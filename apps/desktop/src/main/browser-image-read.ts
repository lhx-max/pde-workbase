import type { WebContents } from 'electron';
import type { BezierHostBrowserImage } from '@bezier/host';
import { readBrowserImage } from './browser-resource.js';

export const BROWSER_IMAGE_READ_TIMEOUT_MS = 30_000;
// Separate from the page (0) and Electron preload (999), so page scripts cannot
// replace Array/DOM accessors to turn image attestation into a fetch proxy.
const IMAGE_ATTESTATION_WORLD = 1004;

type ImageGuest = Pick<WebContents, 'isDestroyed' | 'isLoadingMainFrame' | 'getURL' | 'getTitle'
  | 'executeJavaScriptInIsolatedWorld' | 'session' | 'on' | 'removeListener'>;
export type BrowserImageCollector = { guest: ImageGuest; enabled: boolean };

function webUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//i.test(value)) throw new Error('Only HTTP(S) image URLs are supported');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^https?:\/\/[^/]*@/i.test(value)) {
    throw new Error('Only HTTP(S) URLs without credentials are supported');
  }
  return url.href;
}

/** A read is bound to one enabled, registered guest document for its entire life.
 * Native navigation events invalidate even same-URL reloads; isolated-world DOM
 * attestation is repeated before returning bytes. This never emits or saves.
 */
export function createBrowserImageReader(options: {
  getCollector(guestId: number): BrowserImageCollector | undefined;
  ownerAlive(): boolean;
}) {
  const pending = new Map<number, Set<AbortController>>();
  const cancelGuest = (guestId: number) => {
    for (const abort of pending.get(guestId) ?? []) abort.abort(new Error('Image source is no longer available'));
  };

  const read = async (guestId: number, input: string): Promise<BezierHostBrowserImage> => {
    if (!Number.isSafeInteger(guestId) || guestId <= 0) throw new Error('Invalid browser guest');
    const url = webUrl(input);
    const entry = options.getCollector(guestId);
    if (!options.ownerAlive() || !entry?.enabled || entry.guest.isDestroyed()) throw new Error('Image collector is unavailable');
    const guest = entry.guest;
    // Snapshot BEFORE the first await, not after a possibly delayed DOM query.
    const pageUrl = webUrl(guest.getURL());
    const title = guest.getTitle();
    const abort = new AbortController();
    const requests = pending.get(guestId) ?? new Set<AbortController>();
    pending.set(guestId, requests);
    requests.add(abort);
    const invalidate = () => abort.abort(new Error('Image source document changed'));
    const navigating = (details: { isMainFrame: boolean }) => {
      if (details.isMainFrame) invalidate();
    };
    guest.on('did-start-navigation', navigating);
    guest.on('destroyed', invalidate);
    guest.on('render-process-gone', invalidate);
    const timeout = setTimeout(() => abort.abort(new Error('Image read timed out')), BROWSER_IMAGE_READ_TIMEOUT_MS);
    const assertCurrent = () => {
      abort.signal.throwIfAborted();
      if (!options.ownerAlive() || options.getCollector(guestId) !== entry || !entry.enabled
        || guest.isDestroyed() || guest.isLoadingMainFrame() || guest.getURL() !== pageUrl) {
        throw new Error('Image source document changed');
      }
    };
    const attest = async (): Promise<number> => {
      assertCurrent();
      const result: unknown = await guest.executeJavaScriptInIsolatedWorld(IMAGE_ATTESTATION_WORLD, [{ code: `(() => ({
        pageUrl: location.href,
        documentTime: performance.timeOrigin,
        present: Array.from(document.images).some(image => image.currentSrc === ${JSON.stringify(url)} || image.src === ${JSON.stringify(url)})
      }))()` }]);
      assertCurrent();
      const evidence = result as { pageUrl?: unknown; documentTime?: unknown; present?: unknown } | null;
      if (!evidence || evidence.pageUrl !== pageUrl || evidence.present !== true
        || typeof evidence.documentTime !== 'number' || !Number.isFinite(evidence.documentTime)) {
        throw new Error('Image is not in the current document');
      }
      return evidence.documentTime;
    };
    // Race the ENTIRE operation, including stalled script evaluation/stream reads.
    // The same signal cancels Electron's request and its response body.
    let onAbort: () => void = () => undefined;
    const canceled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(abort.signal.reason);
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([canceled, (async () => {
        const documentTime = await attest();
        assertCurrent();
        const response = await guest.session.fetch(url, {
          signal: abort.signal, referrer: pageUrl, credentials: 'include', redirect: 'error',
        });
        try { assertCurrent(); }
        catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
        // Also cancel the stream explicitly: this bounds body reads even when a
        // transport does not propagate its fetch signal after headers arrive.
        const readable = response.body ? new Response(response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>(), { signal: abort.signal },
        ), { status: response.status, headers: response.headers }) : response;
        const image = await readBrowserImage(readable);
        assertCurrent();
        if (await attest() !== documentTime) throw new Error('Image source document changed');
        assertCurrent();
        return { url, pageUrl, title, ...image };
      })()]);
    } finally {
      clearTimeout(timeout);
      abort.signal.removeEventListener('abort', onAbort);
      guest.removeListener('did-start-navigation', navigating);
      guest.removeListener('destroyed', invalidate);
      guest.removeListener('render-process-gone', invalidate);
      requests.delete(abort);
      if (requests.size === 0) pending.delete(guestId);
      abort.abort();
    }
  };
  return { read, cancelGuest, cancelAll: () => { for (const guestId of pending.keys()) cancelGuest(guestId); } };
}
