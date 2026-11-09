import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { AppwriteWriterLock, writerLockDocumentId } from '../src/appwrite-writer-lock.js';
import { CloudStateError } from '../src/errors.js';
import type { AppwriteStateClient } from '../src/port.js';

/** In-memory Appwrite documents API: POST create is atomic on documentId,
 * getOrNull reads, DELETE removes. Optional failure hooks simulate
 * ambiguous/poisoned backends without copying real error shapes. */
function fakeClient(failures: { post?: () => unknown; get?: () => unknown; del?: () => unknown } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  const counts = { post: 0, get: 0, del: 0 };
  const client: AppwriteStateClient = {
    docsPath: (db, col) => `/databases/${db}/collections/${col}/documents`,
    async call(method, path, body) {
      if (method === 'POST') {
        counts.post++;
        const b = body as { documentId: string; data: unknown };
        if (failures.post) { const r = failures.post(); if (r) throw r; }
        if (docs.has(b.documentId)) throw Object.assign(new Error('conflict'), { status: 409 });
        docs.set(b.documentId, { $id: b.documentId, ...(b.data as object) });
        return { $id: b.documentId } as never;
      }
      if (method === 'DELETE') {
        counts.del++;
        if (failures.del) { const r = failures.del(); if (r) throw r; }
        const id = decodeURIComponent(path.split('/').pop()!);
        if (!docs.delete(id)) throw Object.assign(new Error('not found'), { status: 404 });
        return undefined as never;
      }
      throw new Error(`unexpected ${method}`);
    },
    async getOrNull(path) {
      counts.get++;
      if (failures.get) { const r = failures.get(); if (r) throw r; }
      const id = decodeURIComponent(path.split('/').pop()!);
      return (docs.get(id) ?? null) as never;
    },
  };
  return { client, docs, counts };
}

const opts = (docs: ReturnType<typeof fakeClient>, serviceId = 'canvas-svc') => ({
  client: docs.client, databaseId: 'canvas_app_dev', collectionId: 'app_runtime_state', serviceId,
});

test('constructor rejects missing/invalid config without I/O', () => {
  const f = fakeClient();
  for (const bad of [undefined, {}, { ...opts(f), serviceId: '' }, { ...opts(f), serviceId: 'has space' },
    { ...opts(f), serviceId: 'x'.repeat(102) }, { ...opts(f), client: {} }]) {
    assert.throws(() => new AppwriteWriterLock(bad as never), (e: unknown) =>
      e instanceof CloudStateError && e.status === 503 && e.code === 'CLOUD_WRITER_NOT_CONFIGURED');
  }
  assert.equal(f.counts.post + f.counts.get + f.counts.del, 0);
});

test('concurrent acquire yields exactly one winner; loser fails CLOUD_WRITER_LOCKED and never retries', async () => {
  const f = fakeClient();
  const a = new AppwriteWriterLock(opts(f, 'svc'));
  const b = new AppwriteWriterLock(opts(f, 'svc'));
  const [ra, rb] = await Promise.allSettled([a.acquire(), b.acquire()]);
  const winners = [ra, rb].filter(r => r.status === 'fulfilled');
  const losers = [ra, rb].filter(r => r.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  const loser = losers[0] as PromiseRejectedResult;
  assert.equal((loser.reason as CloudStateError).code, 'CLOUD_WRITER_LOCKED');
  assert.equal((loser.reason as CloudStateError).status, 503);
  assert.equal(f.counts.post, 2); // exactly one create each
  const loserLock = ra.status === 'rejected' ? a : b;
  await assert.rejects(loserLock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_LOCKED');
  assert.equal(f.counts.post, 2); // blocked writer stays blocked — no takeover loop
});

test('idempotent acquire reuses one POST; release deletes only own doc; old object cannot re-acquire', async () => {
  const f = fakeClient();
  const lock = new AppwriteWriterLock(opts(f));
  await Promise.all([lock.acquire(), lock.acquire()]);
  assert.equal(f.counts.post, 1);
  await Promise.all([lock.release(), lock.release()]);
  assert.equal(f.counts.del, 1);
  assert.equal(f.docs.size, 0);
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_RELEASED');
  const fresh = new AppwriteWriterLock(opts(f));
  await fresh.acquire(); // a NEW object may acquire after release
  assert.equal(f.counts.post, 2);
});

test('a failed acquire never deletes the winning writer\'s document', async () => {
  const f = fakeClient();
  const a = new AppwriteWriterLock(opts(f));
  await a.acquire();
  const b = new AppwriteWriterLock(opts(f));
  await assert.rejects(b.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_LOCKED');
  await b.release(); // no storage touched
  assert.equal(f.counts.del, 0);
  assert.equal(f.docs.size, 1);
});

test('release refuses to delete a lock owned by someone else', async () => {
  const f = fakeClient();
  const a = new AppwriteWriterLock(opts(f));
  await a.acquire();
  const doc = f.docs.get(writerLockDocumentId('canvas-svc'))!;
  doc.payload = JSON.stringify({ kind: 'exclusive-app-writer', version: 1, serviceId: 'canvas-svc', ownerId: '11111111-1111-4111-8111-111111111111', startedAt: new Date().toISOString() });
  await assert.rejects(a.release(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_OWNERSHIP_LOST');
  assert.equal(f.counts.del, 0);
  assert.equal(f.docs.size, 1); // other owner untouched
});

test('corrupt or foreign metadata fails closed without deleting', async () => {
  const f = fakeClient();
  const a = new AppwriteWriterLock(opts(f));
  await a.acquire();
  const doc = f.docs.get(writerLockDocumentId('canvas-svc'))!;
  doc.payload = 'not-json';
  await assert.rejects(a.release(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.equal(f.docs.size, 1);
});

test('backend failures are sanitized — no upstream message leakage', async () => {
  const f = fakeClient({ post: () => Object.assign(new Error('secret bearer abc123 exploded'), { status: 500 }) });
  const lock = new AppwriteWriterLock(opts(f));
  await assert.rejects(lock.acquire(), (e: unknown) => {
    assert.ok(e instanceof CloudStateError);
    assert.equal(e.code, 'CLOUD_WRITER_UNAVAILABLE');
    assert.equal(e.status, 503);
    assert.doesNotMatch(e.message, /secret|bearer|abc123/i);
    return true;
  });
  const g2 = fakeClient();
  const ok = new AppwriteWriterLock(opts(g2));
  await ok.acquire();
  g2.client.getOrNull = async () => { throw Object.assign(new Error('upstream says secret'), { status: 500 }); };
  await assert.rejects(ok.release(), (e: unknown) => {
    assert.equal((e as CloudStateError).code, 'CLOUD_WRITER_UNAVAILABLE');
    assert.doesNotMatch((e as Error).message, /secret/i);
    return true;
  });
});

test('ambiguous create failure marks ownership uncertain; release still reconciles our own doc', async () => {
  // POST stores the document then reports failure — a landed-but-lost create.
  const f = fakeClient();
  const realPost = f.client.call.bind(f.client);
  let first = true;
  f.client.call = async (method, path, body) => {
    if (method === 'POST' && first) {
      first = false;
      await realPost(method, path, body); // document actually lands
      throw Object.assign(new Error('socket hangup with secret detail'), { status: 502 });
    }
    return realPost(method, path, body);
  };
  const lock = new AppwriteWriterLock(opts(f));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE'); // never a fake success
  await lock.release(); // our doc was ours → deleted
  assert.equal(f.docs.size, 0);
});

test('ambiguous create that never landed releases harmlessly', async () => {
  const f = fakeClient({ post: () => Object.assign(new Error('network down'), { status: 503 }) });
  const lock = new AppwriteWriterLock(opts(f));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  await lock.release(); // nothing to delete
  assert.equal(f.counts.del, 0);
});

test('missing document on release is harmless; a fresh object can then acquire', async () => {
  const f = fakeClient();
  const a = new AppwriteWriterLock(opts(f));
  await a.acquire();
  f.docs.clear(); // operator reset out of band
  await a.release();
  const b = new AppwriteWriterLock(opts(f));
  await b.acquire();
  assert.equal(f.docs.size, 1);
});
