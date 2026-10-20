import type { BrowserAssetInspectorData } from '../../../packages/contracts/src/api/browser-capture.js';
/**
 * DA Browser Extension — service worker.
 *
 * Scope: `kind: 'selection'` (JSON) and `kind: 'image'` (raw picture bytes).
 * Other kinds are still rejected by the desktop bridge.
 *
 * The worker is the only place that talks to DA. The content script (which now
 * runs on every site) holds no credentials and cannot reach DA on its own; it
 * can only ask the worker to act. That keeps a hostile page from gaining
 * anything beyond the text the user explicitly selected.
 *
 * Security posture mirrors the Pinterest experiment's worker:
 * - find DA on 127.0.0.1 first (any Chromium browser), Native Messaging as fallback;
 * - the one-time upload claim lives in `chrome.storage.session`, never
 *   `local`/`sync`, and is dropped the moment it is used or expires;
 * - the selection arrives from a user gesture, never a background scan.
 */

// Imported from the source module rather than the package root: the root
// barrel pulls in the whole contracts surface (~450 KB bundled) when all the
// extension needs is the YAML pair. Same code either way — this must stay the
// app's own parser so the extension accepts exactly what the app accepts.
import { assetMetadataYaml, parseAssetMetadataYaml } from '../../../packages/contracts/src/api/asset-yaml.js';
import {
  ALLOWED_IMAGE_MIMES,
  BROWSER_CAPTURE_IMAGE_CONTENT_TYPE,
  BROWSER_CAPTURE_LIMITS,
  encodeBrowserCaptureImageBody,
  sniffImageMime,
} from '../../../packages/contracts/src/api/browser-capture.js';
import { previewFromImageBytes, type ImageFilePreview } from './image-preview.js';
import { claimDaBridge, discoverDaBridge } from './da-discovery.js';
import { bindExtensionLocale, currentExtensionLocale, eu, extensionLocaleStorageKey, extensionUiLocale, localizeBridgeError } from './locales/extension-ui.js';

const NATIVE_HOST = 'com.canvas_workspace.browser_bridge';
const EXTENSION_VERSION = '0.3.0';
const CONTEXT_MENU_ID = 'da-send-selection';
const IMAGE_MENU_ID = 'da-send-image';

type InspectorReply = {ok: boolean; message: string; assetData?: BrowserAssetInspectorData; sessionId?: string; inspectorId?: string};
type InspectorHandle = {sessionId: string; tabId: number; expires: number};

type Space = { id: string; name: string };

type CaptureClaim = {
  protocolVersion: number;
  uploadUrl: string;
  token: string;
  expiresAt: number;
  context: {
    connected: boolean;
    projectName: string | null;
    canWrite: boolean;
    spaces?: Space[];
    defaultSpaceId?: string;
    tags?: string[];
    locale?: string;
  };
};

type AssetMeta = {
  name: string;
  spaceId?: string;
  description?: string;
  style?: string;
  usage?: string;
  tags?: string[];
  rating?: number;
  aiFill?: boolean;
};

export type WorkerState = {
  phase: 'idle' | 'ready' | 'sending' | 'done' | 'error';
  message: string;
  projectName?: string | null;
  canWrite?: boolean;
};

declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    connectNative(host: string): {
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(fn: (message: unknown) => void): void };
      onDisconnect: { addListener(fn: () => void): void };
    };
    onInstalled: { addListener(fn: () => void): void };
    onMessage: {
      addListener(
        fn: (
          message: Record<string, unknown>,
          sender: { id?: string; url?: string; tab?: { id?: number } },
          reply: (value: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  storage: {
    session: { get(key: string): Promise<Record<string, any>>; set(v: Record<string, unknown>): Promise<void> };
    local: { get(key: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> };
  };
  action: { setBadgeText(o: { text: string }): Promise<void> };
  tabs: {
    query(o: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; url?: string; title?: string }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  contextMenus: {
    create(o: { id: string; title: string; contexts: string[] }): void;
    removeAll(cb?: () => void): void;
    onClicked: { addListener(fn: (info: { menuItemId: string; srcUrl?: string }, tab?: { id?: number }) => void): void };
  };
  declarativeNetRequest?: {
    updateSessionRules(o: {
      removeRuleIds: number[];
      addRules?: Array<{
        id: number;
        priority: number;
        action: { type: 'modifyHeaders'; requestHeaders: Array<{ header: string; operation: 'set'; value: string }> };
        condition: { requestDomains: string[]; resourceTypes: string[] };
      }>;
    }): Promise<void>;
  };
};

type NativeRequest = {
  type: 'claim' | 'status';
  protocolVersion: number;
  extensionVersion: string;
};
type NativeResponse = Record<string, unknown>;
type NativePort = ReturnType<typeof chrome.runtime.connectNative>;

let nativePort: NativePort | null = null;
let nativeBackoffMs = 500;
let nativeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let httpBridgePort: number | null = null;
const nativePending: Array<{
  port: NativePort;
  resolve: (value: NativeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

function rejectNativePendingFor(port: NativePort, message: string): void {
  for (let index = nativePending.length - 1; index >= 0; index -= 1) {
    if (nativePending[index].port !== port) continue;
    const [item] = nativePending.splice(index, 1);
    clearTimeout(item.timer);
    item.reject(new Error(message));
  }
}

function scheduleNativeReconnect(): void {
  if (nativeReconnectTimer) return;
  nativeReconnectTimer = setTimeout(() => {
    nativeReconnectTimer = null;
    ensureNativePort();
  }, nativeBackoffMs);
  nativeBackoffMs = Math.min(nativeBackoffMs * 2, 5000);
}

function ensureNativePort(): NativePort | null {
  if (nativePort) return nativePort;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener(message => {
      if (nativePort !== port) return;
      nativeBackoffMs = 500;
      const index = nativePending.findIndex(item => item.port === port);
      const item = index >= 0 ? nativePending.splice(index, 1)[0] : undefined;
      if (!item) return;
      clearTimeout(item.timer);
      item.resolve(message && typeof message === 'object' ? message as NativeResponse : {});
    });
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      nativePort = null;
      rejectNativePendingFor(port, eu().nativeDisconnected);
      scheduleNativeReconnect();
    });
    return port;
  } catch {
    nativePort = null;
    scheduleNativeReconnect();
    return null;
  }
}

function nativeRequest(message: NativeRequest): Promise<NativeResponse> {
  const port = ensureNativePort();
  if (!port) return Promise.reject(new Error(eu().nativeUnavailable));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = nativePending.findIndex(item => item.timer === timer);
      if (index >= 0) nativePending.splice(index, 1);
      reject(new Error(eu().nativeTimeout));
      if (nativePort === port) { nativePort = null; port.disconnect(); }
      scheduleNativeReconnect();
    }, 4500);
    nativePending.push({ port, resolve, reject, timer });
    try { port.postMessage(message); }
    catch (error) {
      const index = nativePending.findIndex(item => item.timer === timer);
      const item = index >= 0 ? nativePending.splice(index, 1)[0] : undefined;
      if (item) clearTimeout(item.timer);
      reject(error instanceof Error ? error : new Error(eu().nativeUnavailable));
      if (nativePort === port) nativePort = null;
      scheduleNativeReconnect();
    }
  });
}


function badge(text: string): void {
  void chrome.action.setBadgeText({ text }).catch(() => undefined);
}

/**
 * Asks the desktop for a fresh one-time upload claim. DA re-arms its bridge
 * after every completed capture, so this is safe to call before each send
 * rather than caching a claim across captures.
 */
async function parseClaimResponse(raw: unknown): Promise<{ ok: true; claim: CaptureClaim } | { ok: false; message: string }> {
  if (!raw || typeof raw !== 'object') return { ok: false, message: eu().claimInvalid };
  const { code, error } = raw as { code?: unknown; error?: unknown };
  if (typeof error === 'string') return { ok: false, message: localizeBridgeError(error, eu().nativeUnavailable) };
  if (typeof code !== 'string') return { ok: false, message: eu().claimMissingToken };
  let parsed: CaptureClaim;
  try {
    parsed = JSON.parse(code) as CaptureClaim;
  } catch {
    return { ok: false, message: eu().claimParseFailed };
  }
  let url: URL;
  try {
    url = new URL(parsed.uploadUrl);
  } catch {
    return { ok: false, message: eu().badAddress };
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/v1/captures') {
    return { ok: false, message: eu().badAddress };
  }
  if (typeof parsed.token !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.token)) {
    return { ok: false, message: eu().badToken };
  }
  await chrome.storage.session.set({ claim: parsed });
  return { ok: true, claim: parsed };
}

async function claimBridge(): Promise<{ ok: true; claim: CaptureClaim } | { ok: false; message: string }> {
  if (!httpBridgePort) {
    const found = await discoverDaBridge();
    if (found) httpBridgePort = found.port;
  }
  if (httpBridgePort) {
    try {
      const raw = await claimDaBridge(httpBridgePort, {
        type: 'claim',
        protocolVersion: 1,
        extensionVersion: EXTENSION_VERSION,
      });
      return await parseClaimResponse(raw);
    } catch {
      httpBridgePort = null;
    }
  }
  try {
    return await parseClaimResponse(await nativeRequest({
      type: 'claim',
      protocolVersion: 1,
      extensionVersion: EXTENSION_VERSION,
    }));
  } catch {
    return { ok: false, message: eu().appNotFound };
  }
}

/**
 * Reads DA's readiness without consuming anything. Deliberately distinct from
 * `claimBridge`: this is safe to call on every selection, whereas a claim
 * mints a single-use upload credential and must only happen when the user
 * actually saves. Merging the two is what used to make a status check break
 * the capture that followed it.
 */

function installContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: eu().saveSelection, contexts: ["selection"] });
    chrome.contextMenus.create({ id: IMAGE_MENU_ID, title: eu().saveOriginal, contexts: ["image"] });
  });
}

function rememberAppLocale(locale: unknown): void {
  if (typeof locale !== "string" || !locale.trim()) return;
  const next = extensionUiLocale(locale);
  if (next === currentExtensionLocale()) return;
  bindExtensionLocale(locale);
  void chrome.storage.local.set({ [extensionLocaleStorageKey()]: currentExtensionLocale() }).catch(() => undefined);
  installContextMenus();
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) void chrome.tabs.sendMessage(tab.id, { type: "locale", locale: currentExtensionLocale() }).catch(() => undefined);
    }
  }).catch(() => undefined);
}

async function probeBridge(): Promise<
  { ok: true; status: CaptureClaim['context'] } | { ok: false; message: string }
> {
  const found = await discoverDaBridge();
  if (found) {
    httpBridgePort = found.port;
    rememberAppLocale(found.status.locale);
    return { ok: true, status: found.status };
  }
  httpBridgePort = null;
  let raw: unknown;
  try {
    raw = await nativeRequest({
      type: 'status',
      protocolVersion: 1,
      extensionVersion: EXTENSION_VERSION,
    });
  } catch {
    return { ok: false, message: eu().appNotFound };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, message: eu().badResponse };
  const { status, error } = raw as { status?: unknown; error?: unknown };
  if (typeof error === 'string') return { ok: false, message: localizeBridgeError(error, eu().appNotFound) };
  if (!status || typeof status !== 'object') return { ok: false, message: eu().statusMissing };
  rememberAppLocale((status as { locale?: unknown }).locale);
  return { ok: true, status: status as CaptureClaim['context'] };
}

/**
 * Turns a readiness snapshot into what the UI should say, so the toolbar and
 * the dialog can never disagree about whether saving is possible.
 */
function describeContext(context: CaptureClaim['context']): {
  ok: boolean; message: string; projectName?: string | null;
  canWrite?: boolean; spaces?: Space[]; defaultSpaceId?: string; tags?: string[];
} {
  // No project open is no longer a dead state: a personal-asset save (the
  // only intent this extension ever sends) does not need a project as a
  // container, so an open project is reported as a richer label rather than
  // a precondition. `canWrite` carries "a save can land at all"; the project
  // name only refines the status text.
  if (!context.canWrite) {
    if (context.projectName) return { ok: false, message: eu().projectReadOnly(context.projectName) };
    return { ok: false, message: eu().appNotReady };
  }
  return {
    ok: true,
    message: context.projectName ? eu().connectedProject(context.projectName) : eu().connectedLibrary,
    projectName: context.projectName ?? null,
    canWrite: true,
    spaces: context.spaces ?? [],
    ...(context.defaultSpaceId ? { defaultSpaceId: context.defaultSpaceId } : {}),
    tags: context.tags ?? [],
  };
}

/** Everything the dialog needs before it can render its space picker. */
async function rememberContext(context: {
  ok: boolean; message: string; projectName?: string | null;
  canWrite?: boolean; spaces?: Space[]; defaultSpaceId?: string; tags?: string[];
}): Promise<typeof context> {
  try { await chrome.storage.session.set({ daContext: context }); } catch { /* session may be unavailable */ }
  return context;
}

async function connectForDialog(): Promise<{
  ok: boolean; message: string; projectName?: string | null;
  canWrite?: boolean; spaces?: Space[]; defaultSpaceId?: string; tags?: string[];
}> {
  const probe = await probeBridge();
  if (!probe.ok) { badge(''); return rememberContext({ ok: false, message: probe.message }); }
  badge('·');
  return rememberContext(describeContext(probe.status));
}


function toBytes(value: unknown): Uint8Array {
  if (!value) return new Uint8Array();
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return new Uint8Array(value as ArrayBuffer);
  }
  return new Uint8Array();
}

const imageStash = new Map<string, { bytes: Uint8Array; mime: string }>();

function stashImageBytes(bytes: Uint8Array, mime: string): string {
  if (imageStash.size > 4) {
    const oldest = imageStash.keys().next().value;
    if (oldest) imageStash.delete(oldest);
  }
  const id = `img_${crypto.randomUUID().replace(/-/g, '')}`;
  imageStash.set(id, { bytes, mime });
  return id;
}

function readStashedImage(id: string | undefined): Uint8Array | null {
  if (!id) return null;
  const entry = imageStash.get(id);
  if (!entry) return null;
  return entry.bytes;
}

async function stashWithPreview(bytes: Uint8Array, mime: string): Promise<{
  ok: true; stashId: string; mime: string; byteLength: number; preview: ImageFilePreview;
}> {
  const stashId = stashImageBytes(bytes, mime);
  const preview = await previewFromImageBytes(bytes, mime);
  return { ok: true, stashId, mime, byteLength: bytes.byteLength, preview };
}

async function postCapture(contentType: string, body: BodyInit, timeoutMs: number): Promise<InspectorReply> {
  await chrome.storage.session.set({ claim: null });
  const claimed = await claimBridge();
  if (!claimed.ok) return { ok: false, message: claimed.message };
  const active = claimed.claim;
  if (!active.context.canWrite) return { ok: false, message: eu().notWritable };

  badge('…');
  let response: Response;
  try {
    response = await fetch(active.uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${active.token}`, 'Content-Type': contentType },
      body,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    await chrome.storage.session.set({ claim: null });
    badge('');
    return { ok: false, message: eu().sendFailed };
  }
  await chrome.storage.session.set({ claim: null });
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = await response.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch { /* A successful HTTP status alone never confirms a saved capture. */ }
  const message = typeof parsed.message === 'string' ? parsed.message : undefined;
  badge('');
  if (response.status === 202) return { ok: false, message: message ?? eu().deliveredUnconfirmed };
  const assetData = parsed.assetData as BrowserAssetInspectorData | undefined;
  const validAssetData = assetData === undefined || (assetData !== null && typeof assetData === 'object'
    && !Array.isArray(assetData) && assetData.asset !== null && typeof assetData.asset === 'object'
    && typeof assetData.asset.id === 'string' && assetData.asset.id.length > 0);
  const sessionId = parsed.sessionId;
  const validSession = sessionId === undefined || (typeof sessionId === 'string' && /^[a-f0-9]{64}$/.test(sessionId) && assetData !== undefined);
  if (response.ok && parsed.ok === true && parsed.status === 'saved' && validAssetData && validSession) {
    badge('✓');
    // Preserve the host's result until onMessage replaces the private session
    // with an opaque, sender-tab-bound inspector handle. Never forward raw JSON.
    return { ok: true, message: message ?? eu().savedToLibrary,
      ...(assetData === undefined ? {} : { assetData }),
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
    };
  }
  return { ok: false, message: message ?? (response.ok ? eu().badResponse : eu().sendCheckApp) };
}

async function saveCapture(message: Record<string, unknown>): Promise<InspectorReply> {
  const asset = message.asset as AssetMeta;
  const capture = (message.capture ?? {}) as {
    text?: string;
    pageUrl?: string;
    title?: string;
    imageUrl?: string;
    alt?: string;
    mime?: string;
    filenameHint?: string;
  };
  const kind = message.kind === 'image' || message.bytes ? 'image' : 'selection';
  const pageUrl = String(capture.pageUrl || '');
  const title = capture.title;

  if (kind === 'image') {
    const imageBytes = readStashedImage(typeof message.stashId === 'string' ? message.stashId : undefined)
      || toBytes(message.bytes);
    if (imageBytes.byteLength === 0) return { ok: false, message: eu().emptyImage };
    const mime = String(capture.mime || '');
    const metadata = {
      schema: 'bezier-design.browser-capture.v1' as const,
      captureId: `cap_${crypto.randomUUID().replace(/-/g, '')}`,
      kind: 'image' as const,
      intent: 'save_personal_asset' as const,
      source: { pageUrl, ...(title ? { title } : {}) },
      resource: {
        url: String(capture.imageUrl || ''),
        mime,
        ...(capture.alt ? { alt: capture.alt } : {}),
      },
      asset,
      provenance: {
        captureMode: 'original-resource' as const,
        capturedAt: new Date().toISOString(),
        extensionVersion: EXTENSION_VERSION,
      },
    };
    const result = await postCapture(BROWSER_CAPTURE_IMAGE_CONTENT_TYPE, new Uint8Array(encodeBrowserCaptureImageBody(metadata, imageBytes)).buffer, 60000);
    if (result.ok && typeof message.stashId === 'string') imageStash.delete(message.stashId);
    return result;
  }

  const text = String(capture.text || '').trim();
  if (!text) return { ok: false, message: eu().emptySelection };
  const envelope = {
    schema: 'bezier-design.browser-capture.v1',
    captureId: `cap_${crypto.randomUUID().replace(/-/g, '')}`,
    kind: 'selection',
    intent: 'save_personal_asset',
    source: { pageUrl, ...(title ? { title } : {}) },
    selection: { text },
    asset,
    provenance: {
      captureMode: 'selection',
      capturedAt: new Date().toISOString(),
      extensionVersion: EXTENSION_VERSION,
    },
  };
  return postCapture('application/json', JSON.stringify(envelope), 30000);
}

/** Popup path: connection state only; the popup no longer captures anything. */
async function popupStatus(): Promise<WorkerState> {
  const result = await connectForDialog();
  return result.ok
    ? { phase: 'ready', message: result.message, projectName: result.projectName, canWrite: true }
    : { phase: 'error', message: result.message };
}


/** Download original bytes with extension privileges (bypasses page CORS).
 *  Behance/CDN images fail if the content script fetches them as the page. */
const IMAGE_REFERER_RULE_ID = 9001;

async function withPageReferer(imageUrl: string, pageUrl: string | undefined, run: () => Promise<Response>): Promise<Response> {
  const dnr = chrome.declarativeNetRequest;
  let armed = false;
  if (dnr && pageUrl && /^https?:/i.test(pageUrl)) {
    try {
      const imageHost = new URL(imageUrl).hostname;
      const pageOrigin = new URL(pageUrl).origin;
      await dnr.updateSessionRules({
        removeRuleIds: [IMAGE_REFERER_RULE_ID],
        addRules: [{
          id: IMAGE_REFERER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: pageUrl },
              { header: 'Origin', operation: 'set', value: pageOrigin },
            ],
          },
          condition: { requestDomains: [imageHost], resourceTypes: ['xmlhttprequest', 'other'] },
        }],
      });
      armed = true;
    } catch { /* rule install is best-effort */ }
  }
  try {
    return await run();
  } finally {
    if (armed) {
      try { await dnr!.updateSessionRules({ removeRuleIds: [IMAGE_REFERER_RULE_ID] }); } catch { /* ignore */ }
    }
  }
}

async function readFetchedImage(response: Response): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; message: string }> {
  if (!response.ok) return { ok: false, message: eu().imageResponse(response.status) };
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > BROWSER_CAPTURE_LIMITS.imagePayloadBytes) {
    return { ok: false, message: eu().imageTooLarge };
  }
  let mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const sniffed = sniffImageMime(new Uint8Array(bytes));
  if (sniffed) mime = sniffed;
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
    return { ok: false, message: eu().unsupportedImage(mime) };
  }
  return { ok: true, bytes, mime };
}

async function fetchImageBytes(url: string, pageUrl?: string) {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, message: eu().httpImagesOnly };
  }
  const pull = () => fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'force-cache' });
  const pack = async (result: Awaited<ReturnType<typeof readFetchedImage>>) => {
    if (!result.ok) return result;
    const bytes = new Uint8Array(result.bytes);
    return stashWithPreview(bytes, result.mime);
  };
  try {
    const withRef = await pack(await readFetchedImage(await withPageReferer(url, pageUrl, pull)));
    if (withRef.ok) return withRef;
    const bare = await pack(await readFetchedImage(await pull()));
    if (bare.ok) return bare;
    return withRef;
  } catch {
    try {
      return await pack(await readFetchedImage(await pull()));
    } catch {
      return { ok: false, message: eu().downloadBlocked };
    }
  }
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.then(() => undefined, () => undefined);
  return next;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Accept only our own popup and our own content scripts. A content-script
  // sender always carries a tab; the popup never does.
  if (sender.id !== chrome.runtime.id) return false;
  const fromOwnPopup = (() => {
    if (!sender.url || sender.tab) return false;
    try {
      const url = new URL(sender.url);
      return url.origin === new URL(chrome.runtime.getURL('popup.html')).origin && url.pathname === '/popup.html';
    } catch { return false; }
  })();
  if (!fromOwnPopup && !sender.tab?.id) return false;

  const type = message?.type;

  // YAML round-trips here so the extension reuses DA's own parser rather than
  // a lookalike that could accept metadata the app itself would reject.
  if (type === 'locale') {
    reply({ locale: currentExtensionLocale() });
    return true;
  }
  if (type === 'to-yaml') {
    try {
      const value = message.value as { name: string; description: string; tags: string[]; style: string; usage: string };
      reply({ ok: true, yaml: assetMetadataYaml(value) });
    } catch (error) {
      reply({ ok: false, message: error instanceof Error ? error.message : eu().yamlFailed });
    }
    return true;
  }
  if (type === 'from-yaml') {
    try {
      reply({ ok: true, value: parseAssetMetadataYaml(String(message.yaml ?? '')) });
    } catch (error) {
      reply({ ok: false, message: error instanceof Error ? error.message : eu().yamlInvalid });
    }
    return true;
  }

  if (type === 'connect') {
    void connectForDialog()
      .then(reply)
      .catch(() => reply({ ok: false, message: eu().extensionUnavailable }));
    return true;
  }
  // Cheap, credential-free readiness check the selection toolbar runs so it
  // can show connection state before the user commits to opening the panel.
  if (type === 'probe') {
    void connectForDialog()
      .then(reply)
      .catch(() => reply({ ok: false, message: eu().extensionUnavailable }));
    return true;
  }
  if (type === 'inspect-asset') {
    const tabId = sender.tab?.id;
    void serial(async () => {
      const handles = (await chrome.storage.session.get('assetInspectors')).assetInspectors as Record<string, InspectorHandle> | undefined;
      const handle = handles?.[String(message.inspectorId)];
      if (!handle || handle.tabId !== tabId || handle.expires < Date.now()) return {ok: false, message: eu().inspectorExpired};
      if (!['read','update','analyze','prompt'].includes(String(message.action))) return {ok: false, message: eu().assetActionInvalid};
      const result = await postCapture('application/json', JSON.stringify({schema: 'design-ai.browser-asset-inspector.v1', sessionId: handle.sessionId, action: message.action, ...(message.action === 'update' ? {patch: message.patch} : {})}), 30000);
      delete result.sessionId;
      return result;
    }).then(reply).catch(() => reply({ok: false, message: eu().connectFailed}));
    return true;
  }
  if (type === 'save-capture' || type === 'save-asset' || type === 'save-image') {
    void serial(async () => {
      const result = await saveCapture(message);
      if (result.ok && result.sessionId && typeof sender.tab?.id === 'number') {
        const handles = ((await chrome.storage.session.get('assetInspectors')).assetInspectors ?? {}) as Record<string, InspectorHandle>;
        for (const [key, value] of Object.entries(handles)) if (value.expires < Date.now()) delete handles[key];
        if (Object.keys(handles).length >= 100) delete handles[Object.keys(handles)[0]!];
        const inspectorId = crypto.randomUUID();
        handles[inspectorId] = {sessionId: result.sessionId, tabId: sender.tab.id, expires: Date.now() + 30 * 60_000};
        await chrome.storage.session.set({assetInspectors: handles});
        result.inspectorId = inspectorId;
      }
      delete result.sessionId;
      return result;
    })
      .then(reply)
      .catch(() => reply({ ok: false, message: eu().saveFailed }));
    return true;
  }
  if (type === 'stash-image') {
    const bytes = toBytes(message.bytes);
    const mime = String(message.mime || '');
    if (bytes.byteLength === 0) { reply({ ok: false, message: eu().emptyImage }); return true; }
    void stashWithPreview(bytes, mime).then(reply).catch(() => reply({ ok: false, message: eu().stashFailed }));
    return true;
  }
  if (type === 'fetch-image') {
    void fetchImageBytes(String(message.url || ''), typeof message.pageUrl === 'string' ? message.pageUrl : undefined)
      .then(reply)
      .catch(() => reply({ ok: false, message: eu().downloadFailed }));
    return true;
  }
  if (type === 'status') {
    void popupStatus()
      .then(reply)
      .catch(() => reply({ phase: 'error', message: eu().extensionUnavailable } satisfies WorkerState));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => { installContextMenus(); });
void chrome.storage.local.get(extensionLocaleStorageKey()).then((stored) => {
  const saved = stored[extensionLocaleStorageKey()];
  if (typeof saved === "string") bindExtensionLocale(saved);
  installContextMenus();
}).catch(() => installContextMenus());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === CONTEXT_MENU_ID) {
    void chrome.tabs.sendMessage(tab.id, { type: 'open-dialog' }).catch(() => undefined);
    return;
  }
  if (info.menuItemId === IMAGE_MENU_ID) {
    // Ask the content script to fetch the image bytes (it owns the page's
    // credentials/origin context) and send them back; the worker then forwards
    // to DA. The content script is the only place that can fetch the image
    // with the page's own session.
    void chrome.tabs.sendMessage(tab.id, { type: 'capture-image', srcUrl: info.srcUrl }).catch(() => undefined);
  }
});

export {};
