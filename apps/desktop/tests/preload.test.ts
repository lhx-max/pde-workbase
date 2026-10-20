import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { getBezierHost, type BezierHostBridge } from '@bezier/host';

const program = ts.transpileModule(readFileSync(new URL('../src/preload.cts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture(url = 'http://127.0.0.1:3210/', mainFrame = true) {
  const exposed: Record<string, unknown> = {};
  const ipc = { invoke: vi.fn(async () => ({ ok: true })), on: vi.fn(), removeListener: vi.fn() };
  runInNewContext(program, {
    URL, Error, exports: {}, location: new URL(url),
    process: { isMainFrame: mainFrame, platform: 'test', argv: [`--canvas-web-url=${encodeURIComponent('http://127.0.0.1:3210/')}`] },
    require: (name: string) => {
      if (name !== 'electron') throw new Error('Sandbox preload imported a non-Electron dependency');
      return { contextBridge: { exposeInMainWorld: (key: string, value: unknown) => { exposed[key] = value; } }, ipcRenderer: ipc };
    },
  });
  return { host: getBezierHost(exposed), exposed, ipc };
}
describe('sandboxed original host contract', () => {
  it('exposes a structurally valid getBezierHost contract only in the configured main app', () => {
    const f = fixture(); expect(f.host).not.toBeNull(); expect(f.host?.version).toBe(2);
    expect(f.host?.browser.readImage).toBeTypeOf('function');
    expect(f.host?.browser.openResourceCapture).toBeTypeOf('function');
    expect(f.host?.browser.startCaptureBridge).toBeTypeOf('function');
    expect(f.host?.browser.onBrowserCapture).toBeTypeOf('function');
  });
  it.each(['http://127.0.0.1:3210/artifacts/p.html', 'http://127.0.0.1:3211/', 'https://evil.test/', 'file:///private'])('does not expose bridge to %s', url => {
    expect(fixture(url).exposed).toEqual({});
  });
  it('does not expose bridge in a same-origin subframe', () => { expect(fixture(undefined, false).host).toBeNull(); });
  it('returns explicit unsupported rather than pretend successes', async () => {
    const host = fixture().host as BezierHostBridge;
    for (const result of [await host.pdf.print('<p>x</p>'), await host.project.pickAndImport(), await host.project.pickAndReplaceWorkingDir('p'), await host.shell.openPath('p')]) {
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('不支持') });
    }
    await expect(host.updater.status()).rejects.toThrow('不支持');
    expect(() => host.updater.subscribe(() => undefined)).toThrow('不支持');
  });
  it('returns a Chinese failure rather than raw English IPC errors or success', async () => {
    const { host, ipc } = fixture();
    ipc.invoke.mockRejectedValueOnce(new Error('Native network failed'));
    await expect(host!.browser.startCaptureBridge!()).resolves.toEqual({ ok: false, reason: '桌面端操作失败，请重试。' });
  });
  it('strips Electron English wrappers from read-only native errors and still rejects', async () => {
    const { host, ipc } = fixture();
    ipc.invoke.mockRejectedValueOnce(new Error("Error invoking remote method 'browser:read-image': Error: 图片来源页面已改变。"));
    await expect(host!.browser.readImage!(7, 'https://site.test/image.png')).rejects.toThrow('图片来源页面已改变。');
    ipc.invoke.mockRejectedValueOnce(new Error('Network failed'));
    await expect(host!.browser.readImage!(7, 'https://site.test/image.png')).rejects.toThrow('桌面端操作失败，请重试。');
  });
  it('forwards only the fixed native methods without revealing a generic invoke primitive', async () => {
    const { host, ipc } = fixture();
    await host!.browser.openResourceCapture!(7, 'project', 'tab');
    expect(ipc.invoke).toHaveBeenCalledWith('browser:open-resource-capture', 7, 'project', 'tab');
    expect(host).not.toHaveProperty('invoke'); expect(host).not.toHaveProperty('token');
  });
});
