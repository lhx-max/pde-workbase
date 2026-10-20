import { app, BrowserWindow, ipcMain, session, shell, type WebContents } from 'electron';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { allowedBrowserUrl, allowedBrowserSubresourceUrl, captureClip, DESIGN_BROWSER_PARTITION, localAppUrl, requireHostToken, trustedDocument } from './policy.js';
import { createBrowserResourceCapture, requireResourceCaptureFrame } from './main/browser-resource-capture.js';
import { createBrowserImageReader, type BrowserImageCollector } from './main/browser-image-read.js';
import { setBrowserRequestPolicy } from './main/browser-request-policy.js';
import { startCommandTransport } from './transport.js';

// This executable consumes launcher configuration; it never discovers upstream
// processes, reads an original checkout, or starts a web/server process.
const webUrl = localAppUrl(process.env.CANVAS_WEB_URL, 'CANVAS_WEB_URL');
const serverUrl = localAppUrl(process.env.CANVAS_SERVER_URL, 'CANVAS_SERVER_URL');
const token = requireHostToken(process.env.CANVAS_DESKTOP_AUTH_TOKEN);
const port = Number(process.env.CANVAS_BROWSER_HOST_PORT);
const userData = process.env.CANVAS_DESKTOP_USER_DATA;
if (!userData || !isAbsolute(userData)) throw new Error('CANVAS_DESKTOP_USER_DATA must be an explicit absolute instance directory');
app.setPath('userData', userData);
app.setName('Canvas Workspace');
// Electron waits for an ESM entry to finish evaluating before emitting ready.
// Do not top-level-await whenReady: that creates a circular startup wait.
async function startDesktop() {
await app.whenReady();
const window = new BrowserWindow({
  width: 1440, height: 940, minWidth: 800, minHeight: 600,
  title: 'Canvas Workspace', show: false,
  webPreferences: {
    preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    additionalArguments: [`--canvas-web-url=${encodeURIComponent(webUrl.href)}`],
    contextIsolation: true, sandbox: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: true,
  },
});
const owner = window.webContents;
const guests = new Map<number, BrowserImageCollector>();
const ownerAlive = () => !window.isDestroyed() && !owner.isDestroyed() && !owner.isLoadingMainFrame() && trustedDocument(owner.getURL(), webUrl);
const capture = createBrowserResourceCapture({ getGuest: id => guests.get(id)?.guest as WebContents | undefined, ownerAlive });
const imageReader = createBrowserImageReader({ getCollector: id => guests.get(id), ownerAlive });
const browserSession = session.fromPartition(DESIGN_BROWSER_PARTITION);
const blockedOrigins = [webUrl.origin, serverUrl.origin, `http://127.0.0.1:${port}`];
const allowed = (url: string) => allowedBrowserUrl(url, blockedOrigins);
// This request-level gate also protects programmatic webview.loadURL, which
// Electron's will-navigate event explicitly does not intercept.
setBrowserRequestPolicy(browserSession, details => {
  if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') return allowed(details.url);
  return allowedBrowserSubresourceUrl(details.url, blockedOrigins);
});
for (const s of [owner.session, browserSession]) {
  s.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    contents === owner && permission === 'clipboard-sanitized-write' && details.isMainFrame
    && trustedDocument(details.requestingUrl, webUrl) && ownerAlive(),
  ));
  s.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents === owner && permission === 'clipboard-sanitized-write' && details.isMainFrame
    && trustedDocument(details.requestingUrl ?? '', webUrl) && ownerAlive(),
  );
  s.on('will-download', event => event.preventDefault());
}
owner.on('will-attach-webview', (event, preferences, params) => {
  if (!trustedDocument(owner.getURL(), webUrl) || params.partition !== DESIGN_BROWSER_PARTITION || !allowed(params.src)) { event.preventDefault(); return; }
  delete preferences.preload;
  preferences.nodeIntegration = false; preferences.nodeIntegrationInSubFrames = false;
  preferences.nodeIntegrationInWorker = false; preferences.contextIsolation = true;
  preferences.sandbox = true; preferences.webSecurity = true; preferences.allowRunningInsecureContent = false;
  preferences.webviewTag = false;
});
owner.on('did-attach-webview', (_event, guest) => {
  const id = guest.id;
  guests.set(id, { guest, enabled: false });
  guest.on('dom-ready', () => {
    if (/Android.*Mobile/.test(guest.getUserAgent())) guest.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: { width: 390, height: 844 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 0, height: 0 }, deviceScaleFactor: 0, scale: 1 });
    else guest.disableDeviceEmulation();
  });
  guest.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  guest.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  guest.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) void guest.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });
  guest.once('destroyed', () => { imageReader.cancelGuest(id); guests.delete(id); });
});
owner.on('will-navigate', (event, url) => { if (!trustedDocument(url, webUrl)) event.preventDefault(); });
owner.on('will-redirect', (event, url) => { if (!trustedDocument(url, webUrl)) event.preventDefault(); });
owner.setWindowOpenHandler(() => ({ action: 'deny' }));
let ownerGeneration = 0;
const revoke = () => { ownerGeneration++; capture.revokeAll(); imageReader.cancelAll(); for (const guest of guests.values()) guest.enabled = false; };
owner.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) revoke(); });
owner.on('render-process-gone', revoke);
const channels: string[] = [];
function handle(channel: string, operation: (...args: any[]) => unknown) {
  channels.push(channel);
  ipcMain.handle(channel, (event, ...args) => {
    requireResourceCaptureFrame(event, owner, webUrl.href);
    if (!ownerAlive()) throw new Error('The trusted application document is unavailable');
    return operation(...args);
  });
}
handle('browser:open-resource-capture', (guestId: number, projectId: string, tabId: string) => capture.open(guestId, projectId, tabId));
handle('browser:close-resource-capture', (sessionId: string, accessToken: string) => capture.close(sessionId, accessToken));
handle('browser:set-collector', (guestId: number, enabled: boolean) => {
  const entry = guests.get(guestId);
  if (!entry || entry.guest.isDestroyed() || typeof enabled !== 'boolean') throw new Error('Owned browser guest required');
  entry.enabled = enabled; if (!enabled) imageReader.cancelGuest(guestId);
});
handle('browser:read-image', (guestId: number, url: string) => imageReader.read(guestId, url));
handle('browser:collect-image', async (guestId: number, url: string) => {
  const image = await imageReader.read(guestId, url);
  if (!ownerAlive()) throw new Error('Application document changed');
  // The renderer's project-file adapter persists this event. No personal library.
  owner.send('browser:collected-resource', { guestId, ...image });
});
handle('browser:clear-data', async (options?: { cookies?: boolean; storage?: boolean }) => {
  revoke();
  const storages: Electron.ClearStorageDataOptions['storages'] = [];
  if (options?.cookies !== false) storages.push('cookies');
  if (options?.storage !== false) storages.push('filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage');
  if (storages.length) await browserSession.clearStorageData({ storages });
  if (options?.storage !== false) await browserSession.clearCache();
  return { ok: true };
});
handle('shell:open-external', async (url: unknown) => {
  if (typeof url !== 'string' || url === 'about:blank' || !allowedBrowserUrl(url)) throw new Error('Only HTTP(S) external URLs are supported');
  await shell.openExternal(url); return { ok: true };
});
handle('bezier:capture-page', async (options?: { clip?: unknown }) => {
  const generation = ownerGeneration;
  const clip = captureClip(options?.clip, window.getContentBounds());
  const image = await owner.capturePage(clip);
  if (generation !== ownerGeneration || !ownerAlive() || image.isEmpty()) return { ok: false, reason: 'Capture document changed or image is empty' };
  const size = image.getSize(); return { ok: true, dataUrl: image.toDataURL(), w: size.width, h: size.height };
});
const transport = await startCommandTransport({ port, token, execute: command => capture.execute(command) });
window.once('closed', () => {
  capture.dispose(); imageReader.cancelAll(); guests.clear();
  for (const channel of channels) ipcMain.removeHandler(channel);
  transport.closeAllConnections(); transport.close(); app.quit();
});
window.once('ready-to-show', () => window.show());
await window.loadURL(webUrl.href);
console.log(JSON.stringify({ app: 'canvas-desktop', ready: true, nativePort: port }));
app.on('window-all-closed', () => app.quit());
}
void startDesktop().catch(error => {
  console.error('Canvas desktop startup failed:', error);
  app.exit(1);
});
