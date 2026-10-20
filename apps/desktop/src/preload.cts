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
const unsupported = async (): Promise<{ ok: false; reason: string }> => ({ ok: false, reason: 'unsupported: not provided by the independent browser host' });
const unsupportedUpdater = async (): Promise<never> => { throw new Error('unsupported: independent browser host has no updater'); };
const unsupportedSubscription = (): never => { throw new Error('unsupported: independent browser host has no updater events'); };
async function action(channel: string, ...args: unknown[]): Promise<BezierHostActionResult> {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Host operation failed' }; }
}
const host: BezierHostBridge = {
  version: 2,
  client: { type: 'desktop', platform: process.platform },
  browser: {
    openResourceCapture: (guestId, projectId, tabId) => ipcRenderer.invoke('browser:open-resource-capture', guestId, projectId, tabId),
    closeResourceCapture: (sessionId, accessToken) => ipcRenderer.invoke('browser:close-resource-capture', sessionId, accessToken),
    setCollector: (guestId, enabled) => ipcRenderer.invoke('browser:set-collector', guestId, enabled),
    readImage: (guestId, url) => ipcRenderer.invoke('browser:read-image', guestId, url),
    collectImage: (guestId, url) => ipcRenderer.invoke('browser:collect-image', guestId, url),
    onCollectedResource: listener => {
      const handler = (_event: Electron.IpcRendererEvent, resource: Parameters<typeof listener>[0]) => listener(resource);
      ipcRenderer.on('browser:collected-resource', handler);
      return () => ipcRenderer.removeListener('browser:collected-resource', handler);
    },
    clearData: options => action('browser:clear-data', options),
  },
  capture: { page: options => ipcRenderer.invoke('bezier:capture-page', options) },
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
