// Adapted from upstream apps/desktop/src/main/preload.cts. Sandboxed CommonJS
// preload may require Electron only; all host imports are erased type imports.
import type { BezierHostBridge, BezierHostActionResult } from '@bezier/host';
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const prefix = '--canvas-web-url=';
const configured = process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
function isApplicationDocument(): boolean {
  try {
    const expected = new URL(decodeURIComponent(configured ?? ''));
    return process.isMainFrame && location.origin === expected.origin && location.pathname === expected.pathname;
  } catch { return false; }
}
const unsupported = async (): Promise<{ ok: false; reason: string }> => ({ ok: false, reason: '不支持：独立浏览器宿主未提供此功能' });
const unsupportedUpdater = async (): Promise<never> => { throw new Error('不支持：独立浏览器宿主未提供更新功能'); };
const unsupportedSubscription = (): never => { throw new Error('不支持：独立浏览器宿主未提供更新事件'); };
function failureMessage(error: unknown): string {
  // Sandboxed preload cannot import locale modules; use a neutral Chinese fallback.
  const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
  return /[\u3400-\u9fff]/u.test(message.replaceAll('画布工作区', '')) ? message : '桌面端操作失败，请重试。';
}
async function invoke(channel: string, ...args: unknown[]) {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) { throw new Error(failureMessage(error)); }
}
async function action(channel: string, ...args: unknown[]): Promise<BezierHostActionResult> {
  try { return await invoke(channel, ...args); }
  catch (error) { return { ok: false, reason: failureMessage(error) }; }
}
const host: BezierHostBridge = {
  version: 2,
  client: { type: 'desktop', platform: process.platform },
  browser: {
    connectPinterest: guestId => action('browser:connect-pinterest', guestId),
    cancelPinterest: guestId => invoke('browser:cancel-pinterest', guestId),
    onPinterestAuthStatus: listener => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on('browser:pinterest-status', handler);
      return () => ipcRenderer.removeListener('browser:pinterest-status', handler);
    },
    startCaptureBridge: () => action('browser:start-capture-bridge'),
    stopCaptureBridge: () => invoke('browser:stop-capture-bridge'),
    setBrowserCaptureContext: context => { void invoke('browser:set-capture-context', context).catch(() => undefined); },
    completeBrowserCapture: result => invoke('browser:complete-capture', result),
    getCaptureExtensionStatus: () => invoke('browser:extension-status'),
    installCaptureExtension: () => invoke('browser:install-extension'),
    listCaptureRecords: () => invoke('browser:capture-records'),
    onBrowserCapture: listener => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on('browser:capture-received', handler);
      return () => ipcRenderer.removeListener('browser:capture-received', handler);
    },
    onCaptureExtensionStatus: listener => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on('browser:extension-status', handler);
      return () => ipcRenderer.removeListener('browser:extension-status', handler);
    },
    onCaptureRecord: listener => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on('browser:capture-record', handler);
      return () => ipcRenderer.removeListener('browser:capture-record', handler);
    },
    openResourceCapture: (guestId, projectId, tabId) => invoke('browser:open-resource-capture', guestId, projectId, tabId),
    closeResourceCapture: (sessionId, accessToken) => invoke('browser:close-resource-capture', sessionId, accessToken),
    setCollector: (guestId, enabled) => invoke('browser:set-collector', guestId, enabled),
    readImage: (guestId, url) => invoke('browser:read-image', guestId, url),
    collectImage: (guestId, url) => invoke('browser:collect-image', guestId, url),
    onCollectedResource: listener => {
      const handler = (_event: Electron.IpcRendererEvent, resource: Parameters<typeof listener>[0]) => listener(resource);
      ipcRenderer.on('browser:collected-resource', handler);
      return () => ipcRenderer.removeListener('browser:collected-resource', handler);
    },
    clearData: options => action('browser:clear-data', options),
  },
  capture: { page: options => invoke('bezier:capture-page', options) },
  shell: { openExternal: url => action('shell:open-external', url), openPath: unsupported },
  project: { pickAndImport: unsupported, pickAndReplaceWorkingDir: unsupported },
  pdf: { print: unsupported },
  updater: {
    status: unsupportedUpdater, check: unsupportedUpdater, 'clear-cache': unsupportedUpdater,
    download: unsupportedUpdater, install: unsupportedUpdater, quit: unsupported,
    setMenuLabels: unsupported, subscribe: unsupportedSubscription, subscribeOpenDialog: unsupportedSubscription,
  },
};
if (isApplicationDocument()) contextBridge.exposeInMainWorld('__bezier__', host);
