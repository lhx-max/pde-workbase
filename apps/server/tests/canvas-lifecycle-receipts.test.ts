import express from 'express';
import type { Request, Response as ExpressResponse } from 'express';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import type { AppActor } from '@ks-designai/app-authority';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerAppCanvasRoutes } from '../src/routes/app-canvas.js';
import { setVerifiedTenant } from '../src/tenant.js';
import '../src/card-packs.js';

/** Two-layer fake JsonStatePort: write() stages, flush() commits to `durable`.
 * A "restarted" port built over the same durable map sees only committed data. */
interface FakeState extends JsonStatePort { durable: Map<string, unknown>; flushCalls: number }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function fakeState(durable = new Map<string, unknown>(), failFlushAt: number[] = []): FakeState {
  const staged = new Map<string, unknown>([...durable].map(([k, v]) => [k, clone(v)]));
  const port: FakeState = {
    durable, flushCalls: 0,
    ready: Promise.resolve(),
    read: key => (staged.has(key) ? clone(staged.get(key)) : undefined),
    write: (key, value) => { staged.set(key, clone(value)); },
    flush: async () => {
      port.flushCalls += 1;
      if (failFlushAt.includes(port.flushCalls)) throw new Error('simulated persistence failure');
      durable.clear();
      for (const [k, v] of staged) durable.set(k, clone(v));
    },
  };
  return port;
}

interface Row { id: string; name: string; teamId?: string; createdBy?: string; createdAt: number; updatedAt: number; archivedAt?: number; metadata?: unknown }
function fakeRegistry() {
  const rows = new Map<string, Row>();
  return {
    rows,
    created: [] as string[], renamed: [] as string[], archived: [] as string[], flushed: 0,
    get(id: string) { return rows.get(id) ?? null; },
    list() { return [...rows.values()].filter(row => !row.archivedAt); },
    create(input: { id?: string; name: string; teamId?: string; createdBy?: string; metadata?: unknown }) {
      const id = input.id ?? `generated-${rows.size}`;
      const now = Date.now();
      const row: Row = { id, name: input.name, createdAt: now, updatedAt: now,
        ...(input.teamId ? { teamId: input.teamId } : {}), ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}) };
      rows.set(id, row); this.created.push(id);
      return row;
    },
    update(id: string, input: { name?: string }) {
      const row = rows.get(id); if (!row) throw new Error('project not found');
      if (input.name) row.name = input.name; row.updatedAt = Date.now(); this.renamed.push(id); return row;
    },
    archive(id: string) {
      const row = rows.get(id); if (!row) throw new Error('project not found');
      row.archivedAt = Date.now(); this.archived.push(id); return row;
    },
    async flush() { this.flushed += 1; },
  };
}
type Registry = ReturnType<typeof fakeRegistry>;

interface Auth { authorize: (req: Request, res: ExpressResponse, id: string, access?: { mode: 'read' | 'write'; capability?: string }) => Promise<boolean>; denied: Set<string> }
function fakeAuthorize(): Auth {
  const denied = new Set<string>();
  return {
    denied,
    authorize: async (_req, res, id) => {
      if (denied.has('*') || denied.has(id)) { res.status(403).json({ error: { code: 'TEST_FORBIDDEN', message: 'denied' } }); return false; }
      return true;
    },
  };
}

interface Fixture {
  base: string; registry: Registry; port: FakeState; auth: Auth;
  request: (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
  close: () => Promise<void>;
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture(options?: { durable?: Map<string, unknown>; failFlushAt?: number[]; registry?: Registry; maIdentity?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-lifecycle-'));
  const registry = options?.registry ?? fakeRegistry();
  const service = new CanvasStateService(async id => { const dir = join(root, id); await mkdir(dir, { recursive: true }); return dir; });
  const auth = fakeAuthorize();
  const port = fakeState(options?.durable, options?.failFlushAt);
  const app = express();
  app.use(express.json());
  if (options?.maIdentity) {
    app.use((req: Request, _res, next) => {
      const biz = req.get('x-test-biz'), application = req.get('x-test-app'), instance = req.get('x-test-inst');
      if (biz || application || instance) {
        const actor: AppActor = {
          teamId: req.get('x-team-id')?.trim() || 'local', userId: req.get('x-user-id')?.trim() || 'local',
          bizId: biz ?? '', applicationId: application ?? '', applicationInstanceId: instance ?? '', providerInstanceId: 'provider',
        };
        setVerifiedTenant(req, actor);
      }
      next();
    });
  }
  registerAppCanvasRoutes(app, { canvasState: service, registry, authorizeProjectRequest: auth.authorize, runtimeState: port });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('listener');
  const base = `http://127.0.0.1:${address.port}/api/apps/canvas`;
  const request = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
    fetch(`${base}${path}`, {
      method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  const close = async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); };
  cleanup.push(close);
  return { base, registry, port, auth, request, close } satisfies Fixture;
}

const json = async (res: Response) => res.json() as Promise<{ data?: Record<string, unknown>; error?: { code: string } }>;

it('replays canvas.create with the same receipt after a journal restart', async () => {
  const durable = new Map<string, unknown>();
  const registry = fakeRegistry();
  const f = await fixture({ durable, registry });
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1', 'idempotency-key': 'k1' };
  const created = await f.request('/actions/canvas.create', { body: { input: { name: 'A', instanceId: 'inst-1' } }, headers });
  expect(created.status, await created.clone().text()).toBe(201);
  const first = (await json(created)).data!;
  expect(first.receiptId).toBe('k1');
  expect(first.status).toBe('succeeded');
  expect(first.replayed).toBe(false);
  expect((first.result as { instanceId: string }).instanceId).toBe('inst-1');

  const replay = await f.request('/actions/canvas.create', { body: { input: { name: 'A', instanceId: 'inst-1' } }, headers });
  expect(replay.status).toBe(201);
  const replayed = (await json(replay)).data!;
  expect(replayed.replayed).toBe(true);
  expect(replayed.receiptId).toBe('k1');
  expect(replayed.result).toEqual({ instanceId: 'inst-1' });
  expect(registry.created).toEqual(['inst-1']);

  // "Restart": a fresh journal + router over the same durable slot.
  const restarted = await fixture({ durable, registry });
  const again = await restarted.request('/actions/canvas.create', { body: { input: { name: 'A', instanceId: 'inst-1' } }, headers });
  expect(again.status).toBe(201);
  expect((await json(again)).data!.replayed).toBe(true);
  expect(registry.created).toEqual(['inst-1']);

  const receipt = await restarted.request('/action-receipts/k1', { headers: { 'x-team-id': 't1', 'x-user-id': 'u1' } });
  expect(receipt.status).toBe(200);
  const view = (await json(receipt)).data!;
  expect(view).toMatchObject({ receiptId: 'k1', action: 'canvas.create', status: 'succeeded', result: { instanceId: 'inst-1' } });

  // An unkeyed create gets a generated durable receipt id usable for lookup.
  const unkeyed = await restarted.request('/actions/canvas.create', { body: { input: { name: 'B' } }, headers: { 'x-team-id': 't1', 'x-user-id': 'u1' } });
  expect(unkeyed.status).toBe(201);
  const generated = (await json(unkeyed)).data!;
  expect(typeof generated.receiptId).toBe('string');
  const lookup = await restarted.request(`/action-receipts/${generated.receiptId}`, { headers: { 'x-team-id': 't1', 'x-user-id': 'u1' } });
  expect(lookup.status).toBe(200);
});

it('replays canvas.rename and canvas.delete after a journal restart', async () => {
  const durable = new Map<string, unknown>();
  const registry = fakeRegistry();
  const f = await fixture({ durable, registry });
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1' };
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-2' } }, headers: { ...headers, 'idempotency-key': 'make' } });

  const renamed = await f.request('/instances/inst-2/actions/canvas.rename', { body: { input: { name: 'New' } }, headers: { ...headers, 'idempotency-key': 'k2' } });
  expect(renamed.status, await renamed.clone().text()).toBe(200);
  expect((await json(renamed)).data!).toMatchObject({ receiptId: 'k2', status: 'succeeded', result: { instanceId: 'inst-2', name: 'New' }, replayed: false });

  const restart = await fixture({ durable, registry });
  const replayedRename = await restart.request('/instances/inst-2/actions/canvas.rename', { body: { input: { name: 'New' } }, headers: { ...headers, 'idempotency-key': 'k2' } });
  expect(replayedRename.status).toBe(200);
  expect((await json(replayedRename)).data!).toMatchObject({ receiptId: 'k2', result: { instanceId: 'inst-2', name: 'New' }, replayed: true });
  expect(registry.renamed).toEqual(['inst-2']);

  const archived = await restart.request('/instances/inst-2/actions/canvas.delete', { body: {}, headers: { ...headers, 'idempotency-key': 'k3' } });
  expect(archived.status).toBe(200);
  expect((await json(archived)).data!).toMatchObject({ receiptId: 'k3', result: { instanceId: 'inst-2', archived: true } });
  const replayedArchive = await restart.request('/instances/inst-2/actions/canvas.delete', { body: {}, headers: { ...headers, 'idempotency-key': 'k3' } });
  expect((await json(replayedArchive)).data!.replayed).toBe(true);
  expect(registry.archived).toEqual(['inst-2']);

  const lifecycle = await restart.request('/instances/inst-2/action-receipts/k2', { headers });
  expect(lifecycle.status).toBe(200);
  expect((await json(lifecycle)).data!).toMatchObject({ receiptId: 'k2', action: 'canvas.rename', status: 'succeeded' });
});

it('conflicts when the same key is reused with different input or action', async () => {
  const f = await fixture({});
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1' };
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-c' } }, headers: { ...headers, 'idempotency-key': 'mk' } });
  expect((await f.request('/instances/inst-c/actions/canvas.rename', { body: { input: { name: 'x' } }, headers: { ...headers, 'idempotency-key': 'kc' } })).status).toBe(200);
  const differentInput = await f.request('/instances/inst-c/actions/canvas.rename', { body: { input: { name: 'y' } }, headers: { ...headers, 'idempotency-key': 'kc' } });
  expect(differentInput.status).toBe(409);
  expect((await json(differentInput)).error!.code).toBe('CANVAS_OPERATION_ID_CONFLICT');
  const differentAction = await f.request('/instances/inst-c/actions/canvas.delete', { body: {}, headers: { ...headers, 'idempotency-key': 'kc' } });
  expect(differentAction.status).toBe(409);
  const differentCreate = await f.request('/actions/canvas.create', { body: { input: { name: 'other', instanceId: 'inst-d' } }, headers: { ...headers, 'idempotency-key': 'mk' } });
  expect(differentCreate.status).toBe(409);
});

it('serializes concurrent same-key requests to a single side effect', async () => {
  const f = await fixture({});
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1' };
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-p' } }, headers: { ...headers, 'idempotency-key': 'mk' } });
  const call = () => f.request('/instances/inst-p/actions/canvas.rename', { body: { input: { name: 'race' } }, headers: { ...headers, 'idempotency-key': 'k-conc' } });
  const [a, b] = await Promise.all([call(), call()]);
  expect(a.status).toBe(200); expect(b.status).toBe(200);
  const da = (await json(a)).data!, db = (await json(b)).data!;
  expect(da.receiptId).toBe('k-conc'); expect(db.receiptId).toBe('k-conc');
  expect([da.replayed, db.replayed].sort()).toEqual([false, true]);
  expect(f.registry.renamed).toEqual(['inst-p']);
});

it('scopes receipts to the exact team/user/biz/MA-instance identity', async () => {
  const durable = new Map<string, unknown>();
  const f = await fixture({ durable, maIdentity: true });
  const a = { 'x-team-id': 't1', 'x-user-id': 'u1', 'x-test-biz': 'b1', 'x-test-app': 'app', 'x-test-inst': 'i1' };
  const sameTeamOtherBiz = { ...a, 'x-test-biz': 'b2' };
  const created = await f.request('/actions/canvas.create', { body: { input: { name: 'A', instanceId: 'inst-iso' } }, headers: { ...a, 'idempotency-key': 'kiso' } });
  expect(created.status).toBe(201);

  // Another MA biz/instance reusing the key gets no replay — the create target
  // simply exists, so it sees the plain conflict, not the cached result.
  const foreign = await f.request('/actions/canvas.create', { body: { input: { name: 'A', instanceId: 'inst-iso' } }, headers: { ...sameTeamOtherBiz, 'idempotency-key': 'kiso' } });
  expect(foreign.status).toBe(409);
  expect((await json(foreign)).error!.code).toBe('CANVAS_INSTANCE_EXISTS');
  expect((await f.request('/action-receipts/kiso', { headers: sameTeamOtherBiz })).status).toBe(404);
  expect((await f.request('/action-receipts/kiso', { headers: { ...a, 'x-user-id': 'u2' } })).status).toBe(404);
  expect((await f.request('/action-receipts/kiso', { headers: { ...a, 'x-team-id': 't2' } })).status).toBe(404);

  const renamed = await f.request('/instances/inst-iso/actions/canvas.rename', { body: { input: { name: 'mine' } }, headers: { ...a, 'idempotency-key': 'kri' } });
  expect(renamed.status).toBe(200);
  expect((await f.request('/instances/inst-iso/action-receipts/kri', { headers: sameTeamOtherBiz })).status).toBe(404);
  expect((await f.request('/instances/inst-iso/action-receipts/kri', { headers: { 'x-team-id': 't2', 'x-user-id': 'u9' } })).status).toBe(403);
});

it('denies a cached replay once the current authorizer is revoked', async () => {
  const f = await fixture({});
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1' };
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-rev' } }, headers: { ...headers, 'idempotency-key': 'kre' } });
  f.auth.denied.add('inst-rev');
  const denied = await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-rev' } }, headers: { ...headers, 'idempotency-key': 'kre' } });
  expect(denied.status).toBe(403);
  expect((await json(denied)).error!.code).toBe('TEST_FORBIDDEN');

  f.auth.denied.clear();
  await f.request('/instances/inst-rev/actions/canvas.rename', { body: { input: { name: 'ok' } }, headers: { ...headers, 'idempotency-key': 'krf' } });
  f.auth.denied.add('inst-rev');
  const deniedRename = await f.request('/instances/inst-rev/actions/canvas.rename', { body: { input: { name: 'ok' } }, headers: { ...headers, 'idempotency-key': 'krf' } });
  expect(deniedRename.status).toBe(403);
});

it('leaves the receipt pending when the completion flush fails and never mutates twice', async () => {
  const durable = new Map<string, unknown>();
  const registry = fakeRegistry();
  // create consumes flushes #1-#2; delete's reservation is #3 (commits) and its
  // completion is #4 (fails) — the mutation ran but no success was persisted.
  const f = await fixture({ durable, registry, failFlushAt: [4] });
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1', 'idempotency-key': 'kp' };
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-f' } }, headers: { ...headers, 'idempotency-key': 'mkf' } });
  const failed = await f.request('/instances/inst-f/actions/canvas.delete', { body: {}, headers });
  expect(failed.status).toBe(503);
  expect((await json(failed)).error!.code).toBe('CANVAS_ACTION_RECEIPTS_UNAVAILABLE');
  expect(registry.archived).toEqual(['inst-f']);
  const slot = durable.get('canvas-action-receipts') as { receipts: Array<{ status: string }> };
  expect(slot.receipts.map(r => r.status)).toContain('pending');

  const retry = await f.request('/instances/inst-f/actions/canvas.delete', { body: {}, headers });
  expect(retry.status).toBe(503);
  expect((await json(retry)).error!.code).toBe('CANVAS_OPERATION_UNCERTAIN');
  expect(registry.archived).toEqual(['inst-f']);

  const restarted = await fixture({ durable, registry });
  const afterRestart = await restarted.request('/instances/inst-f/actions/canvas.delete', { body: {}, headers });
  expect(afterRestart.status).toBe(503);
  expect((await json(afterRestart)).error!.code).toBe('CANVAS_OPERATION_UNCERTAIN');
  expect(registry.archived).toEqual(['inst-f']);
});

it('rejects a malformed receipt slot instead of recovering silently', async () => {
  const durable = new Map<string, unknown>();
  durable.set('canvas-action-receipts', { version: 99, receipts: [] });
  const f = await fixture({ durable });
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1', 'idempotency-key': 'kb' };
  const res = await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-b' } }, headers });
  expect(res.status).toBe(503);
  expect((await json(res)).error!.code).toBe('CANVAS_ACTION_RECEIPTS_CORRUPT');
  expect(f.registry.created).toEqual([]);
});

it('keeps the legacy operation receipt lookup unchanged', async () => {
  const f = await fixture({});
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1' };
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-ops' } }, headers: { ...headers, 'idempotency-key': 'mko' } });
  const applied = await f.request('/instances/inst-ops/actions/node.create', {
    body: { expectedRevision:0, input: { node: { id: 'n1', kind: 'text', title: 't', text: 'hi', x: 0, y: 0 } } },
    headers: { ...headers, 'idempotency-key': 'op-9' },
  });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const receipt = await f.request('/instances/inst-ops/action-receipts/op-9', { headers });
  expect(receipt.status).toBe(200);
  const data = (await json(receipt)).data!;
  expect(data.receiptId).toBe('op-9');
  expect(data.status).toBe('succeeded');
  const missing = await f.request('/instances/inst-ops/action-receipts/nope', { headers });
  expect(missing.status).toBe(404);
});

it('validates input and targets before reserving a pending receipt', async () => {
  const f = await fixture({});
  const headers = { 'x-team-id': 't1', 'x-user-id': 'u1' };
  expect((await f.request('/instances/ghost/actions/canvas.rename', { body: { input: { name: 'x' } }, headers: { ...headers, 'idempotency-key': 'kg' } })).status).toBe(404);
  await f.request('/actions/canvas.create', { body: { input: { instanceId: 'inst-v' } }, headers: { ...headers, 'idempotency-key': 'mkv' } });
  expect((await f.request('/instances/inst-v/actions/canvas.rename', { body: { input: {} }, headers: { ...headers, 'idempotency-key': 'kv1' } })).status).toBe(400);
  expect((await f.request('/instances/inst-v/actions/canvas.rename', { body: { input: { name: 'x' } }, headers: { ...headers, 'idempotency-key': 'bad/key' } })).status).toBe(400);
  const slot = f.port.durable.get('canvas-action-receipts') as { receipts: unknown[] } | undefined;
  expect(slot?.receipts ?? []).toHaveLength(1); // only the create
});
