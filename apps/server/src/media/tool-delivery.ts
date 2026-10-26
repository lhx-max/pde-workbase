/** Multi-artifact tool result delivery: validation, deterministic task-bound
 * output paths, and a per-task JSON journal slot for partial writes.
 *
 * Image adapters may return a `toolResult` carrying the complete artifact set
 * (bytes) plus optional JSON edit metadata. The primary artifact keeps the
 * declared request output path; extras are stored under
 * `outputs/image-tools/<taskId>/` so a replayed or recovered delivery maps to
 * the same paths and can never silently overwrite unrelated files.
 *
 * Raster/SVG artifacts ride the existing ImageFileStorage (or project file)
 * pipeline. application/json artifacts (edit-state, surface, dense masks)
 * require the dedicated tool artifact store injected by the host — when it is
 * absent the task fails explicitly instead of dropping extras or writing JSON
 * through the image channel. */
import { createHash } from 'node:crypto';
import { CanvasStateError } from '../canvas/errors.js';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';

export type ToolArtifactRole = 'result' | 'preview' | 'mask' | 'vector' | 'layer' | 'edit-state' | 'surface';

/** Portable tool result as every adapter returns it in-process: bytes are
 * Uint8Array on both the verified in-process path and the decoded HTTP path. */
export interface ToolResultPayload {
  kind: string;
  artifacts: ToolResultArtifactPayload[];
  /** Optional structured edit metadata (layer frames/OCR/etc); bounded JSON. */
  layering?: unknown;
}
export interface ToolResultArtifactPayload {
  content: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
  name?: string;
  role?: ToolArtifactRole;
}

/** Structural port root injects for JSON artifacts (CloudToolArtifactFiles). */
export interface ToolArtifactStoragePort {
  put(
    scope: { namespace: string; projectId: string },
    input: { id: string; role: ToolArtifactRole; path: string; mime: string; content: Uint8Array; width?: number; height?: number },
  ): Promise<{ id: string; role: string; path: string; mime: string; byteLength: number; sha256: string; width?: number; height?: number }>;
}

export interface PlannedToolOutput {
  index: number;
  id: string;
  role: ToolArtifactRole;
  path: string;
  mime: string;
  byteLength: number;
  sha256: string;
  name?: string;
  width?: number;
  height?: number;
  storage: 'image' | 'json';
}
export interface ToolDeliveryPlan {
  taskId: string;
  projectId: string;
  tool: string;
  primaryPath: string;
  artifacts: PlannedToolOutput[];
  layering?: unknown;
}

const MAX_ARTIFACTS = 128;
const MAX_ARTIFACT_BYTES = 30_000_000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_PIXELS = 32_000_000;
const MAX_NAME = 200;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_JSON_DEPTH = 12;
const ALLOWED_MIME: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/json']);
const RASTER_MIME: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ROLES: ReadonlySet<string> = new Set(['result', 'preview', 'mask', 'vector', 'layer', 'edit-state', 'surface']);
const ROLE_MIME: Record<ToolArtifactRole, (mime: string) => boolean> = {
  result: mime => ALLOWED_MIME.has(mime),
  preview: mime => RASTER_MIME.has(mime),
  mask: mime => RASTER_MIME.has(mime),
  vector: mime => mime === 'image/svg+xml',
  layer: mime => RASTER_MIME.has(mime),
  'edit-state': mime => mime === 'application/json',
  surface: mime => mime === 'application/json',
};
const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/json': 'json',
};
const CREDENTIAL_KEY = /token|secret|password|passwd|credential|authorization|cookie|bearer|api[-_]?key|session|header|oauth|jwt|signature|__proto__|constructor|prototype/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/u;
const sha256hex = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
function invalid(message:string):never {throw new CanvasStateError(400,'IMAGE_TOOL_RESULT_INVALID',message);}
function tooLarge(message:string):never {throw new CanvasStateError(413,'IMAGE_TOOL_RESULT_TOO_LARGE',message);}

function safeJson(value: unknown, depth: number, stack: Set<object>): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('工具元数据包含非有限数值'); return; }
  if (typeof value === 'string') return;
  if (Array.isArray(value)) {
    if (depth > MAX_JSON_DEPTH || stack.has(value)) invalid('工具元数据嵌套或循环无效');
    stack.add(value);
    for (const child of value) safeJson(child, depth + 1, stack);
    stack.delete(value);
    return;
  }
  if (value && typeof value === 'object') {
    if (depth > MAX_JSON_DEPTH || stack.has(value)) invalid('工具元数据嵌套或循环无效');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) invalid('工具元数据必须是普通JSON对象');
    stack.add(value);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(key)) invalid('工具元数据不得包含凭据字段');
      safeJson(child, depth + 1, stack);
    }
    stack.delete(value);
    return;
  }
  invalid('工具元数据必须是JSON值');
}

function artifactName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > MAX_NAME || /[/\\:%?#]/u.test(value) || CONTROL_CHARS.test(value)) invalid('工具产物名称无效');
  return value;
}

function roleFor(role: unknown, mime: string, index: number): ToolArtifactRole {
  if (role === undefined) return index === 0 ? 'result' : mime === 'image/svg+xml' ? 'vector' : mime === 'application/json' ? 'edit-state' : 'result';
  if (typeof role === 'string' && ROLES.has(role)) return role as ToolArtifactRole;
  if (role === 'dense-b' && mime === 'application/json') return 'surface';
  return mime === 'image/svg+xml' ? 'vector' : mime === 'application/json' ? 'edit-state' : 'result';
}

/** Strictly validate the adapter-returned complete tool result. Artifact bytes
 * stay bytes (no inline base64 accepted); layering must be bounded plain JSON. */
export function parseToolResultPayload(value: unknown): ToolResultPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('工具结果必须是对象');
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!['kind', 'artifacts', 'layering'].includes(key)) invalid('工具结果包含未知字段');
  if (typeof input.kind !== 'string' || !input.kind || input.kind.length > 128 || !/^[a-z0-9][a-z0-9-]*$/u.test(input.kind)) invalid('工具结果类型无效');
  const list = input.artifacts;
  if (!Array.isArray(list) || !list.length || list.length > MAX_ARTIFACTS) invalid('工具结果产物数量无效');
  let total = 0;
  const artifacts = list.map((entry, index): ToolResultArtifactPayload => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid('工具产物无效');
    const artifact = entry as Record<string, unknown>;
    for (const key of Object.keys(artifact)) if (!['content', 'mime', 'width', 'height', 'name', 'role'].includes(key)) invalid('工具产物包含未知字段');
    if (!(artifact.content instanceof Uint8Array) || !artifact.content.byteLength) invalid('工具产物缺少字节内容');
    if (artifact.content.byteLength > MAX_ARTIFACT_BYTES) tooLarge('单个工具产物超过大小限制');
    total += artifact.content.byteLength;
    if (total > MAX_TOTAL_BYTES) tooLarge('工具产物总量超过大小限制');
    if (typeof artifact.mime !== 'string' || !ALLOWED_MIME.has(artifact.mime)) invalid('工具产物类型不受支持');
    const role = roleFor(artifact.role, artifact.mime, index);
    if (!ROLE_MIME[role](artifact.mime)) invalid('工具产物角色与类型不匹配');
    const checked: ToolResultArtifactPayload = { content: new Uint8Array(artifact.content), mime: artifact.mime, role };
    const name = artifactName(artifact.name);
    if (name !== undefined) checked.name = name;
    if (artifact.width !== undefined || artifact.height !== undefined) {
      if (typeof artifact.width !== 'number' || typeof artifact.height !== 'number'
        || !Number.isSafeInteger(artifact.width) || !Number.isSafeInteger(artifact.height)
        || artifact.width < 1 || artifact.height < 1 || artifact.width * artifact.height > MAX_PIXELS) invalid('工具产物尺寸无效');
      checked.width = artifact.width;
      checked.height = artifact.height;
    }
    return checked;
  });
  const result: ToolResultPayload = { kind: input.kind, artifacts };
  if (input.layering !== undefined) {
    safeJson(input.layering, 0, new Set());
    if (new TextEncoder().encode(JSON.stringify(input.layering)).byteLength > MAX_JSON_BYTES) tooLarge('工具元数据超过大小限制');
    result.layering = structuredClone(input.layering);
  }
  return result;
}

const TASK_PATH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
/** Keep the provider-given display name readable while making the stored file
 * segment deterministic and safe for both image storage and blob indexing. */
function safeFileSegment(name: string | undefined, fallback: string): string {
  const base = (name ?? fallback).replace(/\.[A-Za-z0-9]{1,8}$/u, '');
  const cleaned = base.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^\.+/u, '').replace(/-{2,}/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120);
  return cleaned || fallback;
}

/** Deterministic task-bound paths for every artifact: index 0 keeps the
 * declared request output path; extras live under outputs/image-tools/<task>/
 * so replays converge on identical paths and recovery stays idempotent. */
export function planToolDelivery(taskId: string, projectId: string, primaryPath: string, result: ToolResultPayload): ToolDeliveryPlan {
  if (!TASK_PATH_ID.test(taskId)) invalid('任务编号无效');
  if (typeof primaryPath !== 'string' || !primaryPath) invalid('工具主产物路径无效');
  const artifacts = result.artifacts.map((artifact, index): PlannedToolOutput => {
    const ext = MIME_EXTENSION[artifact.mime]!;
    const path = index === 0
      ? primaryPath
      : `outputs/image-tools/${taskId}/${String(index).padStart(2, '0')}-${safeFileSegment(artifact.name, `artifact-${index}`)}.${ext}`;
    if (path.length > 2000) invalid('工具产物路径过长');
    const planned: PlannedToolOutput = {
      index, id: `art-${index}`, role: artifact.role ?? 'result', path, mime: artifact.mime,
      byteLength: artifact.content.byteLength, sha256: sha256hex(artifact.content),
      storage: artifact.mime === 'application/json' ? 'json' : 'image',
    };
    if (artifact.name !== undefined) planned.name = artifact.name;
    if (artifact.width !== undefined && artifact.height !== undefined) { planned.width = artifact.width; planned.height = artifact.height; }
    return planned;
  });
  const plan: ToolDeliveryPlan = { taskId, projectId, tool: result.kind, primaryPath, artifacts };
  if (result.layering !== undefined) plan.layering = result.layering;
  return plan;
}

/** Canvas-visible record stored on task.file.outputs: paths and metadata only,
 * never bytes. index/role/storage let delivery append each node exactly once. */
export interface ToolDeliveredOutput {
  index: number;
  id: string;
  role: ToolArtifactRole;
  path: string;
  mime: string;
  storage: 'image' | 'json';
  name?: string;
  width?: number;
  height?: number;
  fileId?: string;
}
export function deliveredOutputs(plan: ToolDeliveryPlan, stored: Map<number, { path: string; fileId?: string }>): ToolDeliveredOutput[] {
  return plan.artifacts.map(item => {
    const output: ToolDeliveredOutput = {
      index: item.index, id: item.id, role: item.role, path: stored.get(item.index)?.path ?? item.path,
      mime: item.mime, storage: item.storage,
    };
    if (item.name !== undefined) output.name = item.name;
    if (item.width !== undefined && item.height !== undefined) { output.width = item.width; output.height = item.height; }
    const fileId = stored.get(item.index)?.fileId;
    if (fileId !== undefined) output.fileId = fileId;
    return output;
  });
}

/* ------------------------------------------------------------------ */
/* Per-task delivery journal slot on the shared single-writer state port */
/* ------------------------------------------------------------------ */

const SLOT_PREFIX = 'media-tool-';
const SLOT_VERSION = 'media-tool-delivery/v1' as const;
const RECORD_STATUSES = new Set(['planned', 'writing', 'stored', 'failed', 'delivered']);

export interface ToolDeliveryRecord {
  schemaVersion: typeof SLOT_VERSION;
  taskId: string;
  projectId: string;
  tool: string;
  status: 'planned' | 'writing' | 'stored' | 'failed' | 'delivered';
  planned: Array<Pick<PlannedToolOutput, 'index' | 'id' | 'role' | 'path' | 'mime' | 'byteLength' | 'sha256' | 'storage'>>;
  staged: string[];
  updatedAt: number;
  createdAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function corrupted(field:string):never {throw new Error(`tool delivery journal is corrupt at ${field}`);}

function parsePlanned(value: unknown, field: string): ToolDeliveryRecord['planned'][number] {
  if (!isRecord(value)) corrupted(field);
  for (const key of Object.keys(value)) {
    if (!['index', 'id', 'role', 'path', 'mime', 'byteLength', 'sha256', 'storage', 'name', 'width', 'height'].includes(key)) corrupted(`${field}.${key}`);
  }
  if (typeof value.index !== 'number' || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= MAX_ARTIFACTS) corrupted(`${field}.index`);
  if (typeof value.id !== 'string' || !value.id || value.id.length > 128) corrupted(`${field}.id`);
  if (typeof value.role !== 'string' || !ROLES.has(value.role)) corrupted(`${field}.role`);
  if (typeof value.path !== 'string' || !value.path || value.path.length > 2000) corrupted(`${field}.path`);
  if (typeof value.mime !== 'string' || !ALLOWED_MIME.has(value.mime)) corrupted(`${field}.mime`);
  if (typeof value.byteLength !== 'number' || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > MAX_ARTIFACT_BYTES) corrupted(`${field}.byteLength`);
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) corrupted(`${field}.sha256`);
  if (value.storage !== 'image' && value.storage !== 'json') corrupted(`${field}.storage`);
  return value as unknown as ToolDeliveryRecord['planned'][number];
}

function parseRecord(value: unknown): ToolDeliveryRecord {
  if (!isRecord(value)) corrupted('record');
  for (const key of Object.keys(value)) {
    if (!['schemaVersion', 'taskId', 'projectId', 'tool', 'status', 'planned', 'staged', 'updatedAt', 'createdAt'].includes(key)) corrupted(key);
  }
  if (value.schemaVersion !== SLOT_VERSION) corrupted('schemaVersion');
  if (typeof value.taskId !== 'string' || !TASK_PATH_ID.test(value.taskId)) corrupted('taskId');
  if (typeof value.projectId !== 'string' || !value.projectId) corrupted('projectId');
  if (typeof value.tool !== 'string' || !value.tool || value.tool.length > 128) corrupted('tool');
  if (typeof value.status !== 'string' || !RECORD_STATUSES.has(value.status)) corrupted('status');
  if (!Array.isArray(value.planned) || !value.planned.length || value.planned.length > MAX_ARTIFACTS) corrupted('planned');
  const planned = value.planned.map((entry, i) => parsePlanned(entry, `planned[${i}]`));
  if (!Array.isArray(value.staged) || value.staged.length > MAX_ARTIFACTS || value.staged.some(v => typeof v !== 'string')) corrupted('staged');
  if (typeof value.updatedAt !== 'number' || typeof value.createdAt !== 'number' || !Number.isFinite(value.updatedAt) || !Number.isFinite(value.createdAt)) corrupted('timestamps');
  return { ...value, planned, staged: value.staged as string[] } as ToolDeliveryRecord;
}

/** Durable per-task record of the artifact plan and staged writes. The plan is
 * persisted before any byte is stored and staged paths append as each write
 * commits, so a crash mid-upload leaves an inspectable partial and never
 * reports a fabricated success. Single-writer JsonStatePort only — no
 * distributed CAS is claimed or emulated. */
export class ToolDeliveryJournal {
  private failure: Error | null = null;
  private readonly cache = new Map<string, ToolDeliveryRecord | null>();
  constructor(private readonly port: JsonStatePort | undefined) {}

  get enabled(): boolean { return this.port !== undefined; }
  assertHealthy(): void { if (this.failure) throw this.failure; }
  private poison(error: unknown): Error {
    const value = error instanceof Error ? error : new Error(String(error));
    if (!this.failure) this.failure = value;
    return this.failure;
  }
  private slot(taskId: string): string {
    if (!TASK_PATH_ID.test(taskId)) throw new CanvasStateError(400, 'IMAGE_TOOL_TASK_INVALID', '工具任务编号无效');
    return `${SLOT_PREFIX}${taskId}`;
  }
  /** Hydrate one task record. Callers must have awaited the port's readiness
   * gate upstream (adapter-service ready()); lazy per-task reads keep boot
   * reconciliation independent of enumeration support on the port. */
  get(taskId: string): ToolDeliveryRecord | null {
    if (!this.port) return null;
    this.assertHealthy();
    try {
      if (!this.cache.has(taskId)) {
        const raw = this.port.read(this.slot(taskId));
        this.cache.set(taskId, raw === undefined ? null : parseRecord(raw));
      }
      return this.cache.get(taskId) ?? null;
    } catch (error) { throw this.poison(error); }
  }
  private async put(record: ToolDeliveryRecord): Promise<void> {
    if (!this.port) return;
    this.assertHealthy();
    try {
      this.port.write(this.slot(record.taskId), record);
      await this.port.flush();
      this.cache.set(record.taskId, record);
    } catch (error) { throw this.poison(error); }
  }
  /** Persist the complete artifact plan before the first byte is written. */
  async begin(plan: ToolDeliveryPlan): Promise<void> {
    if (!this.port) return;
    const existing = this.get(plan.taskId);
    const now = Date.now();
    const record: ToolDeliveryRecord = {
      schemaVersion: SLOT_VERSION, taskId: plan.taskId, projectId: plan.projectId, tool: plan.tool,
      status: 'planned',
      planned: plan.artifacts.map(({ index, id, role, path, mime, byteLength, sha256, storage }) => ({ index, id, role, path, mime, byteLength, sha256, storage })),
      staged: existing?.staged ?? [],
      updatedAt: now, createdAt: existing?.createdAt ?? now,
    };
    await this.put(record);
  }
  /** Persist each committed artifact path before the next write starts. */
  async staged(taskId: string, path: string): Promise<void> {
    if (!this.port) return;
    const record = this.get(taskId);
    if (!record) throw new Error(`tool delivery journal has no plan for ${taskId}`);
    if (record.staged.includes(path)) return;
    await this.put({ ...record, staged: [...record.staged, path], status: 'writing', updatedAt: Date.now() });
  }
  async finish(taskId: string, status: 'stored' | 'delivered' | 'failed'): Promise<void> {
    if (!this.port) return;
    const record = this.get(taskId);
    if (!record) return;
    await this.put({ ...record, status, updatedAt: Date.now() });
  }
}
