import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCanvasServer } from '../src/server.js';
import type { CanvasImageEditorTarget } from '@bezier/contracts';

let api: ReturnType<typeof createCanvasServer>, listener: ReturnType<typeof api.app.listen>, root: string, origin: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'image-handoff-'));
  api = createCanvasServer({ dataRoot: root, authorizeAppManagement: () => true }); await api.ready;
  api.registry.create({ id: 'canvas-a', name: 'A', teamId: 'alpha' });
  await api.canvas.updateMediaState('canvas-a', state => ({ ...state, workbenchImages: [{ id: 'picture-1', path: 'images/source.png', name: 'Source image', x: 10, y: 20, naturalWidth: 640, naturalHeight: 480, status: 'ready' }] }));
  listener = api.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => listener.once('listening', resolve));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>(resolve => listener.close(() => resolve())); await api.close(); await rm(root, { recursive: true, force: true }); });
const call = (path: string, body: unknown, team = 'alpha') => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-id': team, 'x-user-id': 'tester' }, body: JSON.stringify(body) });
const register = (scope = 'platform', team = 'alpha') => call('/api/apps/register', { appId: 'image', name: '图片', endpoint: 'http://127.0.0.1:19010/api/apps/image', scope }, team);
const open = (nodeId = 'picture-1', team = 'alpha') => call('/api/apps/canvas/instances/canvas-a/open-editor', { nodeId }, team);

it('resolves the existing image collection read-only, without creating App storage or changing card actions', async () => {
  const before = await api.canvas.read('canvas-a');
  expect((await register()).status).toBe(201);
  const response = await open(); expect(response.status).toBe(200);
  expect((await response.json() as { data: CanvasImageEditorTarget }).data).toEqual({ appId: 'image', kind: 'image', canvasInstanceId: 'canvas-a', nodeId: 'picture-1', endpoint: 'http://127.0.0.1:19010/api/apps/image', filePath: 'images/source.png', revision: before.revision, name: 'Source image', naturalWidth: 640, naturalHeight: 480 });
  expect(await api.canvas.read('canvas-a')).toEqual(before);
  const caps = (await (await fetch(origin + '/api/apps/canvas')).json() as { data: { editorApps: { image: string }; createActions: { image: string }; cardPacks: Array<{ packId: string; kinds: string[] }> } }).data;
  expect(caps.editorApps.image).toBe('image'); expect(caps.createActions.image).toBe('image.attach');
  expect(caps.cardPacks).toContainEqual(expect.objectContaining({ packId: 'image', kinds: ['image'] }));
});
it('reports an unregistered App explicitly and keeps the image', async () => {
  const before = await api.canvas.read('canvas-a');
  const response = await open(); expect(response.status).toBe(404);
  expect((await response.json() as { error: { code: string } }).error.code).toBe('APP_NOT_INSTALLED');
  expect(await api.canvas.read('canvas-a')).toEqual(before);
});
it('rejects wrong canvas tenant, inaccessible image App and missing cards', async () => {
  await register('team', 'beta');
  expect((await open('picture-1', 'beta')).status).toBe(403);
  expect((await open()).status).toBe(403);
  expect((await open('missing')).status).toBe(404);
});
it('does not open an unfinished image', async () => {
  await register();
  await api.canvas.updateMediaState('canvas-a', state => ({ ...state, workbenchImages: (state.workbenchImages as Record<string, unknown>[]).map(image => ({ ...image, status: 'generating' })) }));
  const response = await open(); expect(response.status).toBe(409);
  expect((await response.json() as { error: { code: string } }).error.code).toBe('IMAGE_NOT_READY');
});
