import { nativeFailure } from './locales/native-messages.js';
import type { App, BrowserWindow, Session, WebContents } from 'electron';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { browserLoginRoute } from './browser-login-route.js';
import { prepareBrowserConnector } from './browser-connector-onboarding.js';
import { pinterestDefaultBrowser } from './pinterest-default-browser.js';
import { startPinterestAuthBridge, importPinterestCookies } from './pinterest-auth-bridge.js';
import { preparePinterestNativeRelay, PINTEREST_CONNECTOR_ID } from './pinterest-native-relay.js';
import { du } from './locales/desktop-ui.js';
const exec = promisify(execFile);
const pinterestUrl = (url: string) => browserLoginRoute(url)?.sessionReturn === 'pinterest';

/** Preserve original macOS/development-only consent and rollback semantics.
 * Production receives an explicit unsupported result, never a fake session.
 * All user-profile writes happen only AFTER native onboarding consent. */
export function createBrowserLoginHost(options: {
  app: Pick<App, 'isPackaged' | 'getApplicationInfoForProtocol' | 'getPath'>;
  window: BrowserWindow; session: Session; platform: string; executable: string;
  getGuest(id: number): WebContents | undefined; alive(): boolean;
  dialog: { showMessageBox(window: BrowserWindow, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> };
  shell: { openExternal(url: string): Promise<void>; openPath(path: string): Promise<string> };
  receiverOrigin(origin: string | null): void;
}) {
  let starting = false, importing = false, generation = 0;
  let active: { id: number; abort: AbortController; cleanup(): void } | undefined;
  let bridge: Awaited<ReturnType<typeof startPinterestAuthBridge>> | undefined;
  let relay: Awaited<ReturnType<typeof preparePinterestNativeRelay>> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let connectorTimeout: ReturnType<typeof setTimeout> | undefined;
  const pendingGoogle = new Set<number>();
  const status = (guestId: number, message: string, active = false) => { if (options.alive()) options.window.webContents.send('browser:pinterest-status', { guestId, message, active }); };
  const stop = () => {
    generation++; active?.abort.abort(); active?.cleanup(); active = undefined;
    bridge?.close(); bridge = undefined; relay?.close(); relay = undefined;
    clearTimeout(timeout); clearTimeout(connectorTimeout); options.receiverOrigin(null);
  };
  const connectPinterest = async (guestId: number): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (options.app.isPackaged) return { ok: false, reason: du().devOnlySignIn };
    if (options.platform !== 'darwin') return { ok: false, reason: du().macOnlyConnect };
    const guest = options.getGuest(guestId);
    if (!options.alive() || !guest || guest.isDestroyed() || !pinterestUrl(guest.getURL())) return { ok: false, reason: du().openPinterestFirst };
    if (starting || importing || active) return { ok: false, reason: du().signInAlreadyRunning };
    starting = true;
    const initialUrl = guest.getURL(), epoch = generation;
    const valid = () => options.alive() && !guest.isDestroyed() && generation === epoch && options.getGuest(guestId) === guest && guest.getURL() === initialUrl;
    try {
      const target = pinterestDefaultBrowser(await options.app.getApplicationInfoForProtocol('https://www.pinterest.com/'), options.app.getPath('appData'));
      if (!valid()) return { ok: false, reason: du().sourceChanged };
      if (!target.registryDir) {
        const choice = await options.dialog.showMessageBox(options.window, { type: 'info', title: du().defaultBrowserCannotContinue,
          message: du().defaultBrowserUnsupported(target.name), detail: du().pinterestOpenDetail,
          buttons: [du().cancel, du().openPinterestIn(target.name)], defaultId: 0, cancelId: 0 });
        if (choice.response === 1 && valid()) await options.shell.openExternal('https://www.pinterest.com/login/');
        return { ok: false, reason: du().browserCannotContinueSession(target.name) };
      }
      const consent = await prepareBrowserConnector({ browserName: target.name,
        prompt: async (detail, buttons) => (await options.dialog.showMessageBox(options.window, { type: 'info', title: du().connectBrowser,
          message: du().finishSignInIn(target.name), detail: du().continueMaySwitchAccount(detail), buttons, defaultId: 0, cancelId: 0 })).response,
        openInstall: async () => {
          if (!valid()) throw new Error(du().sourceChanged);
          const directory = fileURLToPath(new URL('../pinterest-auth-extension/', import.meta.url));
          await stat(join(directory, 'manifest.json'));
          if (!valid()) throw new Error(du().sourceChanged);
          await exec('/usr/bin/open', ['-a', target.path, basename(target.path).startsWith('Microsoft Edge') ? 'edge://extensions/' : 'chrome://extensions/']);
          if (await options.shell.openPath(directory)) throw new Error(du().connectorFolderFailed);
        },
      });
      if (!consent || !valid()) return { ok: false, reason: du().sourceChanged };
      const abort = new AbortController();
      const onNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => { if (event.isMainFrame && !event.isSameDocument) stop(); };
      const onGone = () => stop();
      guest.on('did-start-navigation', onNavigation); guest.once('destroyed', onGone);
      active = { id: guestId, abort, cleanup: () => { guest.removeListener('did-start-navigation', onNavigation); guest.removeListener('destroyed', onGone); } };
      bridge = await startPinterestAuthBridge({ accept: async (cookies, signal) => {
        if (!valid() || active?.id !== guestId || abort.signal.aborted || signal.aborted) return false;
        status(guestId, du().connectingPinterest, true); importing = true;
        try { await importPinterestCookies(options.session, cookies, AbortSignal.any([signal, abort.signal])); }
        catch (error) { status(guestId, nativeFailure(error, du().sessionConnectFailed)); stop(); throw error; }
        finally { importing = false; }
        active?.cleanup(); active = undefined; relay?.close(); relay = undefined; clearTimeout(timeout); clearTimeout(connectorTimeout);
        if (!guest.isDestroyed() && pinterestUrl(guest.getURL())) {
          if (/\/(login|signup)/.test(new URL(guest.getURL()).pathname)) void guest.loadURL('https://www.pinterest.com/').catch(() => undefined);
          else guest.reload();
        }
        options.window.show(); options.window.focus(); status(guestId, du().sessionConnected);
        options.receiverOrigin(null); return true;
      } });
      if (!valid()) { stop(); return { ok: false, reason: du().sourceChanged }; }
      options.receiverOrigin(new URL(bridge.code).origin);
      const hostScript = fileURLToPath(new URL('./pinterest-native-host.cjs', import.meta.url));
      await stat(hostScript);
      if (!valid()) { stop(); return { ok: false, reason: du().sourceChanged }; }
      let ready = false;
      relay = await preparePinterestNativeRelay({ code: bridge.code, executable: options.executable, hostScript,
        runtimeDir: join(options.app.getPath('userData'), 'pinterest-auth-native'), registryDir: target.registryDir,
        onClaim: () => { ready = true; clearTimeout(connectorTimeout); if (active?.id === guestId) status(guestId, du().connectorConnected(target.name), true); } });
      if (!valid()) { stop(); return { ok: false, reason: du().sourceChanged }; }
      timeout = setTimeout(() => { stop(); status(guestId, du().signInTimedOut); }, 300000); timeout.unref();
      await exec('/usr/bin/open', ['-a', target.path, `chrome-extension://${PINTEREST_CONNECTOR_ID}/connect.html?launch=1`]);
      if (!ready) { status(guestId, du().waitingForConnector(target.name), true); connectorTimeout = setTimeout(() => {
        if (!ready && active?.id === guestId) { stop(); status(guestId, du().connectorNoResponse(target.name)); }
      }, 20000); connectorTimeout.unref(); }
      return { ok: true };
    } catch { stop(); return { ok: false, reason: du().defaultBrowserStartFailed }; }
    finally { starting = false; }
  };
  return {
    connectPinterest, stop,
    cancel(guestId: number) { if (active?.id === guestId) { stop(); status(guestId, du().pinterestCanceled); } },
    async connectGoogle(guest: WebContents) {
      if (!options.alive() || guest.isDestroyed() || options.getGuest(guest.id) !== guest || pendingGoogle.has(guest.id)) return;
      const source = guest.getURL(), route = browserLoginRoute(source);
      if (!route) { status(guest.id, du().unknownSignInSite); return; }
      pendingGoogle.add(guest.id);
      try {
        if (route.sessionReturn === 'pinterest') { const result = await connectPinterest(guest.id); if (!result.ok) status(guest.id, result.reason); return; }
        const choice = await options.dialog.showMessageBox(options.window, { type: 'info', title: du().continueSignInTitle,
          message: du().continueSignIn(route.name), detail: du().siteCannotReturnDetail,
          buttons: [du().stayInApp, du().openOriginalSite], defaultId: 0, cancelId: 0 });
        if (choice.response === 1 && options.alive() && !guest.isDestroyed() && options.getGuest(guest.id) === guest && guest.getURL() === source) {
          await options.shell.openExternal(route.loginUrl); status(guest.id, du().openedOriginalSite);
        }
      } catch { status(guest.id, du().couldNotOpenSignIn); }
      finally { pendingGoogle.delete(guest.id); }
    },
  };
}
