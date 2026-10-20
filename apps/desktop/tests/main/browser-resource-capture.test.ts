import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_RESOURCE_LIMITS, type BrowserResourceCommand, type BrowserResourceSnapshot } from '@bezier/contracts';
import { createBrowserResourceCapture, requireResourceCaptureFrame, RESOURCE_SCAN_SCRIPT } from '../../src/main/browser-resource-capture.js';
import { resourceKind, safeResourceUrl, verifyResourceBytes } from '../../src/main/browser-resource-policy.js';

const imageUrl = 'https://cdn.test/picture.png?secret=abc#fragment';
const pageUrl = 'https://example.test/gallery?token=private#section';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const cleanups: Array<() => void> = [];
function fixture() {
  const events = new EventEmitter();
  let before: ((details: any, callback: (value: unknown) => void) => void) | null = null;
  let response: ((details: any) => void) | null = null;
  const webRequest = {
    onBeforeRequest: vi.fn((filter: unknown, listener?: typeof before) => { before = listener ?? null; }),
    onResponseStarted: vi.fn((filter: unknown, listener?: typeof response) => { response = listener ?? null; }),
    onErrorOccurred: vi.fn(),
  };
  const fetch = vi.fn(async (_url: string, _options: RequestInit): Promise<Response> => new Response(png, { headers: { 'content-type': 'image/png' } }));
  const execute = vi.fn(async (_world: number, _scripts: unknown[]): Promise<unknown> => [{ url: imageUrl, width: 32, height: 16 }]);
  const guest = Object.assign(events, { id: 7, session: { webRequest, fetch }, getURL: () => pageUrl, getTitle: () => 'Gallery', isDestroyed: () => false, isLoadingMainFrame: () => false, executeJavaScriptInIsolatedWorld: execute }) as unknown as WebContents;
  const registry = new Map([[7, guest]]);
  const ownerAlive = vi.fn(() => true);
  const capture = createBrowserResourceCapture({ getGuest: id => registry.get(id), ownerAlive });
  cleanups.push(() => capture.dispose());
  const grant = capture.open(7, 'project', 'tab');
  const command = (action: 'start' | 'snapshot' | 'scan' | 'stop') => capture.execute({ ...grant, projectId: 'project', action }) as Promise<BrowserResourceSnapshot>;
  const begin = (id: number, url = 'https://cdn.test/network.png?hidden=1', webContentsId = 7, method = 'GET') => before?.({ id, url, webContentsId, method }, () => {});
  const end = (id: number, extra: Record<string, unknown> = {}) => response?.({ id, url: 'https://cdn.test/network.png?hidden=1', webContentsId: 7, method: 'GET', statusCode: 200, responseHeaders: { 'Content-Type': ['image/png'] }, ...extra });
  const read = (snapshot: BrowserResourceSnapshot, overrides: Record<string, unknown> = {}) => capture.execute({ ...grant, projectId: 'project', action: 'read', navigationId: snapshot.navigationId, resourceId: snapshot.items[0]!.id, ...overrides } as BrowserResourceCommand);
  return { capture, grant, command, begin, end, read, guest, events, registry, fetch, execute, ownerAlive, webRequest };
}
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });

describe('native resource capture', () => {
  it('issues only a disabled grant; start enables metadata without reading bodies', async () => {
    const f = fixture();
    expect(f.grant.accessToken.length).toBeGreaterThan(32);
    expect(await f.command('snapshot')).toMatchObject({ enabled: false, items: [] });
    expect(f.webRequest.onBeforeRequest).not.toHaveBeenCalled();
    const state = await f.command('start');
    expect(state).toMatchObject({ projectId: 'project', tabId: 'tab', enabled: true, pageUrl: 'https://example.test/gallery' });
    expect(state.items[0]).toMatchObject({ url: 'https://cdn.test/picture.png', width: 32, height: 16, readable: true });
    expect(state.items[0]).not.toHaveProperty('mime'); expect(state.items[0]).not.toHaveProperty('size');
    expect(JSON.stringify(state)).not.toContain('secret'); expect(JSON.stringify(state)).not.toContain('private');
    expect(f.execute.mock.calls[0]![0]).toBeGreaterThan(999); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('binds grants to the owned registration and project/token', async () => {
    const f = fixture();
    expect(() => f.capture.open(8, 'project', 'tab')).toThrow();
    for (const extra of [{ projectId: 'other' }, { accessToken: 'wrong' }]) {
      await expect(f.capture.execute({ ...f.grant, action: 'start', projectId: 'project', ...extra })).rejects.toMatchObject({ code: 'unauthorized' });
    }
    f.registry.delete(7);
    await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('revokes a previous grant on replacement and explicit close', async () => {
    const f = fixture(); await f.command('start');
    const next = f.capture.open(7, 'new-project', 'tab2');
    await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(f.webRequest.onResponseStarted).toHaveBeenLastCalledWith(null);
    expect(() => f.capture.close(next.sessionId, 'wrong')).toThrow();
    f.capture.close(next.sessionId, next.accessToken);
    await expect(f.capture.execute({ ...next, projectId: 'new-project', action: 'start' })).rejects.toThrow();
  });
  it.each([false, true])('revokes a destroyed native guest without accessing its dead getters (enabled=%s)', async enabled => {
    const f = fixture();
    if (enabled) await f.command('start');
    const descriptors = Object.getOwnPropertyDescriptors(f.guest);
    const dead = () => { throw new TypeError('Object has been destroyed'); };
    Object.defineProperties(f.guest, {
      session: { configurable: true, get: dead }, id: { configurable: true, get: dead },
      getURL: { configurable: true, value: dead }, getTitle: { configurable: true, value: dead },
      isDestroyed: { configurable: true, value: () => true },
    });
    try {
      expect(() => f.events.emit('destroyed')).not.toThrow();
      await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
      expect(f.events.listenerCount('did-start-navigation')).toBe(0);
      expect(f.events.listenerCount('render-process-gone')).toBe(0);
      if (enabled) expect(f.webRequest.onResponseStarted).toHaveBeenLastCalledWith(null);
      expect(() => f.capture.close(f.grant.sessionId, f.grant.accessToken)).not.toThrow();
      expect(() => f.capture.dispose()).not.toThrow();
    } finally { Object.defineProperties(f.guest, descriptors); }
  });
  it('filters exact guest/GET and request epoch; rejects late response after same-URL reload', async () => {
    const f = fixture(); await f.command('start');
    f.begin(1, undefined, 8); f.end(1);
    f.begin(2, undefined, 7, 'POST'); f.end(2);
    expect((await f.command('snapshot')).items).toHaveLength(1);
    f.begin(3);
    f.events.emit('did-start-navigation', { isMainFrame: true, url: pageUrl, isInPlace: false });
    f.end(3);
    expect(await f.command('snapshot')).toMatchObject({ navigationId: 1, enabled: true, items: [] });
    f.begin(4); f.end(4);
    expect((await f.command('snapshot')).items[0]).toMatchObject({ source: 'network', mime: 'image/png' });
    f.begin(5, 'https://cdn.test/old-during-navigation.png');
    f.events.emit('did-navigate');
    f.end(5, { url: 'https://cdn.test/old-during-navigation.png' });
    expect((await f.command('snapshot')).items).toEqual([]);
  });
  it('does not accept responses begun before stop/start or guest replacement', async () => {
    const f = fixture(); await f.command('start'); f.begin(42);
    await f.command('stop'); await f.command('start'); f.end(42);
    expect((await f.command('snapshot')).items).toHaveLength(1);
    f.registry.set(7, { ...f.guest } as WebContents);
    await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('uses one central listener for multiple enabled guests and releases only the last', async () => {
    const f = fixture(); await f.command('start');
    const events = new EventEmitter();
    const second = Object.assign(events, { id: 8, session: f.guest.session, getURL: () => pageUrl, getTitle: () => '', isDestroyed: () => false, isLoadingMainFrame: () => false, executeJavaScriptInIsolatedWorld: async () => [] }) as unknown as WebContents;
    f.registry.set(8, second);
    const grant = f.capture.open(8, 'project', 'second');
    await f.capture.execute({ ...grant, projectId: 'project', action: 'start' });
    expect(f.webRequest.onResponseStarted).toHaveBeenCalledTimes(1);
    await f.command('stop'); expect(f.webRequest.onResponseStarted).toHaveBeenCalledTimes(1);
    f.capture.close(grant.sessionId, grant.accessToken);
    expect(f.webRequest.onResponseStarted).toHaveBeenLastCalledWith(null);
  });
  it('bounds records at 500 and deduplicates original URL', async () => {
    const f = fixture(); f.execute.mockResolvedValue([]); await f.command('start');
    for (let i = 0; i < 502; i++) { const url = `https://cdn.test/${i}.png`; f.begin(i, url); f.end(i, { url }); }
    f.begin(700, 'https://cdn.test/1.png'); f.end(700, { url: 'https://cdn.test/1.png' });
    expect(await f.command('snapshot')).toMatchObject({ limitReached: true });
    expect((await f.command('snapshot')).items).toHaveLength(500);
  });
  it('discovers extensionless image URLs already loaded before capture starts', async () => {
    const f = fixture(); f.execute.mockResolvedValue([{ url: 'https://images.test/photo-123?size=640', kind: 'image', width: 640, height: 480 }]);
    const state = await f.command('start');
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: 'image', readable: true, width: 640, height: 480 });
    await expect(f.read(state)).resolves.toMatchObject({ mime: 'image/png' });
  });
  it('enriches network resources with scan dimensions and preserves them on later responses', async () => {
    const f = fixture(); f.execute.mockResolvedValue([]); await f.command('start');
    const url = 'https://cdn.test/network.png?hidden=1';
    f.begin(1, url); f.end(1, { responseHeaders: { 'Content-Type': ['image/png'], 'Content-Length': ['2048'] } });
    const first = (await f.command('snapshot')).items[0]!;
    f.execute.mockResolvedValue([{ url, width: 640, height: 480 }]);
    const scanned = await f.command('scan');
    expect(scanned.items[0]).toMatchObject({ id: first.id, source: 'network', mime: 'image/png', size: 2048, width: 640, height: 480 });
    f.begin(2, url); f.end(2);
    expect((await f.command('snapshot')).items[0]).toMatchObject({ id: first.id, width: 640, height: 480 });
  });
  it('stop clears resources and detaches listeners but allows later start', async () => {
    const f = fixture(); const old = await f.command('start');
    expect(await f.command('stop')).toMatchObject({ enabled: false, items: [] });
    expect(f.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null);
    const next = await f.command('start'); expect(next.enabled).toBe(true);
    await expect(f.read(old)).rejects.toMatchObject({ code: 'stale-document' });
  });
  it('reads only the observed capability and returns sanitized provenance and verified bytes', async () => {
    const f = fixture(); const state = await f.command('start');
    await expect(f.read(state)).resolves.toEqual({ resourceId: state.items[0]!.id, navigationId: 0, pageUrl: 'https://example.test/gallery', name: 'picture.png', mime: 'image/png', base64: png.toString('base64') });
    expect(f.fetch).toHaveBeenCalledWith('https://cdn.test/picture.png?secret=abc', expect.objectContaining({ method: 'GET', credentials: 'include', referrer: pageUrl.split('#')[0], redirect: 'error', signal: expect.any(AbortSignal) }));
    await expect(f.read(state, { resourceId: 'unknown' })).rejects.toMatchObject({ code: 'stale-document' });
    await expect(f.read(state, { navigationId: 9 })).rejects.toMatchObject({ code: 'stale-document' });
  });
  it.each(['stop', 'revoke', 'navigation', 'crash', 'destroy'] as const)('cancels body streaming on %s', async cause => {
    const f = fixture(); const state = await f.command('start');
    const pulling = deferred<void>(); const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ pull() { pulling.resolve(); }, cancel }), { headers: { 'content-type': 'image/png' } }));
    const pending = f.read(state); const assertion = expect(pending).rejects.toThrow();
    await pulling.promise;
    if (cause === 'stop') await f.command('stop');
    if (cause === 'revoke') f.capture.close(f.grant.sessionId, f.grant.accessToken);
    if (cause === 'navigation') f.events.emit('did-start-navigation', { isMainFrame: true });
    if (cause === 'crash') f.events.emit('render-process-gone');
    if (cause === 'destroy') f.events.emit('destroyed');
    await assertion;
    expect(f.fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });
  it('times out the entire isolated scan and does not publish late evidence', async () => {
    vi.useFakeTimers(); const f = fixture(); const evidence = deferred<unknown>(); f.execute.mockReturnValue(evidence.promise);
    const pending = f.command('start'); const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000); await assertion;
    evidence.resolve([{ url: imageUrl }]); await Promise.resolve();
    expect((await f.command('snapshot')).items).toEqual([]);
  });
  it('times out a stalled fetch, aborts its signal, and cancels a late response body', async () => {
    vi.useFakeTimers(); const f = fixture(); const state = await f.command('start');
    const response = deferred<Response>(); f.fetch.mockReturnValue(response.promise);
    const pending = f.read(state); const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000); await assertion;
    expect(f.fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
    const cancel = vi.fn(); response.resolve(new Response(new ReadableStream({ cancel })));
    await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalled();
  });
  it('times out body streaming and expires even a disabled grant at 30 minutes', async () => {
    vi.useFakeTimers(); const f = fixture(); const state = await f.command('start'); const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'image/png' } }));
    const pending = f.read(state); const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(cancel).toHaveBeenCalled();
    await f.command('stop'); await vi.advanceTimersByTimeAsync(BROWSER_RESOURCE_LIMITS.grantLifetimeMs);
    await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(f.events.eventNames()).toEqual([]);
  });
  it('rejects over-limit streams and MIME/magic mismatch without exposing native errors', async () => {
    const f = fixture(); const state = await f.command('start'); const cancel = vi.fn();
    f.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(BROWSER_RESOURCE_LIMITS.bytes + 1)); }, cancel }), { headers: { 'content-type': 'image/png' } }));
    await expect(f.read(state)).rejects.toMatchObject({ code: 'too-large' }); expect(cancel).toHaveBeenCalled();
    f.fetch.mockResolvedValueOnce(new Response('<svg onload="alert(1)"></svg>', { headers: { 'content-type': 'image/png' } }));
    await expect(f.read(state)).rejects.toMatchObject({ code: 'unsupported-resource' });
    f.fetch.mockRejectedValueOnce(new Error('https://host/private?token=secret'));
    await expect(f.read(state)).rejects.toMatchObject({ code: 'read-failed', message: '资源操作失败。' });
  });
  it('does not save an unsolicited partial-content response as a complete file', async () => {
    const f = fixture(); const state = await f.command('start');
    f.fetch.mockResolvedValueOnce(new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': 'bytes 0-11/2048' } }));
    await expect(f.read(state)).rejects.toMatchObject({ code: 'read-failed' });
  });
  it('keeps SVG and segmented media metadata-only, drops unsafe URLs', async () => {
    const f = fixture(); f.execute.mockResolvedValue(['https://cdn.test/a.svg', 'https://cdn.test/a.m3u8', 'https://cdn.test/a.m4s', 'data:image/png,xyz', 'file:///a.png', 'https://user:pass@host/a.png'].map(url => ({ url })));
    const state = await f.command('start'); expect(state.items).toHaveLength(3);
    expect(state.items.every(item => !item.readable && item.unavailableReason === 'unsupported')).toBe(true);
    await expect(f.read(state)).rejects.toMatchObject({ code: 'unsupported-resource' }); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('revokes all owner-document grants without disabling a later trusted document', async () => {
    const f = fixture(); await f.command('start'); f.capture.revokeAll();
    await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(f.webRequest.onResponseStarted).toHaveBeenLastCalledWith(null);
    expect(f.events.eventNames()).toEqual([]);
    expect(f.capture.open(7, 'project', 'new-tab').sessionId).not.toBe(f.grant.sessionId);
  });
  it('permanently disposes grants and prevents reopening after runtime shutdown', async () => {
    const f = fixture(); await f.command('start'); f.capture.dispose();
    expect(() => f.capture.open(7, 'project', 'tab')).toThrow();
    await expect(f.command('snapshot')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(f.events.eventNames()).toEqual([]);
    expect(f.webRequest.onResponseStarted).toHaveBeenLastCalledWith(null);
  });
  it('requires exact main-window main-frame identity and a trusted application URL', () => {
    const trusted = 'http://127.0.0.1:17573/';
    const mainFrame = { url: trusted }; const owner = { mainFrame, getURL: () => mainFrame.url };
    expect(() => requireResourceCaptureFrame({ sender: owner, senderFrame: mainFrame }, owner, trusted)).not.toThrow();
    expect(() => requireResourceCaptureFrame({ sender: {}, senderFrame: mainFrame }, owner, trusted)).toThrow();
    expect(() => requireResourceCaptureFrame({ sender: owner, senderFrame: {} }, owner, trusted)).toThrow();
    expect(() => requireResourceCaptureFrame({ sender: owner, senderFrame: undefined }, owner, trusted)).toThrow();
    for (const url of ['https://untrusted.test/', 'http://127.0.0.1:17574/', 'file:///private/page.html', 'data:text/html,owned']) {
      mainFrame.url = url;
      expect(() => requireResourceCaptureFrame({ sender: owner, senderFrame: mainFrame }, owner, trusted)).toThrow();
    }
    mainFrame.url = 'bezier://app/project/example';
    expect(() => requireResourceCaptureFrame({ sender: owner, senderFrame: mainFrame }, owner, 'bezier://app/')).not.toThrow();
    mainFrame.url = 'bezier://evil/';
    expect(() => requireResourceCaptureFrame({ sender: owner, senderFrame: mainFrame }, owner, 'bezier://app/')).toThrow();
  });
  it('runs the bounded fixed isolated DOM scan for images, media, backgrounds and timing', () => {
    const image = { tagName: 'IMG', currentSrc: imageUrl, naturalWidth: 40, naturalHeight: 20 };
    const media = { tagName: 'VIDEO', currentSrc: 'https://cdn.test/v.mp4', poster: 'https://cdn.test/poster.png' };
    const rows = runInNewContext(RESOURCE_SCAN_SCRIPT, { URL, document: { baseURI: pageUrl, querySelectorAll: (selector: string) => selector === '*' ? [{}] : [image, media] }, getComputedStyle: () => ({ backgroundImage: 'url("https://cdn.test/bg.png")' }), performance: { getEntriesByType: () => [{ name: 'https://cdn.test/loaded.woff2', initiatorType: 'css' }, { name: 'https://cdn.test/arbitrary.png', initiatorType: 'fetch' }] } });
    expect(rows.map((r: { url: string }) => r.url)).toEqual([imageUrl, media.currentSrc, media.poster, 'https://cdn.test/bg.png', 'https://cdn.test/loaded.woff2']);
    expect(rows.slice(0, 4).map((r: { kind: string }) => r.kind)).toEqual(['image', 'video', 'image', 'image']);
  });
  it('sanitizes display URLs and uses conservative signatures', () => {
    expect(safeResourceUrl('https://user:pass@host/path?q=secret#x')).toBe('https://host/path');
    expect(safeResourceUrl('file:///private')).toBe('');
    expect(resourceKind('https://host/segment.ts', 'video/mp4')).toBe('stream');
    expect(verifyResourceBytes(png, 'image/png')).toBe(true);
    expect(verifyResourceBytes(png, 'image/svg+xml')).toBe(false);
  });
});
