import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { canvasProviderProjectId, registerCanvasProviderRoutes, type RegisterCanvasProviderRoutesDeps } from '../src/routes/canvas-provider.js';
import { currentRequestTenant, tenantOf } from '../src/tenant.js';
import { createCanvasServer, type CanvasServer, type CanvasServerOptions } from '../src/server.js';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';

let root: string;
let registry: ReturnType<typeof createProjectRegistry>;
let canvas: CanvasStateService;
const servers: ReturnType<ReturnType<typeof express>['listen']>[] = [];
const runtimes: CanvasServer[] = [];
const authorize = vi.fn<RegisterCanvasProviderRoutesDeps['authorizeProjectRequest']>(() => true);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-provider-'));
  registry = createProjectRegistry(root);
  canvas = new CanvasStateService(id => registry.resolveProjectRoot(id));
  authorize.mockReset(); authorize.mockReturnValue(true);
});
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  for (const runtime of runtimes.splice(0)) await runtime.close();
  if (resolve(root) !== root || !basename(root).startsWith('canvas-provider-')) throw new Error('Unexpected test cleanup target');
  await rm(root, { recursive: true, force: true });
});
async function start(extra: Partial<RegisterCanvasProviderRoutesDeps> = {}) {
  const app = express(); app.use(express.json());
  registerCanvasProviderRoutes(app, { registry, canvasState: canvas, authorizeProjectRequest: authorize, providerLocalDevelopment: true, ...extra });
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(done => server.once('listening', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('listener');
  return `http://127.0.0.1:${address.port}`;
}
async function startFull(options: Partial<CanvasServerOptions> = {}) {
  const api = createCanvasServer({ dataRoot: root, ...options }); runtimes.push(api);
  await api.ready;
  const server = api.app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(done => server.once('listening', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('listener');
  return { api, base: `http://127.0.0.1:${address.port}` };
}
function body(actionId: string, overrides: Record<string, unknown> = {}) {
  return { protocolVersion: '1.0', requestId: 'req-1', idempotencyKey: 'key-1', applicationId: 'app-canvas', applicationVersion: '0.1.0', applicationInstanceId: 'ai-1', providerInstanceId: 'pid-1', actor: { tenantId: 'team-a', userId: 'alice' }, actionId, input: {}, ...overrides };
}
async function call(base: string, actionId: string, overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const payload = body(actionId, overrides);
  const response = await fetch(`${base}/open-platform/v1/instances/${encodeURIComponent(String(payload.providerInstanceId))}/actions/${actionId}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return { status: response.status, json: await response.json() as { protocolVersion: string; actionId: string; providerInstanceId: string; revision: number; summary: string; data: { canvasInstanceId: string; name?: string; state?: Record<string, unknown>; context?: { revision: number }; receipt?: { operationId: string; revision: number } }; error?: { code: string; details?: { actualRevision?: number } } } };
}
const operation = (id = 'n1') => ({ type: 'node.create', node: { id, kind: 'text', text: `hello ${id}`, x: 0, y: 0 } });
const actorB = { tenantId: 'team-b', userId: 'bob' };

it('defaults unavailable even with a forged Kit actor', async () => {
  const base = await start({ providerLocalDevelopment: undefined });
  const result = await call(base, 'canvas.create');
  expect(result.status).toBe(503); expect(result.json.error?.code).toBe('PROVIDER_UNAVAILABLE');
  expect(registry.list()).toEqual([]); expect(authorize).not.toHaveBeenCalled();
});

it('rejects cross-origin, non-loopback Host, forwarded requests and actor/header ambiguity', async () => {
  const base = await start();
  const rejectedHeaders: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'x-forwarded-for': '127.0.0.1' }, { forwarded: 'for=127.0.0.1' }, { 'x-team-id': 'team-b' }, { 'x-user-id': 'mallory' }];
  for (const headers of rejectedHeaders) {
    expect((await call(base, 'canvas.create', {}, headers)).status, JSON.stringify(headers)).toBe(403);
  }
  // Node fetch normalizes/ignores a custom Host; use the actual HTTP wire here.
  const status = await new Promise<number>((done, reject) => {
    const req = httpRequest(`${base}/open-platform/v1/instances/pid-1/actions/canvas.create`, { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => done(res.statusCode ?? 0));
    });
    req.on('error', reject); req.end(JSON.stringify(body('canvas.create')));
  });
  expect(status).toBe(403);
  expect(registry.list()).toEqual([]);
  expect((await call(base, 'canvas.create', {}, { origin: base })).status).toBe(200);
});

it('validates protocol, actor, path binding, IDs and safe positive revisions', async () => {
  const base = await start();
  for (const override of [{ protocolVersion: '2.0' }, { actor: undefined }, { actor: { userId: 'a' } }, { applicationId: '' }, { requestId: '' }, { actionId: 'canvas.read' }, { input: [] }, { expectedRevision: 0 }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect((await call(base, 'canvas.create', override)).status).toBe(400);
  }
  const mismatch = await fetch(`${base}/open-platform/v1/instances/other/actions/canvas.create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('canvas.create')) });
  expect(mismatch.status).toBe(400); expect(registry.list()).toEqual([]);
});

it('creates once by tenant/app/pid and persists mapping and creation metadata without state duplication', async () => {
  const base = await start();
  const first = await call(base, 'canvas.create', { bizId: 'biz-1', sessionId: 'session-1', input: { name: 'Demo' } });
  expect(first.status).toBe(200);
  expect(first.json).toMatchObject({ protocolVersion: '1.0', actionId: 'canvas.create', providerInstanceId: 'pid-1', revision: 1, data: { name: 'Demo' } });
  const id = first.json.data.canvasInstanceId;
  expect(id).toBe(canvasProviderProjectId('team-a', 'app-canvas', 'pid-1'));
  expect(registry.get(id)).toMatchObject({ name: 'Demo', teamId: 'team-a', createdBy: 'alice', metadata: { canvasProvider: { tenantId: 'team-a', applicationId: 'app-canvas', providerInstanceId: 'pid-1' }, canvasProviderCreation: { bizId: 'biz-1', sessionId: 'session-1', applicationInstanceId: 'ai-1' } } });
  const second = await call(base, 'canvas.create', { requestId: 'new', idempotencyKey: 'new', input: { name: 'Must not rename', state: { injected: true } } });
  expect(second.json.data).toEqual(first.json.data); expect(registry.list()).toHaveLength(1);
  expect(await canvas.read(id)).toEqual({ state: {}, revision: 0 });
});

it('authorizes with mapped project, local identity and async tenant before any creation', async () => {
  authorize.mockImplementation((req, res, id, access) => {
    expect(id).toBe(canvasProviderProjectId('team-a', 'app-canvas', 'pid-1'));
    expect(tenantOf(req)).toEqual({ teamId: 'team-a', userId: 'alice' });
    expect(currentRequestTenant()).toEqual(tenantOf(req));
    expect(access).toEqual({ mode: 'write', capability: 'writeFiles' });
    res.status(403).json({ error: { code: 'DENIED' } }); return false;
  });
  expect((await call(await start(), 'canvas.create')).status).toBe(403);
  expect(registry.list()).toHaveLength(0);
});

it('reads and builds context from the same canonical canvas state', async () => {
  const base = await start();
  const created = await call(base, 'canvas.create');
  const applied = await call(base, 'canvas.operations', { expectedRevision: 1, input: { operations: [operation()] } });
  expect(applied.status).toBe(200); expect(applied.json.data.receipt?.operationId).toMatch(/^ma-[a-f0-9]{64}$/);
  const stored = await canvas.read(created.json.data.canvasInstanceId);
  const read = await call(base, 'canvas.read');
  expect(read.json.data).toMatchObject({ canvasInstanceId: created.json.data.canvasInstanceId, state: stored.state });
  expect(read.json.revision).toBe(stored.revision + 1);
  expect(read.json.revision).toBe(applied.json.revision);
  const context = await call(base, 'canvas.context');
  expect(context.json.data.context).toEqual(await canvas.context(created.json.data.canvasInstanceId));
  expect(context.json.revision).toBe(read.json.revision);
  expect(authorize.mock.calls.at(-1)?.[3]).toEqual({ mode: 'read' });
});

it('requires write revision and rejects Provider-owned fields and invalid operations', async () => {
  const base = await start(); await call(base, 'canvas.create');
  for (const input of [{ operations: [operation()] }, { operations: [], baseRevision: 0 }, { operations: [], operationId: 'escape' }, { operations: [] }, { operations: [{ type: 'not-real' }] }]) {
    const result = await call(base, 'canvas.operations', { ...(Object.keys(input).length === 1 && input.operations.length === 1 && input.operations[0]?.type === 'node.create' ? {} : { expectedRevision: 1 }), input });
    expect(result.status).toBe(400);
  }
});

it('rejects stale core and Provider revisions, with Provider-space conflict details', async () => {
  const base = await start(); const created = await call(base, 'canvas.create');
  const external = await canvas.patch(created.json.data.canvasInstanceId, { marker: 'UI edit' });
  const stale = await call(base, 'canvas.operations', { expectedRevision: 1, input: { operations: [operation()] } });
  expect(stale.status).toBe(409); expect(stale.json.error?.code).toBe('PROVIDER_REVISION_CONFLICT');
  expect(stale.json.error?.details?.actualRevision).toBe(external.revision + 1);
  expect((await call(base, 'canvas.read', { expectedRevision: 1 })).status).toBe(409);
  expect((await call(base, 'canvas.context', { expectedRevision: 1 })).status).toBe(409);
});

it('replays the original receipt after later edits and rejects changed input under the same key', async () => {
  const base = await start(); const created = await call(base, 'canvas.create');
  const request = { expectedRevision: 1, input: { operations: [operation()] } };
  const first = await call(base, 'canvas.operations', request);
  await canvas.patch(created.json.data.canvasInstanceId, { marker: 'later edit' });
  const replay = await call(base, 'canvas.operations', { ...request, requestId: 'retry-request' });
  expect(replay.status).toBe(200); expect(replay.json).toEqual(first.json);
  const conflict = await call(base, 'canvas.operations', { ...request, input: { operations: [operation('different')] } });
  expect(conflict.status).toBe(409); expect(conflict.json.error?.code).toBe('PROVIDER_IDEMPOTENCY_CONFLICT');
});

it('restores mapping and operation replay from existing stores after service reconstruction', async () => {
  const base = await start(); await call(base, 'canvas.create');
  const request = { expectedRevision: 1, input: { operations: [operation()] } };
  const first = await call(base, 'canvas.operations', request);
  registry = createProjectRegistry(root); canvas = new CanvasStateService(id => registry.resolveProjectRoot(id));
  const restarted = await start();
  expect((await call(restarted, 'canvas.operations', request)).json).toEqual(first.json);
  const createdAgain = await call(restarted, 'canvas.create', { idempotencyKey: 'another' });
  expect(createdAgain.json.data.canvasInstanceId).toBe(first.json.data.canvasInstanceId);
  expect(registry.list()).toHaveLength(1);
});

it('isolates same pid and key across tenants and applications, and does not resolve raw project IDs', async () => {
  const base = await start();
  const a = await call(base, 'canvas.create');
  expect((await call(base, 'canvas.read', { actor: actorB })).status).toBe(404);
  const b = await call(base, 'canvas.create', { actor: actorB });
  const appB = await call(base, 'canvas.create', { applicationId: 'app-other' });
  expect(new Set([a.json.data.canvasInstanceId, b.json.data.canvasInstanceId, appB.json.data.canvasInstanceId]).size).toBe(3);
  await call(base, 'canvas.operations', { expectedRevision: 1, input: { operations: [operation()] } });
  const readB = await call(base, 'canvas.read', { actor: actorB });
  expect(readB.json.data.state).toEqual({}); expect(readB.json.revision).toBe(1);
  expect((await call(base, 'canvas.operations', { actor: actorB, expectedRevision: 1, input: { operations: [operation('b')] } })).status).toBe(200);
  expect((await call(base, 'canvas.read', { providerInstanceId: a.json.data.canvasInstanceId, actor: actorB })).status).toBe(404);
});

it('does not replay another user receipt in the same tenant', async () => {
  const base = await start(); await call(base, 'canvas.create');
  const request = { expectedRevision: 1, input: { operations: [operation()] } };
  expect((await call(base, 'canvas.operations', request)).status).toBe(200);
  const result = await call(base, 'canvas.operations', { ...request, actor: { tenantId: 'team-a', userId: 'different-user' } });
  expect(result.status).toBe(409); expect(result.json.error?.code).toBe('PROVIDER_REVISION_CONFLICT');
});

it('fails closed when the deterministic ID is occupied by an unrelated project', async () => {
  registry.create({ id: canvasProviderProjectId('team-a', 'app-canvas', 'pid-1'), name: 'Existing user project', teamId: 'team-a' });
  const result = await call(await start(), 'canvas.create');
  expect(result.status).toBe(403); expect(result.json.error?.code).toBe('PROVIDER_MAPPING_FORBIDDEN');
  expect(registry.list()[0]?.name).toBe('Existing user project');
});

it('serializes concurrent creates and lets only one distinct write win the same revision', async () => {
  const base = await start();
  const created = await Promise.all(Array.from({ length: 4 }, () => call(base, 'canvas.create')));
  expect(created.every(result => result.status === 200)).toBe(true); expect(registry.list()).toHaveLength(1);
  const results = await Promise.all(['a', 'b'].map(id => call(base, 'canvas.operations', { idempotencyKey: id, expectedRevision: 1, input: { operations: [operation(id)] } })));
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
});

it('requires authorization for read/replay and never exposes an anonymous GET snapshot', async () => {
  const base = await start(); await call(base, 'canvas.create');
  const request = { expectedRevision: 1, input: { operations: [operation()] } };
  await call(base, 'canvas.operations', request);
  authorize.mockImplementation((_req, res) => { res.status(403).json({ error: { code: 'DENIED' } }); return false; });
  expect((await call(base, 'canvas.operations', request)).status).toBe(403);
  expect((await call(base, 'canvas.read')).status).toBe(403);
  expect((await fetch(`${base}/open-platform/v1/instances/pid-1`)).status).toBe(404);
  expect((await fetch(`${base}/open-platform/v1/instances/pid-1/snapshot`)).status).toBe(404);
});

it('fails closed when an authorizer denies without writing a response', async () => {
  authorize.mockReturnValue(false);
  const result = await call(await start(), 'canvas.create');
  expect(result.status).toBe(403); expect(result.json.error?.code).toBe('PROVIDER_FORBIDDEN');
  expect(registry.list()).toHaveLength(0);
});

it('uses requestId as a durable idempotency fallback and keeps a failed batch atomic', async () => {
  const base = await start(); await call(base, 'canvas.create');
  const request = { idempotencyKey: undefined, requestId: 'fallback-key', expectedRevision: 1, input: { operations: [operation()] } };
  const first = await call(base, 'canvas.operations', request);
  expect(first.status).toBe(200);
  expect((await call(base, 'canvas.operations', request)).json).toEqual(first.json);
  const failed = await call(base, 'canvas.operations', { idempotencyKey: 'bad-batch', expectedRevision: first.json.revision, input: { operations: [operation('n2'), { type: 'node.move', nodeId: 'missing', x: 1, y: 1 }] } });
  expect(failed.status).toBeGreaterThanOrEqual(400);
  const snapshot = await call(base, 'canvas.read');
  expect(snapshot.json.revision).toBe(first.json.revision);
  expect(snapshot.json.data.state?.workbenchBasicNodes).toHaveLength(1);
});

it('integrates with real server authorization and shares the UI canvas state without a fork', async () => {
  const { api, base } = await startFull({ providerLocalDevelopment: true });
  const created = await call(base, 'canvas.create');
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const pid = created.json.data.canvasInstanceId;
  expect(api.registry.get(pid)?.teamId).toBe('team-a');
  const applied = await call(base, 'canvas.operations', { expectedRevision: 1, input: { operations: [operation()] } });
  expect(applied.status, JSON.stringify(applied.json)).toBe(200);
  const uiResponse = await fetch(`${base}/api/projects/${pid}/canvas/state`, { headers: { 'x-team-id': 'team-a', 'x-user-id': 'alice' } });
  expect(uiResponse.status).toBe(200);
  const ui = await uiResponse.json() as { revision: number; state: Record<string, unknown> };
  const provider = await call(base, 'canvas.read');
  const { projectPath: _path, cloudProjectId: _cloud, ...uiAuthoredState } = ui.state;
  expect(uiAuthoredState).toEqual(provider.json.data.state);
  expect(provider.json.revision).toBe(ui.revision + 1);
  expect((await fetch(`${base}/api/projects/${pid}/canvas/state`, { headers: { 'x-team-id': 'team-b' } })).status).toBe(403);
  new AppEntitlementStore(root).put({ scope: 'team:team-a', appId: 'canvas', effect: 'deny' });
  expect((await call(base, 'canvas.read')).status).toBe(403);
  expect((await call(base, 'canvas.create', { providerInstanceId: 'denied-new' })).status).toBe(403);
  expect(api.registry.list()).toHaveLength(1);
});

it('keeps Provider disabled in the real server and applies host write authorization before create', async () => {
  const disabled = await startFull();
  expect((await call(disabled.base, 'canvas.create')).status).toBe(503);
  expect(disabled.api.registry.list()).toHaveLength(0);
  const denied = await startFull({ providerLocalDevelopment: true, authorizeProject: (_req, res, _id, access) => {
    expect(access.mode).toBe('write'); res.status(403).json({ error: { code: 'READ_ONLY' } }); return false;
  } });
  const response = await call(denied.base, 'canvas.create');
  expect(response.status).toBe(403); expect(response.json.error?.code).toBe('READ_ONLY');
  expect(denied.api.registry.list()).toHaveLength(0);
});

it('rejects archived writes and unsupported actions rather than pretending success', async () => {
  const base = await start(); const created = await call(base, 'canvas.create');
  registry.archive(created.json.data.canvasInstanceId);
  expect((await call(base, 'canvas.operations', { expectedRevision: 1, input: { operations: [operation()] } })).status).toBe(409);
  for (const action of ['canvas.rename', 'canvas.delete', 'canvas.duplicate', 'node.create']) expect((await call(base, action)).status).toBe(404);
});
