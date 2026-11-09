import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createCanvasServer, type CanvasServer, type CanvasServerOptions } from '../src/server.js';

const active: Array<{ api: CanvasServer; listener: ReturnType<CanvasServer['app']['listen']>; root: string }> = [];
afterEach(async () => {
  for (const { api, listener, root } of active.splice(0)) {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture(options: Partial<CanvasServerOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-image-http-'));
  const api = createCanvasServer({ ...options, dataRoot: root });
  const listener = api.app.listen(0, '127.0.0.1');
  active.push({ api, listener, root });
  await once(listener, 'listening');
  await api.ready;
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  return { api, root, url };
}
async function upload(url: string, bytes: Buffer) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'source.png');
  const response = await fetch(`${url}/api/asset-library/upload`, { method: 'POST', body: form });
  expect(response.status).toBe(201);
  return (await response.json() as { asset: { id: string; versions: Array<{ id: string }> } }).asset;
}
function send(url: string, id: string, source: Record<string, unknown>, revision = 0) {
  return fetch(`${url}/api/projects/${id}/canvas/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: `attach-${revision}`, baseRevision: revision, operations: [{ type: 'image.attach', nodeId: 'attached', source, x: 2, y: 4 }] }) });
}

it('attaches a real local asset version over HTTP and records stable source identity and usage', async () => {
  const { api, url } = await fixture();
  const project = api.registry.create({ name: 'Image operation' });
  const red = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#fa2030' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#2030fa' } }).png().toBuffer();
  const asset = await upload(url, red);
  const newer = await api.assetLibrary.version(asset.id, { bytes: blue, filename: 'newer.png', mime: 'image/png' }, 1);
  const versionId = asset.versions[0]!.id;
  expect(newer.versions.at(-1)!.id).not.toBe(versionId);
  const capabilities = await (await fetch(`${url}/api/projects/${project.id}/canvas/capabilities`)).json() as { image: { source: string[] } };
  expect(capabilities.image.source).toContain('personal-asset-version');
  const response = await send(url, project.id, { assetId: asset.id, versionId });
  expect(response.status, await response.clone().text()).toBe(200);
  const applied = await response.json() as { state: { workbenchImages: Array<{ path: string; sourceAsset: unknown; naturalWidth: number; naturalHeight: number }> }; revision: number };
  const image = applied.state.workbenchImages[0]!;
  expect(image.sourceAsset).toEqual({ assetId: asset.id, versionId });
  expect(image).toMatchObject({ naturalWidth: 3, naturalHeight: 2 });
  expect(await readFile(join(api.registry.resolveProjectRoot(project.id), image.path))).toEqual(red);
  expect(await api.assetLibrary.uses(asset.id)).toEqual(expect.arrayContaining([expect.objectContaining({ projectId: project.id, filename: image.path, versionId })]));
  const replay = await send(url, project.id, { assetId: asset.id, versionId });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ replayed: true, revision: applied.revision });
  expect((await api.assetLibrary.uses(asset.id)).filter(use => use.projectId === project.id)).toHaveLength(1);
  const missingVersion = await fetch(`${url}/api/projects/${project.id}/canvas/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'attach-absent-version', baseRevision: applied.revision, operations: [{ type: 'image.attach', nodeId: 'other', source: { assetId: asset.id, versionId: 'missing' }, x: 0, y: 0 }] }) });
  expect(missingVersion.status).toBe(404);
  expect((await api.canvas.read(project.id)).state.workbenchImages).toHaveLength(1);
});

it('rejects image operation mutations for read-only projects without reading asset bytes', async () => {
  const { api, url } = await fixture({ authorizeProject: (_req, res, _id, access) => {
    if (access.mode === 'write') { res.status(403).json({ error: { code: 'READ_ONLY' } }); return false; }
    return true;
  } });
  const project = api.registry.create({ name: 'Read only' });
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#123456' } }).png().toBuffer();
  const asset = await upload(url, png);
  expect((await fetch(`${url}/api/projects/${project.id}/canvas/capabilities`)).status).toBe(200);
  const response = await send(url, project.id, { assetId: asset.id, versionId: asset.versions[0]!.id });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'READ_ONLY' } });
  expect(await api.canvas.read(project.id)).toEqual({ state: {}, revision: 0 });
  expect(await api.assetLibrary.uses(asset.id)).toEqual([]);
  expect((await send(url, 'no-such-project', { assetId: asset.id })).status).toBe(404);
});
