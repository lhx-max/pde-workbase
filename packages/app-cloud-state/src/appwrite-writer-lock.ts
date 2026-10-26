import { createHash, randomUUID } from 'node:crypto';
import { CloudStateError } from './errors.js';
import type { AppwriteStateClient } from './port.js';

/** One exclusive writer per serviceId, stored as a single document in the
 * shared runtime-state collection. The create is the only atomic primitive:
 * a second writer's POST conflicts (409) and must fail — there is no
 * overwrite, TTL, heartbeat or stale-owner takeover by design. The database
 * and collection path already scope the lock, so the document id only binds
 * the serviceId. */
const LOCK_NAMESPACE = '__app_writer_locks__';
const LOCK_KIND = 'exclusive-app-writer';
const LOCK_VERSION = 1;
const ID_SEED = 'exclusive-app-writer-v1';
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/;

export function writerLockDocumentId(serviceId: string): string {
  return createHash('sha256').update(JSON.stringify([ID_SEED, serviceId]), 'utf8').digest('hex').slice(0, 36);
}

interface LockRow {
  $id?: unknown;
  namespace?: unknown;
  slot?: unknown;
  payload?: unknown;
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/** Backend bodies/messages never reach the caller — only the status class. */
const unavailable = (): CloudStateError =>
  new CloudStateError(503, 'CLOUD_WRITER_UNAVAILABLE', 'Writer lock backend is unavailable');
const misconfigured = (why: string): CloudStateError =>
  new CloudStateError(503, 'CLOUD_WRITER_NOT_CONFIGURED', why);

type LockStatus = 'idle' | 'acquiring' | 'acquired' | 'uncertain' | 'locked' | 'released';

/** Opt-in owned-create acknowledgement reconciliation. When the create POST
 * fails ambiguously the acknowledgement may have been lost AFTER the row
 * landed; the caller may then authorize a bounded read-back of OUR OWN
 * deterministic lock row to decide the outcome on evidence instead of
 * guessing. The reconcile never issues another POST, never deletes any row,
 * and never decides by age — only a complete ownership match confirms the
 * acquisition. Bounds are taken from the caller's OWN deadline (usually the
 * invocation budget): the reconcile spends from the same clock, it never
 * gets a fresh window. */
export interface WriterLockReconcileOptions {
  /** Absolute deadline (epoch ms, Date.now() clock) bounding the reconcile.
   * Typically `startedAt + totalMs - reserveMs` of the invocation deadline. */
  deadlineAt?: number;
  /** Additional relative bound from reconcile start (ms). */
  timeoutMs?: number;
  /** Delay between ownership read-backs (ms); default 150. */
  pollIntervalMs?: number;
}

export interface AppwriteWriterLockOptions {
  client: AppwriteStateClient;
  databaseId: string;
  collectionId: string;
  serviceId: string;
  /** Opt-in: reconcile an ambiguous create result by reading back our own
   * deterministic row within the supplied bound. Absent = legacy behavior:
   * any ambiguous create failure rejects immediately as uncertain. */
  reconcileAcquire?: WriterLockReconcileOptions;
}

export class AppwriteWriterLock {
  private readonly client: AppwriteStateClient;
  private readonly databaseId: string;
  private readonly collectionId: string;
  private readonly serviceId: string;
  private readonly reconcile: { until: () => number; pollIntervalMs: number } | null;
  private readonly ownerId = randomUUID();
  private acquisition: Promise<void> | undefined;
  private releaseOp: Promise<void> | undefined;
  private status: LockStatus = 'idle';

  constructor(options: AppwriteWriterLockOptions) {
    const { client, databaseId, collectionId, serviceId } = options ?? ({} as never);
    if (!client || typeof client.call !== 'function' || typeof client.getOrNull !== 'function' || typeof client.docsPath !== 'function')
      throw misconfigured('A client with call/getOrNull/docsPath is required');
    if (typeof databaseId !== 'string' || !databaseId) throw misconfigured('databaseId is required');
    if (typeof collectionId !== 'string' || !collectionId) throw misconfigured('collectionId is required');
    if (typeof serviceId !== 'string' || !SERVICE_ID.test(serviceId))
      throw misconfigured('serviceId must be a bounded literal service identifier');
    this.client = client;
    this.databaseId = databaseId;
    this.collectionId = collectionId;
    this.serviceId = serviceId;
    this.reconcile = options.reconcileAcquire ? AppwriteWriterLock.boundReconcile(options.reconcileAcquire) : null;
  }

  private static boundReconcile(options: WriterLockReconcileOptions): { until: () => number; pollIntervalMs: number } {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs;
    const deadlineAt = options.deadlineAt;
    if (timeoutMs === undefined && deadlineAt === undefined)
      throw misconfigured('reconcileAcquire requires an explicit bound: deadlineAt and/or timeoutMs');
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
      throw misconfigured('reconcileAcquire.timeoutMs must be a positive number');
    if (deadlineAt !== undefined && !Number.isFinite(deadlineAt))
      throw misconfigured('reconcileAcquire.deadlineAt must be a finite epoch ms');
    if (options.pollIntervalMs !== undefined && (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0 || options.pollIntervalMs > 10_000))
      throw misconfigured('reconcileAcquire.pollIntervalMs must be a positive number <= 10000');
    const pollIntervalMs = options.pollIntervalMs ?? 150;
    return { until: () => Math.min(deadlineAt ?? Number.POSITIVE_INFINITY, timeoutMs !== undefined ? startedAt + timeoutMs : Number.POSITIVE_INFINITY), pollIntervalMs };
  }

  private documents(): string {
    return this.client.docsPath(this.databaseId, this.collectionId);
  }
  private documentPath(): string {
    return `${this.documents()}/${encodeURIComponent(writerLockDocumentId(this.serviceId))}`;
  }

  /** Idempotent while one acquisition exists: every later call returns the
   * SAME settled promise — a rejected acquire never retries and never posts
   * again. After a successful release this object is done; callers must
   * construct a new lock rather than re-acquire. */
  async acquire(): Promise<void> {
    if (this.status === 'released')
      throw new CloudStateError(503, 'CLOUD_WRITER_RELEASED', 'This lock object was released; construct a new AppwriteWriterLock');
    this.acquisition ??= this.doAcquire();
    return this.acquisition;
  }

  private async doAcquire(): Promise<void> {
    this.status = 'acquiring';
    const now = new Date().toISOString();
    try {
      await this.client.call('POST', this.documents(), {
        documentId: writerLockDocumentId(this.serviceId),
        data: {
          namespace: LOCK_NAMESPACE,
          slot: `service:${this.serviceId}`,
          revision: 0,
          payload: JSON.stringify({
            kind: LOCK_KIND, version: LOCK_VERSION,
            serviceId: this.serviceId, ownerId: this.ownerId, startedAt: now,
          }),
          updatedAt: now,
        },
        permissions: [],
      });
      this.status = 'acquired';
    } catch (error) {
      if (statusOf(error) === 409) {
        // A live owner already holds this serviceId. Never overwrite.
        this.status = 'locked';
        throw new CloudStateError(503, 'CLOUD_WRITER_LOCKED', `An exclusive writer already owns service '${this.serviceId}'; stop the previous writer before retrying`);
      }
      // Ambiguous: the create may or may not have landed. Ownership is
      // uncertain — release() must still reconcile our ownerId — but no
      // success is ever reported from a failed create.
      this.status = 'uncertain';
      // Opt-in reconcile either throws (deterministically foreign-owned),
      // promotes us to 'acquired' on full ownership evidence, or leaves us
      // 'uncertain' — in which case the same unavailable failure surfaces.
      if (this.reconcile) await this.reconcileOwnership();
      if ((this.status as LockStatus) !== 'acquired') throw unavailable();
      return;
    }
  }

  /** Opt-in lost-acknowledgement reconcile: read back OUR deterministic row
   * inside the caller-supplied bound. Exactly three outcomes:
   *  - the stored row is verifiably OUR create (same rowid + namespace +
   *    slot + strict payload schema + our ownerId) → the POST landed, the
   *    ack was lost: status 'acquired' and the caller owns the lock;
   *  - a structurally valid lock row exists under a DIFFERENT owner → we did
   *    not win this serviceId: status 'locked', fail as busy;
   *  - anything else — missing row, corrupt/foreign metadata, an
   *    undecidable read, or an exhausted bound → stay 'uncertain' and the
   *    caller sees the same unavailable failure as before; the row, if it
   *    exists, is left for release()/operator reconciliation. */
  private async reconcileOwnership(): Promise<void> {
    const reconcile = this.reconcile!;
    const rowId = writerLockDocumentId(this.serviceId);
    for (;;) {
      const remaining = reconcile.until() - Date.now();
      if (remaining <= 0) return; // bound exhausted — stay uncertain
      // Each read-back is bounded by the SAME deadline: a getOrNull that
      // outlives the budget is abandoned and counted undecidable. Its late
      // result can never promote this object to 'acquired' — see the
      // deadline re-check below before any ownership claim is made.
      const row = await this.readRowBounded(remaining);
      if (Date.now() >= reconcile.until()) return; // late evidence never qualifies
      if (row !== null && row !== undefined) {
        if (row.$id !== rowId) return; // wrong rowid — fail closed
        const owner = this.readOwner(row);
        if (owner === null) return; // corrupt or foreign-shaped metadata
        if (owner === this.ownerId) { this.status = 'acquired'; return; }
        this.status = 'locked';
        throw new CloudStateError(503, 'CLOUD_WRITER_LOCKED', `An exclusive writer already owns service '${this.serviceId}'; stop the previous writer before retrying`);
      }
      // Missing row or undecidable read: probe again while budget remains.
      const wait = reconcile.until() - Date.now();
      if (wait <= 0) return;
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(reconcile.pollIntervalMs, wait)));
    }
  }

  /** One ownership read bounded by `ms`. Resolves `undefined` when the read
   * failed OR did not settle inside the budget — both undecidable. The
   * abandoned getOrNull is never reported as cancelled upward; it simply
   * cannot win the race that matters (the deadline is checked again before
   * any acquisition decision). */
  private readRowBounded(ms: number): Promise<LockRow | null | undefined> {
    let timer: NodeJS.Timeout | undefined;
    return new Promise<LockRow | null | undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
      this.client.getOrNull<LockRow>(this.documentPath()).then(
        row => resolve(row),
        () => resolve(undefined),
      );
    }).finally(() => { if (timer) clearTimeout(timer); });
  }

  /** Deletes the lock document only when it is verifiably ours. A 409-conflict
   * (locked) or never-acquired object releases without touching storage, so a
   * failed acquire can never delete another writer's lock. A missing document
   * is a harmless release. A document owned by someone else fails closed and
   * is left for an operator — this object never deletes it. */
  async release(): Promise<void> {
    // One reconcile+delete at most: concurrent and repeated calls share the
    // same settled promise, so a second release can never double-DELETE.
    this.releaseOp ??= this.doRelease();
    return this.releaseOp;
  }

  private async doRelease(): Promise<void> {
    if (this.status === 'released') return;
    // An in-flight or settled acquisition must finish before we decide what
    // we own; its rejection is already observable to the original caller.
    if (this.acquisition) await this.acquisition.catch(() => {});
    if (this.status === 'idle' || this.status === 'locked') {
      this.status = 'released';
      return;
    }
    // 'acquired' or 'uncertain': reconcile the stored document.
    let row: LockRow | null;
    try {
      row = await this.client.getOrNull<LockRow>(this.documentPath());
    } catch {
      throw unavailable();
    }
    if (row === null) { this.status = 'released'; return; }

    const owner = this.readOwner(row);
    if (owner === null) throw unavailable(); // corrupt/foreign metadata — fail closed
    if (owner !== this.ownerId)
      throw new CloudStateError(503, 'CLOUD_WRITER_OWNERSHIP_LOST', `Lock for service '${this.serviceId}' is owned by another writer; not deleted`);
    try {
      await this.client.call('DELETE', this.documentPath());
    } catch {
      throw unavailable();
    }
    this.status = 'released';
  }

  /** Strict shape check: the row must be our lock schema, in our namespace and
   * slot, carrying an ownerId. Anything else is treated as foreign/corrupt. */
  private readOwner(row: LockRow): string | null {
    if (row.namespace !== LOCK_NAMESPACE || row.slot !== `service:${this.serviceId}`) return null;
    if (typeof row.payload !== 'string') return null;
    let payload: { kind?: unknown; version?: unknown; serviceId?: unknown; ownerId?: unknown; startedAt?: unknown };
    try { payload = JSON.parse(row.payload); } catch { return null; }
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['kind','version','serviceId','ownerId','startedAt'].includes(key)))return null;
    if (payload.kind !== LOCK_KIND || payload.version !== LOCK_VERSION || payload.serviceId !== this.serviceId) return null;
    if(typeof payload.startedAt!=='string'||!Number.isFinite(Date.parse(payload.startedAt)))return null;
    return typeof payload.ownerId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.ownerId) ? payload.ownerId : null;
  }
}
