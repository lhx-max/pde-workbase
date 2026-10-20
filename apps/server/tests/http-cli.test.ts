import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildHttpCliRequest, runHttpCli } from '../src/http-cli.js';

const roots: string[] = [];
const base = ['--server-url', 'http://127.0.0.1:17456'];
async function temp() { const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-http-cli-')); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const root of roots.splice(0)) { const resolved = path.resolve(root); if (path.dirname(resolved) !== os.tmpdir() || !path.basename(resolved).startsWith('canvas-http-cli-')) throw new Error('Unexpected CLI test cleanup path'); await rm(resolved, { recursive: true, force: true }); } });

describe('standalone capability CLI', () => {
  it('uses the same library and browser preference HTTP routes as the UI', async () => {
    expect((await buildHttpCliRequest(['assets', 'list', ...base])).url.pathname).toBe('/api/asset-library');
    expect((await buildHttpCliRequest(['browser', 'preferences', ...base])).url.pathname).toBe('/api/browser-preferences');
    const root = await temp(), file = path.join(root, 'patch.json');
    await writeFile(file, JSON.stringify({ revision: 4, patch: { browserBookmarks: [] } }));
    const request = await buildHttpCliRequest(['browser', 'preferences', '--body-file', file, ...base]);
    expect(request.init.method).toBe('PUT');
    expect(JSON.parse(String(request.init.body))).toEqual({ revision: 4, patch: { browserBookmarks: [] } });
  });
  it('uploads real file bytes and original multipart metadata including capture identity', async () => {
    const root = await temp(), file = path.join(root, 'fixture.bin'), meta = path.join(root, 'meta.json');
    await writeFile(file, new Uint8Array([0, 128, 255]));
    await writeFile(meta, JSON.stringify({ name: 'Fixture', captureId: 'capture-1', tags: ['reference'], source: { projectId: 'p1' } }));
    const request = await buildHttpCliRequest(['assets', 'upload', '--file', file, '--body-file', meta, ...base]);
    expect(request.url.pathname).toBe('/api/asset-library/upload');
    const form = request.init.body as FormData;
    expect(form.get('captureId')).toBe('capture-1'); expect(form.get('tags')).toBe('["reference"]');
    expect([...new Uint8Array(await (form.get('file') as File).arrayBuffer())]).toEqual([0, 128, 255]);
    expect(new Headers(request.init.headers).has('Content-Type')).toBe(false);
  });
  it('keeps project import/save explicit and percent-encodes identity', async () => {
    const request = await buildHttpCliRequest(['assets', 'import', 'asset-1', '--project', 'one/two', '--path', 'imports/reference.png', ...base]);
    expect(request.url.pathname).toBe('/api/projects/one%2Ftwo/asset-library/import');
    expect(JSON.parse(String(request.init.body))).toEqual({ assetId: 'asset-1', path: 'imports/reference.png' });
  });
  it('accepts long-form task prompts from files without a shell interpolation path', async () => {
    const root = await temp(), prompt = path.join(root, 'prompt.md'), body = path.join(root, 'task.json');
    await writeFile(prompt, 'Preserve `literal` $(content)\n第二行'); await writeFile(body, '{"requestId":"test-task"}');
    const request = await buildHttpCliRequest(['request', 'POST', '/api/projects/p/agent/tasks', '--body-file', body, '--prompt-file', prompt, ...base]);
    expect(JSON.parse(String(request.init.body))).toEqual({ requestId: 'test-task', prompt: 'Preserve `literal` $(content)\n第二行' });
    expect(request.init.redirect).toBe('error');
  });
  it('rejects credential URLs, path escape, unsupported options and accidental uploads', async () => {
    await expect(buildHttpCliRequest(['request', 'GET', '/api/../../outside', ...base])).rejects.toThrow();
    await expect(buildHttpCliRequest(['assets', 'list', '--server-url', 'https://user:secret@example.com/'])).rejects.toThrow();
    await expect(buildHttpCliRequest(['assets', 'batch', '--dry-run', ...base])).rejects.toThrow();
    await expect(buildHttpCliRequest(['assets', 'upload', ...base])).rejects.toThrow(/file/);
  });
  it('writes binary exports losslessly and refuses to overwrite an existing output', async () => {
    const root = await temp(), output = path.join(root, 'assets.zip'), bytes = new Uint8Array([80, 75, 0, 255, 128]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'application/zip' } })));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runHttpCli(['assets', 'export', '--ids', 'a,b', '--output', output, '--json', ...base]);
    expect([...await readFile(output)]).toEqual([...bytes]);
    await expect(runHttpCli(['assets', 'export', '--ids', 'a,b', '--output', output, ...base])).rejects.toThrow();
    expect([...await readFile(output)]).toEqual([...bytes]);
  });
});
