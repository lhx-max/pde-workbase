import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import type { Database } from '../storage/database.js';
import type { MediaTaskStatus } from './tasks.js';

/** Shared-state slot holding the whole media task/delivery/request journal. */
export const MEDIA_TASK_JOURNAL_SLOT = 'media-tasks';
const MEDIA_TASK_JOURNAL_VERSION = 1;

const TASK_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'done', 'failed', 'interrupted']);
const DELIVERY_STATUSES: ReadonlySet<string> = new Set(['pending', 'delivered', 'conflict']);

/** Generation request fields that are safe to persist in the journal and replay via retry. */
export const MEDIA_JOURNAL_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'surface', 'model', 'prompt', 'operation', 'aspect', 'quality', 'resolution',
  'image', 'images', 'imageUrl', 'imageUrls', 'output', 'length',
  'tool', 'slot', 'lineage', 'canvasDelivery', 'clientRequestId', 'resumeTaskId',
]);

const SENSITIVE_REQUEST_FIELD =
  /token|secret|password|passwd|credential|authorization|cookie|bearer|api[-_]?key|access[-_]?key|private[-_]?key|session|header|oauth|jwt|signature/i;

function assertNoCredentialFields(value:unknown):void {
 if(Array.isArray(value)){for(const child of value)assertNoCredentialFields(child);return;}
 if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
  if(SENSITIVE_REQUEST_FIELD.test(key))throw Object.assign(new Error('Credential-shaped media request fields cannot be persisted'),{status:400,code:'MEDIA_REQUEST_FIELD_DENIED'});
  assertNoCredentialFields(child);
 }
}

/** Strip a generation request to the whitelist that may reach durable storage.
 * An unknown field that looks like a credential fails the request outright,
 * before paid dispatch; a harmless extra field is simply not recorded. */
export function sanitizeMediaJournalRequest(request: Record<string, unknown>): Record<string, unknown> {
  assertNoCredentialFields(request);
  for (const key of Object.keys(request)) {
    if (!MEDIA_JOURNAL_REQUEST_FIELDS.has(key) && SENSITIVE_REQUEST_FIELD.test(key)) {
      throw Object.assign(new Error(`media request field "${key}" cannot be persisted by the task journal`), {
        status: 400,
        code: 'MEDIA_REQUEST_FIELD_DENIED',
      });
    }
  }
  const persisted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (MEDIA_JOURNAL_REQUEST_FIELDS.has(key) && value !== undefined) persisted[key] = value;
  }
  return persisted;
}

export interface MediaJournalTaskRow {
  id: string;
  projectId: string;
  status: MediaTaskStatus;
  surface: string | null;
  model: string | null;
  operation: string | null;
  prompt: string | null;
  aspect: string | null;
  quality: string | null;
  resolution: string | null;
  slot: unknown;
  lineage: unknown;
  progress: string[];
  file: unknown;
  error: unknown;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MediaJournalRequestRow {
  projectId: string;
  requestId: string;
  digest: string;
  taskId: string;
}

export interface MediaJournalAdapterRequestRow {
  taskId: string;
  request: Record<string, unknown>;
}

export interface MediaJournalDeliveryRow {
  taskId: string;
  projectId: string;
  target: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'conflict';
  error: string | null;
}

export interface MediaJournalSnapshot {
  version: typeof MEDIA_TASK_JOURNAL_VERSION;
  projects: string[];
  tasks: MediaJournalTaskRow[];
  requests: MediaJournalRequestRow[];
  adapterRequests: MediaJournalAdapterRequestRow[];
  deliveries: MediaJournalDeliveryRow[];
}

function corrupted(field: string): Error {
  return new Error(`media task journal snapshot is corrupt at ${field}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.length) throw corrupted(field);
  return value;
};

const optionalString = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw corrupted(field);
  return value;
};

const requiredNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw corrupted(field);
  return value;
};

const optionalNumber = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined) return null;
  return requiredNumber(value, field);
};

const requiredArray = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) throw corrupted(field);
  return value;
};

const optionalObject = (value: unknown, field: string): Record<string, unknown> | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw corrupted(field);
  return value;
};

function parseTaskRow(value: unknown, index: number): MediaJournalTaskRow {
  const field = `tasks[${index}]`;
  if (!isRecord(value)) throw corrupted(field);
  if (typeof value.status !== 'string' || !TASK_STATUSES.has(value.status)) throw corrupted(`${field}.status`);
  const operation = optionalString(value.operation, `${field}.operation`);
  if (operation !== null && operation !== 'cutout') throw corrupted(`${field}.operation`);
  const progress = requiredArray(value.progress, `${field}.progress`);
  if (!progress.every(line => typeof line === 'string')) throw corrupted(`${field}.progress`);
  const error = value.error ?? null;
  if (error !== null && (!isRecord(error) || typeof error.message !== 'string')) throw corrupted(`${field}.error`);
  return {
    id: requiredString(value.id, `${field}.id`),
    projectId: requiredString(value.projectId, `${field}.projectId`),
    status: value.status as MediaTaskStatus,
    surface: optionalString(value.surface, `${field}.surface`),
    model: optionalString(value.model, `${field}.model`),
    operation,
    prompt: optionalString(value.prompt, `${field}.prompt`),
    aspect: optionalString(value.aspect, `${field}.aspect`),
    quality: optionalString(value.quality, `${field}.quality`),
    resolution: optionalString(value.resolution, `${field}.resolution`),
    slot: optionalObject(value.slot, `${field}.slot`),
    lineage: optionalObject(value.lineage, `${field}.lineage`),
    progress: progress as string[],
    file: value.file ?? null,
    error,
    startedAt: requiredNumber(value.startedAt, `${field}.startedAt`),
    endedAt: optionalNumber(value.endedAt, `${field}.endedAt`),
    createdAt: requiredNumber(value.createdAt, `${field}.createdAt`),
    updatedAt: requiredNumber(value.updatedAt, `${field}.updatedAt`),
  };
}

function parseRequestRow(value: unknown, index: number): MediaJournalRequestRow {
  const field = `requests[${index}]`;
  if (!isRecord(value)) throw corrupted(field);
  return {
    projectId: requiredString(value.projectId, `${field}.projectId`),
    requestId: requiredString(value.requestId, `${field}.requestId`),
    digest: requiredString(value.digest, `${field}.digest`),
    taskId: requiredString(value.taskId, `${field}.taskId`),
  };
}

function parseAdapterRequestRow(value: unknown, index: number): MediaJournalAdapterRequestRow {
  const field = `adapterRequests[${index}]`;
  if (!isRecord(value)) throw corrupted(field);
  if (!isRecord(value.request)) throw corrupted(`${field}.request`);
  for (const key of Object.keys(value.request)) {
    if (SENSITIVE_REQUEST_FIELD.test(key)) throw corrupted(`${field}.request.${key}`);
  }
  try{assertNoCredentialFields(value.request);}catch{throw corrupted(`${field}.request`);}
  return { taskId: requiredString(value.taskId, `${field}.taskId`), request: value.request };
}

function parseDeliveryRow(value: unknown, index: number): MediaJournalDeliveryRow {
  const field = `deliveries[${index}]`;
  if (!isRecord(value)) throw corrupted(field);
  if (typeof value.status !== 'string' || !DELIVERY_STATUSES.has(value.status)) throw corrupted(`${field}.status`);
  if (!isRecord(value.target)) throw corrupted(`${field}.target`);
  return {
    taskId: requiredString(value.taskId, `${field}.taskId`),
    projectId: requiredString(value.projectId, `${field}.projectId`),
    target: value.target,
    status: value.status as MediaJournalDeliveryRow['status'],
    error: optionalString(value.error, `${field}.error`),
  };
}

/** Strictly validate a stored snapshot; any corrupt field/status/identity throws. */
export function parseMediaJournalSnapshot(value: unknown): MediaJournalSnapshot {
  if (!isRecord(value) || value.version !== MEDIA_TASK_JOURNAL_VERSION) throw corrupted('version');
  const snapshot:MediaJournalSnapshot = {
    version: MEDIA_TASK_JOURNAL_VERSION,
    projects: requiredArray(value.projects, 'projects').map((entry, index) => requiredString(entry, `projects[${index}]`)),
    tasks: requiredArray(value.tasks, 'tasks').map(parseTaskRow),
    requests: requiredArray(value.requests, 'requests').map(parseRequestRow),
    adapterRequests: requiredArray(value.adapterRequests, 'adapterRequests').map(parseAdapterRequestRow),
    deliveries: requiredArray(value.deliveries, 'deliveries').map(parseDeliveryRow),
  };
  const projects=new Set(snapshot.projects),tasks=new Map(snapshot.tasks.map(task=>[task.id,task]));
  if(projects.size!==snapshot.projects.length||tasks.size!==snapshot.tasks.length)throw corrupted('duplicate identity');
  for(const task of snapshot.tasks)if(!projects.has(task.projectId))throw corrupted('task project');
  for(const row of [...snapshot.requests,...snapshot.deliveries])if(tasks.get(row.taskId)?.projectId!==row.projectId)throw corrupted('cross-project journal relation');
  for(const row of snapshot.adapterRequests)if(!tasks.has(row.taskId))throw corrupted('adapter task');
  return snapshot;
}

const emptySnapshot = (): MediaJournalSnapshot => ({
  version: MEDIA_TASK_JOURNAL_VERSION,
  projects: [],
  tasks: [],
  requests: [],
  adapterRequests: [],
  deliveries: [],
});

interface RawTaskRow {
  id: string;
  project_id: string;
  status: string;
  surface: string | null;
  model: string | null;
  operation: string | null;
  prompt: string | null;
  aspect: string | null;
  quality: string | null;
  resolution: string | null;
  slot_json: string | null;
  lineage_json: string | null;
  progress_json: string | null;
  file_json: string | null;
  error_json: string | null;
  started_at: number;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

const decodeJson = (json: string | null): unknown => (json === null ? null : JSON.parse(json));

/** Serialize the four task-domain tables under their exact known schemas; no
 * arbitrary table names or input SQL ever reach the snapshot. */
export function snapshotMediaJournal(db: Database): MediaJournalSnapshot {
  const tasks = (db.prepare(
    `SELECT id, project_id, status, surface, model, operation, prompt, aspect, quality,
            resolution, slot_json, lineage_json, progress_json, file_json, error_json,
            started_at, ended_at, created_at, updated_at
       FROM media_tasks`,
  ).all() as RawTaskRow[]).map((row): MediaJournalTaskRow => {
    if (!TASK_STATUSES.has(row.status)) throw corrupted(`media_tasks(${row.id}).status`);
    const progress = decodeJson(row.progress_json);
    if (!Array.isArray(progress) || !progress.every(line => typeof line === 'string')) {
      throw corrupted(`media_tasks(${row.id}).progress_json`);
    }
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status as MediaTaskStatus,
      surface: row.surface,
      model: row.model,
      operation: row.operation,
      prompt: row.prompt,
      aspect: row.aspect,
      quality: row.quality,
      resolution: row.resolution,
      slot: decodeJson(row.slot_json),
      lineage: decodeJson(row.lineage_json),
      progress,
      file: decodeJson(row.file_json),
      error: decodeJson(row.error_json),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  const requests = (db.prepare(
    'SELECT project_id, request_id, request_digest, task_id FROM media_task_requests',
  ).all() as Array<{ project_id: string; request_id: string; request_digest: string; task_id: string }>)
    .map((row): MediaJournalRequestRow => ({
      projectId: row.project_id,
      requestId: row.request_id,
      digest: row.request_digest,
      taskId: row.task_id,
    }));
  const adapterRequests = (db.prepare(
    'SELECT task_id, request_json FROM media_adapter_requests',
  ).all() as Array<{ task_id: string; request_json: string }>)
    .map((row): MediaJournalAdapterRequestRow => {
      const request = decodeJson(row.request_json);
      if (!isRecord(request)) throw corrupted(`media_adapter_requests(${row.task_id}).request_json`);
      return { taskId: row.task_id, request };
    });
  const deliveries = (db.prepare(
    'SELECT task_id, project_id, target_json, status, error FROM media_canvas_deliveries',
  ).all() as Array<{ task_id: string; project_id: string; target_json: string; status: string; error: string | null }>)
    .map((row): MediaJournalDeliveryRow => {
      if (!DELIVERY_STATUSES.has(row.status)) throw corrupted(`media_canvas_deliveries(${row.task_id}).status`);
      const target = decodeJson(row.target_json);
      if (!isRecord(target)) throw corrupted(`media_canvas_deliveries(${row.task_id}).target_json`);
      return {
        taskId: row.task_id,
        projectId: row.project_id,
        target,
        status: row.status as MediaJournalDeliveryRow['status'],
        error: row.error,
      };
    });
  const projects = [...new Set<string>([
    ...tasks.map(row => row.projectId),
    ...requests.map(row => row.projectId),
    ...deliveries.map(row => row.projectId),
  ])].sort();
  return { version: MEDIA_TASK_JOURNAL_VERSION, projects, tasks, requests, adapterRequests, deliveries };
}

/** The cloud snapshot is authoritative in cloud mode; pre-existing local
 * business rows are never read once the journal is attached. */
function clearMediaJournalRows(db: Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM media_canvas_deliveries').run();
    db.prepare('DELETE FROM media_adapter_requests').run();
    db.prepare('DELETE FROM media_task_requests').run();
    db.prepare('DELETE FROM media_tasks').run();
  })();
}

/** Insert validated snapshot rows; foreign keys still prove referential integrity. */
export function hydrateMediaJournal(db: Database, snapshot: MediaJournalSnapshot): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY)');
    for (const id of snapshot.projects) {
      db.prepare('INSERT OR IGNORE INTO projects (id) VALUES (?)').run(id);
    }
    for (const task of snapshot.tasks) {
      db.prepare(
        `INSERT INTO media_tasks
           (id, project_id, status, surface, model, operation, prompt, aspect, quality,
            resolution, slot_json, lineage_json, progress_json, file_json, error_json,
            started_at, ended_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        task.id, task.projectId, task.status, task.surface, task.model, task.operation,
        task.prompt, task.aspect, task.quality, task.resolution,
        task.slot === null ? null : JSON.stringify(task.slot),
        task.lineage === null ? null : JSON.stringify(task.lineage),
        JSON.stringify(task.progress),
        task.file === null || task.file === undefined ? null : JSON.stringify(task.file),
        task.error === null ? null : JSON.stringify(task.error),
        task.startedAt, task.endedAt, task.createdAt, task.updatedAt,
      );
    }
    for (const row of snapshot.requests) {
      db.prepare('INSERT INTO media_task_requests (project_id, request_id, request_digest, task_id) VALUES (?, ?, ?, ?)')
        .run(row.projectId, row.requestId, row.digest, row.taskId);
    }
    for (const row of snapshot.adapterRequests) {
      db.prepare('INSERT INTO media_adapter_requests (task_id, request_json) VALUES (?, ?)')
        .run(row.taskId, JSON.stringify(row.request));
    }
    for (const row of snapshot.deliveries) {
      db.prepare('INSERT INTO media_canvas_deliveries (task_id, project_id, target_json, status, error) VALUES (?, ?, ?, ?, ?)')
        .run(row.taskId, row.projectId, JSON.stringify(row.target), row.status, row.error);
    }
  })();
}

/** Durable media journal on the shared JSON state port. Snapshots are written
 * synchronously and flushed at commit points; any port failure poisons the
 * journal so later operations cannot report unearned success. */
export class MediaTaskJournal {
  private failure: Error | null = null;

  constructor(private readonly db: Database, private readonly port: JsonStatePort) {}

  /** Present after the first storage failure; every later operation must fail. */
  get error(): Error | null {
    return this.failure;
  }

  assertHealthy(): void {
    if (this.failure) throw this.failure;
  }

  private poison(error: unknown): Error {
    const value = error instanceof Error ? error : new Error(String(error));
    if (!this.failure) this.failure = value;
    return this.failure;
  }

  /** Authoritative restore runs before boot reconciliation. */
  async restore(): Promise<void> {
    try {
      await this.port.ready;
      clearMediaJournalRows(this.db);
      const raw = this.port.read(MEDIA_TASK_JOURNAL_SLOT);
      hydrateMediaJournal(this.db, raw === undefined ? emptySnapshot() : parseMediaJournalSnapshot(raw));
      this.port.write(MEDIA_TASK_JOURNAL_SLOT, snapshotMediaJournal(this.db));
      await this.port.flush();
    } catch (error) {
      throw this.poison(error);
    }
  }

  /** Synchronous snapshot write; bound/size errors from the port poison the journal. */
  write(): void {
    if (this.failure) throw this.failure;
    try {
      this.port.write(MEDIA_TASK_JOURNAL_SLOT, snapshotMediaJournal(this.db));
    } catch (error) {
      throw this.poison(error);
    }
  }

  async flush(): Promise<void> {
    if (this.failure) throw this.failure;
    try {
      await this.port.flush();
    } catch (error) {
      throw this.poison(error);
    }
  }

  async persist(): Promise<void> {
    this.write();
    await this.flush();
  }
}
