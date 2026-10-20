import { createHash } from 'node:crypto';
import type { Database } from '../storage/database.js';

export class MediaRequestConflict extends Error {}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Persist the claim together with task creation, before any provider side effect. */
export function acceptMediaRequest<T extends { id: string }>(
  db: Database,
  projectId: string,
  request: Record<string, unknown>,
  create: () => T,
): { taskId: string; created: T | null } {
  const key = request.clientRequestId;
  if (key === undefined) {
    const created = create();
    return { taskId: created.id, created };
  }
  if (typeof key !== 'string' || !key.trim() || key.length > 200) {
    throw new MediaRequestConflict('clientRequestId must be a non-empty string of at most 200 characters');
  }
  const digest = createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
  return db.transaction(() => {
    const existing = db.prepare(`SELECT task_id AS taskId, request_digest AS digest
      FROM media_task_requests WHERE project_id = ? AND request_id = ?`)
      .get(projectId, key) as { taskId: string; digest: string } | undefined;
    if (existing) {
      if (existing.digest !== digest) throw new MediaRequestConflict('同一次媒体请求的内容已变化，请使用新的请求标识');
      return { taskId: existing.taskId, created: null };
    }
    const created = create();
    db.prepare(`INSERT INTO media_task_requests (project_id, request_id, request_digest, task_id)
      VALUES (?, ?, ?, ?)`).run(projectId, key, digest, created.id);
    return { taskId: created.id, created };
  })();
}
