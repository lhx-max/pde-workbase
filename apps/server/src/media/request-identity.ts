import { createHash } from 'node:crypto';
import type { Database } from '../storage/database.js';
import { CanvasStateError } from '../canvas/errors.js';
import { currentRequestTenant } from '../tenant.js';
import { getMediaTask } from './tasks.js';

export class MediaRequestConflict extends Error {
  constructor(message: string, readonly status: number = 409, readonly code: string = 'MEDIA_REQUEST_ID_CONFLICT') { super(message); }
}

/** Identity fields a verified MA caller must carry in full. The order is part
 * of the persisted claim/receipt key format — never reorder it. */
const VERIFIED_CALLER_FIELDS = ['teamId', 'bizId', 'userId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const;

export interface VerifiedCallerScope {
  /** sha256 of the exact verified identity tuple; never raw ids or credentials. */
  readonly hash: string;
}

/** The trusted request tenant marks a production-verified MA caller with
 * userVerified === true. Anything else (local development, background work,
 * explicit unverified fixtures) keeps the legacy unscoped behavior. A flagged
 * caller missing any identity field fails closed instead of silently
 * downgrading into the shared claim namespace. */
export function verifiedCallerScope(): VerifiedCallerScope | undefined {
  const tenant = currentRequestTenant();
  if (!tenant || (tenant as { userVerified?: unknown }).userVerified !== true) return undefined;
  const actor = tenant as unknown as Record<string, unknown>;
  if (VERIFIED_CALLER_FIELDS.some(field => typeof actor[field] !== 'string' || !(actor[field] as string).trim() || (actor[field] as string).length>512 || (actor[field] as string).trim()!==actor[field] || /[\u0000-\u001f\u007f]/u.test(actor[field] as string)))
    throw new CanvasStateError(503, 'MEDIA_CALLER_SCOPE_UNAVAILABLE', 'Verified caller identity is incomplete; the request cannot be scoped safely');
  return { hash: createHash('sha256').update(JSON.stringify(VERIFIED_CALLER_FIELDS.map(field => actor[field]))).digest('hex') };
}

/** Opaque storage key for a verified caller's claim or receipt: it hashes the
 * identity scope, project and the raw validated caller key — never the key
 * itself, a credential or a token. `mrq-` (media request claim) stays <=200
 * chars, `irp-` (image receipt) stays <=128. */
export function callerScopedKey(prefix: 'mrq' | 'irp', projectId: string, scope: VerifiedCallerScope, key: string): string {
  return `${prefix}-${createHash('sha256').update(JSON.stringify([prefix, projectId, scope.hash, key])).digest('hex')}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Persist the claim together with task creation, before any provider side effect.
 * Under a verified caller the stored request id is a caller-scoped hash, so two
 * verified callers sharing a raw clientRequestId hold independent claims. When
 * the caller-prescribed task id (canvasDelivery) already exists but the claim
 * does not, another caller owns it: fail instead of returning their task. */
export function acceptMediaRequest<T extends { id: string }>(
  db: Database,
  projectId: string,
  request: Record<string, unknown>,
  create: () => T,
  claimedTaskId?: string,
): { taskId: string; created: T | null } {
  const scope = verifiedCallerScope();
  const key = request.clientRequestId;
  if (key === undefined) {
    if(scope)throw new CanvasStateError(428,'MEDIA_IDEMPOTENCY_REQUIRED','Verified media generation requires a stable clientRequestId');
    const created = create();
    return { taskId: created.id, created };
  }
  if (typeof key !== 'string' || !key.trim() || key.length > 200) {
    throw new MediaRequestConflict('clientRequestId must be a non-empty string of at most 200 characters',400,'MEDIA_REQUEST_INVALID');
  }
  const claimId = scope ? callerScopedKey('mrq', projectId, scope, key) : key;
  const digest = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
  return db.transaction(() => {
    const existing = db.prepare(`SELECT task_id AS taskId, request_digest AS digest
      FROM media_task_requests WHERE project_id = ? AND request_id = ?`)
      .get(projectId, claimId) as { taskId: string; digest: string } | undefined;
    if (existing) {
      if (existing.digest !== digest) throw new MediaRequestConflict('同一次媒体请求的内容已变化，请使用新的请求标识');
      return { taskId: existing.taskId, created: null };
    }
    if (claimedTaskId !== undefined && getMediaTask(db, claimedTaskId))
      throw new MediaRequestConflict('This request identifier is already claimed by another operation; submit a new request id', 409, 'MEDIA_REQUEST_ID_CONFLICT');
    const created = create();
    db.prepare(`INSERT INTO media_task_requests (project_id, request_id, request_digest, task_id)
      VALUES (?, ?, ?, ?)`).run(projectId, claimId, digest, created.id);
    return { taskId: created.id, created };
  })();
}
