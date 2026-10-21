import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createCanvasServer } from '../src/server.js';
import { runWithRequestTenant } from '../src/tenant.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-library-local-boundary-'));
  const api = createCanvasServer({ dataRoot: root });
  await api.ready;
  const listener = api.app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    await api.close();
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('asset-library-local-boundary-')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const request = (route: string, teamId: string, userId: string, method = 'GET', body?: unknown) => fetch(url + route, {
    method, headers: { 'content-type': 'application/json', 'x-team-id': teamId, 'x-user-id': userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { api, root, request };
}

it('rejects nonlocal callers across built-in library routes and project import/save before accessing assets', async () => {
  const { api, request } = await fixture();
  // No request context: this explicit temporary service is system/local setup.
  const asset = await api.assetLibrary.create({ name: 'Private local note', kind: 'text', content: 'local snapshot' });
  for (const [teamId, userId] of [['team-a', 'alice'], ['local', 'another-user']] as const) {
    const project = api.registry.create({ name: 'Caller owns this project', teamId });
    const routes: Array<[string, string, unknown?]> = [
      ['/api/asset-library', 'GET'], ['/api/asset-library/info', 'GET'],
      [`/api/asset-library/${asset.id}`, 'GET'], [`/api/asset-library/${asset.id}/content`, 'GET'],
      [`/api/asset-library/${asset.id}/uses`, 'GET'], ['/api/asset-library/spaces', 'GET'],
      [`/api/asset-library/export?ids=${asset.id}`, 'GET'],
      ['/api/asset-library', 'POST', { name: 'Denied', kind: 'text' }],
      ['/api/asset-library/upload', 'POST', {}],
      [`/api/asset-library/${asset.id}`, 'PATCH', { name: 'Denied' }],
      [`/api/asset-library/${asset.id}/versions`, 'POST', { content: 'Denied' }],
      ['/api/asset-library/batch', 'POST', { ids: [asset.id], action: 'copy' }],
      ['/api/asset-library/spaces', 'POST', { upsert: [], remove: [] }],
      [`/api/projects/${project.id}/asset-library/import`, 'POST', { assetId: asset.id }],
      [`/api/projects/${project.id}/asset-library/save`, 'POST', { filename: 'missing.md' }],
    ];
    for (const [route, method, body] of routes) {
      const response = await request(route, teamId, userId, method, body);
      expect(response.status, `${method} ${route}`).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'ASSET_LIBRARY_LOCAL_ONLY' } });
    }
    expect(await readdir(api.registry.resolveProjectRoot(project.id))).not.toContain('note.md');
  }
  expect((await request('/api/asset-library', 'local', 'local')).status).toBe(200);
  expect(await api.assetLibrary.list()).toEqual([asset]);
});

it('blocks direct service and image attach/replace bypasses without touching the source or canvas', async () => {
  const { api, request } = await fixture();
  const asset = await api.assetLibrary.create({ name: 'Private image', kind: 'image' }, {
    // Reading authorization must fail before any image decoding occurs.
    bytes: Buffer.from('private image bytes'), filename: 'source.png', mime: 'image/png',
  });
  const tenant = { teamId: 'team-a', userId: 'alice' };
  expect(() => runWithRequestTenant(tenant, () => api.assetLibrary.content(asset.id)))
    .toThrow(expect.objectContaining({ status: 403, code: 'ASSET_LIBRARY_LOCAL_ONLY' }));
  expect(() => runWithRequestTenant(tenant, () => api.assetLibrary.create({ name: 'Denied', kind: 'text' })))
    .toThrow(expect.objectContaining({ status: 403 }));
  const project = api.registry.create({ name: 'Team canvas', ...tenant });
  const initial = await api.canvas.patch(project.id, { workbenchImages: [{ id: 'existing', path: 'untouched.png', x: 0, y: 0 }] });
  for (const type of ['image.attach', 'image.replace']) {
    const response = await request(`/api/projects/${project.id}/canvas/operations`, tenant.teamId, tenant.userId, 'POST', {
      operationId: type.replace('.', '-'), baseRevision: initial.revision,
      operations: [{ type, nodeId: type === 'image.attach' ? 'new-image' : 'existing',
        source: { assetId: asset.id, versionId: asset.versions[0]!.id }, ...(type === 'image.attach' ? { x: 0, y: 0 } : {}) }],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'CANVAS_ASSET_FORBIDDEN' } });
  }
  expect(await api.canvas.read(project.id)).toEqual(initial);
  expect(await api.assetLibrary.uses(asset.id)).toEqual([]);
  expect((await api.assetLibrary.content(asset.id)).bytes.toString()).toBe('private image bytes');
});
