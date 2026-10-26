import { createHash } from 'node:crypto';
import type { ProjectFile, ProjectFileKind, ProjectFileVersionPromptSource, ProjectFileVersionSource } from '@bezier/contracts';
import { CanvasStateError } from '@bezier/canvas-core';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { AppwriteClient, appwriteEnc as enc } from './appwrite-client.js';

/** Cloud-authoritative project file storage.
 *
 * Bytes live in the Appwrite storage bucket under content-derived immutable
 * blob ids; the EXISTING `canvas_files` collection is the sole canonical head
 * mapping (canvasId, path) -> blob. The injected JsonStatePort carries only
 * the typed immutable file-version history — it is never a competing
 * current-head table and the service keeps no local disk or SQLite backup.
 *
 * Other internal canvas writers (content/assets/sketches/videos/images)
 * share `canvas_files` concurrently: every head read re-queries the index,
 * overwrites require an explicit baseline revision, and external head changes
 * are folded into the version history instead of being silently overwritten. */

const FILES_COLLECTION = 'canvas_files';
const PAGE_LIMIT = 100;
export const CLOUD_PROJECT_FILE_MAX_BYTES = 30_000_000;
export const CLOUD_PROJECT_FILE_HISTORY_MAX_BYTES = 1024 * 1024; // JsonStatePort payload bound

const APPWRITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const VERSION_ID_RE = /^v-[a-f0-9]{32}$/u;
const MIME_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_+\-.]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_+\-.]{0,127}(;[ \t]*[A-Za-z0-9_.+-]+=[A-Za-z0-9_.:/+\-]+)*$/u;
const CONTRACT_KINDS: ReadonlySet<ProjectFileKind> = new Set([
  'html', 'image', 'video', 'audio', 'sketch', 'text', 'code',
  'pdf', 'document', 'presentation', 'spreadsheet', 'binary',
]);
const HISTORY_VERSION = 1;
const HISTORY_ENTRY_FIELDS = new Set(['id', 'fileId', 'sha256', 'size', 'mime', 'createdAt', 'source', 'parentVersionId', 'label', 'prompt', 'promptSource']);
const VERSION_SOURCES: ReadonlySet<string> = new Set(['ai', 'manual', 'restore']);
const VERSION_PROMPT_SOURCES: ReadonlySet<string> = new Set(['message', 'project', 'manual', 'restore']);
const VERSION_OPTION_FIELDS = new Set(['expectedRevision', 'label', 'prompt', 'source', 'promptSource', 'parentVersionId']);
const VERSION_LABEL_MAX_CHARS = 200;
const VERSION_PROMPT_MAX_CHARS = 4096;

const qOrderAsc = (attribute: string) => JSON.stringify({ method: 'orderAsc', attribute });
const qCursorAfter = (id: string) => JSON.stringify({ method: 'cursorAfter', values: [id] });
const sha256hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

const corrupt = (why: string): never => {
  throw new CanvasStateError(503, 'CANVAS_FILES_CORRUPT', `cloud project files index is corrupt: ${why}`);
};
const unavailable = (why: string): never => {
  throw new CanvasStateError(503, 'CANVAS_FILES_UNAVAILABLE', `cloud project files unavailable: ${why}`);
};

export interface CloudProjectFileVersion {
  id: string;
  fileId: string;
  sha256: string;
  size: number;
  mime: string;
  createdAt: string;
  source: ProjectFileVersionSource;
  /** Requested checkpoint label; absent means the positional default. */
  label?: string;
  prompt?: string;
  promptSource?: ProjectFileVersionPromptSource;
  parentVersionId?: string;
}

export interface CloudProjectFileRead {
  buffer: Buffer;
  file: ProjectFile;
  /** Baseline token for optimistic concurrency: the canonical row's sha256. */
  revision: string;
}

export interface CloudProjectFileVersionRead {
  buffer: Buffer;
  file: ProjectFile;
  version: CloudProjectFileVersion;
}

export interface CloudProjectFileWriteOptions {
  /** Required when the canonical row already exists (else 428); a stale
   * baseline fails 409 and a baseline on a missing row fails 409. */
  expectedRevision?: string;
  /** Fail 409 when the canonical row already exists. */
  createOnly?: boolean;
}

export interface CloudProjectFileBaselineOptions {
  expectedRevision?: string;
}

/** Manual checkpoint request for createVersion: whitelisted, bounded and
 * validated before any state write; unknown fields are rejected, never
 * silently adopted. */
export interface CloudProjectFileCreateVersionOptions extends CloudProjectFileBaselineOptions {
  label?: string | null;
  prompt?: string | null;
  source?: ProjectFileVersionSource;
  promptSource?: ProjectFileVersionPromptSource;
  parentVersionId?: string;
}

interface CanvasFileRow {
  $id: string;
  canvasId: string;
  path: string;
  fileId: string;
  kind: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

interface HistoryDocument {
  version: number;
  projectId: string;
  entries: Record<string, { versions: CloudProjectFileVersion[] }>;
}

/** Map the stored kind column onto the real ProjectFileKind contract.
 * `file` is what older asset writers recorded; unknown values are rejected. */
function contractKind(raw: string): ProjectFileKind {
  if ((CONTRACT_KINDS as ReadonlySet<string>).has(raw)) return raw as ProjectFileKind;
  if (raw === 'file') return 'binary';
  return corrupt(`unsupported file kind ${JSON.stringify(raw)}`);
}

/** Kind for rows this service writes, derived from mime + path so the index
 * stays consistent with the extension-based classification used elsewhere. */
function kindFor(path: string, mime: string): ProjectFileKind {
  if (path.endsWith('.sketch.json')) return 'sketch';
  const base = mime.split(';')[0]!.trim().toLowerCase();
  if (base === 'text/html') return 'html';
  if (base === 'image/svg+xml') return 'sketch';
  if (base.startsWith('image/')) return 'image';
  if (base.startsWith('video/')) return 'video';
  if (base.startsWith('audio/')) return 'audio';
  if (base === 'application/pdf') return 'pdf';
  if (base.startsWith('text/')) return 'text';
  if (base === 'application/json' || /(?:javascript|typescript|xml|yaml|x-sh|\+json|\+xml)$/u.test(base)) return 'code';
  if (base.includes('wordprocessingml')) return 'document';
  if (base.includes('presentationml')) return 'presentation';
  if (base.includes('spreadsheetml')) return 'spreadsheet';
  return 'binary';
}

export class CloudProjectFiles {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly client: AppwriteClient,
    private readonly databaseId: string,
    private readonly bucketId: string,
    private readonly state: JsonStatePort,
  ) {}

  private docsPath(): string {
    return this.client.docsPath(this.databaseId, FILES_COLLECTION);
  }

  private downloadPath(fileId: string): string {
    return `/storage/buckets/${enc(this.bucketId)}/files/${enc(fileId)}/download`;
  }

  private historySlot(projectId: string): string {
    return `file-versions:${sha256hex(projectId)}`;
  }

  private lockKey(projectId: string, path: string): string {
    return `${projectId}\0${path}`;
  }

  /** Serialized per project/path queue; rename locks both paths in sorted
   * order so concurrent writers cannot interleave or deadlock. */
  private async serialized<T>(projectId: string, paths: string[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths.map((path) => this.lockKey(projectId, path)))].sort();
    const acquire = (index: number): Promise<T> => {
      const key = keys[index];
      if (key === undefined) return fn();
      return this.withKey(key, () => acquire(index + 1));
    };
    return acquire(0);
  }

  private async withKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.then(() => current, () => current);
    this.locks.set(key, chained);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  private checkProjectId(projectId: string): string {
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'project id required');
    }
    return projectId;
  }

  private checkMime(mime: string): string {
    if (typeof mime !== 'string' || !MIME_RE.test(mime)) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'unsafe or malformed mime type');
    }
    return mime;
  }

  /** Strict row validation: malformed structure fails 503 CORRUPT; a row that
   * is structurally fine but lacks the integrity metadata needed to verify
   * bytes (legacy/foreign row) fails 503 UNAVAILABLE — never fabricated. */
  private parseIndexRow(raw: unknown): CanvasFileRow {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return corrupt('index row is not an object');
    const record = raw as Record<string, unknown>;
    if (typeof record.$id !== 'string' || !APPWRITE_ID_RE.test(record.$id)) return corrupt('index row has an invalid $id');
    if (typeof record.canvasId !== 'string' || record.canvasId.length === 0) return corrupt('index row is missing canvasId');
    if (typeof record.path !== 'string') return corrupt('index row is missing path');
    let relative: string;
    try {
      relative = normalizeSafeProjectFilePath(record.path);
    } catch {
      return corrupt(`index row path is unsafe: ${JSON.stringify(record.path)}`);
    }
    if (relative !== record.path) return corrupt(`index row path is not normalized: ${JSON.stringify(record.path)}`);
    if (typeof record.kind !== 'string' || record.kind.length === 0) return corrupt('index row is missing kind');
    contractKind(record.kind);
    if (typeof record.mime !== 'string' || !MIME_RE.test(record.mime)) return corrupt('index row mime is malformed');
    if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) return corrupt('index row createdAt is invalid');
    // Integrity metadata is required to ever verify this row's bytes. Rows
    // predating the hash columns are explicitly unavailable, not guessed.
    if (record.fileId === undefined || record.fileId === '' || record.sha256 === undefined || record.sha256 === '' || record.size === undefined) {
      return unavailable('index row lacks required integrity metadata (fileId/sha256/size)');
    }
    if (typeof record.fileId !== 'string' || !APPWRITE_ID_RE.test(record.fileId)) return corrupt('index row fileId is invalid');
    if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) return corrupt('index row sha256 is invalid');
    if (typeof record.size !== 'number' || !Number.isSafeInteger(record.size) || record.size < 0) return corrupt('index row size is invalid');
    return {
      $id: record.$id,
      canvasId: record.canvasId,
      path: record.path,
      fileId: record.fileId,
      kind: record.kind,
      mime: record.mime,
      size: record.size,
      sha256: record.sha256,
      createdAt: record.createdAt,
    };
  }

  private projectFile(row: CanvasFileRow): ProjectFile {
    return {
      name: row.path,
      path: row.path,
      type: 'file',
      size: row.size,
      mtime: Date.parse(row.createdAt),
      kind: row.kind==='document'&&row.mime.split(';')[0]!.trim().toLowerCase()==='text/html'?'html':contractKind(row.kind),
      mime: row.mime,
    };
  }

  /** Exact (canvasId, path) lookup of the canonical head row; the unique
   * index forbids duplicates, so a second row means index corruption. */
  private async headRow(projectId: string, relative: string): Promise<CanvasFileRow | null> {
    const q = AppwriteClient.query([AppwriteClient.eq('canvasId', projectId), AppwriteClient.eq('path', relative), AppwriteClient.limit(2)]);
    const page = await this.client.call<{ documents?: unknown }>('GET', `${this.docsPath()}?${q}`);
    if (!page || !Array.isArray(page.documents)) return corrupt('index lookup returned a malformed page');
    if (page.documents.length > 1) return corrupt(`duplicate index rows for ${JSON.stringify(relative)}`);
    const row = page.documents[0];
    if (row === undefined) return null;
    const parsed=this.parseIndexRow(row);
    if(parsed.canvasId!==projectId||parsed.path!==relative)return corrupt('head lookup escaped its exact project/path scope');
    return parsed;
  }

  private async downloadVerified(fileId: string, size: number, sha256: string, label: string): Promise<Buffer> {
    const buffer = Buffer.from(await this.client.download(this.downloadPath(fileId)));
    if (buffer.byteLength !== size || sha256hex(buffer) !== sha256) {
      throw new CanvasStateError(503, 'CANVAS_FILES_CORRUPT', `${label} failed size/sha256 verification`);
    }
    return buffer;
  }

  private async listRows(projectId: string): Promise<CanvasFileRow[]> {
    this.checkProjectId(projectId);
    const files: CanvasFileRow[] = [];
    const seen = new Set<string>();
    const paths = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const queries = [AppwriteClient.eq('canvasId', projectId), qOrderAsc('$id'), AppwriteClient.limit(PAGE_LIMIT)];
      if (cursor !== null) queries.push(qCursorAfter(cursor));
      const page = await this.client.call<{ documents?: unknown }>('GET', `${this.docsPath()}?${AppwriteClient.query(queries)}`);
      if (!page || !Array.isArray(page.documents)) return corrupt('list page is not a documents array');
      const docs = page.documents;
      if (docs.length > PAGE_LIMIT) return corrupt('list page exceeds the requested limit');
      if (docs.length === 0) break;
      for (const raw of docs) {
        const row = this.parseIndexRow(raw);
        if (row.canvasId !== projectId) return corrupt('list page contains a row for a different canvas');
        if (cursor !== null && row.$id <= cursor) return corrupt('list pagination did not advance');
        if (seen.has(row.$id)) return corrupt('list page contains a duplicate row id');
        if (paths.has(row.path)) return corrupt('list contains duplicate canonical paths');
        seen.add(row.$id);
        paths.add(row.path);
        files.push(row);
        cursor = row.$id;
      }
      if (docs.length < PAGE_LIMIT) break;
    }
    return files;
  }

  async list(projectId: string): Promise<ProjectFile[]> {
    return (await this.listRows(projectId)).map(row=>this.projectFile(row));
  }

  /** Verified index metadata only: never downloads file bodies. */
  async listHeads(projectId:string):Promise<Array<{file:ProjectFile;revision:string}>> {
    return (await this.listRows(projectId)).map(row=>({file:this.projectFile(row),revision:row.sha256}));
  }

  async read(projectId: string, path: string): Promise<CloudProjectFileRead | null> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    const row = await this.headRow(projectId, relative);
    if (!row) return null;
    if (row.canvasId !== projectId) return corrupt('index row canvasId mismatch');
    const buffer = await this.downloadVerified(row.fileId, row.size, row.sha256, `cloud project file ${JSON.stringify(relative)}`);
    return { buffer, file: this.projectFile(row), revision: row.sha256 };
  }

  async write(projectId: string, path: string, bytes: Uint8Array, mime: string, options: CloudProjectFileWriteOptions = {}): Promise<ProjectFile> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    return this.serialized(projectId, [relative], () => this.writeUnlocked(projectId, relative, bytes, mime, options, 'manual', undefined));
  }

  /** Inner write used by restore: caller already holds the path lock. */
  private async writeUnlocked(
    projectId: string,
    relative: string,
    bytes: Uint8Array,
    mime: string,
    options: CloudProjectFileWriteOptions,
    source: 'manual' | 'restore',
    restoreFromVersionId: string | undefined,
  ): Promise<ProjectFile> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > CLOUD_PROJECT_FILE_MAX_BYTES) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'file content must not exceed 30 MB');
    }
    mime = this.checkMime(mime);
    const sha256 = sha256hex(bytes);
    const size = bytes.byteLength;
    const blobId = `pfv-${sha256hex(JSON.stringify([projectId, relative, sha256, mime])).slice(0, 32)}`;
    const createdAt = new Date().toISOString();
    const kind = kindFor(relative, mime);

    const existing = await this.headRow(projectId, relative);
    if (options.createOnly && existing) {
      throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file already exists');
    }
    if (existing) {
      if (options.expectedRevision === undefined) {
        throw new CanvasStateError(428, 'CANVAS_PRECONDITION_REQUIRED', 'overwrite requires the expectedRevision baseline');
      }
      if (options.expectedRevision !== existing.sha256) {
        throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed since the baseline was read');
      }
    } else if (options.expectedRevision !== undefined) {
      throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'baseline refers to a file head that does not exist');
    }

    // Immutable blob: id derives from the exact scope/path/content/mime tuple.
    // A 409 means the identical tuple was uploaded before — the deterministic
    // id guarantees the stored object must be byte-identical, so verify it.
    try {
      await this.client.upload(this.bucketId, blobId, relative.split('/').pop() ?? 'file', bytes, mime);
    } catch (error) {
      if (!(error instanceof CanvasStateError && error.status === 409)) throw error;
      await this.downloadVerified(blobId, size, sha256, `existing cloud blob ${blobId}`);
    }

    // Version metadata is durable BEFORE the canonical head moves. The index
    // row remains the only current-head source of truth; the history slot may
    // therefore record an uploaded candidate whose head update later failed.
    const doc = this.loadHistory(projectId);
    const priorHeadId = existing ? this.recordHeadVersion(doc, relative, existing) : undefined;
    this.appendCandidate(doc, relative, {
      id: this.freshVersionId(doc),
      fileId: blobId,
      sha256,
      size,
      mime,
      createdAt,
      source,
      ...(restoreFromVersionId !== undefined ? { parentVersionId: restoreFromVersionId } : priorHeadId !== undefined ? { parentVersionId: priorHeadId } : {}),
    });
    this.saveHistory(projectId, doc);
    await this.state.flush();

    const data = { canvasId: projectId, path: relative, fileId: blobId, kind, mime, size, sha256, createdAt };
    if (existing) {
      try {
        await this.client.call('PATCH', `${this.docsPath()}/${enc(existing.$id)}`, { data });
      } catch (error) {
        if (error instanceof CanvasStateError && error.status === 404) {
          throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed during write');
        }
        throw error;
      }
    } else {
      const documentId = `pf-${sha256hex(`${projectId}\0${relative}`).slice(0, 30)}`;
      try {
        // Bucket file permissions come from the bucket; collection rows get
        // an explicit empty permission list like every other app write.
        await this.client.call('POST', this.docsPath(), { documentId, data, permissions: [] });
      } catch (error) {
        if (!(error instanceof CanvasStateError && error.status === 409)) throw error;
        const winner = await this.headRow(projectId, relative);
        if (winner) throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'a concurrent writer created this file head');
        return corrupt('index create conflicted but no row exists');
      }
    }
    return this.projectFile({ $id: existing?.$id ?? `pf-${sha256hex(`${projectId}\0${relative}`).slice(0, 30)}`, ...data });
  }

  /** Record the canonical head as an immutable version when it is not already
   * in history (e.g. written by another internal writer). Id is derived from
   * the content tuple so re-recording is naturally idempotent. */
  private recordHeadVersion(doc: HistoryDocument, relative: string, row: CanvasFileRow): string {
    const entry = (doc.entries[relative] ??= { versions: [] });
    const known = entry.versions.find((version) => version.fileId === row.fileId && version.sha256 === row.sha256 && version.size === row.size);
    if (known) return known.id;
    const id = `v-${sha256hex(JSON.stringify([relative, row.fileId, row.sha256, row.size, row.mime])).slice(0, 32)}`;
    if (entry.versions.some((version) => version.id === id)) return id;
    entry.versions.push({ id, fileId: row.fileId, sha256: row.sha256, size: row.size, mime: row.mime, createdAt: row.createdAt, source: 'manual' });
    return id;
  }

  private freshVersionId(doc: HistoryDocument): string {
    const taken = new Set<string>();
    for (const entry of Object.values(doc.entries)) for (const version of entry.versions) taken.add(version.id);
    for (let attempt = 0; ; attempt += 1) {
      const id = `v-${sha256hex(JSON.stringify([Date.now(), attempt])).slice(0, 32)}`;
      if (!taken.has(id)) return id;
    }
  }

  private appendCandidate(doc: HistoryDocument, relative: string, version: CloudProjectFileVersion): void {
    (doc.entries[relative] ??= { versions: [] }).versions.push(version);
  }

  /** Strictly typed immutable version metadata — known fields only, unique
   * version ids across the project, normalized paths, never credentials. */
  private loadHistory(projectId: string): HistoryDocument {
    const raw = this.state.read(this.historySlot(projectId));
    if (raw === undefined) return { version: HISTORY_VERSION, projectId, entries: Object.create(null) };
    const fail = (why: string): never => {
      throw new CanvasStateError(503, 'CANVAS_FILES_HISTORY_CORRUPT', `file-version history is corrupt: ${why}`);
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('document is not an object');
    const doc = raw as Record<string, unknown>;
    for (const key of Object.keys(doc)) if (!['version', 'projectId', 'entries'].includes(key)) return fail(`unknown field ${key}`);
    if (doc.version !== HISTORY_VERSION) return fail(`unsupported history version ${JSON.stringify(doc.version)}`);
    if (doc.projectId !== projectId) return fail('history projectId mismatch');
    if (!doc.entries || typeof doc.entries !== 'object' || Array.isArray(doc.entries)) return fail('entries is not an object');
    const ids = new Set<string>();
    const entries: Record<string, { versions: CloudProjectFileVersion[] }> = Object.create(null);
    for (const [path, rawEntry] of Object.entries(doc.entries as Record<string, unknown>)) {
      let normalized: string;
      try {
        normalized = normalizeSafeProjectFilePath(path);
      } catch {
        return fail(`history path is unsafe: ${JSON.stringify(path)}`);
      }
      if (normalized !== path) return fail(`history path is not normalized: ${JSON.stringify(path)}`);
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return fail(`history entry for ${JSON.stringify(path)} is not an object`);
      const entryRecord = rawEntry as Record<string, unknown>;
      for (const key of Object.keys(entryRecord)) if (key !== 'versions') return fail(`history entry has unknown field ${key}`);
      if (!Array.isArray(entryRecord.versions)) return fail(`history entry for ${JSON.stringify(path)} has no versions array`);
      const versions: CloudProjectFileVersion[] = [];
      for (const rawVersion of entryRecord.versions) {
        if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion)) return fail('version is not an object');
        const record = rawVersion as Record<string, unknown>;
        for (const key of Object.keys(record)) if (!HISTORY_ENTRY_FIELDS.has(key)) return fail(`version has unknown field ${key}`);
        if (typeof record.id !== 'string' || !VERSION_ID_RE.test(record.id)) return fail('version id is invalid');
        if (ids.has(record.id)) return fail(`duplicate version id ${record.id}`);
        ids.add(record.id);
        if (typeof record.fileId !== 'string' || !APPWRITE_ID_RE.test(record.fileId)) return fail('version fileId is invalid');
        if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) return fail('version sha256 is invalid');
        if (typeof record.size !== 'number' || !Number.isSafeInteger(record.size) || record.size < 0) return fail('version size is invalid');
        if (typeof record.mime !== 'string' || !MIME_RE.test(record.mime)) return fail('version mime is invalid');
        if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) return fail('version createdAt is invalid');
        if (typeof record.source !== 'string' || !VERSION_SOURCES.has(record.source)) return fail('version source is invalid');
        if (record.parentVersionId !== undefined && (typeof record.parentVersionId !== 'string' || !VERSION_ID_RE.test(record.parentVersionId))) {
          return fail('version parentVersionId is invalid');
        }
        if (record.label !== undefined && (typeof record.label !== 'string' || !record.label.trim() || record.label.length > VERSION_LABEL_MAX_CHARS)) {
          return fail('version label is invalid');
        }
        if (record.prompt !== undefined && record.prompt !== null && (typeof record.prompt !== 'string' || record.prompt.length > VERSION_PROMPT_MAX_CHARS)) {
          return fail('version prompt is invalid');
        }
        if (record.promptSource !== undefined && (typeof record.promptSource !== 'string' || !VERSION_PROMPT_SOURCES.has(record.promptSource))) {
          return fail('version promptSource is invalid');
        }
        const version: CloudProjectFileVersion = {
          id: record.id,
          fileId: record.fileId,
          sha256: record.sha256,
          size: record.size,
          mime: record.mime,
          createdAt: record.createdAt,
          source: record.source as ProjectFileVersionSource,
        };
        if (record.parentVersionId !== undefined) version.parentVersionId = record.parentVersionId as string;
        if (record.label !== undefined) version.label = record.label as string;
        if (typeof record.prompt === 'string') version.prompt = record.prompt;
        if (record.promptSource !== undefined) version.promptSource = record.promptSource as ProjectFileVersionPromptSource;
        versions.push(version);
      }
      entries[path] = { versions };
    }
    return { version: HISTORY_VERSION, projectId, entries };
  }

  /** Stage the history document through the port. The 1 MiB bound is explicit:
   * when history outgrows it the write fails closed rather than truncating. */
  private saveHistory(projectId: string, doc: HistoryDocument): void {
    if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > CLOUD_PROJECT_FILE_HISTORY_MAX_BYTES) {
      throw new CanvasStateError(413, 'CANVAS_FILES_HISTORY_LIMIT', 'file-version history exceeds the 1 MiB cloud state bound');
    }
    this.state.write(this.historySlot(projectId), doc);
  }

  private historyFor(doc: HistoryDocument, relative: string): CloudProjectFileVersion[] {
    return doc.entries[relative]?.versions ?? [];
  }

  private findVersion(doc: HistoryDocument, relative: string, versionId: string): CloudProjectFileVersion {
    const version = this.historyFor(doc, relative).find((entry) => entry.id === versionId);
    if (!version) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'file version not found');
    return version;
  }

  async versions(projectId: string, path: string): Promise<CloudProjectFileVersion[]> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    return this.serialized(projectId, [relative], async () => {
      const row = await this.headRow(projectId, relative);
      const doc = this.loadHistory(projectId);
      let changed = false;
      if (row) {
        const before = this.historyFor(doc, relative).length;
        this.recordHeadVersion(doc, relative, row);
        changed = this.historyFor(doc, relative).length !== before;
      }
      if (changed) {
        this.saveHistory(projectId, doc);
        await this.state.flush();
      }
      return this.historyFor(doc, relative).map((version) => ({ ...version }));
    });
  }

  /** Whitelist + bound every request field before any state write; unknown
   * fields fail instead of being silently adopted. promptSource inference
   * mirrors the legacy local route: an explicit prompt marks the checkpoint
   * 'manual', a manual/restore source carries its own provenance. */
  private checkCreateVersionOptions(options: CloudProjectFileCreateVersionOptions): {
    expectedRevision?: string;
    label?: string;
    prompt?: string;
    source: ProjectFileVersionSource;
    promptSource?: ProjectFileVersionPromptSource;
    parentVersionId?: string;
  } {
    const invalid = (message: string): never => {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', message);
    };
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      invalid('version options must be an object');
    }
    for (const key of Object.keys(options)) {
      if (!VERSION_OPTION_FIELDS.has(key)) invalid(`unsupported version field ${JSON.stringify(key)}`);
    }
    let expectedRevision: string | undefined;
    if (options.expectedRevision !== undefined) {
      if (typeof options.expectedRevision !== 'string' || !options.expectedRevision.trim()) {
        invalid('expectedRevision must be a non-empty revision string');
      }
      expectedRevision = options.expectedRevision.trim();
    }
    let label: string | undefined;
    if (options.label !== undefined && options.label !== null) {
      if (typeof options.label !== 'string') invalid('version label must be a string');
      const trimmed = options.label.trim();
      if (trimmed.length > VERSION_LABEL_MAX_CHARS) invalid(`version label exceeds the ${VERSION_LABEL_MAX_CHARS} character bound`);
      if (trimmed) label = trimmed;
    }
    let prompt: string | undefined;
    if (options.prompt !== undefined && options.prompt !== null) {
      if (typeof options.prompt !== 'string') invalid('version prompt must be a string');
      const trimmed = options.prompt.trim();
      if (trimmed.length > VERSION_PROMPT_MAX_CHARS) invalid(`version prompt exceeds the ${VERSION_PROMPT_MAX_CHARS} character bound`);
      if (trimmed) prompt = trimmed;
    }
    let source: ProjectFileVersionSource = 'manual';
    if (options.source !== undefined) {
      if (typeof options.source !== 'string' || !VERSION_SOURCES.has(options.source)) invalid('invalid source; expected one of: ai, manual, restore');
      source = options.source as ProjectFileVersionSource;
    }
    let promptSource: ProjectFileVersionPromptSource | undefined;
    if (options.promptSource !== undefined && options.promptSource !== null) {
      if (typeof options.promptSource !== 'string' || !VERSION_PROMPT_SOURCES.has(options.promptSource)) {
        invalid('invalid promptSource; expected one of: message, project, manual, restore');
      }
      promptSource = options.promptSource as ProjectFileVersionPromptSource;
    }
    let parentVersionId: string | undefined;
    if (options.parentVersionId !== undefined && options.parentVersionId !== null) {
      if (typeof options.parentVersionId !== 'string' || !VERSION_ID_RE.test(options.parentVersionId)) invalid('invalid file version id');
      parentVersionId = options.parentVersionId;
    }
    promptSource ??= prompt !== undefined ? 'manual' : source === 'manual' ? 'manual' : source === 'restore' ? 'restore' : undefined;
    return {
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      source,
      ...(promptSource !== undefined ? { promptSource } : {}),
      ...(parentVersionId !== undefined ? { parentVersionId } : {}),
    };
  }

  /** Explicit checkpoint of the CURRENT verified head bytes — the cloud
   * equivalent of the legacy POST /files/:path/versions snapshot. No bytes
   * are overwritten and no head table exists here: a typed history entry is
   * appended referencing the same immutable fileId/sha256, carrying the
   * requested label/prompt/provenance. A provided parent must already exist
   * in THIS path's history; expectedRevision is an optional baseline that
   * fails 409 on drift but is not required because nothing is overwritten. */
  async createVersion(projectId: string, path: string, options: CloudProjectFileCreateVersionOptions = {}): Promise<CloudProjectFileVersion> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    const request = this.checkCreateVersionOptions(options);
    return this.serialized(projectId, [relative], async () => {
      const row = await this.headRow(projectId, relative);
      if (!row) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'file not found');
      if (row.canvasId !== projectId) return corrupt('index row canvasId mismatch');
      if (!/\.html?$/iu.test(relative)) {
        throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'versions are only available for HTML files');
      }
      if (request.expectedRevision !== undefined && request.expectedRevision !== row.sha256) {
        throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed since the baseline was read');
      }
      // The snapshot only references blobs proven byte-intact — verify the
      // head download before history is allowed to point at it.
      await this.downloadVerified(row.fileId, row.size, row.sha256, `cloud project file ${JSON.stringify(relative)}`);
      const doc = this.loadHistory(projectId);
      if (request.parentVersionId !== undefined) this.findVersion(doc, relative, request.parentVersionId);
      const version: CloudProjectFileVersion = {
        id: this.freshVersionId(doc),
        fileId: row.fileId,
        sha256: row.sha256,
        size: row.size,
        mime: row.mime,
        createdAt: new Date().toISOString(),
        source: request.source,
        ...(request.label !== undefined ? { label: request.label } : {}),
        ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
        ...(request.promptSource !== undefined ? { promptSource: request.promptSource } : {}),
        ...(request.parentVersionId !== undefined ? { parentVersionId: request.parentVersionId } : {}),
      };
      this.appendCandidate(doc, relative, version);
      this.saveHistory(projectId, doc);
      await this.state.flush();
      return { ...version };
    });
  }

  async readVersion(projectId: string, path: string, versionId: string): Promise<CloudProjectFileVersionRead> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    if (typeof versionId !== 'string' || !VERSION_ID_RE.test(versionId)) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'invalid file version id');
    }
    const doc = this.loadHistory(projectId);
    const version = this.findVersion(doc, relative, versionId);
    const buffer = await this.downloadVerified(version.fileId, version.size, version.sha256, `cloud file version ${versionId}`);
    const file: ProjectFile = {
      name: relative,
      path: relative,
      type: 'file',
      size: version.size,
      mtime: Date.parse(version.createdAt),
      kind: kindFor(relative, version.mime),
      mime: version.mime,
    };
    return { buffer, file, version: { ...version } };
  }

  async restore(projectId: string, path: string, versionId: string, options: CloudProjectFileBaselineOptions = {}): Promise<ProjectFile> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    if (typeof versionId !== 'string' || !VERSION_ID_RE.test(versionId)) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'invalid file version id');
    }
    return this.serialized(projectId, [relative], async () => {
      const version = this.findVersion(this.loadHistory(projectId), relative, versionId);
      const bytes = await this.downloadVerified(version.fileId, version.size, version.sha256, `cloud file version ${versionId}`);
      // Inner write path: the lock is already held, so this never re-enters
      // the queue. The blob id re-derives to the old immutable object — the
      // upload-409 branch verifies it instead of re-uploading.
      return this.writeUnlocked(projectId, relative, bytes, version.mime, options, 'restore', version.id);
    });
  }

  async rename(projectId: string, from: string, to: string, options: CloudProjectFileBaselineOptions = {}): Promise<ProjectFile> {
    this.checkProjectId(projectId);
    const source = normalizeSafeProjectFilePath(from);
    const destination = normalizeSafeProjectFilePath(to);
    if (source === destination) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'rename target equals source');
    return this.serialized(projectId, [source, destination], async () => {
      const row = await this.headRow(projectId, source);
      if (!row) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'file not found');
      if (options.expectedRevision === undefined) {
        throw new CanvasStateError(428, 'CANVAS_PRECONDITION_REQUIRED', 'rename requires the expectedRevision baseline');
      }
      if (options.expectedRevision !== row.sha256) {
        throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed since the baseline was read');
      }
      if (await this.headRow(projectId, destination)) {
        throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'rename destination already exists');
      }
      // History moves under the destination key first; on an index failure
      // the source head can re-record itself on the next versions() call.
      const doc = this.loadHistory(projectId);
      const moved = doc.entries[source];
      if (moved) {
        const target = (doc.entries[destination] ??= { versions: [] });
        const known = new Set(target.versions.map((version) => version.id));
        for (const version of moved.versions) if (!known.has(version.id)) target.versions.push(version);
        delete doc.entries[source];
        this.saveHistory(projectId, doc);
        await this.state.flush();
      }
      const data = { canvasId: projectId, path: destination, fileId: row.fileId, kind: row.kind, mime: row.mime, size: row.size, sha256: row.sha256, createdAt: row.createdAt };
      try {
        await this.client.call('PATCH', `${this.docsPath()}/${enc(row.$id)}`, { data });
      } catch (error) {
        if (error instanceof CanvasStateError && error.status === 404) {
          throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed during rename');
        }
        if (error instanceof CanvasStateError && error.status === 409) {
          throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'rename destination already exists');
        }
        throw error;
      }
      return this.projectFile({ $id: row.$id, ...data });
    });
  }

  /** Deletes only the canonical index row — immutable blobs are never
   * deleted — after the head is preserved in version history. */
  async delete(projectId: string, path: string, options: CloudProjectFileBaselineOptions = {}): Promise<void> {
    this.checkProjectId(projectId);
    const relative = normalizeSafeProjectFilePath(path);
    return this.serialized(projectId, [relative], async () => {
      const row = await this.headRow(projectId, relative);
      if (!row) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'file not found');
      if (options.expectedRevision === undefined) {
        throw new CanvasStateError(428, 'CANVAS_PRECONDITION_REQUIRED', 'delete requires the expectedRevision baseline');
      }
      if (options.expectedRevision !== row.sha256) {
        throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed since the baseline was read');
      }
      const doc = this.loadHistory(projectId);
      const before = this.historyFor(doc, relative).length;
      this.recordHeadVersion(doc, relative, row);
      if (this.historyFor(doc, relative).length !== before) this.saveHistory(projectId, doc);
      await this.state.flush();
      try {
        await this.client.call('DELETE', `${this.docsPath()}/${enc(row.$id)}`);
      } catch (error) {
        if (error instanceof CanvasStateError && error.status === 404) {
          throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'file head changed during delete');
        }
        throw error;
      }
    });
  }
}
