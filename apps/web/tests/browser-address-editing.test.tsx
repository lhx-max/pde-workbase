// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignBrowserPanel } from '../src/components/DesignBrowserPanel';
const mocks = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('../src/components/BrowserAssetCapture', () => ({ useBrowserAssetCapture: () => ({ toolbar: null, busy: false, saveImage: vi.fn(), saveSelection: vi.fn() }) }));
vi.mock('../src/browser-resources/BrowserResourcePlugin', () => ({ useBrowserResourcePlugin: () => ({ trigger: null, panel: null }) }));
vi.mock('../src/providers/registry', () => ({ requestJson: vi.fn(), writeProjectBase64File: vi.fn(), writeProjectTextFile: vi.fn(), projectRawUrl: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock('../src/i18n', () => ({ useT: () => mocks.t, useI18n: () => ({ t: mocks.t, locale: 'en' }) }));
vi.mock('@bezier/host', () => ({ isBezierHostAvailable: () => true, getBezierHost: () => undefined, clearHostBrowserData: vi.fn() }));
const noop = () => {};
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<DesignBrowserPanel projectId="address-race" browserTabId="address-race" initialUrl="https://first.test/" onOpenFile={noop} onRefreshFiles={noop} />); });
  const input = screen.getByRole('textbox', { name: 'designBrowser.addressAria' }) as HTMLInputElement;
  const guest = Object.assign(view.container.querySelector('webview')!, { getURL: () => 'https://first.test/', getTitle: () => 'First', isLoading: () => false, loadURL: vi.fn(async () => {}) });
  return { view, input, guest };
}
describe('browser address edit ownership', () => {
  it('replaces the displayed URL when text insertion follows focus before the next animation frame', async () => {
    const { input, guest } = await mount();
    expect(input).toHaveValue('');
    // Browser fill selects before focusing; focus reveals the current URL.
    // Native insertion must replace that entire URL, even before any rAF runs.
    act(() => { input.select(); input.focus(); });
    const replacement = 'https://first.test/second';
    input.setRangeText(replacement, input.selectionStart!, input.selectionEnd!, 'end');
    fireEvent.input(input);
    expect(input).toHaveValue(replacement);
    fireEvent.submit(input.form!);
    expect(guest.loadURL).toHaveBeenCalledWith(replacement);
  });
  it('retains and submits a new draft after blur/refocus before the old blur timer fires', async () => {
    const { input, guest } = await mount();
    act(() => { input.focus(); }); fireEvent.change(input, { target: { value: 'https://second.test/' } });
    act(() => { input.blur(); input.focus(); });
    expect(input).toHaveValue('https://second.test/');
    fireEvent.change(input, { target: { value: 'https://third.test/' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(input).toHaveValue('https://third.test/');
    fireEvent.submit(input.form!); expect(guest.loadURL).toHaveBeenCalledWith('https://third.test/');
  });
  it('protects the focused draft from native metadata callbacks before React effects can resubscribe', async () => {
    const { input, guest } = await mount();
    act(() => {
      input.focus(); fireEvent.change(input, { target: { value: 'https://draft.test/' } });
      guest.dispatchEvent(Object.assign(new Event('page-title-updated'), { title: 'Late title from first page' }));
    });
    expect(input).toHaveValue('https://draft.test/');
  });
  it('never selects late after blur, typing or unmount', async () => {
    const { input, view } = await mount(); const select = vi.spyOn(input, 'select');
    act(() => { input.focus(); input.blur(); });
    expect(select).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); }); expect(select).toHaveBeenCalledTimes(1);
    act(() => { input.focus(); }); fireEvent.change(input, { target: { value: 'https://typed.test/' } });
    expect(select).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); }); expect(select).toHaveBeenCalledTimes(2);
    act(() => { input.blur(); input.focus(); }); view.unmount();
    expect(select).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); }); expect(select).toHaveBeenCalledTimes(3);
  });
  it('selects on the first pointer focus but leaves subsequent caret positioning native', async () => {
    const { input } = await mount();
    expect(fireEvent.mouseDown(input, { button: 0 })).toBe(false);
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(fireEvent.mouseDown(input, { button: 0 })).toBe(true);
    input.setSelectionRange(8, 8);
    fireEvent.mouseUp(input, { button: 0 }); fireEvent.click(input, { button: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 8]);
  });
});
