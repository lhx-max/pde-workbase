import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Session, WebContents } from 'electron';
const adapters = vi.hoisted(() => ({ start: vi.fn(), relay: vi.fn(), importCookies: vi.fn(), exec: vi.fn(), stat: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: adapters.stat }));
vi.mock('node:child_process', () => ({ execFile: adapters.exec }));
vi.mock('../../src/main/pinterest-auth-bridge.js', () => ({ startPinterestAuthBridge: adapters.start, importPinterestCookies: adapters.importCookies }));
vi.mock('../../src/main/pinterest-native-relay.js', () => ({ preparePinterestNativeRelay: adapters.relay, PINTEREST_CONNECTOR_ID: 'synthetic-connector' }));
import { createBrowserLoginHost } from '../../src/main/browser-login-host.js';

function fixture(platform = 'darwin', isPackaged = false) {
  const guest = Object.assign(new EventEmitter(), { id: 1, getURL: vi.fn(() => 'https://www.pinterest.com/login/'), isDestroyed: vi.fn(() => false), reload: vi.fn(), loadURL: vi.fn(async () => {}) });
  const send = vi.fn(), alive = vi.fn(() => true), prompt = vi.fn(async () => ({ response: 0, checkboxChecked: false })), openExternal = vi.fn(async () => {});
  const app = { isPackaged, getPath: vi.fn(() => '/synthetic-only'), getApplicationInfoForProtocol: vi.fn(async () => ({ name: 'Chrome', path: '/synthetic/Google Chrome.app', icon: {} as Electron.NativeImage })) };
  const closeBridge = vi.fn(), closeRelay = vi.fn();
  adapters.start.mockResolvedValue({ code: 'http://127.0.0.1:23457/#synthetic', close: closeBridge });
  adapters.relay.mockResolvedValue({ close: closeRelay }); adapters.stat.mockResolvedValue({}); adapters.importCookies.mockResolvedValue(undefined);
  adapters.exec.mockImplementation((...args: unknown[]) => (args.at(-1) as (...input: unknown[]) => void)(null, '', ''));
  const host = createBrowserLoginHost({ app, platform, executable: '/synthetic/electron',
    window: { webContents: { send }, show: vi.fn(), focus: vi.fn() } as unknown as BrowserWindow,
    session: {} as Session, getGuest: id => id === 1 ? guest as unknown as WebContents : undefined,
    alive, dialog: { showMessageBox: prompt }, shell: { openExternal, openPath: vi.fn(async () => '') }, receiverOrigin: vi.fn() });
  return { host, guest, app, alive, prompt, openExternal, send, closeBridge, closeRelay };
}
afterEach(() => vi.clearAllMocks());
describe('native sign-in handoff without real profile writes', () => {
  it('keeps macOS/dev-only Pinterest guards and rejects unowned guests', async () => {
    for (const [platform, packaged] of [['linux', false], ['darwin', true]] as const) {
      const f = fixture(platform, packaged); expect((await f.host.connectPinterest(1)).ok).toBe(false); expect(f.app.getApplicationInfoForProtocol).not.toHaveBeenCalled(); f.host.stop();
    }
    const f = fixture(); expect((await f.host.connectPinterest(2)).ok).toBe(false); expect(f.prompt).not.toHaveBeenCalled(); f.host.stop();
  });
  it('never starts cookie receiver or registration after cancelled consent', async () => {
    const f = fixture(); expect((await f.host.connectPinterest(1)).ok).toBe(false);
    expect(adapters.start).not.toHaveBeenCalled(); expect(adapters.relay).not.toHaveBeenCalled(); f.host.stop();
  });
  it('revokes the one-use connector on navigation and never imports stale cookies', async () => {
    const f = fixture(); f.prompt.mockResolvedValue({ response: 2, checkboxChecked: false });
    expect(await f.host.connectPinterest(1)).toEqual({ ok: true }); expect(adapters.relay).toHaveBeenCalledOnce();
    const accept = adapters.start.mock.calls[0]![0].accept;
    f.guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(f.closeBridge).toHaveBeenCalledOnce(); expect(f.closeRelay).toHaveBeenCalledOnce();
    expect(await accept([], new AbortController().signal)).toBe(false); expect(adapters.importCookies).not.toHaveBeenCalled(); f.host.stop();
  });
  it('imports only after confirmation and settles the guest on a successful receiver', async () => {
    const f = fixture(); f.prompt.mockResolvedValue({ response: 2, checkboxChecked: false });
    await f.host.connectPinterest(1); expect(await adapters.start.mock.calls[0]![0].accept([{ name: 'session' }], new AbortController().signal)).toBe(true);
    expect(adapters.importCookies).toHaveBeenCalledOnce(); expect(f.guest.loadURL).toHaveBeenCalledWith('https://www.pinterest.com/'); f.host.stop();
  });
  it('opens original-site login, never foreign OAuth state, only after native confirmation', async () => {
    const f = fixture(); f.guest.getURL.mockReturnValue('https://dribbble.com/shots/123?oauth_state=secret');
    f.prompt.mockResolvedValue({ response: 1, checkboxChecked: false }); await f.host.connectGoogle(f.guest as unknown as WebContents);
    expect(f.openExternal).toHaveBeenCalledWith('https://dribbble.com/session/new'); expect(adapters.relay).not.toHaveBeenCalled(); f.host.stop();
  });
  it('rechecks source ownership after a native login dialog', async () => {
    const f = fixture(); f.guest.getURL.mockReturnValue('https://behance.net/');
    f.prompt.mockImplementation(async () => { f.guest.getURL.mockReturnValue('https://other.test/'); return { response: 1, checkboxChecked: false }; });
    await f.host.connectGoogle(f.guest as unknown as WebContents); expect(f.openExternal).not.toHaveBeenCalled(); f.host.stop();
  });
});
