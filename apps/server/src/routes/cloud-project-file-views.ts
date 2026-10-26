// Cloud project file views: folder metadata, search and previews served
// entirely from the cloud-authoritative file storage (canvas_files index +
// immutable bucket blobs + JsonStatePort slots). No local authority fallback:
// `dataRoot` is only the explicit disposable scratch root for preview temp
// dirs, and every route checks registry existence and authorization before
// any file detail, version or cached reply.
import { createHash,randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type {
  DeleteProjectFolderResponse,
  ProjectFileTextPreviewResponse,
  ProjectFolder,
  ProjectFolderResponse,
  ProjectFoldersResponse,
} from '@bezier/contracts';
import { CanvasStateError } from '@bezier/canvas-core';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { isProjectFileVersionPath } from '../project-file-versions.js';
import { createCanvasPreview, PREVIEW_WIDTHS, type CanvasPreviewKind } from '../media/canvas-preview.js';
import { buildDocumentPreview } from '../artifacts/document-preview.js';
import type { ProjectRegistry } from '../storage/project-registry.js';
import type { CloudProjectFiles } from '../storage/cloud-project-files.js';
import {CLOUD_PROJECT_PREVIEW_CSP,CLOUD_PROJECT_IFRAME_SANDBOX,sendCloudProjectFileBytes} from './cloud-project-files.js';

export interface CloudProjectFileViewsDeps {
  files: CloudProjectFiles;
  state: JsonStatePort;
  /** Explicit absolute scratch root for disposable preview temp dirs only. */
  dataRoot: string;
  registry: Pick<ProjectRegistry, 'get'>;
  authorize: (req: Request, res: Response, projectId: string, options: { mode: 'read' | 'write' }) => Promise<boolean>;
}

interface FolderRecord { path: string; createdAt: string }
interface FolderDocument { version: number; projectId: string; folders: FolderRecord[] }

const FOLDERS_DOC_VERSION = 1;
const MAX_SEARCH_QUERY_CHARS = 1000;
const MAX_SEARCH_SCANNED_BYTES = 256 * 1024 * 1024;
const TEXT_PREVIEW_DEFAULT_LIMIT = 96 * 1024;
const TEXT_PREVIEW_MIN_LIMIT = 1024;
const TEXT_PREVIEW_MAX_LIMIT = 512 * 1024;

const folderSlot = (projectId: string) => `file-folders:${createHash('sha256').update(projectId).digest('hex')}`;

function sendApiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Stable sanitized error surface: our coded errors pass through (messages
 * are authored, never credentials), document-preview statusCodes map to fixed
 * codes, and everything else collapses to a generic 502 — no raw upstream
 * strings on the wire. */
function sendViewError(res: Response, error: unknown) {
  const shaped = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (typeof shaped?.status === 'number' && typeof shaped.code === 'string') {
    return sendApiError(res, shaped.status, shaped.code, typeof shaped.message === 'string' ? shaped.message : 'request failed');
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    const code = statusCode === 404 ? 'FILE_NOT_FOUND'
      : statusCode === 413 ? 'PREVIEW_TOO_LARGE'
        : statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE'
          : 'PREVIEW_UNAVAILABLE';
    return sendApiError(res, statusCode, code, error instanceof Error ? error.message : 'preview unavailable');
  }
  return sendApiError(res, 502, 'CLOUD_VIEWS_UNAVAILABLE', 'cloud file views are unavailable');
}

/** Visible project-relative path: normalized, never a traversal, never a
 * hidden dot segment, never internal version storage. */
function visiblePath(value: unknown): string {
  const relative = normalizeSafeProjectFilePath(String(value ?? ''));
  if (relative.split('/').some((segment) => segment.startsWith('.'))) {
    throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'hidden path segments are not allowed');
  }
  return relative;
}

function visibleOrNull(value: unknown): string | null {
  try {
    const relative = visiblePath(value);
    return isProjectFileVersionPath(relative) ? null : relative;
  } catch {
    return null;
  }
}

const isTextualMime = (mime: string) =>
  /^text\//i.test(mime)
  || /^application\/(json|javascript|typescript|xml|x-(?:yaml|toml|httpd-php|sh))\b/i.test(mime)
  || /\+(?:json|xml)\b/i.test(mime)
  || /^image\/svg\+xml/i.test(mime);

const escapeRegex = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Same `*`→`.*` full-path glob semantics the original search used — `*.txt`
 * matches files in nested directories. Pure function, never user regex. */
const globMatch = (relative: string, pattern: string) => {
  // Only '*' is special, as in the legacy matcher. Avoid exponential
  // backtracking from a tenant-supplied sequence of wildcard fragments.
  let text=0,part=0,star=-1,restart=0;
  while(text<relative.length){
    if(part<pattern.length&&pattern[part]!=='*'&&pattern[part]===relative[text]){part++;text++;}
    else if(pattern[part]==='*'){star=part++;restart=text;}
    else if(star>=0){part=star+1;text=++restart;}
    else return false;
  }
  while(pattern[part]==='*')part++;
  return part===pattern.length;
};

/** Strictly validated folder metadata document — known fields only, unique
 * normalized paths, bound to the requested project. */
function parseFolderDocument(raw: unknown, projectId: string): FolderDocument {
  const fail = (why: string): never => {
    throw new CanvasStateError(503, 'CLOUD_FOLDERS_CORRUPT', `cloud folder metadata is corrupt: ${why}`);
  };
  if (raw === undefined) return { version: FOLDERS_DOC_VERSION, projectId, folders: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('document is not an object');
  const doc = raw as Record<string, unknown>;
  for (const key of Object.keys(doc)) if (!['version', 'projectId', 'folders'].includes(key)) return fail(`unknown field ${key}`);
  if (doc.version !== FOLDERS_DOC_VERSION) return fail(`unsupported version ${JSON.stringify(doc.version)}`);
  if (doc.projectId !== projectId) return fail('projectId mismatch');
  if (!Array.isArray(doc.folders)) return fail('folders is not an array');
  const seen = new Set<string>();
  const folders: FolderRecord[] = [];
  for (const rawFolder of doc.folders) {
    if (!rawFolder || typeof rawFolder !== 'object' || Array.isArray(rawFolder)) return fail('folder entry is not an object');
    const record = rawFolder as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!['path', 'createdAt'].includes(key)) return fail(`folder has unknown field ${key}`);
    if (typeof record.path !== 'string') return fail('folder path is not a string');
    let normalized: string;
    try {
      normalized = normalizeSafeProjectFilePath(record.path);
    } catch {
      return fail(`folder path is unsafe: ${JSON.stringify(record.path)}`);
    }
    if (normalized !== record.path) return fail(`folder path is not normalized: ${JSON.stringify(record.path)}`);
    if (seen.has(record.path)) return fail(`duplicate folder path ${JSON.stringify(record.path)}`);
    seen.add(record.path);
    if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) return fail('folder createdAt is invalid');
    folders.push({ path: record.path, createdAt: record.createdAt });
  }
  return { version: FOLDERS_DOC_VERSION, projectId, folders };
}

/** Folder set = durable explicit records ∪ parents implied by file paths and
 * by explicit folders themselves. Visibility filtering is caller's job. */
function implicitParents(paths: string[]): Set<string> {
  const parents = new Set<string>();
  for (const rel of paths) {
    const segments = rel.split('/');
    let dir = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      dir = dir ? `${dir}/${segments[i]}` : segments[i]!;
      parents.add(dir);
    }
  }
  return parents;
}

function htmlPoweredPreviewHint(mime: string, bytes: Buffer): ProjectFileTextPreviewResponse['poweredPreview'] {
  if (!/^text\/html(?:;|$)/i.test(mime)) return { required: false, scannedBytes: 0, complete: true };
  const source = bytes.toString('utf8');
  const required = /\bSharedArrayBuffer\b|\bnew\s+(?:Worker|SharedWorker)\s*\(|\bimportScripts\s*\(|WebAssembly\s*\.\s*(?:instantiateStreaming|compileStreaming)\b|\.wasm\b|getContext\s*\(\s*["'`]webgl2["'`]|\bOffscreenCanvas\b|\bnavigator\s*\.\s*gpu\b/.test(source);
  return { required, scannedBytes: bytes.byteLength, complete: true };
}

function requestIsFresh(req: Request, etag: string): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  return typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((tag) => tag.trim() === etag);
}

export function registerCloudProjectFileViews(app: Express, deps: CloudProjectFileViewsDeps): void {
  if (!deps || typeof deps !== 'object') throw new Error('cloud project file views dependencies are required');
  if (!deps.files || !deps.state || !deps.registry || typeof deps.authorize !== 'function') {
    throw new Error('cloud project file views require files, state, registry and authorize');
  }
  if (typeof deps.dataRoot !== 'string' || !path.isAbsolute(deps.dataRoot)) {
    throw new Error('cloud project file views require an explicit absolute dataRoot');
  }
  const dataRoot = path.resolve(deps.dataRoot);
  const folderLocks = new Map<string, Promise<void>>();
  const previewScopes=new Map<string,{projectId:string;expiresAt:number}>();

  const serializedFolderMutation = <T>(projectId: string, fn: () => Promise<T>): Promise<T> => {
    const key = `folders\0${projectId}`;
    const previous = folderLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.then(() => current, () => current);
    folderLocks.set(key, chained);
    return previous.catch(() => undefined).then(async () => {
      try {
        return await fn();
      } finally {
        release();
        if (folderLocks.get(key) === chained) folderLocks.delete(key);
      }
    });
  };

  /** Registry existence then authorization, before any file detail, version
   * or cached reply. */
  const gate = async (req: Request, res: Response, projectId: string, mode: 'read' | 'write'): Promise<boolean> => {
    if (!deps.registry.get(projectId)) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return false;
    }
    const allowed = await deps.authorize(req, res, projectId, { mode });
    if (!allowed && !res.headersSent) sendApiError(res, 403, 'FORBIDDEN', 'project access denied');
    return allowed;
  };

  const loadFolderDocument = (projectId: string): FolderDocument =>
    parseFolderDocument(deps.state.read(folderSlot(projectId)), projectId);

  const persistFolderDocument = async (projectId: string, doc: FolderDocument): Promise<void> => {
    deps.state.write(folderSlot(projectId), doc);
    await deps.state.flush();
  };

  /** All folders that exist logically for non-emptiness checks — explicit
   * records plus parents implied by every file path (visible or not). */
  const fullFolderSet = (projectId: string, files: { path?: string; name: string }[], doc: FolderDocument): Set<string> => {
    const set = new Set<string>(doc.folders.map((folder) => folder.path));
    for (const parent of implicitParents(doc.folders.map((folder) => folder.path))) set.add(parent);
    for (const file of files) {
      const rel = typeof file.path === 'string' ? file.path : file.name;
      for (const parent of implicitParents([rel])) set.add(parent);
    }
    void projectId;
    return set;
  };

  const folderDto = (relative: string, mtime: number): ProjectFolder => ({
    name: relative,
    path: relative,
    type: 'dir',
    size: 0,
    mtime,
  });

  app.get('/api/projects/:id/folders', async (req, res) => {
    try {
      if (!await gate(req, res, req.params.id, 'read')) return;
      const doc = loadFolderDocument(req.params.id);
      const files = await deps.files.list(req.params.id);
      const visible = new Map<string, number>();
      for (const folder of doc.folders) visible.set(folder.path, Date.parse(folder.createdAt));
      const fileMtimes = new Map<string, number>();
      for (const file of files) {
        const rel = visibleOrNull(file.path ?? file.name);
        if (rel === null) continue;
        for (const parent of implicitParents([rel])) {
          fileMtimes.set(parent, Math.max(fileMtimes.get(parent) ?? 0, file.mtime));
        }
      }
      for (const parent of implicitParents(doc.folders.map((folder) => folder.path))) {
        if (!visible.has(parent)) fileMtimes.set(parent, Math.max(fileMtimes.get(parent) ?? 0, 0));
      }
      const folders = [
        ...[...visible.entries()].map(([relative, mtime]) => folderDto(relative, mtime)),
        ...[...fileMtimes.entries()].filter(([relative]) => !visible.has(relative)).map(([relative, mtime]) => folderDto(relative, mtime)),
      ].sort((a, b) => a.name.localeCompare(b.name));
      const body: ProjectFoldersResponse = { folders };
      res.json(body);
    } catch (error) {
      sendViewError(res, error);
    }
  });

  app.post('/api/projects/:id/folders', async (req, res) => {
    try {
      if (!await gate(req, res, req.params.id, 'write')) return;
      const name = req.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      const relative = visiblePath(name);
      if (isProjectFileVersionPath(relative)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid folder name');
      }
      const created = await serializedFolderMutation(req.params.id, async () => {
        const doc = loadFolderDocument(req.params.id);
        const files = await deps.files.list(req.params.id);
        if (fullFolderSet(req.params.id, files, doc).has(relative)) {
          throw new CanvasStateError(409, 'FOLDER_CONFLICT', 'folder already exists');
        }
        const createdAt = new Date().toISOString();
        // Parent folders come into existence logically with the child.
        for (const target of [...implicitParents([relative]), relative].sort()) {
          if (!doc.folders.some((folder) => folder.path === target)) doc.folders.push({ path: target, createdAt });
        }
        await persistFolderDocument(req.params.id, doc);
        return folderDto(relative, Date.parse(createdAt));
      });
      const body: ProjectFolderResponse = { folder: created };
      res.json(body);
    } catch (error) {
      sendViewError(res, error);
    }
  });

  /** Deletes only EMPTY folders: refuses when a cloud file or nested folder
   * lives below — an intentional boundary that never recursively deletes
   * unversioned cloud assets. No blob or index rows are touched. */
  app.delete('/api/projects/:id/folders', async (req, res) => {
    try {
      if (!await gate(req, res, req.params.id, 'write')) return;
      const folderPath = req.body?.path;
      if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'path required');
      }
      const relative = visiblePath(folderPath);
      await serializedFolderMutation(req.params.id, async () => {
        const doc = loadFolderDocument(req.params.id);
        const files = await deps.files.list(req.params.id);
        if (!fullFolderSet(req.params.id, files, doc).has(relative)) {
          throw new CanvasStateError(404, 'FOLDER_NOT_FOUND', 'folder not found');
        }
        const prefix = `${relative}/`;
        if (files.some((file) => (file.path ?? file.name).startsWith(prefix))
          || [...fullFolderSet(req.params.id, files, doc)].some((folder) => folder !== relative && folder.startsWith(prefix))) {
          throw new CanvasStateError(409, 'FOLDER_NOT_EMPTY', 'folder is not empty');
        }
        doc.folders = doc.folders.filter((folder) => folder.path !== relative);
        await persistFolderDocument(req.params.id, doc);
      });
      const body: DeleteProjectFolderResponse = { ok: true };
      res.json(body);
    } catch (error) {
      sendViewError(res, error);
    }
  });

  /** Cloud-authoritative text search: only textual-mime files, glob pattern
   * prefilter, explicit 256 MiB scanned-byte bound (413, never silent
   * truncation). Read-only — no history or metadata writes. */
  app.get('/api/projects/:id/search', async (req, res) => {
    try {
      if (!await gate(req, res, req.params.id, 'read')) return;
      const query = String(req.query.q ?? '');
      if (!query || query.length > MAX_SEARCH_QUERY_CHARS) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'q query parameter is required (max 1000 chars)');
      }
      const pattern = req.query.pattern !== undefined ? String(req.query.pattern) : null;
      if(pattern!==null&&pattern.length>1000)throw new CanvasStateError(400,'BAD_REQUEST','pattern must not exceed 1000 characters');
      const max = Math.min(Number(req.query.max) || 200, 1000);
      const matcher = new RegExp(escapeRegex(query), 'i');
      const files = (await deps.files.list(req.params.id))
        .filter((file) => isTextualMime(file.mime)
          && visibleOrNull(file.path ?? file.name) !== null
          && (pattern === null || globMatch(file.path ?? file.name, pattern)));
      const matches: { file: string; line: number; snippet: string }[] = [];
      let scanned = 0;
      for (const file of files) {
        if (matches.length >= max) break;
        scanned += file.size;
        if (scanned > MAX_SEARCH_SCANNED_BYTES) {
          return sendApiError(res, 413, 'SEARCH_TOO_LARGE', 'search exceeds the 256 MiB cloud scan bound');
        }
        const read = await deps.files.read(req.params.id, file.path ?? file.name);
        if (!read) continue;
        const lines = read.buffer.toString('utf8').split('\n');
        for (let index = 0; index < lines.length && matches.length < max; index += 1) {
          const line = lines[index]!;
          if (matcher.test(line)) {
            matches.push({ file: file.path ?? file.name, line: index + 1, snippet: line.length > 220 ? `${line.slice(0, 220)}…` : line });
          }
        }
      }
      res.json({ query, matches });
    } catch (error) {
      sendViewError(res, error);
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/text-preview\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const rawPath = String(params[1] ?? '');
      if (!await gate(req, res, projectId, 'read')) return;
      if (isProjectFileVersionPath(rawPath)) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      }
      const relative = visiblePath(rawPath);
      const requested = Number(req.query.limit);
      const limit = Math.max(
        TEXT_PREVIEW_MIN_LIMIT,
        Math.min(Number.isFinite(requested) ? Math.floor(requested) : TEXT_PREVIEW_DEFAULT_LIMIT, TEXT_PREVIEW_MAX_LIMIT),
      );
      const read = await deps.files.read(projectId, relative);
      if (!read) return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      const bytes = Math.min(read.file.size, limit);
      const body: ProjectFileTextPreviewResponse = {
        text: read.buffer.subarray(0, bytes).toString('utf8'),
        truncated: read.file.size > bytes,
        size: read.file.size,
        limit,
        mime: read.file.mime,
        kind: read.file.kind,
        poweredPreview: htmlPoweredPreviewHint(read.file.mime, read.buffer),
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (error) {
      sendViewError(res, error);
    }
  });

  /** Structured Office/PDF document preview via the existing bounded helper.
   * A missing native PDF binary (or any extraction failure) is an explicit
   * 503 — never an empty success. */
  app.get('/api/projects/:id/files/:name/preview', async (req, res) => {
    try {
      if (!await gate(req, res, req.params.id, 'read')) return;
      const relative = visiblePath(req.params.name);
      const read = await deps.files.read(req.params.id, relative);
      if (!read) return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      const preview = await buildDocumentPreview({ name: relative, buffer: read.buffer }, dataRoot);
      if (preview.kind === 'pdf' && preview.sections.every((section) => section.notice === 'pdf-unavailable')) {
        return sendApiError(res, 503, 'PREVIEW_UNAVAILABLE', 'PDF preview is unavailable on this deployment');
      }
      res.json(preview);
    } catch (error) {
      sendViewError(res, error);
    }
  });

  /** Image/poster/video derivatives through the existing preview helper:
   * the single cloud buffer lands in an ephemeral per-request temp dir under
   * the explicit dataRoot and is unlinked in finally — original bytes remain
   * cloud-authoritative. ETag derives from content hash/kind/width; 304s are
   * still evaluated only after authorization. */
  app.get(/^\/api\/projects\/([^/]+)\/preview\/(image|poster|video)\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const kind = String(params[1] ?? '') as CanvasPreviewKind;
      const rawPath = String(params[2] ?? '');
      if (!await gate(req, res, projectId, 'read')) return;
      const relative = visiblePath(rawPath);
      const widthParam = req.query.odPreviewWidth ?? req.query.width;
      const width = Number(widthParam ?? (kind === 'video' ? 512 : 256));
      if (!PREVIEW_WIDTHS.some((value) => value === width) || (kind !== 'image' && width > 512)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid canvas preview options');
      }
      const read = await deps.files.read(projectId, relative);
      if (!read) return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      if (kind === 'image' ? !read.file.mime.startsWith('image/') : !read.file.mime.startsWith('video/')) {
        return sendApiError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'invalid canvas preview source');
      }
      const etag = `W/"cloud-v1-${kind}-${width}-${read.revision}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      if (requestIsFresh(req, etag)) return res.status(304).end();
      await mkdir(dataRoot, { recursive: true });
      const requestRoot = await mkdtemp(path.join(dataRoot, 'cloud-preview-'));
      try {
        const source = path.join(requestRoot, 'source');
        await writeFile(source, read.buffer, { flag: 'wx' });
        const body = await createCanvasPreview({
          filePath: source,
          size: read.file.size,
          mtime: read.file.mtime,
          mime: read.file.mime,
          kind,
          width,
          runtimeDir: requestRoot,
        });
        res.setHeader('Content-Type', kind === 'image' ? 'image/webp' : kind === 'poster' ? 'image/jpeg' : 'video/mp4');
        res.status(200).send(body);
      } catch {
        res.removeHeader('ETag');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Retry-After', '30');
        sendApiError(res, 503, 'PREVIEW_UNAVAILABLE', 'preview unavailable; use original');
      } finally {
        await rm(requestRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (error) {
      sendViewError(res, error);
    }
  });

  // Scope tokens contain the preview to a project; they never replace current
  // request authorization or grant anonymous access to a private file.
  app.get(/^\/api\/projects\/([^/]+)\/preview\/(opaque-[a-f0-9-]{36})\/(.+)$/u,async(req,res)=>{
    try{
      const projectId=String(req.params[0]??''),scope=String(req.params[1]??'');
      if(!await gate(req,res,projectId,'read'))return;
      const grant=previewScopes.get(scope);
      if(!grant||grant.projectId!==projectId||grant.expiresAt<=Date.now())return sendApiError(res,404,'PREVIEW_SCOPE_NOT_FOUND','Preview scope expired; request a new preview URL');
      const relative=visiblePath(req.params[2]);
      if(isProjectFileVersionPath(relative))return sendApiError(res,404,'FILE_NOT_FOUND','file not found');
      const read=await deps.files.read(projectId,relative);if(!read)return sendApiError(res,404,'FILE_NOT_FOUND','file not found');
      sendCloudProjectFileBytes(req,res,{mime:read.file.mime,size:read.file.size,mtime:read.file.mtime,revision:read.revision},read.buffer);
    }catch(error){sendViewError(res,error);}
  });

  app.get('/api/projects/:id/preview-url', async (req, res) => {
    try {
      if (!await gate(req, res, req.params.id, 'read')) return;
      const relative=visiblePath(req.query.file);
      if(isProjectFileVersionPath(relative))return sendApiError(res,404,'FILE_NOT_FOUND','file not found');
      const read=await deps.files.read(req.params.id,relative);if(!read)return sendApiError(res,404,'FILE_NOT_FOUND','file not found');
      const now=Date.now();for(const [scope,grant] of previewScopes)if(grant.expiresAt<=now)previewScopes.delete(scope);
      if(previewScopes.size>=1024)return sendApiError(res,503,'PREVIEW_SCOPE_CAPACITY','Too many active previews; wait for an earlier scope to expire');
      const scope=`opaque-${randomUUID()}`;previewScopes.set(scope,{projectId:req.params.id,expiresAt:now+10*60*1000});
      res.setHeader('Cache-Control', 'no-store');
      res.json({url:`/api/projects/${encodeURIComponent(req.params.id)}/preview/${scope}/${relative.split('/').map(encodeURIComponent).join('/')}`,file:relative,csp:CLOUD_PROJECT_PREVIEW_CSP,iframeSandbox:CLOUD_PROJECT_IFRAME_SANDBOX,opaqueOrigin:true});
    } catch (error) {
      sendViewError(res, error);
    }
  });
}
