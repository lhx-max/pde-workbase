import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasServer, type CanvasServerOptions } from '../src/server.js';
import { AppRegistryStore } from '../src/storage/app-registry.js';
import { AppwriteClient } from '../src/storage/appwrite-client.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(options: Partial<CanvasServerOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'canvas-tenant-test-'));
  const api = createCanvasServer({ ...options, dataRoot: root });
  await api.ready;
  const listener = api.app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await api.close();
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('canvas-tenant-test-')) throw Error('unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  });
  const call = (route: string, team?: string, method = 'GET', body?: unknown) => fetch(url + route, {
    method, headers: { 'content-type': 'application/json', ...(team ? { 'x-team-id': team, 'x-user-id': 'alice' } : {}), ...(options.authToken ? { authorization: `Bearer ${options.authToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { api, call };
}
async function upstream() {
  const requests: Array<{ path: string; team?: string | undefined; actor?: string | undefined; key?: string | undefined }> = [];
  const app = express(); app.use(express.json());
  app.use((req, res) => { requests.push({ path: req.originalUrl, team: req.get('x-team-id'), actor: req.get('x-user-id'), key: req.get('idempotency-key') }); res.json({ data: { ok: true } }); });
  const listener = app.listen(0, '127.0.0.1'); await once(listener, 'listening');
  cleanups.push(() => new Promise<void>(resolve => listener.close(() => resolve())));
  return { requests, endpoint: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/apps/private` };
}

it('keeps team Apps hidden and denies every proxy shape before any upstream request', async () => {
  const f = await fixture(); const remote = await upstream();
  expect((await f.call('/api/apps/register', 'alpha', 'POST', { appId: 'private', name: 'Private', endpoint: remote.endpoint, scope: 'team' })).status).toBe(201);
  const catalog = await (await f.call('/api/apps', 'beta')).json() as { data: { apps: { appId: string }[] } };
  expect(catalog.data.apps.map((app: { appId: string }) => app.appId)).not.toContain('private');
  const paths = ['/instances', '/instances/one/state', '/actions/private.create', '/instances/one/actions/private.write'];
  for (const route of paths) {
    const response = await f.call('/api/apps/private' + route, 'beta', route.includes('/actions/') ? 'POST' : 'GET', route.includes('/actions/') ? { input: {} } : undefined);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'TENANT_FORBIDDEN' } });
  }
  expect(await (await f.call('/api/apps/entitlements/check?appId=private', 'beta')).json()).toMatchObject({ data: { allowed: false } });
  expect(await (await f.call('/api/apps/entitlements/check?appId=unknown', 'alpha')).json()).toMatchObject({ data: { allowed: false } });
  expect(remote.requests).toHaveLength(0);
  expect((await f.call('/api/apps/private/instances?limit=2', 'alpha')).status).toBe(200);
  expect(remote.requests).toEqual([{ path: '/api/apps/private/instances?limit=2', team: 'alpha', actor: 'alice' }]);
  expect((await f.call('/api/apps/entitlements', undefined, 'PUT', { scope: 'team:alpha', appId: 'private', effect: 'deny' })).status).toBe(200);
  expect((await f.call('/api/apps/private/instances', 'alpha')).status).toBe(403);
  expect(remote.requests).toHaveLength(1);
});

it('allows own-team registration but prevents global governance and registration takeover', async () => {
  const f = await fixture();
  const registration = { appId: 'private', name: 'Private', endpoint: 'http://127.0.0.1:9/api/apps/private', scope: 'team' };
  expect((await f.call('/api/apps/register', 'alpha', 'POST', registration)).status).toBe(201);
  expect((await f.call('/api/apps/register', 'beta', 'POST', registration)).status).toBe(403);
  expect((await f.call('/api/apps/register', 'alpha', 'POST', { ...registration, scope: 'platform' })).status).toBe(403);
  expect((await f.call('/api/apps/register', 'alpha', 'POST', { ...registration, appId: 'global', scope: undefined })).status).toBe(403);
  expect((await f.call('/api/apps/private', 'beta', 'DELETE')).status).toBe(403);
  const rule = { scope: '*', appId: 'canvas', effect: 'deny' };
  for (const method of ['GET', 'PUT', 'DELETE']) expect((await f.call('/api/apps/entitlements', 'alpha', method, method === 'GET' ? undefined : rule)).status).toBe(403);
  expect(await (await f.call('/api/apps/entitlements')).json()).toMatchObject({ data: { rules: [] } });
  expect((await f.call('/api/apps/register', undefined, 'POST', { ...registration, appId: 'platform', scope: 'platform' })).status).toBe(201);
  expect((await f.call('/api/apps/platform', 'alpha', 'DELETE')).status).toBe(403);
  expect((await f.call('/api/apps/register', undefined, 'POST', { ...registration, appId: 'canvas' })).status).toBe(400);
  expect((await f.call('/api/apps/private', 'alpha', 'DELETE')).status).toBe(200);
  const competing = await Promise.all(['alpha', 'beta'].map(team => f.call('/api/apps/register', team, 'POST', { ...registration, appId: 'race' })));
  expect(competing.map(response => response.status).sort()).toEqual([201, 403]);
});

it('does not treat a deployment bearer or omitted identity as an operator role', async () => {
  const f = await fixture({ authToken: 'test-only' });
  expect((await f.call('/api/apps/entitlements')).status).toBe(403);
  expect((await f.call('/api/apps/register', undefined, 'POST', { appId: 'demo', name: 'Demo', endpoint: 'http://127.0.0.1:9' })).status).toBe(403);
  const trusted = await fixture({ authToken: 'test-only', authorizeAppManagement: () => true });
  expect((await trusted.call('/api/apps/entitlements', 'verified-operator')).status).toBe(200);
});

it('gates legacy and COI canvas reads/writes/receipts/files by the same instance tenant', async () => {
  const f = await fixture();
  f.api.registry.create({ id: 'alpha-canvas', name: 'Alpha', teamId: 'alpha', createdBy: 'alice' });
  f.api.registry.create({ id: 'local-canvas', name: 'Legacy local' });
  const routes = [
    ['/api/projects/alpha-canvas/canvas/state', 'GET'],
    ['/api/projects/alpha-canvas/canvas/operations', 'POST'],
    ['/api/projects/alpha-canvas/files', 'GET'],
    ['/api/projects/alpha-canvas/tabs', 'PUT'],
    ['/api/apps/canvas/instances/alpha-canvas/state', 'GET'],
    ['/api/apps/canvas/instances/alpha-canvas/operations', 'POST'],
    ['/api/apps/canvas/instances/alpha-canvas/action-receipts/op', 'GET'],
    ['/api/apps/canvas/instances/alpha-canvas/files?path=test.txt', 'PUT'],
    ['/api/apps/canvas/instances/alpha-canvas/bindings', 'PUT'],
  ];
  for (const [route, method] of routes) {
    const response = await f.call(route!, 'beta', method!, method === 'GET' ? undefined : {});
    expect(response.status, route).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'TENANT_FORBIDDEN' } });
  }
  expect((await f.call('/api/projects/alpha-canvas/canvas/state', 'alpha')).status).toBe(200);
  expect((await f.call('/api/projects/local-canvas/canvas/state', 'alpha')).status).toBe(403);
  expect((await f.call('/api/projects/local-canvas/canvas/state')).status).toBe(200);
  const listed = await (await f.call('/api/projects', 'alpha')).json() as { projects: { id: string }[] };
  expect(listed.projects.map((p: { id: string }) => p.id)).toEqual(['alpha-canvas']);
  const created = await (await f.call('/api/projects', 'alpha', 'POST', { id: 'legacy-new', name: 'new', teamId: 'beta', createdBy: 'mallory' })).json();
  expect(created).toMatchObject({ project: { teamId: 'alpha', createdBy: 'alice' } });
  expect((await f.call('/api/apps/entitlements', undefined, 'PUT', { scope: 'team:alpha', appId: 'canvas', effect: 'deny' })).status).toBe(200);
  expect((await f.call('/api/projects/alpha-canvas/canvas/state', 'alpha')).status).toBe(403);
  expect((await f.call('/api/apps/canvas/instances', 'alpha')).status).toBe(403);
});

it('refuses editor resolution and bindings to another team’s App', async () => {
  const f = await fixture();
  f.api.registry.create({ id: 'alpha-canvas', name: 'Alpha', teamId: 'alpha' });
  await f.api.canvas.applyOperations('alpha-canvas', { operationId: 'seed', baseRevision: 0, operations: [{ type: 'node.create', node: { id: 'text', kind: 'text', x: 0, y: 0 } }] });
  expect((await f.call('/api/apps/register', 'beta', 'POST', { appId: 'doc', name: 'Doc', endpoint: 'http://127.0.0.1:9/api/apps/doc', scope: 'team' })).status).toBe(201);
  expect((await f.call('/api/apps/canvas/instances/alpha-canvas/open-editor', 'alpha', 'POST', { nodeId: 'text' })).status).toBe(403);
  expect((await f.call('/api/apps/canvas/instances/alpha-canvas/bindings', 'alpha', 'PUT', { nodeId: 'text', appId: 'doc', appInstanceId: 'doc-1' })).status).toBe(403);
  expect(await (await f.call('/api/apps/canvas/instances/alpha-canvas/bindings', 'alpha')).json()).toMatchObject({ data: { bindings: [] } });
});

it('roundtrips scope/team and manifest through Appwrite instead of widening cached registrations', async () => {
  const client = new AppwriteClient({ endpoint: 'http://127.0.0.1:9/v1', projectId: 'fixture' });
  let row: Record<string, unknown> = {};
  const call = vi.spyOn(client, 'call').mockImplementation(async (method, _path, body) => {
    if (method === 'PATCH') { row = (body as { data: Record<string, unknown> }).data; return {} as never; }
    return { documents: [row] } as never;
  });
  const registry = new AppRegistryStore(client, 'fixture');
  await registry.register({ appId: 'private', name: 'Private', endpoint: 'http://localhost/private', scope: 'team', teamId: 'alpha', status: 'active', manifest: { tenancy: 'required' } });
  expect(row).toMatchObject({ scope: 'team', teamId: 'alpha', manifest: '{"tenancy":"required"}' });
  expect(await new AppRegistryStore(client, 'fixture').list()).toMatchObject([{ scope: 'team', teamId: 'alpha', manifest: { tenancy: 'required' } }]);
  delete row.scope; delete row.teamId;
  expect(await registry.list()).toMatchObject([{ scope: 'team', teamId: 'alpha' }]);
  call.mockRestore();
});
