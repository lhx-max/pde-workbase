// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignBrowserPanel } from '../src/components/DesignBrowserPanel';

type Image = { x: number; y: number; width: number; height: number; alt?: string; src?: string };
const mocks = vi.hoisted(() => ({
  captureOptions: vi.fn<(options: { onAddImageToChat?: (image: Image) => void }) => void>(),
  snapshot: vi.fn(), write: vi.fn(), t: (key: string) => key,
}));
vi.mock('../src/components/BrowserAssetCapture', () => ({ useBrowserAssetCapture: (options: { onAddImageToChat?: (image: Image) => void }) => {
  mocks.captureOptions(options); return { toolbar: null, busy: false, saveImage: vi.fn(), saveSelection: vi.fn() };
} }));
vi.mock('../src/browser-resources/BrowserResourcePlugin', () => ({ useBrowserResourcePlugin: () => ({ trigger: null, panel: null }) }));
vi.mock('../src/runtime/exports', () => ({ captureHostRegionSnapshot: mocks.snapshot }));
vi.mock('../src/providers/registry', () => ({ writeProjectBase64File: mocks.write, writeProjectTextFile: vi.fn(), projectRawUrl: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock('../src/i18n', () => ({ useT: () => mocks.t, useI18n: () => ({ t: mocks.t, locale: 'en' }) }));
vi.mock('@bezier/host', () => ({ isBezierHostAvailable: () => true, getBezierHost: () => ({ browser: { readImage: () => {} } }), clearHostBrowserData: vi.fn() }));
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.useFakeTimers(); mocks.captureOptions.mockClear();
  mocks.snapshot.mockResolvedValue({ dataUrl: 'data:image/png;base64,aGVsbG8=', width: 10, height: 10 });
  mocks.write.mockResolvedValue({ name: 'inputs/uploads/image.png', path: 'inputs/uploads/image.png', size: 5 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function capture(onAddImageToChat: () => void | Promise<void>) {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(DesignBrowserPanel, { projectId: 'p', initialUrl: 'https://example.com', onOpenFile() {}, onRefreshFiles() {}, onAddImageToChat })); });
  await act(async () => {
    mocks.captureOptions.mock.calls.at(-1)![0].onAddImageToChat!({ x: 10, y: 10, width: 30, height: 30, alt: 'Captured reference' });
    await vi.advanceTimersByTimeAsync(40);
  });
  return view;
}
describe('browser image callback acceptance', () => {
  it('shows rejected Agent acceptance as an error rather than submitted', async () => {
    const accepted = deferred(); const view = await capture(() => accepted.promise);
    await act(async () => { accepted.reject(new Error('Agent unavailable')); await accepted.promise.catch(() => {}); });
    expect(view.queryByText('Agent unavailable')).not.toBeNull();
    expect(view.queryByText('designBrowser.status.imageAddedToChat')).toBeNull();
  });
  it('retains compatibility with synchronous attachment callbacks', async () => {
    const callback = vi.fn(() => {}); const view = await capture(callback);
    expect(callback).toHaveBeenCalledOnce();
    expect(view.queryByText('designBrowser.status.imageAddedToChat')).not.toBeNull();
  });
  it('does not report submitted until the neutral Agent callback accepts', async () => {
    const accepted = deferred(); const callback = vi.fn(() => accepted.promise);
    const view = await capture(callback);
    expect(callback).toHaveBeenCalledOnce();
    expect(view.queryByText('designBrowser.status.imageAddedToChat')).toBeNull();
    await act(async () => { accepted.resolve(); await accepted.promise; });
    expect(view.queryByText('designBrowser.status.imageAddedToChat')).not.toBeNull();
  });
});
