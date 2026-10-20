// Extracted from upstream browser-resource-capture.ts; see docs/browser-host.md.
import { randomBytes, randomUUID } from 'node:crypto';
import { observeBrowserRequests } from './browser-request-policy.js';
import type { Session, WebContents } from 'electron';
import {
  BROWSER_RESOURCE_LIMITS as LIMITS, BrowserResourceError, parseBrowserResourceCommand,
  type BrowserResourceCommand, type BrowserResourceGrant, type BrowserResourceItem,
  type BrowserResourceResult, type BrowserResourceSnapshot,
} from '@bezier/contracts';
import { normalizedResourceMime, readResourceName, resourceKind, resourceName, safeResourceUrl, supportedResourceMime, verifyResourceBytes } from './browser-resource-policy.js';

// Fixed program, isolated from page JS. No renderer hints or arbitrary evaluation API.
export const RESOURCE_SCAN_SCRIPT = `(() => {
  const out = []; const seen = new Set();
  const add = (url, width, height, kind) => {
    if (out.length >= 500 || typeof url !== 'string' || url.length > 8192 || seen.has(url)) return;
    seen.add(url); out.push({url, width, height, kind});
  };
  for (const el of document.querySelectorAll('img,video,audio,source')) {
    if (out.length >= 500) break;
    const tag = el.tagName === 'SOURCE' ? el.parentElement?.tagName : el.tagName;
    const kind = tag === 'IMG' ? 'image' : tag === 'VIDEO' ? 'video' : tag === 'AUDIO' ? 'audio' : undefined;
    add(el.currentSrc || el.src, el.naturalWidth || el.videoWidth, el.naturalHeight || el.videoHeight, kind);
    if (el.poster) add(el.poster, undefined, undefined, 'image');
  }
  let count = 0;
  for (const el of document.querySelectorAll('*')) {
    if (++count > 3000 || out.length >= 500) break;
    const bg = getComputedStyle(el).backgroundImage;
    for (const match of bg.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)) {
      try { add(new URL(match[1], document.baseURI).href, undefined, undefined, 'image'); } catch {}
    }
  }
  for (const entry of performance.getEntriesByType('resource').slice(-500)) {
    if (['img', 'css', 'video', 'audio'].includes(entry.initiatorType)) add(entry.name, undefined, undefined, entry.initiatorType === 'img' ? 'image' : entry.initiatorType === 'css' ? undefined : entry.initiatorType);
  }
  return out;
})()`;
const SCAN_WORLD = 1004;
const MAX_GRANTS = 32;
const MAX_PENDING_REQUESTS = 2000;
type Entry = { item: BrowserResourceItem; originalUrl: string; referrer: string };
type Grant = BrowserResourceGrant & {
  projectId: string; tabId: string; guest: WebContents; guestId: number; session: Session; enabled: boolean; navigationId: number;
  generation: number; expiresAt: number; expiry: ReturnType<typeof setTimeout>;
  entries: Map<string, Entry>; urls: Map<string, string>; limitReached: boolean;
  operations: Set<AbortController>; detach: () => void;
};
type RequestEpoch = { grant: Grant; generation: number; url: string; referrer: string };
type Hub = { grants: Set<Grant>; pending: Map<number, RequestEpoch>; detach: () => void };
// Electron only permits one listener per webRequest event. This module owns these
// events centrally for this partition; all enabled guests multiplex through it.
const hubs = new WeakMap<Session, Hub>();
function fail(code: ConstructorParameters<typeof BrowserResourceError>[0], message: string): never {
  throw new BrowserResourceError(code, message);
}
function originalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = ''; return url.href;
  } catch { return; }
}
function addEntry(grant: Grant, rawUrl: unknown, source: 'network' | 'document', mime?: string, size?: number, width?: number, height?: number, referrer?: string, documentKind?: unknown): void {
  const url = originalHttpUrl(rawUrl);
  if (!url) return;
  const existingId = grant.urls.get(url);
  const existing = existingId ? grant.entries.get(existingId) : undefined;
  const dimension = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100_000 ? Math.floor(n) : undefined;
  const observedWidth = dimension(width) ?? existing?.item.width;
  const observedHeight = dimension(height) ?? existing?.item.height;
  if (existing && source === 'document') {
    // DOM evidence enriches network metadata; it must not erase MIME/size or
    // replace the opaque entry while an explicitly requested read is in flight.
    existing.item = { ...existing.item,
      ...(observedWidth ? { width: observedWidth } : {}), ...(observedHeight ? { height: observedHeight } : {}) };
    return;
  }
  // CDN URLs often have no extension. DOM element type is discovery evidence,
  // not MIME authority: the later read still verifies response MIME and magic.
  const kind = resourceKind(url, mime) ?? (source === 'document'
    && (documentKind === 'image' || documentKind === 'video' || documentKind === 'audio') ? documentKind : undefined);
  if (!kind) return;
  if (!existing && grant.entries.size >= LIMITS.items) { grant.limitReached = true; return; }
  const id = existingId ?? randomUUID();
  const unavailableReason = kind === 'svg' || kind === 'stream' || (mime !== undefined && !supportedResourceMime(mime)) ? 'unsupported' : size !== undefined && size > LIMITS.bytes ? 'too-large' : undefined;
  const item: BrowserResourceItem = {
    id, kind, name: resourceName(url), url: safeResourceUrl(url), source, readable: !unavailableReason,
    ...(unavailableReason ? { unavailableReason } : {}), ...(mime ? { mime } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(observedWidth ? { width: observedWidth } : {}), ...(observedHeight ? { height: observedHeight } : {}),
  };
  grant.urls.set(url, id);
  grant.entries.set(id, { item, originalUrl: url, referrer: originalHttpUrl(referrer ?? grant.guest.getURL()) ?? '' });
}
function activate(grant: Grant): void {
  let hub = hubs.get(grant.session);
  if (!hub) {
    const session = grant.session;
    const current: Hub = { grants: new Set(), pending: new Map(), detach: () => {
      stopObserving();
      session.webRequest.onResponseStarted(null);
      session.webRequest.onErrorOccurred(null);
      current.pending.clear(); hubs.delete(session);
    } };
    const stopObserving = observeBrowserRequests(session, details => {
        current.pending.delete(details.id);
        const owner = [...current.grants].find(g => g.enabled && !g.guest.isDestroyed() && g.guestId === details.webContentsId && Date.now() < g.expiresAt);
        const url = originalHttpUrl(details.url);
        if (owner && url && details.method === 'GET' && current.pending.size < MAX_PENDING_REQUESTS) {
          current.pending.set(details.id, { grant: owner, generation: owner.generation, url, referrer: owner.guest.getURL() });
        }
    });
    session.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, details => {
      const request = current.pending.get(details.id); current.pending.delete(details.id);
      if (!request) return;
      const g = request.grant;
      if (!current.grants.has(g) || !g.enabled || g.generation !== request.generation || g.guest.isDestroyed() || Date.now() >= g.expiresAt
        || details.webContentsId !== g.guestId || details.method !== 'GET' || originalHttpUrl(details.url) !== request.url || details.statusCode < 200 || details.statusCode >= 300) return;
      const header = (name: string) => Object.entries(details.responseHeaders ?? {}).find(([key]) => key.toLowerCase() === name)?.[1]?.[0];
      const length = header('content-length');
      const size = length && /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) ? Number(length) : undefined;
      addEntry(g, request.url, 'network', normalizedResourceMime(header('content-type')), size, undefined, undefined, request.referrer);
    });
    session.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*'] }, details => { current.pending.delete(details.id); });
    hubs.set(session, current); hub = current;
  }
  hub.grants.add(grant);
}
function deactivate(grant: Grant): void {
  const hub = hubs.get(grant.session);
  if (!hub) return;
  hub.grants.delete(grant);
  for (const [id, request] of hub.pending) if (request.grant === grant) hub.pending.delete(id);
  if (!hub.grants.size) hub.detach();
}
function clear(grant: Grant): void {
  grant.generation++;
  grant.entries.clear(); grant.urls.clear(); grant.limitReached = false;
  for (const operation of grant.operations) operation.abort(new BrowserResourceError('stale-document', 'Resource capture changed'));
  const hub = hubs.get(grant.session);
  if (hub) for (const [id, request] of hub.pending) if (request.grant === grant) hub.pending.delete(id);
}
/** A WebContents identity can survive a redirect. Bind grants to the discovered
 * application authority as well, including custom-scheme authority (origin=null).
 */
export function isTrustedResourceOwnerUrl(value: string, trustedUrl: string | null): boolean {
  try {
    if (!trustedUrl) return false;
    const expected = new URL(trustedUrl); const actual = new URL(value);
    if (!['http:', 'https:', 'bezier:'].includes(expected.protocol) || (expected.protocol === 'bezier:' && expected.hostname !== 'app')) return false;
    return !actual.username && !actual.password && actual.protocol === expected.protocol && actual.host === expected.host;
  } catch { return false; }
}
export function requireResourceCaptureFrame(event: { sender: unknown; senderFrame: unknown }, owner: { mainFrame: { url: string }; getURL(): string }, trustedUrl: string | null): void {
  if (event.sender !== owner || !event.senderFrame || event.senderFrame !== owner.mainFrame
    || !isTrustedResourceOwnerUrl(owner.mainFrame.url, trustedUrl) || !isTrustedResourceOwnerUrl(owner.getURL(), trustedUrl)) {
    fail('unauthorized', 'Resource grants require the trusted main window frame');
  }
}
export function createBrowserResourceCapture(options: { getGuest: (id: number) => WebContents | undefined; ownerAlive: () => boolean }) {
  const grants = new Map<string, Grant>();
  const byGuest = new Map<number, Grant>();
  let disposed = false;
  function revoke(grant: Grant): void {
    if (grants.get(grant.sessionId) !== grant) return;
    grants.delete(grant.sessionId); byGuest.delete(grant.guestId);
    grant.enabled = false; clear(grant); deactivate(grant); clearTimeout(grant.expiry); grant.detach();
  }
  function authorized(command: BrowserResourceCommand): Grant {
    const grant = grants.get(command.sessionId);
    if (!grant || grant.accessToken !== command.accessToken || grant.projectId !== command.projectId) fail('unauthorized', 'Resource grant is unavailable');
    if (!options.ownerAlive() || grant.guest.isDestroyed() || options.getGuest(grant.guestId) !== grant.guest || Date.now() >= grant.expiresAt) {
      revoke(grant); fail('unauthorized', 'Resource grant expired or closed');
    }
    return grant;
  }
  function snapshot(grant: Grant): BrowserResourceSnapshot {
    return { sessionId: grant.sessionId, projectId: grant.projectId, tabId: grant.tabId, pageUrl: safeResourceUrl(grant.guest.getURL()), title: grant.guest.getTitle().slice(0, 512), navigationId: grant.navigationId, enabled: grant.enabled, items: [...grant.entries.values()].map(e => ({ ...e.item })), limitReached: grant.limitReached };
  }
  async function operation<T>(grant: Grant, work: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    if (grant.operations.size >= 4) fail('unavailable', 'Too many resource operations');
    const controller = new AbortController(); grant.operations.add(controller);
    const generation = grant.generation;
    const pageUrl = grant.guest.getURL();
    const check = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      authorized({ ...grant, action: 'snapshot' });
      if (!grant.enabled || generation !== grant.generation || grant.guest.getURL() !== pageUrl || grant.guest.isLoadingMainFrame()) fail('stale-document', 'Resource document changed');
    };
    const timeout = setTimeout(() => controller.abort(new BrowserResourceError('timeout', 'Resource operation timed out')), LIMITS.readTimeoutMs);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try { check(); return await Promise.race([work(controller.signal, check), aborted]); }
    catch (error) {
      if (error instanceof BrowserResourceError) throw error;
      return fail('read-failed', 'Resource operation failed'); // Never export URLs/headers from native errors.
    } finally {
      clearTimeout(timeout); if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      controller.abort(); grant.operations.delete(controller);
    }
  }
  async function scan(grant: Grant): Promise<void> {
    await operation(grant, async (_signal, check) => {
      const result: unknown = await grant.guest.executeJavaScriptInIsolatedWorld(SCAN_WORLD, [{ code: RESOURCE_SCAN_SCRIPT }]);
      check();
      if (!Array.isArray(result)) return;
      for (const row of result.slice(0, LIMITS.items)) {
        if (!row || typeof row !== 'object') continue;
        addEntry(grant, row.url, 'document', undefined, undefined, row.width, row.height, undefined, row.kind);
      }
    });
  }
  return {
    open(guestId: number, projectId: string, tabId: string): BrowserResourceGrant {
      if (!Number.isSafeInteger(guestId) || guestId <= 0 || typeof projectId !== 'string' || !projectId.trim() || projectId.length > 256 || typeof tabId !== 'string' || !tabId.trim() || tabId.length > 256 || /[\x00-\x1f]/.test(projectId + tabId)) fail('invalid-request', 'Invalid resource grant');
      const guest = options.getGuest(guestId);
      if (disposed || !options.ownerAlive() || !guest || guest.isDestroyed()) fail('unauthorized', 'Browser guest is not owned by this window');
      const previous = byGuest.get(guestId); if (previous) revoke(previous);
      if (grants.size >= MAX_GRANTS) fail('unavailable', 'Resource grant limit reached');
      // Native WebContents getters throw once `destroyed` fires. Cleanup must
      // use these stable values captured while the guest is still alive.
      const grant: Grant = { sessionId: randomUUID(), accessToken: randomBytes(32).toString('base64url'), projectId, tabId, guest, guestId, session: guest.session, enabled: false, navigationId: 0, generation: 0, expiresAt: Date.now() + LIMITS.grantLifetimeMs, expiry: undefined!, entries: new Map(), urls: new Map(), limitReached: false, operations: new Set(), detach: () => {} };
      const navigate = (details: { isMainFrame: boolean }) => { if (details.isMainFrame) { grant.navigationId++; clear(grant); } };
      const crashed = () => { grant.navigationId++; clear(grant); };
      // Discard old-document requests launched during a pending navigation too.
      // The public navigation id advances at start; commit only advances the private epoch.
      const committed = () => clear(grant);
      const destroyed = () => revoke(grant);
      guest.on('did-start-navigation', navigate); guest.on('did-navigate', committed); guest.on('render-process-gone', crashed); guest.once('destroyed', destroyed);
      grant.detach = () => { guest.removeListener('did-start-navigation', navigate); guest.removeListener('did-navigate', committed); guest.removeListener('render-process-gone', crashed); guest.removeListener('destroyed', destroyed); };
      grant.expiry = setTimeout(() => revoke(grant), LIMITS.grantLifetimeMs); grant.expiry.unref?.();
      grants.set(grant.sessionId, grant); byGuest.set(guestId, grant);
      return { sessionId: grant.sessionId, accessToken: grant.accessToken };
    },
    close(sessionId: string, accessToken: string): void {
      const grant = grants.get(sessionId);
      if (!grant) return;
      if (grant.accessToken !== accessToken) fail('unauthorized', 'Resource grant is unavailable');
      revoke(grant);
    },
    revokeAll(): void { for (const grant of [...grants.values()]) revoke(grant); },
    dispose(): void { disposed = true; for (const grant of [...grants.values()]) revoke(grant); },
    async execute(input: BrowserResourceCommand): Promise<BrowserResourceResult> {
      const command = parseBrowserResourceCommand(input);
      const grant = authorized(command);
      if (command.action === 'stop') { grant.enabled = false; clear(grant); deactivate(grant); return snapshot(grant); }
      if (command.action === 'snapshot') return snapshot(grant);
      if (command.action === 'start') {
        const wasEnabled = grant.enabled;
        if (!wasEnabled) { grant.enabled = true; activate(grant); }
        try { await scan(grant); authorized(command); return snapshot(grant); }
        catch (error) {
          // A failed initial start must not leave an invisible observer enabled.
          if (!wasEnabled) { grant.enabled = false; clear(grant); deactivate(grant); }
          throw error;
        }
      }
      if (!grant.enabled) fail('unavailable', 'Resource capture is disabled');
      if (command.action === 'scan') { await scan(grant); return snapshot(grant); }
      if (command.action !== 'read') return fail('invalid-request', 'Invalid resource command');
      if (command.navigationId !== grant.navigationId) fail('stale-document', 'Resource document changed');
      const entry = grant.entries.get(command.resourceId);
      if (!entry) fail('stale-document', 'Resource is no longer observed');
      if (!entry.item.readable) fail(entry.item.unavailableReason === 'too-large' ? 'too-large' : 'unsupported-resource', 'Resource is metadata-only');
      return operation(grant, async (signal, check) => {
        check();
        const response = await grant.session.fetch(entry.originalUrl, { method: 'GET', credentials: 'include', referrer: entry.referrer, redirect: 'error', signal });
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const cancel = () => { void reader?.cancel().catch(() => undefined); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          check();
          // This API imports whole files, not ranged/segmented stream assembly.
          if (response.status !== 200 || response.redirected || response.headers.has('content-range')) fail('read-failed', 'Resource response unavailable');
          const mime = normalizedResourceMime(response.headers.get('content-type') ?? undefined);
          if (!mime || resourceKind(entry.originalUrl, mime) !== entry.item.kind) fail('unsupported-resource', 'Resource MIME does not match');
          const length = response.headers.get('content-length');
          if (length && Number(length) > LIMITS.bytes) fail('too-large', 'Resource exceeds 25 MiB');
          if (!response.body) fail('read-failed', 'Resource body unavailable');
          reader = response.body.getReader();
          let total = 0; const chunks: Buffer[] = [];
          while (true) {
            check();
            const part = await reader.read(); check();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > LIMITS.bytes) fail('too-large', 'Resource exceeds 25 MiB');
            chunks.push(Buffer.from(part.value));
          }
          const bytes = Buffer.concat(chunks, total);
          if (!verifyResourceBytes(bytes, mime)) fail('unsupported-resource', 'Resource signature is unsupported');
          check();
          if (grant.entries.get(command.resourceId) !== entry) fail('stale-document', 'Resource is no longer observed');
          return { resourceId: command.resourceId, navigationId: command.navigationId, pageUrl: safeResourceUrl(grant.guest.getURL()), name: readResourceName(entry.originalUrl, mime), mime, base64: bytes.toString('base64') };
        } finally {
          signal.removeEventListener('abort', cancel);
          if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
          else { void response.body?.cancel().catch(() => undefined); }
        }
      });
    },
  };
}
