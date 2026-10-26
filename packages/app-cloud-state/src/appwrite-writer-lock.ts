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

export class AppwriteWriterLock {
  private readonly client: AppwriteStateClient;
  private readonly databaseId: string;
  private readonly collectionId: string;
  private readonly serviceId: string;
  private readonly ownerId = randomUUID();
  private acquisition: Promise<void> | undefined;
  private releaseOp: Promise<void> | undefined;
  private status: LockStatus = 'idle';

  constructor(options: { client: AppwriteStateClient; databaseId: string; collectionId: string; serviceId: string }) {
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
      throw unavailable();
    }
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
    return typeof payload.ownerId === 'string' && /^[a-f0-9-]{36}$/.test(payload.ownerId) ? payload.ownerId : null;
  }
}
