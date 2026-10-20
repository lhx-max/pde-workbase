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
    URL, exports: {}, location: new URL(url),
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
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('unsupported') });
    }
    await expect(host.updater.status()).rejects.toThrow('unsupported');
    expect(() => host.updater.subscribe(() => undefined)).toThrow('unsupported');
  });
  it('forwards only the fixed native methods without revealing a generic invoke primitive', async () => {
    const { host, ipc } = fixture();
    await host!.browser.openResourceCapture!(7, 'project', 'tab');
    expect(ipc.invoke).toHaveBeenCalledWith('browser:open-resource-capture', 7, 'project', 'tab');
    expect(host).not.toHaveProperty('invoke'); expect(host).not.toHaveProperty('token');
  });
});
