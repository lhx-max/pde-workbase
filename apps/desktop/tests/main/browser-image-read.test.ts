import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_IMAGE_READ_TIMEOUT_MS,
  createBrowserImageReader,
  type BrowserImageCollector,
} from '../../src/main/browser-image-read.js';

const pageUrl = 'https://example.test/gallery';
const imageUrl = 'https://cdn.example.test/image.webp';
const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
const imageResponse = () => new Response(bytes, { headers: { 'content-type': 'image/webp; charset=binary' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const events = new EventEmitter();
  const document = { images: [{ src: imageUrl, currentSrc: imageUrl }] };
  const location = { href: pageUrl };
  const performance = { timeOrigin: 123 };
  const fetchStarted = deferred<void>();
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => {
    fetchStarted.resolve();
    return imageResponse();
  });
  const execute = vi.fn(async (_world: number, scripts: { code: string }[]) =>
    runInNewContext(scripts[0]!.code, { document, location, performance }));
  const isDestroyed = vi.fn(() => false);
  const isLoadingMainFrame = vi.fn(() => false);
  const getURL = vi.fn(() => location.href);
  const entry: BrowserImageCollector = {
    enabled: true,
    guest: {
      isDestroyed, isLoadingMainFrame, getURL, getTitle: () => 'Gallery',
      session: { fetch }, executeJavaScriptInIsolatedWorld: execute,
      on: events.on.bind(events), removeListener: events.removeListener.bind(events),
    } as unknown as BrowserImageCollector['guest'],
  };
  const registry = new Map([[7, entry]]);
  const ownerAlive = vi.fn(() => true);
  const reader = createBrowserImageReader({ getCollector: id => registry.get(id), ownerAlive });
  return { reader, entry, registry, events, document, location, performance, fetch, execute,
    isDestroyed, isLoadingMainFrame, getURL, ownerAlive, fetchStarted: fetchStarted.promise };
}

afterEach(() => vi.useRealTimers());

describe('native embedded image reads', () => {
  it('returns original byte results directly using the guest session and captured referrer', async () => {
    const f = fixture();
    const result = await f.reader.read(7, imageUrl);
    expect(result).toEqual({ url: imageUrl, pageUrl, title: 'Gallery', base64: Buffer.from(bytes).toString('base64'), mime: 'image/webp' });
    expect(f.fetch).toHaveBeenCalledWith(imageUrl, expect.objectContaining({
      referrer: pageUrl, credentials: 'include', redirect: 'error', signal: expect.any(AbortSignal),
    }));
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.execute.mock.calls[0]![0]).toBeGreaterThan(999);
    expect(f.events.eventNames()).toEqual([]);
  });

  it.each(['file:///etc/passwd', 'data:image/png;base64,AA==', 'javascript:alert(1)',
    'https://user:secret@example.test/image', 'http://user@example.test/image', '//example.test/image',
    'https://@example.test/image', `https://example.test/${'a'.repeat(8192)}`, 'https://', 42, null])('rejects unsafe URL %s before executing or fetching', async input => {
    const f = fixture();
    await expect(f.reader.read(7, input as string)).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, 8])('rejects invalid or unregistered guest %s', async id => {
    const f = fixture();
    await expect(f.reader.read(id, imageUrl)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'destroyed', 'owner-closed', 'loading'] as const)('rejects a %s collector', async state => {
    const f = fixture();
    if (state === 'disabled') f.entry.enabled = false;
    if (state === 'destroyed') f.isDestroyed.mockReturnValue(true);
    if (state === 'owner-closed') f.ownerAlive.mockReturnValue(false);
    if (state === 'loading') f.isLoadingMainFrame.mockReturnValue(true);
    await expect(f.reader.read(7, imageUrl)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('requires an actual currentSrc or src match, not arbitrary URL or srcset text', async () => {
    const f = fixture();
    f.document.images = [{ src: 'https://example.test/other.png', currentSrc: imageUrl }];
    await expect(f.reader.read(7, imageUrl)).resolves.toHaveProperty('url', imageUrl);
    f.document.images = [{ src: imageUrl, currentSrc: '' }];
    await expect(f.reader.read(7, imageUrl)).resolves.toHaveProperty('url', imageUrl);
    f.document.images = [Object.assign({ src: '', currentSrc: '' }, { srcset: `${imageUrl} 2x` })];
    f.fetch.mockClear();
    await expect(f.reader.read(7, imageUrl)).rejects.toThrow('图片不在当前页面中。');
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('uses escaped URL literals for DOM attestation', async () => {
    const f = fixture();
    const quoted = 'https://example.test/a?x=\";throw new Error(\"injected\")';
    const normalized = new URL(quoted).href;
    f.document.images = [{ src: normalized, currentSrc: '' }];
    await expect(f.reader.read(7, quoted)).resolves.toHaveProperty('url', normalized);
  });

  it('rejects navigation during attestation before any fetch', async () => {
    const f = fixture();
    const evidence = deferred<unknown>();
    f.execute.mockReturnValueOnce(evidence.promise);
    const result = f.reader.read(7, imageUrl);
    const rejected = expect(result).rejects.toThrow('图片来源页面已改变。');
    f.events.emit('did-start-navigation', { url: pageUrl, isInPlace: false, isMainFrame: true });
    evidence.resolve({ present: true, pageUrl, documentTime: 123 });
    await rejected;
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['reload', 'in-page', 'destroyed', 'crashed', 'disabled', 'owner-closed'] as const)(
    'cancels a pending fetch on %s without returning stale bytes', async change => {
      const f = fixture();
      const response = deferred<Response>();
      f.fetch.mockImplementation((_url, _options) => {
        responseStarted.resolve();
        return response.promise;
      });
      const responseStarted = deferred<void>();
      const result = f.reader.read(7, imageUrl);
      const rejected = expect(result).rejects.toThrow();
      await responseStarted.promise;
      if (change === 'reload' || change === 'in-page') f.events.emit('did-start-navigation', { url: pageUrl, isInPlace: change === 'in-page', isMainFrame: true });
      if (change === 'destroyed') f.events.emit('destroyed');
      if (change === 'crashed') f.events.emit('render-process-gone');
      if (change === 'disabled') { f.entry.enabled = false; f.reader.cancelGuest(7); f.entry.enabled = true; }
      if (change === 'owner-closed') { f.ownerAlive.mockReturnValue(false); f.reader.cancelAll(); }
      await rejected;
      expect(f.fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
      expect(f.events.eventNames()).toEqual([]);
      response.resolve(imageResponse());
    },
  );

  it.each(['removed', 'replaced', 'new-document', 'new-url', 'image-removed'] as const)(
    'revalidates %s before returning fetched bytes', async change => {
      const f = fixture();
      f.fetch.mockImplementation(async () => {
        if (change === 'removed') f.registry.delete(7);
        if (change === 'replaced') f.registry.set(7, { ...f.entry });
        if (change === 'new-document') f.performance.timeOrigin += 1;
        if (change === 'new-url') f.location.href += '/new';
        if (change === 'image-removed') f.document.images = [];
        return imageResponse();
      });
      await expect(f.reader.read(7, imageUrl)).rejects.toThrow();
    },
  );

  it('ignores subframe navigation while attesting the top-level document', async () => {
    const f = fixture();
    f.fetch.mockImplementation(async () => {
      f.events.emit('did-start-navigation', { url: 'https://example.test/frame', isInPlace: false, isMainFrame: false });
      return imageResponse();
    });
    await expect(f.reader.read(7, imageUrl)).resolves.toHaveProperty('base64');
  });

  it.each(['attestation', 'fetch', 'body'] as const)('bounds stalled %s with an overall timeout', async stage => {
    vi.useFakeTimers();
    const f = fixture();
    if (stage === 'attestation') f.execute.mockReturnValue(new Promise(() => undefined));
    if (stage === 'fetch') f.fetch.mockReturnValue(new Promise(() => undefined));
    const cancelBody = vi.fn();
    if (stage === 'body') f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelBody }), { headers: { 'content-type': 'image/png' } }));
    const result = f.reader.read(7, imageUrl);
    const rejected = expect(result).rejects.toThrow('读取图片超时。');
    await vi.advanceTimersByTimeAsync(BROWSER_IMAGE_READ_TIMEOUT_MS - 1);
    expect(f.events.listenerCount('destroyed')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(f.events.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    if (stage !== 'attestation') expect(f.fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
    if (stage === 'body') expect(cancelBody).toHaveBeenCalledOnce();
  });

  it('cancels an in-progress body read on same-URL reload', async () => {
    const f = fixture();
    const reading = deferred<void>();
    const canceled = deferred<void>();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({
      pull() { reading.resolve(); },
      cancel() { canceled.resolve(); },
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } }));
    const result = f.reader.read(7, imageUrl);
    const rejected = expect(result).rejects.toThrow('图片来源页面已改变。');
    await reading.promise;
    f.events.emit('did-start-navigation', { url: pageUrl, isInPlace: false, isMainFrame: true });
    await rejected;
    await canceled.promise;
    expect(f.events.eventNames()).toEqual([]);
  });

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])('rejects non-raster response %s', async mime => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response('not an image', { headers: { 'content-type': mime } }));
    await expect(f.reader.read(7, imageUrl)).rejects.toThrow();
  });

  it('rejects failed HTTP and empty response bodies', async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(f.reader.read(7, imageUrl)).rejects.toThrow('图片响应不可用。');
    f.fetch.mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'image/png' } }));
    await expect(f.reader.read(7, imageUrl)).rejects.toThrow();
  });

  it('uses the existing 25 MiB streamed size limit and cancels oversized bodies', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1)); }, cancel,
    }), { headers: { 'content-type': 'image/png' } }));
    await expect(f.reader.read(7, imageUrl)).rejects.toThrow('25 MiB');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('wires only the main window/frame to the read-only handler and cleans it up', () => {
    const runtime = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(runtime).toContain('requireResourceCaptureFrame(event, owner, webUrl.href)');
    expect(runtime).toContain('if (!ownerAlive()) throw');
    expect(runtime).toContain("handle('browser:read-image', (guestId: number, url: string) => imageReader.read(guestId, url))");
    expect(runtime).toContain('for (const channel of channels) ipcMain.removeHandler(channel)');
    expect(runtime).toContain('if (!enabled) imageReader.cancelGuest(guestId)');
  });
});
