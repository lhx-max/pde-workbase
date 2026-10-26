import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { AppwriteWriterLock, writerLockDocumentId, type WriterLockReconcileOptions } from '../src/appwrite-writer-lock.js';
import { CloudStateError } from '../src/errors.js';
import type { AppwriteStateClient } from '../src/port.js';

/** In-memory documents fixture: POST is atomic on documentId; hooks let a
 * test drop a create response AFTER the row landed (lost ack) or poison the
 * row/reads. */
function fakeClient(hooks: {
  /** Runs after the row is stored; return an error to simulate a lost ack. */
  afterPost?: () => unknown;
  get?: () => unknown;
} = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  const counts = { post: 0, get: 0, del: 0 };
  const client: AppwriteStateClient = {
    docsPath: (db, col) => `/databases/${db}/collections/${col}/documents`,
    async call(method, path, body) {
      if (method === 'POST') {
        counts.post++;
        const b = body as { documentId: string; data: unknown };
        if (docs.has(b.documentId)) throw Object.assign(new Error('conflict'), { status: 409 });
        docs.set(b.documentId, { $id: b.documentId, ...(b.data as object) });
        if (hooks.afterPost) { const r = hooks.afterPost(); if (r) throw r; }
        return { $id: b.documentId } as never;
      }
      if (method === 'DELETE') {
        counts.del++;
        const id = decodeURIComponent(path.split('/').pop()!);
        if (!docs.delete(id)) throw Object.assign(new Error('not found'), { status: 404 });
        return undefined as never;
      }
      throw new Error(`unexpected ${method}`);
    },
    async getOrNull(path) {
      counts.get++;
      if (hooks.get) { const r = hooks.get(); if (r) throw r; }
      const id = decodeURIComponent(path.split('/').pop()!);
      return (docs.get(id) ?? null) as never;
    },
  };
  return { client, docs, counts };
}

const opts = (f: ReturnType<typeof fakeClient>, serviceId = 'svc', reconcile?: WriterLockReconcileOptions) => ({
  client: f.client, databaseId: 'db', collectionId: 'state', serviceId,
  ...(reconcile ? { reconcileAcquire: reconcile } : {}),
});

const lostAck = () => Object.assign(new Error('response lost'), { status: 502 });

test('opt-in reconcile: lost create ack with OUR landed row acquires on ownership evidence', async () => {
  const f = fakeClient({ afterPost: lostAck });
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 2000, pollIntervalMs: 5 }));
  await lock.acquire(); // resolves — our row is verifiably ours
  assert.equal(f.counts.post, 1); // POST issued exactly once
  assert.ok(f.counts.get >= 1);
  await lock.release();
  assert.equal(f.docs.size, 0);
});

test('default (no opt-in): lost create ack still rejects immediately without a read-back', async () => {
  const f = fakeClient({ afterPost: lostAck });
  const lock = new AppwriteWriterLock(opts(f));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.equal(f.counts.post, 1);
  assert.equal(f.counts.get, 0); // legacy behavior: no reconcile read
});

test('foreign-owned row under our deterministic id fails as busy — never adopted, never deleted', async () => {
  const winner = fakeClient();
  const holder = new AppwriteWriterLock(opts(winner));
  await holder.acquire(); // foreign owner holds svc row
  const f = fakeClient();
  // Reuse the same docs store so the row exists but is foreign-owned.
  f.docs.set(writerLockDocumentId('svc'), winner.docs.get(writerLockDocumentId('svc'))!);
  f.client.call = async (method) => { if (method === 'POST') { f.counts.post++; throw lostAck(); } throw new Error('unexpected'); };
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 500, pollIntervalMs: 5 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_LOCKED');
  assert.equal(f.counts.post, 1); // single POST, no retry
  await lock.release(); // failed-foreign acquire must not touch storage
  assert.equal(f.counts.del, 0);
  assert.equal(f.docs.size, 1);
});

test('missing row stays fail-closed within the bound; release never deletes', async () => {
  const f = fakeClient();
  // POST reports failure BEFORE the row lands (simulated by never storing).
  f.client.call = async (method) => { if (method === 'POST') { f.counts.post++; throw lostAck(); } throw new Error('unexpected'); };
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 60, pollIntervalMs: 5 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.equal(f.counts.post, 1);
  assert.ok(f.counts.get >= 1); // bounded probes happened
  await lock.release();
  assert.equal(f.counts.del, 0);
});

test('corrupt lock payload fails closed — no acquire, no delete', async () => {
  const f = fakeClient();
  f.docs.set(writerLockDocumentId('svc'), {
    $id: writerLockDocumentId('svc'), namespace: '__app_writer_locks__', slot: 'service:svc', revision: 0,
    payload: '{"kind":"exclusive-app-writer"', updatedAt: new Date().toISOString(),
  });
  f.client.call = async (method) => { if (method === 'POST') { f.counts.post++; throw lostAck(); } throw new Error('unexpected'); };
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 500, pollIntervalMs: 5 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  await assert.rejects(lock.release(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.equal(f.counts.del, 0);
  assert.equal(f.docs.size, 1); // corrupt row untouched for the operator
});

test('namespace/slot mismatch on our rowid fails closed', async () => {
  const f = fakeClient();
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 500, pollIntervalMs: 5 }));
  const realPost = f.client.call.bind(f.client);
  f.client.call = async (method, path, body) => {
    if (method === 'POST') {
      await realPost(method, path, body); // lands
      // A concurrent actor rewrote the row's slot marker — the row is no
      // longer provably ours.
      f.docs.get(writerLockDocumentId('svc'))!.slot = 'service:other';
      throw lostAck();
    }
    return realPost(method, path, body);
  };
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
});

test('undecidable GETs stay fail-closed and stop at the bound — the deadline is never re-issued', async () => {
  const f = fakeClient({ get: () => Object.assign(new Error('read exploded'), { status: 500 }) });
  f.client.call = async (method) => { if (method === 'POST') { f.counts.post++; throw lostAck(); } throw new Error('unexpected'); };
  const started = Date.now();
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 80, pollIntervalMs: 10 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `reconcile ran ${elapsed}ms — bound not honored`);
  assert.ok(f.counts.get >= 1 && f.counts.get < 50);
});

test('a never-settling read-back rejects inside the bound — no acquired, no delete, no second POST', async () => {
  const f = fakeClient({ afterPost: lostAck });
  const realGet = f.client.getOrNull.bind(f.client);
  // getOrNull never resolves — the reconcile must still fail inside its bound.
  f.client.getOrNull = async () => { f.counts.get++; return new Promise<never>(() => {}); };
  const started = Date.now();
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 60, pollIntervalMs: 5 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.ok(Date.now() - started < 2000, 'reconcile must stop at its bound even when the read hangs');
  assert.equal(f.counts.post, 1); // exactly one POST, never retried
  // The hung read never settled — yet our POST did land, so release still
  // reconciles and deletes the row that is verifiably ours.
  f.client.getOrNull = realGet;
  await lock.release();
  assert.equal(f.docs.size, 0);
});

test('an own row read back AFTER the deadline never qualifies the acquisition', async () => {
  const f = fakeClient({ afterPost: lostAck });
  const realGet = f.client.getOrNull.bind(f.client);
  // The row exists (our POST landed) but the read answers only after the bound.
  f.client.getOrNull = async (path) => { f.counts.get++; await new Promise(r => setTimeout(r, 120)); return realGet(path); };
  const lock = new AppwriteWriterLock(opts(f, 'svc', { timeoutMs: 40, pollIntervalMs: 5 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.equal(f.counts.post, 1);
  // The object is NOT acquired — the late own-row evidence was discarded.
  // release() still reconciles the row that is verifiably ours.
  await lock.release();
  assert.equal(f.docs.size, 0);
});

test('an already-exhausted absolute deadline performs zero read-backs', async () => {
  const f = fakeClient({ afterPost: lostAck });
  const lock = new AppwriteWriterLock(opts(f, 'svc', { deadlineAt: Date.now() - 1 }));
  await assert.rejects(lock.acquire(), (e: unknown) => (e as CloudStateError).code === 'CLOUD_WRITER_UNAVAILABLE');
  assert.equal(f.counts.get, 0);
});

test('reconcile options require an explicit bound; bad bounds fail at construction', async () => {
  const f = fakeClient();
  for (const bad of [{}, { timeoutMs: 0 }, { timeoutMs: -5 }, { deadlineAt: Number.NaN }, { timeoutMs: 10, pollIntervalMs: 0 }]) {
    assert.throws(() => new AppwriteWriterLock({ client: f.client, databaseId: 'db', collectionId: 'c', serviceId: 's', reconcileAcquire: bad as never }),
      (e: unknown) => e instanceof CloudStateError && (e as CloudStateError).code === 'CLOUD_WRITER_NOT_CONFIGURED');
  }
});

test('acquired-via-reconcile lock is fully usable: second instance id stays independent', async () => {
  const f = fakeClient();
  // Instance-partitioned serviceIds never share a row.
  const a = new AppwriteWriterLock(opts(f, 'doc:ma-instance-v1:aaaa'));
  const b = new AppwriteWriterLock(opts(f, 'doc:ma-instance-v1:bbbb'));
  await a.acquire();
  await b.acquire(); // different instance → no contention
  assert.equal(f.counts.post, 2);
  assert.equal(f.docs.size, 2);
  await a.release();
  assert.equal(f.docs.size, 1); // b's row untouched
});
