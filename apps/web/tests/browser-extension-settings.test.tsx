// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignBrowserPanel } from '../src/components/DesignBrowserPanel';
import { BrowserExtensionSection } from '../src/components/BrowserExtensionSection';
const mocks = vi.hoisted(() => ({
  t: (key: string) => key, native: true,
  status: vi.fn(), records: vi.fn(), install: vi.fn(), stopStatus: vi.fn(), stopRecords: vi.fn(),
}));
vi.mock('../src/components/BrowserAssetCapture', () => ({ useBrowserAssetCapture: () => ({ toolbar: null, busy: false, saveImage: vi.fn(), saveSelection: vi.fn() }) }));
vi.mock('../src/browser-resources/BrowserResourcePlugin', () => ({ useBrowserResourcePlugin: () => ({ trigger: null, panel: null }) }));
vi.mock('../src/providers/registry', () => ({ requestJson: vi.fn(), writeProjectBase64File: vi.fn(), writeProjectTextFile: vi.fn(), projectRawUrl: vi.fn(), openExternalUrl: vi.fn() }));
vi.mock('../src/i18n', () => ({ useT: () => mocks.t, useI18n: () => ({ t: mocks.t, locale: 'en' }) }));
vi.mock('@bezier/host', () => {
  const host = { browser: { getCaptureExtensionStatus: mocks.status, listCaptureRecords: mocks.records,
    installCaptureExtension: mocks.install, onCaptureExtensionStatus: () => mocks.stopStatus, onCaptureRecord: () => mocks.stopRecords } };
  return { isBezierHostAvailable: () => mocks.native, getBezierHost: () => mocks.native ? host : undefined, clearHostBrowserData: vi.fn() };
});
const noop = () => {};
const panel = () => <DesignBrowserPanel projectId="p" browserTabId="extension-settings" onOpenFile={noop} onRefreshFiles={noop} />;
const disconnected = { connected: false, browserName: null, message: 'Awaiting explicit connection' };
beforeEach(() => {
  vi.useFakeTimers(); mocks.native = true;
  mocks.status.mockReset().mockResolvedValue(disconnected); mocks.records.mockReset().mockResolvedValue([]);
  mocks.install.mockReset().mockResolvedValue({ ok: true, message: 'Archive exported' }); mocks.stopStatus.mockClear(); mocks.stopRecords.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function openSettings() {
  await act(async () => { render(panel()); });
  fireEvent.click(screen.getByRole('button', { name: 'designBrowser.menu' }));
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'browserExtension.title' })); });
  return screen.getByRole('dialog', { name: 'browserExtension.title' });
}
describe('reachable original browser extension settings', () => {
  it('opens the actual section through the real native browser menu and permits retry after IPC rejection', async () => {
    const dialog = await openSettings(); expect(screen.queryByRole('menu')).toBeNull();
    expect(within(dialog).getByTestId('settings-browser-extension')).toBeInTheDocument();
    mocks.install.mockRejectedValueOnce(new Error('Native bridge unavailable'));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'browserExtension.install' })); });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Native bridge unavailable');
    expect(within(dialog).getByRole('button', { name: 'browserExtension.install' })).toBeEnabled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'browserExtension.install' })); });
    expect(mocks.install).toHaveBeenCalledTimes(2); expect(within(dialog).getByRole('status')).toHaveTextContent('Archive exported');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.stopStatus).toHaveBeenCalledOnce(); expect(mocks.stopRecords).toHaveBeenCalledOnce();
  });
  it('keeps the same entry visible on web and explains desktop-only behavior without an install action', async () => {
    mocks.native = false; const dialog = await openSettings();
    expect(within(dialog).getByText('browserExtension.desktopOnly')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'browserExtension.install' })).toBeNull();
    expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
  });
  it('handles failed polling and record listing and disposes the interval', async () => {
    mocks.status.mockRejectedValue(new Error('Status unavailable')); mocks.records.mockRejectedValue(new Error('Records unavailable'));
    let view!: ReturnType<typeof render>; await act(async () => { view = render(<BrowserExtensionSection />); });
    expect(screen.getByRole('status')).toHaveTextContent('Records unavailable');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('status')).toHaveTextContent('Status unavailable');
    const calls = mocks.status.mock.calls.length; view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(mocks.status).toHaveBeenCalledTimes(calls);
  });
  it('consumes late status, list and installation failures after unmount', async () => {
    let rejectStatus!: (error: Error) => void, rejectRecords!: (error: Error) => void, rejectInstall!: (error: Error) => void;
    mocks.status.mockReturnValue(new Promise((_resolve, reject) => { rejectStatus = reject; }));
    mocks.records.mockReturnValue(new Promise((_resolve, reject) => { rejectRecords = reject; }));
    mocks.install.mockReturnValue(new Promise((_resolve, reject) => { rejectInstall = reject; }));
    const view = render(<BrowserExtensionSection />); fireEvent.click(screen.getByRole('button', { name: 'browserExtension.install' }));
    view.unmount();
    await act(async () => { rejectStatus(new Error('late status')); rejectRecords(new Error('late records')); rejectInstall(new Error('late install')); });
    expect(mocks.stopStatus).toHaveBeenCalledOnce(); expect(mocks.stopRecords).toHaveBeenCalledOnce();
  });
});
