import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { AppwriteJsonState, MANIFEST_SLOT, stateDocumentId } from '../src/appwrite-json-state.js';
import { CloudStateError } from '../src/errors.js';
import type { AppwriteJsonStateOptions, AppwriteStateClient } from '../src/port.js';

const DB = 'db';
const COLLECTION = 'state';
const NS = 'doc:ma-instance-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const enc = encodeURIComponent;

type Doc = Record<string, unknown> & { $id: string };

/** In-memory Appwrite documents fixture. `afterPost`/`afterPatch` run AFTER
 * the row landed — returning an error simulates a lost write ack. `getHook`
 * fails or delays the read-back. All read/write traffic is counted. */
class FakeStateClient implements AppwriteStateClient {
  readonly docs = new Map<string, Doc>();
  readonly counts = { post: 0, patch: 0, del: 0, getRow: 0, list: 0 };
  afterPost?: (data: Record<string, unknown>) => unknown;
  afterPatch?: (data: Record<string, unknown>) => unknown;
  getHook?: () => unknown;
  getDelayMs = 0;
  getNeverSettles = false;

  docsPath(databaseId: string, collectionId: string): string {
    return `/databases/${enc(databaseId)}/collections/${enc(collectionId)}/documents`;
  }
  private base(): string { return this.docsPath(DB, COLLECTION); }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const [resource, query] = path.split('?') as [string, string | undefined];
    const base = this.base();
    if (method === 'GET' && resource === base) {
      this.counts.list++;
      const params = new URLSearchParams(query ?? '');
      const queries = params.getAll('queries[]').map(q => JSON.parse(q) as { method: string; attribute?: string; values?: unknown[] });
      let rows = [...this.docs.values()];
      for (const q of queries) {
        if (q.method === 'equal') rows = rows.filter(r => r[q.attribute as string] === (q.values as unknown[])[0]);
        if (q.method === 'orderAsc') rows = [...rows].sort((a, b) => String(a[q.attribute as string]).localeCompare(String(b[q.attribute as string])));
      }
      const cursor = queries.find(q => q.method === 'cursorAfter')?.values?.[0] as string | undefined;
      if (cursor !== undefined) rows = rows.filter(r => r.$id > cursor);
      const limit = queries.find(q => q.method === 'limit')?.values?.[0] as number | undefined;
      return { documents: rows.slice(0, limit ?? 100) } as T;
    }
    if (method === 'POST' && resource === base) {
      this.counts.post++;
      const request = body as { documentId: string; data: Record<string, unknown> };
      if (this.docs.has(request.documentId)) throw Object.assign(new Error('conflict'), { status: 409 });
      const doc = { ...request.data, $id: request.documentId } as Doc;
      this.docs.set(request.documentId, doc);
      if (this.afterPost) { const r = this.afterPost(request.data); if (r) throw r; }
      return doc as T;
    }
    if (method === 'PATCH') {
      this.counts.patch++;
      const doc = this.docs.get(resource.slice(base.length + 1));
      if (!doc) throw Object.assign(new Error('not found'), { status: 404 });
      Object.assign(doc, (body as { data: Record<string, unknown> }).data);
      if (this.afterPatch) { const r = this.afterPatch((body as { data: Record<string, unknown> }).data); if (r) throw r; }
      return doc as T;
    }
    throw new Error(`unhandled ${method} ${path}`);
  }

  async getOrNull<T>(path: string): Promise<T | null> {
    if (this.getNeverSettles) return new Promise<never>(() => {});
    if (this.getDelayMs) await new Promise(r => setTimeout(r, this.getDelayMs));
    if (this.getHook) { const r = this.getHook(); if (r) throw r; }
    this.counts.getRow++;
    const doc = this.docs.get(path.split('?')[0]!.slice(this.base().length + 1));
    return (doc ?? null) as T | null;
  }
}

const opts = (client: FakeStateClient, extra: Partial<AppwriteJsonStateOptions> = {}): AppwriteJsonStateOptions => ({
  client, databaseId: DB, collectionId: COLLECTION, namespace: NS, singleWriter: true,
  externalWriterLock: true,
  reconcileWrite: { timeoutMs: 500, pollIntervalMs: 5 },
  ...extra,
});

const lostAck = () => Object.assign(new Error('write ack lost'), { status: 502 });
const manifestOf = (ns: string) => ({
  $id: stateDocumentId(ns, MANIFEST_SLOT), namespace: ns, slot: MANIFEST_SLOT, revision: 0,
  payload: JSON.stringify({ kind: 'app-cloud-state/manifest', schemaVersion: 1, namespace: ns }),
  updatedAt: new Date().toISOString(),
});
const businessSlots = (f: FakeStateClient) => [...f.docs.values()].filter(d => d.slot !== MANIFEST_SLOT && d.namespace !== '__app_writer_locks__');

test('reconcileWrite requires externalWriterLock and an explicit bound', () => {
  const f = new FakeStateClient();
  const base = { client: f, databaseId: DB, collectionId: COLLECTION, namespace: NS, singleWriter: true };
  for (const bad of [
    { ...base, reconcileWrite: { timeoutMs: 100 } },                       // no externalWriterLock
    { ...base, externalWriterLock: false, reconcileWrite: { timeoutMs: 100 } },
    { ...base, externalWriterLock: true, reconcileWrite: {} },             // no bound
    { ...base, externalWriterLock: true, reconcileWrite: { timeoutMs: 0 } },
    { ...base, externalWriterLock: true, reconcileWrite: { timeoutMs: -1 } },
    { ...base, externalWriterLock: true, reconcileWrite: { deadlineAt: Number.NaN } },
  ]) {
    assert.throws(() => new AppwriteJsonState(bad as AppwriteJsonStateOptions),
      (e: unknown) => e instanceof CloudStateError && (e as CloudStateError).code === 'CLOUD_STATE_NOT_CONFIGURED');
  }
});

test('POST landed + lost ack: reconcile confirms the row, port stays usable', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  const businessPosts = () => businessSlots(f).length;
  f.afterPost = () => lostAck();
  state.write('key1', { v: 1 });
  await state.flush(); // confirmed — the write DID land
  f.afterPost = undefined;
  assert.equal(f.counts.post, 2); // manifest + one business write, exactly once each
  assert.ok(f.counts.getRow >= 1);
  assert.equal(businessPosts(), 1);
  // Port is NOT poisoned: a follow-up PATCH works normally.
  state.write('key1', { v: 2 });
  await state.flush();
  assert.equal(f.counts.patch, 1);
  // A fresh instance reads back exactly what was confirmed.
  const fresh = new AppwriteJsonState(opts(f));
  await fresh.ready;
  assert.deepEqual(fresh.read('key1'), { v: 2 });
});

test('PATCH landed + lost ack: reconcile confirms and only one write was ever sent', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  state.write('k', 'first');
  await state.flush();
  f.afterPatch = () => lostAck();
  state.write('k', 'second');
  await state.flush();
  assert.equal(f.counts.patch, 1); // the PATCH was sent once — never replayed
  const row = businessSlots(f)[0]!;
  assert.equal(row.revision, 1);
  assert.equal(row.payload, '"second"');
});

test('fresh read-back is authoritative: confirmed value equals the immutable snapshot', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  f.afterPost = () => lostAck();
  const value = { nested: { list: [1, 2, 3], text: 'héllo' } };
  state.write('doc-a', value);
  await state.flush();
  const fresh = new AppwriteJsonState(opts(f));
  await fresh.ready;
  assert.deepEqual(fresh.read('doc-a'), value);
  assert.equal(f.counts.post, 2); // manifest + key — never a second POST
});

test('foreign/mismatched row fields fail closed — each field checked individually', async () => {
  const mutations: Array<[string, (doc: Doc) => void]> = [
    ['payload', d => { d.payload = '"tampered"'; }],
    ['revision', d => { d.revision = 99; }],
    ['namespace', d => { d.namespace = 'other-ns'; }],
    ['slot', d => { d.slot = 'other-slot'; }],
    ['updatedAt', d => { d.updatedAt = 'not-a-date'; }],
    ['updatedAt-valid-but-foreign', d => { d.updatedAt = '2001-01-01T00:00:00.000Z'; }],
    ['updatedAt-missing', d => { delete d.updatedAt; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = new FakeStateClient();
    const state = new AppwriteJsonState(opts(f, { initialize: true }));
    await state.ready;
    f.afterPost = (data) => { if (data.slot !== MANIFEST_SLOT) { /* mutate AFTER land */ } return lostAck(); };
    // mutate after the row lands — between POST and the reconcile GET.
    const originalGet = f.getOrNull.bind(f);
    f.getOrNull = async <T>(p: string) => {
      const row = await originalGet<T & Doc>(p);
      if (row && (row as Doc).slot === 'k') mutate(row as Doc);
      return row;
    };
    state.write('k', 'x');
    await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
    // poisoned: subsequent writes/read throw the recorded failure.
    assert.throws(() => state.write('later', 1), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
    assert.equal(f.counts.post, 2, `${label}: exactly one business POST`);
  }
});

test('$id mismatch (row id not our deterministic id) fails closed', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  f.afterPost = () => lostAck();
  const originalGet = f.getOrNull.bind(f);
  f.getOrNull = async <T>(p: string) => {
    const row = await originalGet<T & Doc>(p);
    if (row && (row as Doc).slot === 'k') (row as Doc).$id = 'forged-id';
    return row;
  };
  state.write('k', 'x');
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
});

test('missing row stays poisoned — bounded probes then CLOUD_STATE_PERSIST', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  // POST throws BEFORE the doc lands (write never reached storage).
  const realCall = f.call.bind(f);
  f.call = async (method, path, body) => {
    if (method === 'POST' && (body as { data?: { slot?: string } })?.data?.slot === 'k') {
      f.counts.post++;
      throw lostAck();
    }
    return realCall(method, path, body);
  };
  state.write('k', 'x');
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
  assert.ok(f.counts.getRow >= 1);
});

test('undecidable reads stay poisoned; a hung read never grants success', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  f.afterPost = () => lostAck();
  f.getHook = () => Object.assign(new Error('read exploded'), { status: 500 });
  state.write('k', 'x');
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
});

test('a read-back that never settles cannot confirm — flush still fails inside the bound', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true, reconcileWrite: { timeoutMs: 60, pollIntervalMs: 5 } }));
  await state.ready;
  f.afterPost = () => lostAck();
  f.getNeverSettles = true;
  state.write('k', 'x');
  const started = Date.now();
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
  assert.ok(Date.now() - started < 2000);
});

test('an own row read back AFTER the deadline never qualifies — late evidence stays poisoned', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true, reconcileWrite: { timeoutMs: 40, pollIntervalMs: 5 } }));
  await state.ready;
  f.afterPost = () => lostAck();
  f.getDelayMs = 120; // row exists and is ours, but the read lands past the bound
  state.write('k', 'x');
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
  // Confirmed-land semantics must NOT have applied — the port is poisoned.
  assert.throws(() => state.write('later', 1), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
});

test('deterministic write failures never reach reconcile: 409 conflict preserved, 400 poisons without reads', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  // 409 on POST — the definite conflict contract is preserved.
  f.call = ((orig => async (method: string, path: string, body?: unknown) => {
    if (method === 'POST' && (body as { data?: { slot?: string } })?.data?.slot === 'k')
      throw Object.assign(new Error('conflict'), { status: 409 });
    return orig(method, path, body);
  })(f.call.bind(f)));
  const readsBefore = f.counts.getRow;
  state.write('k', 'x');
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_CONFLICT');
  assert.equal(f.counts.getRow, readsBefore); // zero reconcile reads for a definite answer

  const g = new FakeStateClient();
  const s2 = new AppwriteJsonState(opts(g, { initialize: true }));
  await s2.ready;
  g.call = ((orig => async (method: string, path: string, body?: unknown) => {
    if (method === 'POST' && (body as { data?: { slot?: string } })?.data?.slot === 'k')
      throw Object.assign(new Error('bad request'), { status: 400 });
    return orig(method, path, body);
  })(g.call.bind(g)));
  const gReads = g.counts.getRow;
  s2.write('k', 'x');
  await assert.rejects(s2.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
  assert.equal(g.counts.getRow, gReads);
});

test('default (no reconcileWrite) keeps legacy poison behavior — no read-back', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState({
    client: f, databaseId: DB, collectionId: COLLECTION, namespace: NS,
    singleWriter: true, initialize: true,
  });
  await state.ready;
  f.afterPost = () => lostAck();
  const readsBefore = f.counts.getRow;
  state.write('k', 'x');
  await assert.rejects(state.flush(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_STATE_PERSIST');
  assert.equal(f.counts.getRow, readsBefore); // no opt-in → no reconcile GET
});

test('confirmed write does not mask a genuinely different persisted payload (caller-mutated input cannot forge proof)', async () => {
  const f = new FakeStateClient();
  const state = new AppwriteJsonState(opts(f, { initialize: true }));
  await state.ready;
  const input = { v: 'original' };
  f.afterPost = (data) => {
    // Caller mutates the input object AFTER write() returned — the stored
    // row still holds the immutable snapshot, and reconcile must compare
    // against the snapshot, not the mutated caller object.
    input.v = 'mutated';
    return lostAck();
  };
  state.write('k', input);
  await state.flush(); // row = 'original' snapshot; reconcile confirms THAT
  const row = businessSlots(f)[0]!;
  assert.equal((JSON.parse(row.payload as string) as { v: string }).v, 'original');
});
