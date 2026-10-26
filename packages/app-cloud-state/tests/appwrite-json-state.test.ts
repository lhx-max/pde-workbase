import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AppwriteJsonState,
  CloudStateError,
  MANIFEST_SLOT,
  stateDocumentId,
  type AppwriteJsonStateOptions,
  type AppwriteStateClient,
} from '../src/index.js';

const DB = 'db';
const COLLECTION = 'state';
const NS = 'app-instance-a';
const enc = encodeURIComponent;

type Doc = Record<string, unknown> & { $id: string };

interface ParsedQuery { method: string; attribute?: string; values?: unknown[] }

/** In-memory Appwrite double honoring the real serialized-Query contract:
 * `queries[]` params carry JSON query objects, `documentId`/`data` bodies on
 * POST, `{data}` on PATCH, 404 on missing docs and 409 on create conflicts. */
class FakeAppwrite implements AppwriteStateClient {
  readonly docs = new Map<string, Doc>();
  readonly calls: Array<{ method: string; path: string; body: unknown }> = [];
  collectionMissing = false;
  ignoreCursor = false;
  duplicateFirstRow = false;
  hideManifestInFirstList = false;
  listCalls = 0;
  private listedOnce = false;
  private failNextWrites = 0;

  docsPath(databaseId: string, collectionId: string): string {
    return `/databases/${enc(databaseId)}/collections/${enc(collectionId)}/documents`;
  }

  failWrites(n: number): void { this.failNextWrites = n; }

  private base(): string { return this.docsPath(DB, COLLECTION); }

  private assertCollection(): void {
    if (this.collectionMissing) throw new CloudStateError(404, 'appwrite_collection_not_found', 'missing');
  }

  private takeWriteFault(): void {
    if (this.failNextWrites > 0) {
      this.failNextWrites -= 1;
      throw new Error('upstream 502: <html>proxy failure — secret internal body</html>');
    }
  }

  private list(query: string): { documents: Doc[] } {
    this.listCalls += 1;
    const params = new URLSearchParams(query);
    const queries = params.getAll('queries[]').map(q => JSON.parse(q) as ParsedQuery);
    let rows = [...this.docs.values()];
    for (const q of queries) {
      if (q.method === 'equal') rows = rows.filter(r => r[q.attribute as string] === (q.values as unknown[])[0]);
      if (q.method === 'orderAsc') {
        const attribute = q.attribute as string;
        rows = [...rows].sort((a, b) => String(a[attribute]) < String(b[attribute]) ? -1 : 1);
      }
    }
    if (!this.listedOnce) {
      if (this.hideManifestInFirstList) rows = rows.filter(r => r.slot !== MANIFEST_SLOT);
      else if (this.duplicateFirstRow && rows.length > 0) rows.push(rows[0] as Doc);
    }
    const cursor = this.ignoreCursor ? undefined
      : queries.find(q => q.method === 'cursorAfter')?.values?.[0] as string | undefined;
    if (cursor !== undefined) rows = rows.filter(r => r.$id > cursor);
    const limit = queries.find(q => q.method === 'limit')?.values?.[0] as number | undefined;
    this.listedOnce = true;
    return { documents: rows.slice(0, limit ?? 25) };
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path, body });
    this.assertCollection();
    const [resource, query] = path.split('?') as [string, string | undefined];
    const base = this.base();
    if (method === 'GET' && resource === base) return this.list(query ?? '') as T;
    if (method === 'GET') {
      const doc = this.docs.get(resource.slice(base.length + 1));
      if (!doc) throw new CloudStateError(404, 'appwrite_document_not_found', 'not found');
      return doc as T;
    }
    if (method === 'POST' && resource === base) {
      this.takeWriteFault();
      const request = body as { documentId: string; data: Record<string, unknown> };
      if (this.docs.has(request.documentId)) throw new CloudStateError(409, 'appwrite_document_already_exists', 'conflict');
      const doc = { ...request.data, $id: request.documentId } as Doc;
      this.docs.set(request.documentId, doc);
      return doc as T;
    }
    if (method === 'PATCH') {
      this.takeWriteFault();
      const doc = this.docs.get(resource.slice(base.length + 1));
      if (!doc) throw new CloudStateError(404, 'appwrite_document_not_found', 'not found');
      Object.assign(doc, (body as { data: Record<string, unknown> }).data);
      return doc as T;
    }
    throw new Error(`unhandled ${method} ${path}`);
  }

  async getOrNull<T>(path: string): Promise<T | null> {
    this.assertCollection();
    const doc = this.docs.get(path.split('?')[0]!.slice(this.base().length + 1));
    return (doc ?? null) as T | null;
  }
}

const docIdFor = (namespace: string, slot: string) =>
  createHash('sha256').update(JSON.stringify([namespace, slot]), 'utf8').digest('hex').slice(0, 36);

function seedDoc(client: FakeAppwrite, slot: string, payload: unknown, extras: Record<string, unknown> = {}, namespace = NS): Doc {
  const doc: Doc = {
    $id: docIdFor(namespace, slot),
    namespace,
    slot,
    revision: 0,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    updatedAt: new Date().toISOString(),
    ...extras,
  };
  client.docs.set(doc.$id, doc);
  return doc;
}

function seedManifest(client: FakeAppwrite, payload: unknown = { kind: 'app-cloud-state/manifest', schemaVersion: 1, namespace: NS }): Doc {
  return seedDoc(client, MANIFEST_SLOT, payload);
}

function options(client: FakeAppwrite, extra: Partial<AppwriteJsonStateOptions> = {}): AppwriteJsonStateOptions {
  return { client, databaseId: DB, collectionId: COLLECTION, namespace: NS, singleWriter: true, ...extra };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CloudStateError);
    expect((error as CloudStateError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected throw with code ${code}`);
}

async function expectReject(promise: Promise<unknown>, code: string): Promise<CloudStateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CloudStateError);
    expect((error as CloudStateError).code).toBe(code);
    return error as CloudStateError;
  }
  throw new Error(`expected rejection with code ${code}`);
}

describe('AppwriteJsonState', () => {
  it('requires an explicit singleWriter acknowledgement', () => {
    const client = new FakeAppwrite();
    expect(() => new AppwriteJsonState(options(client, { singleWriter: false }))).toThrowError(/singleWriter/);
    expect(() => new AppwriteJsonState(options(client, { singleWriter: undefined as unknown as boolean }))).toThrowError(/singleWriter/);
  });

  it('throws a stable not-ready error before ready resolves', () => {
    const client = new FakeAppwrite();
    seedManifest(client);
    const state = new AppwriteJsonState(options(client));
    expectCode(() => state.read('k'), 'CLOUD_STATE_NOT_READY');
    expectCode(() => state.write('k', 1), 'CLOUD_STATE_NOT_READY');
  });

  it('bootstrap with initialize creates exactly the manifest document', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    const manifest = [...client.docs.values()].find(d => d.slot === MANIFEST_SLOT);
    expect(manifest).toBeDefined();
    expect(manifest?.$id).toBe(docIdFor(NS, MANIFEST_SLOT));
    expect(JSON.parse(manifest?.payload as string)).toMatchObject({ schemaVersion: 1, namespace: NS });
    expect(manifest?.revision).toBe(0);
    expect(client.calls.filter(c => c.method === 'POST')).toHaveLength(1);
    expect(state.read('anything')).toBeUndefined();
  });

  it('treats a missing collection as unavailable, never empty', async () => {
    const client = new FakeAppwrite();
    client.collectionMissing = true;
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_UNAVAILABLE');
    expectCode(() => state.read('k'), 'CLOUD_STATE_UNAVAILABLE');
  });

  it('treats a missing manifest as unavailable without initialize', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_MANIFEST_MISSING');
    expect(client.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });

  it('rejects business rows that lack a manifest', async () => {
    const client = new FakeAppwrite();
    seedDoc(client, 'a', { n: 1 });
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_MANIFEST_MISSING');
  });

  it('rejects an unsupported manifest schemaVersion', async () => {
    const client = new FakeAppwrite();
    seedManifest(client, { schemaVersion: 2, namespace: NS });
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_SCHEMA_VERSION');
  });

  it('rejects a manifest bound to a different namespace', async () => {
    const client = new FakeAppwrite();
    seedManifest(client, { schemaVersion: 1, namespace: 'other' });
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_CORRUPT');
  });

  it('persists writes serially with monotonic revisions', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    state.write('a', { n: 1 });
    state.write('a', { n: 2 });
    state.write('b', 'text');
    await state.flush();
    const mutations = client.calls.filter(c => c.method === 'POST' || c.method === 'PATCH');
    // manifest POST, then slot-a create, slot-a patch, slot-b create.
    expect(mutations.map(c => c.method)).toEqual(['POST', 'POST', 'PATCH', 'POST']);
    const [manifestPost, aPost, aPatch, bPost] = mutations;
    expect((manifestPost?.body as { data: { slot: string } }).data.slot).toBe(MANIFEST_SLOT);
    expect((aPost?.body as { data: { slot: string; revision: number } }).data).toMatchObject({ slot: 'a', revision: 0 });
    expect((aPatch?.body as { data: { slot: string; revision: number } }).data).toMatchObject({ slot: 'a', revision: 1 });
    expect((bPost?.body as { data: { slot: string; revision: number } }).data).toMatchObject({ slot: 'b', revision: 0 });
    const stored = client.docs.get(docIdFor(NS, 'a'));
    expect(JSON.parse(stored?.payload as string)).toEqual({ n: 2 });
    expect(stored?.namespace).toBe(NS);
    expect(state.read('a')).toEqual({ n: 2 });
  });

  it('a fresh instance recovers slots and continues revisions', async () => {
    const client = new FakeAppwrite();
    const first = new AppwriteJsonState(options(client, { initialize: true }));
    await first.ready;
    first.write('a', { n: 1 });
    first.write('a', { n: 2 });
    await first.flush();
    const second = new AppwriteJsonState(options(client));
    await second.ready;
    expect(second.read('a')).toEqual({ n: 2 });
    second.write('a', { n: 3 });
    await second.flush();
    const patch = client.calls.filter(c => c.method === 'PATCH').at(-1);
    expect((patch?.body as { data: { revision: number } }).data.revision).toBe(2);
  });

  it('poisons the backend after a persistence failure', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    client.failWrites(1);
    state.write('a', { n: 1 });
    await expectReject(state.flush(), 'CLOUD_STATE_PERSIST');
    expectCode(() => state.read('a'), 'CLOUD_STATE_PERSIST');
    expectCode(() => state.write('b', 1), 'CLOUD_STATE_PERSIST');
    await expectReject(state.flush(), 'CLOUD_STATE_PERSIST');
  });

  it('redacts upstream error bodies from the recorded failure', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    client.failWrites(1);
    state.write('a', 1);
    const failure = await state.flush().then(() => null, (e: unknown) => e as CloudStateError);
    expect(failure).toBeInstanceOf(CloudStateError);
    expect(failure?.message).not.toContain('secret internal body');
    expect(failure?.message).not.toContain('proxy failure');
  });

  it('fails closed on malformed stored rows', async () => {
    const cases: Array<[string, () => FakeAppwrite]> = [
      ['non-JSON payload', () => { const c = new FakeAppwrite(); seedManifest(c); seedDoc(c, 'a', 'not-json'); return c; }],
      ['$id mismatch', () => { const c = new FakeAppwrite(); seedManifest(c); const d = seedDoc(c, 'a', { n: 1 }); c.docs.delete(d.$id); d.$id = 'forged'; c.docs.set(d.$id, d); return c; }],
      ['response violates namespace filter', () => { const c = new FakeAppwrite(); seedManifest(c); const d = seedDoc(c, 'a', { n: 1 }); d.namespace = 'other'; const original=c.call.bind(c);c.call=async function<T>(method:string,path:string,body?:unknown):Promise<T>{if(method==='GET'&&path.includes('?'))return{documents:[...c.docs.values()]} as T;return original<T>(method,path,body);}; return c; }],
      ['negative revision', () => { const c = new FakeAppwrite(); seedManifest(c); seedDoc(c, 'a', { n: 1 }, { revision: -1 }); return c; }],
      ['bad updatedAt', () => { const c = new FakeAppwrite(); seedManifest(c); seedDoc(c, 'a', { n: 1 }, { updatedAt: 'not-a-date' }); return c; }],
    ];
    for (const [name, build] of cases) {
      const error = await new AppwriteJsonState(options(build())).ready.then(
        () => null,
        (e: unknown) => e as CloudStateError,
      );
      expect(error, name).toBeInstanceOf(CloudStateError);
      expect(error?.code, name).toBe('CLOUD_STATE_CORRUPT');
    }
  });

  it('fails closed on duplicate slots', async () => {
    const client = new FakeAppwrite();
    client.duplicateFirstRow = true;
    seedManifest(client);
    seedDoc(client, 'a', { n: 1 });
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_CORRUPT');
  });

  it('loads a namespace spanning more than one page', async () => {
    const client = new FakeAppwrite();
    seedManifest(client);
    for (let i = 0; i < 130; i += 1) seedDoc(client, `slot-${String(i).padStart(3, '0')}`, i);
    const state = new AppwriteJsonState(options(client));
    await state.ready;
    expect(state.read('slot-000')).toBe(0);
    expect(state.read('slot-129')).toBe(129);
    expect(client.listCalls).toBe(2);
    const pageQueries = client.calls
      .filter(c => c.method === 'GET' && c.path.includes('queries'))
      .map(c => new URLSearchParams(c.path.split('?')[1]).getAll('queries[]').map(q => JSON.parse(q) as ParsedQuery));
    expect(pageQueries[1]?.some(q => q.method === 'cursorAfter')).toBe(true);
    expect(pageQueries.every(qs => qs.some(q => q.method === 'equal' && q.attribute === 'namespace' && q.values?.[0] === NS))).toBe(true);
  });

  it('fails closed when pagination does not advance', async () => {
    const client = new FakeAppwrite();
    client.ignoreCursor = true;
    seedManifest(client);
    for (let i = 0; i < 120; i += 1) seedDoc(client, `slot-${i}`, i);
    const state = new AppwriteJsonState(options(client));
    await expectReject(state.ready, 'CLOUD_STATE_CORRUPT');
  });

  it('snapshots the value at write time', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    const value = { n: 1, nested: { ok: true } };
    state.write('a', value);
    value.n = 999;
    value.nested.ok = false;
    await state.flush();
    expect(state.read('a')).toEqual({ n: 1, nested: { ok: true } });
    expect(JSON.parse(client.docs.get(docIdFor(NS, 'a'))?.payload as string)).toEqual({ n: 1, nested: { ok: true } });
  });

  it('returns deep clones from read', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    state.write('a', { nested: { n: 1 } });
    (state.read('a') as { nested: { n: number } }).nested.n = 999;
    expect(state.read('a')).toEqual({ nested: { n: 1 } });
  });

  it('rejects non-JSON and oversize values before mutating memory', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const invalid: unknown[] = [undefined, Number.NaN, Number.POSITIVE_INFINITY, cyclic, new Date(), new Map(), () => 1, Symbol('s'), 10n];
    for (const value of invalid) expectCode(() => state.write('k', value), 'CLOUD_STATE_INVALID_PAYLOAD');
    expectCode(() => state.write('k', 'x'.repeat(1024 * 1024 + 1)), 'CLOUD_STATE_PAYLOAD_TOO_LARGE');
    expect(state.read('k')).toBeUndefined();
    await state.flush();
    expect(client.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
    expect(client.calls.filter(c => c.method === 'POST')).toHaveLength(1); // manifest only
  });

  it('rejects reads and writes of the reserved manifest slot', async () => {
    const client = new FakeAppwrite();
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    expectCode(() => state.read(MANIFEST_SLOT), 'CLOUD_STATE_RESERVED_SLOT');
    expectCode(() => state.write(MANIFEST_SLOT, {}), 'CLOUD_STATE_RESERVED_SLOT');
  });

  it('validates the existing manifest when bootstrap conflicts (409)', async () => {
    // The listing ran before a racing initializer committed its manifest:
    // the create then conflicts (409) and the package must re-read and
    // validate the existing manifest instead of resetting it.
    const client = new FakeAppwrite();
    seedManifest(client);
    client.hideManifestInFirstList = true;
    const state = new AppwriteJsonState(options(client, { initialize: true }));
    await state.ready;
    expect(client.calls.filter(c => c.method === 'POST')).toHaveLength(1);
    expect(state.read('anything')).toBeUndefined();
    const manifest = [...client.docs.values()].find(d => d.slot === MANIFEST_SLOT);
    expect(JSON.parse(manifest?.payload as string)).toMatchObject({ schemaVersion: 1, namespace: NS });
  });

  it('exposes stateDocumentId deterministically', () => {
    expect(stateDocumentId('ns', 'slot')).toBe(docIdFor('ns', 'slot'));
    expect(stateDocumentId('ns', 'slot')).toMatch(/^[0-9a-f]{36}$/);
  });
});
