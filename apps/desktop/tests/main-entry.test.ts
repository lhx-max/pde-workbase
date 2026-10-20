import { afterEach, expect, it, vi } from 'vitest';
const electron = vi.hoisted(() => ({
  app: { setPath: vi.fn(), setName: vi.fn(), whenReady: vi.fn(() => new Promise<void>(() => {})), exit: vi.fn() },
  BrowserWindow: vi.fn(), ipcMain: {}, session: {}, shell: {},
}));
vi.mock('electron', () => electron);
afterEach(() => vi.unstubAllEnvs());
it('finishes ESM entry evaluation while Electron ready is still pending', async () => {
  vi.stubEnv('CANVAS_WEB_URL', 'http://127.0.0.1:18001');
  vi.stubEnv('CANVAS_SERVER_URL', 'http://127.0.0.1:18002');
  vi.stubEnv('CANVAS_DESKTOP_AUTH_TOKEN', 'a'.repeat(64));
  vi.stubEnv('CANVAS_BROWSER_HOST_PORT', '18003');
  vi.stubEnv('CANVAS_DESKTOP_USER_DATA', '/tmp/canvas-desktop-entry-unit-only');
  // A top-level await of app.whenReady deadlocks this import: Electron cannot
  // emit ready until module evaluation finishes. No timers or real app needed.
  await import('../src/main.js');
  expect(electron.app.whenReady).toHaveBeenCalledOnce();
  expect(electron.BrowserWindow).not.toHaveBeenCalled();
  expect(electron.app.exit).not.toHaveBeenCalled();
});
