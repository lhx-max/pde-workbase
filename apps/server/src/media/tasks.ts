import type { Database } from '../storage/database.js';
import type {
  MediaTaskError,
  MediaTaskGenerationMetadata,
  MediaTaskStatus,
} from '@bezier/contracts';

export type { MediaTaskError, MediaTaskStatus };

export interface MediaTaskRow extends MediaTaskGenerationMetadata {
  id: string;
  projectId: string;
  status: MediaTaskStatus;
  surface?: string;
  model?: string;
  progress: string[];
  file: unknown | null;
  error: MediaTaskError | null;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MediaTaskInsert extends MediaTaskGenerationMetadata {
  id: string;
  projectId: string;
  status?: MediaTaskStatus;
  surface?: string;
  model?: string;
  progress?: string[];
  file?: unknown | null;
  error?: MediaTaskError | null;
  startedAt?: number;
  endedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface MediaTaskPatch {
  status?: MediaTaskStatus;
  surface?: string | null;
  model?: string | null;
  operation?: MediaTaskGenerationMetadata['operation'] | null;
  prompt?: string | null;
  aspect?: string | null;
  quality?: string | null;
  resolution?: string | null;
  slot?: MediaTaskGenerationMetadata['slot'] | null;
  lineage?: MediaTaskGenerationMetadata['lineage'] | null;
  progress?: string[];
  file?: unknown | null;
  error?: MediaTaskError | null;
  startedAt?: number;
  endedAt?: number | null;
  updatedAt?: number;
}

interface RawMediaTaskRow {
  id: string;
  projectId: string;
  status: string;
  surface: string | null;
  model: string | null;
  operation: string | null;
  prompt: string | null;
  aspect: string | null;
  quality: string | null;
  resolution: string | null;
  slotJson: string | null;
  lineageJson: string | null;
  progressJson: string | null;
  fileJson: string | null;
  errorJson: string | null;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
]);


const COLS = `
  id,
  project_id AS projectId,
  status,
  surface,
  model,
  operation,
  prompt,
  aspect,
  quality,
  resolution,
  slot_json AS slotJson,
  lineage_json AS lineageJson,
  progress_json AS progressJson,
  file_json AS fileJson,
  error_json AS errorJson,
  started_at AS startedAt,
  ended_at AS endedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export function migrateMediaTasks(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN
        ('queued','running','done','failed','interrupted')),
      surface TEXT,
      model TEXT,
      operation TEXT,
      prompt TEXT,
      aspect TEXT,
      quality TEXT,
      resolution TEXT,
      slot_json TEXT,
      lineage_json TEXT,
      progress_json TEXT NOT NULL DEFAULT '[]',
      file_json TEXT,
      error_json TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_tasks_project
      ON media_tasks(project_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_media_tasks_status
      ON media_tasks(status, updated_at DESC);
  `);

  db.exec(`CREATE TABLE IF NOT EXISTS media_task_requests (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    task_id TEXT NOT NULL REFERENCES media_tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, request_id)
  )`);
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(media_tasks)`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const additions: Array<[string, string]> = [
    ['prompt', 'TEXT'],
    ['aspect', 'TEXT'],
    ['quality', 'TEXT'],
    ['resolution', 'TEXT'],
    ['operation', 'TEXT'],
    ['slot_json', 'TEXT'],
    ['lineage_json', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE media_tasks ADD COLUMN ${name} ${type}`);
  }
}

export function insertMediaTask(
  db: Database,
  input: MediaTaskInsert,
): MediaTaskRow {
  const now = Date.now();
  const status = input.status ?? 'queued';
  assertValidStatus(status);
  const startedAt = input.startedAt ?? now;
  db.prepare(
    `INSERT INTO media_tasks
       (id, project_id, status, surface, model, operation, prompt, aspect, quality,
        resolution, slot_json, lineage_json, progress_json, file_json,
        error_json, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.projectId,
    status,
    input.surface ?? null,
    input.model ?? null,
    input.operation ?? null,
    input.prompt ?? null,
    input.aspect ?? null,
    input.quality ?? null,
    input.resolution ?? null,
    jsonOrNull(input.slot ?? null),
    jsonOrNull(input.lineage ?? null),
    JSON.stringify(input.progress ?? []),
    jsonOrNull(input.file ?? null),
    jsonOrNull(input.error ?? null),
    startedAt,
    input.endedAt ?? null,
    input.createdAt ?? startedAt,
    input.updatedAt ?? now,
  );
  const row = getMediaTask(db, input.id);
  if (row === null) throw new Error(`Failed to fetch media task after insert: ${input.id}`);
  return row;
}

export function getMediaTask(
  db: Database,
  id: string,
): MediaTaskRow | null {
  const raw = db
    .prepare(`SELECT ${COLS} FROM media_tasks WHERE id = ?`)
    .get(id) as RawMediaTaskRow | undefined;
  return raw ? normalizeRow(raw) : null;
}

export function updateMediaTask(
  db: Database,
  id: string,
  patch: MediaTaskPatch,
): MediaTaskRow | null {
  const existing = getMediaTask(db, id);
  if (existing === null) return null;
  const status = patch.status ?? existing.status;
  assertValidStatus(status);
  const updatedAt = patch.updatedAt ?? Date.now();
  db.prepare(
    `UPDATE media_tasks
        SET status = ?,
            surface = ?,
            model = ?,
            operation = ?,
            prompt = ?,
            aspect = ?,
            quality = ?,
            resolution = ?,
            slot_json = ?,
            lineage_json = ?,
            progress_json = ?,
            file_json = ?,
            error_json = ?,
            started_at = ?,
            ended_at = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    status,
    'surface' in patch ? patch.surface ?? null : existing.surface ?? null,
    'model' in patch ? patch.model ?? null : existing.model ?? null,
    'operation' in patch ? patch.operation ?? null : existing.operation ?? null,
    'prompt' in patch ? patch.prompt ?? null : existing.prompt ?? null,
    'aspect' in patch ? patch.aspect ?? null : existing.aspect ?? null,
    'quality' in patch ? patch.quality ?? null : existing.quality ?? null,
    'resolution' in patch ? patch.resolution ?? null : existing.resolution ?? null,
    'slot' in patch ? jsonOrNull(patch.slot ?? null) : jsonOrNull(existing.slot),
    'lineage' in patch ? jsonOrNull(patch.lineage ?? null) : jsonOrNull(existing.lineage),
    JSON.stringify(patch.progress ?? existing.progress),
    'file' in patch ? jsonOrNull(patch.file ?? null) : jsonOrNull(existing.file),
    'error' in patch ? jsonOrNull(patch.error ?? null) : jsonOrNull(existing.error),
    patch.startedAt ?? existing.startedAt,
    'endedAt' in patch ? patch.endedAt ?? null : existing.endedAt,
    updatedAt,
    id,
  );
  return getMediaTask(db, id);
}

export function listMediaTasksByProject(
  db: Database,
  projectId: string,
  options: { includeTerminal?: boolean; taskIds?: string[] } = {},
): MediaTaskRow[] {
  const includeTerminal = options.includeTerminal === true;
  if (options.taskIds?.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT ${COLS}
         FROM media_tasks
        WHERE project_id = ?
          ${includeTerminal ? '' : "AND status IN ('queued', 'running')"}
          ${options.taskIds ? `AND id IN (${options.taskIds.map(() => '?').join(',')})` : ''}
        ORDER BY started_at DESC`,
    )
    .all(projectId, ...(options.taskIds ?? [])) as RawMediaTaskRow[];
  return rows.map(normalizeRow);
}

export function listRecentMediaTasks(
  db: Database,
  options: { terminalTtlMs: number; now?: number },
): MediaTaskRow[] {
  const now = options.now ?? Date.now();
  const cutoff = now - options.terminalTtlMs;
  const rows = db
    .prepare(
      `SELECT ${COLS}
         FROM media_tasks
        WHERE status IN ('queued', 'running')
           OR COALESCE(ended_at, updated_at) >= ?
        ORDER BY started_at DESC`,
    )
    .all(cutoff) as RawMediaTaskRow[];
  return rows.map(normalizeRow);
}

export function deleteMediaTask(db: Database, id: string): void {
  db.prepare(`DELETE FROM media_tasks WHERE id = ?`).run(id);
}

export function reconcileMediaTasksOnBoot(
  db: Database,
  options: { terminalTtlMs: number; now?: number },
): { interrupted: number; deleted: number } {
  const now = options.now ?? Date.now();
  const interruptedError: MediaTaskError = {
    message: '执行连接因服务重启中断，上游结果尚未确认；这不表示生成已取消。请先检查或取回原任务结果，避免重复生成。',
    status: 5,
    code: 'DAEMON_RESTART',
  };
  const tx = db.transaction(() => {
    const interrupted = db
      .prepare(
        `UPDATE media_tasks
            SET status = 'interrupted',
                error_json = ?,
                ended_at = COALESCE(ended_at, ?),
                updated_at = ?
          WHERE status IN ('queued', 'running')`,
      )
      .run(JSON.stringify(interruptedError), now, now).changes;

    // terminalTtlMs bounds startup hydration, not durable retention. In
    // particular an interrupted upstream job may still be retrievable later.
    return { interrupted, deleted: 0 };
  });
  return tx() as { interrupted: number; deleted: number };
}

function normalizeRow(raw: RawMediaTaskRow): MediaTaskRow {
  const row: MediaTaskRow = {
    id: raw.id,
    projectId: raw.projectId,
    status: raw.status as MediaTaskStatus,
    progress: parseArray(raw.progressJson),
    file: parseJson(raw.fileJson),
    error: normalizeError(parseJson(raw.errorJson)),
    startedAt: Number(raw.startedAt),
    endedAt: raw.endedAt == null ? null : Number(raw.endedAt),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
  if (raw.surface !== null) row.surface = raw.surface;
  if (raw.model !== null) row.model = raw.model;
  if (raw.operation === 'cutout') row.operation = 'cutout';
  if (raw.prompt !== null) row.prompt = raw.prompt;
  if (raw.aspect !== null) row.aspect = raw.aspect;
  if (raw.quality !== null) row.quality = raw.quality;
  if (raw.resolution !== null) row.resolution = raw.resolution;
  const slot = normalizeSlot(parseJson(raw.slotJson));
  if (slot) row.slot = slot;
  const lineage = normalizeLineage(parseJson(raw.lineageJson));
  if (lineage) row.lineage = lineage;
  return row;
}

function normalizeSlot(value: unknown): MediaTaskGenerationMetadata['slot'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) return undefined;
  return {
    id: obj.id,
    ...(typeof obj.kind === 'string' ? { kind: obj.kind } : {}),
    ...(typeof obj.label === 'string' ? { label: obj.label } : {}),
  };
}

function normalizeLineage(value: unknown): MediaTaskGenerationMetadata['lineage'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const sourceNodeIds = Array.isArray(obj.sourceNodeIds)
    ? obj.sourceNodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : undefined;
  const lineage: NonNullable<MediaTaskGenerationMetadata['lineage']> = {
    ...(sourceNodeIds?.length ? { sourceNodeIds } : {}),
    ...(typeof obj.sourceTaskId === 'string' ? { sourceTaskId: obj.sourceTaskId } : {}),
    ...(typeof obj.sourceAssetPath === 'string' ? { sourceAssetPath: obj.sourceAssetPath } : {}),
    ...(typeof obj.sourceRevision === 'string' || typeof obj.sourceRevision === 'number'
      ? { sourceRevision: obj.sourceRevision }
      : {}),
  };
  return Object.keys(lineage).length ? lineage : undefined;
}

function assertValidStatus(status: string): void {
  if (!VALID_STATUSES.has(status)) {
    throw new RangeError(`Invalid media task status: "${status}"`);
  }
}

function parseArray(json: string | null): string[] {
  const parsed = parseJson(json);
  return Array.isArray(parsed)
    ? parsed.filter((line): line is string => typeof line === 'string')
    : [];
}

function normalizeError(value: unknown): MediaTaskError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const message = typeof obj.message === 'string' ? obj.message : '';
  if (!message) return null;
  const error: MediaTaskError = { message };
  if (typeof obj.status === 'number') error.status = obj.status;
  if (typeof obj.code === 'string') error.code = obj.code;
  return error;
}

function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function jsonOrNull(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}
