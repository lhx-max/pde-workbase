// Cloud-authoritative project file routes. Bytes and immutable version
// history come from the injected CloudProjectFiles service (canvas_files index
// + content-addressed blobs); nothing here touches a project filesystem.
// This registrar must run BEFORE the legacy file routes so every route below
// wins registration order. Surfaces that still have no cloud implementation
// end in an explicit CLOUD_FILE_OPERATION_UNAVAILABLE guard at the bottom —
// they can never fall through to the local-disk handlers.
import { createHash } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { Express, Request, Response } from 'express';
import { PROJECT_LAYOUT } from '@bezier/contracts';
import type { ProjectFile, ProjectFileVersion, ProjectFileVersionPromptSource, ProjectFileVersionSource } from '@bezier/contracts';
import { CanvasStateError } from '@bezier/canvas-core';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { isProjectFileVersionPath } from '../project-file-versions.js';
import { isIgnoredProjectDirName } from '../project-ignored-dirs.js';
import { isSketchDocumentPath } from '../storage/sketch-app-files.js';
import { decodeMultipartFilename, kindFor, mimeFor, parseByteRange, sanitizeName, sanitizePath } from '../projects.js';
import { CLOUD_PROJECT_FILE_MAX_BYTES, type CloudProjectFileCreateVersionOptions, type CloudProjectFiles, type CloudProjectFileVersion } from '../storage/cloud-project-files.js';
import type { ProjectRegistry } from '../storage/project-registry.js';
import type {ImageFileStorage} from '../storage/cloud-image-files.js';
import {sendCloudImage} from '../media/cloud-image-response.js';
import {prepareCloudArtifact,type CloudArtifactMetadata} from '../storage/cloud-artifact-metadata.js';
import {normalizeArtifactRuntimeImports} from '../artifacts/runtime-compat.js';

export interface RegisterCloudProjectFileRoutesDeps {
  files: CloudProjectFiles;
  registry: Pick<ProjectRegistry, 'get'>;
  imageFiles?:ImageFileStorage;
  artifacts?:CloudArtifactMetadata;
  /** Root injects the scoped authorizer. Request actor/tenant headers are
   * never consulted here — the callback alone decides access. */
  authorize: (req: Request, res: Response, projectId: string, options: { mode: 'read' | 'write' }) => boolean | Promise<boolean>;
  /** Host-side write veto for paths claimed by another authority (doc
   * mirror). Runs after sanitization, before any mutation. */
  guardLegacyFileWrite?: (projectId: string, sanitizedPath: string) => void | Promise<void>;
  /** Sketch documents live in the sketch App once registered; the canvas
   * must not keep a second authority for them. */
  sketchDocuments?: {
    read(path: string): Promise<string | null | undefined>;
    write(path: string, content: string): Promise<ProjectFile | undefined>;
    listed(projectId: string): Promise<ProjectFile[]>;
  };
  canvasFiles?: { renameSketchFile(projectId: string, from: string, to: string): Promise<void> };
}

const sha256hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

// Identical containment to the legacy project preview: opaque origin, scripts
// and forms allowed, every escape hatch closed. Never weaken this.
const PROJECT_FILE_IFRAME_SANDBOX = 'allow-scripts allow-forms';
const PROJECT_FILE_CSP = [
  `sandbox ${PROJECT_FILE_IFRAME_SANDBOX}`,
  "default-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const CLOUD_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
const SAFE_MIME_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_+\-.]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_+\-.]{0,127}(;[ \t]*[A-Za-z0-9_.+-]+=[A-Za-z0-9_.:/+\-]+)*$/u;
// Raster types sharp can actually verify; SVG is XML, not sniffed image bytes.
const VERIFIABLE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/tiff']);
const AUTHORED_CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/u;

function sendApiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** CanvasStateError carries authored status/code — preserve it verbatim.
 * Host policy errors with a real numeric status + UPPER_SNAKE code keep their
 * status and code. Anything else (raw transport/network failures) collapses
 * to a generic 503; the raw message is never serialized to the client. */
function sendRouteError(res: Response, error: unknown) {
  if (res.headersSent) return;
  if (error instanceof CanvasStateError) {
    sendApiError(res, error.status, error.code, error.message);
    return;
  }
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null | undefined;
  if (
    candidate
    && Number.isInteger(candidate.status)
    && (candidate.status as number) >= 400
    && (candidate.status as number) < 600
    && typeof candidate.code === 'string'
    && AUTHORED_CODE_RE.test(candidate.code)
    && typeof candidate.message === 'string'
  ) {
    sendApiError(res, candidate.status as number, candidate.code, candidate.message);
    return;
  }
  sendApiError(res, 503, 'CLOUD_STORAGE_UNAVAILABLE', 'cloud file storage unavailable');
}

const unavailable = (_req: Request, res: Response) => {
  sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'this project file operation is not available on cloud-authoritative storage yet');
};

function invalidInput(message: string): never {
  throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', message);
}

function sanitizeRelativePath(raw: string): string {
  try {
    return normalizeSafeProjectFilePath(sanitizePath(raw));
  } catch (error) {
    if (error instanceof CanvasStateError) throw error;
    invalidInput('invalid file name');
  }
}

/** Internal version-store paths must be invisible, not sanitized into. */
function resolveRequestPath(res: Response, raw: string): string | null {
  if (isProjectFileVersionPath(raw)) {
    sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
    return null;
  }
  try {
    const relative = normalizeSafeProjectFilePath(raw);
    if (isProjectFileVersionPath(relative)) {
      sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      return null;
    }
    return relative;
  } catch (error) {
    sendRouteError(res, error);
    return null;
  }
}

/** Optimistic-concurrency baseline: explicit body field, or a strong/weak
 * entity-tag If-Match. `*` means "exists" and cannot name a revision — it is
 * ignored so a missing explicit baseline still fails 428 on overwrite. */
function requestBaseline(req: Request): string | undefined {
  const body = req.body as { expectedRevision?: unknown } | undefined;
  if (typeof body?.expectedRevision === 'string' && body.expectedRevision.trim()) {
    return body.expectedRevision.trim();
  }
  const ifMatch = req.headers['if-match'];
  if (typeof ifMatch === 'string') {
    const value = ifMatch.trim().replace(/^W\//u, '').replace(/^"|"$/gu, '');
    if (value && value !== '*') return value;
  }
  return undefined;
}

/** Trusted MIME = extension-derived. A client-claimed mime only fills the
 * application/octet-stream gap and must itself pass the strict shape check —
 * it can never downgrade .html to a passive type or promote SVG to HTML. */
function effectiveMime(relPath: string, clientMime?: unknown): string {
  const byExtension = mimeFor(relPath);
  if (byExtension !== 'application/octet-stream') return byExtension;
  if (typeof clientMime === 'string' && SAFE_MIME_RE.test(clientMime)) return clientMime;
  return byExtension;
}

/** Verify claimed raster image bytes decode; SVG and non-images skip this —
 * an SVG is never served as active HTML because the extension owns the mime. */
async function verifyImageBytes(relPath: string, mime: string, bytes: Uint8Array): Promise<void> {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  if (!VERIFIABLE_IMAGE_MIMES.has(base)) return;
  try {
    await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', `${relPath}: bytes do not decode as ${base}`);
  }
}

/** Strict base64: alphabet + canonical padding only, and the decode must
 * round-trip byte-for-byte so no garbage is silently dropped. */
function decodeStrictBase64(content: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(content) || content.length % 4 !== 0) {
    invalidInput('invalid base64 content');
  }
  const buffer = Buffer.from(content, 'base64');
  if (buffer.toString('base64') !== content) invalidInput('invalid base64 content');
  return buffer;
}

function ifNoneMatchFresh(req: Request, etag: string): boolean {
  const header = req.headers['if-none-match'];
  if (typeof header !== 'string') return false;
  return header.split(',').some((tag) => {
    const value = tag.trim();
    return value === etag || value === `W/${etag}` || value === '*';
  });
}

/** Our ETag is a strong sha256 validator, so an entity-tag If-Range CAN
 * authorize a range — unlike the legacy weak tag, which never could. */
function ifRangeAllowsPartial(req: Request, etag: string, mtimeMs: number): boolean {
  const header = req.headers['if-range'];
  if (typeof header !== 'string' || header.length === 0) return true;
  const value = header.trim();
  if (value.startsWith('"') || value.startsWith('W/')) {
    return value === etag || value === `W/${etag}`;
  }
  const since = Date.parse(value);
  return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

interface FileMeta {
  mime: string;
  size: number;
  mtime: number;
  /** Content sha256 — strong ETag and x-content-revision value. */
  revision: string;
}

function sendCloudBytes(req: Request, res: Response, meta: FileMeta, buffer: Buffer, options: { immutable?: boolean } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const activeMime=meta.mime.split(';')[0]!.trim().toLowerCase();
  if (['text/html','application/xhtml+xml'].includes(activeMime)) {
    res.setHeader('Content-Security-Policy', PROJECT_FILE_CSP);
  }
  if(activeMime==='image/svg+xml')res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'");
  const etag = `"${meta.revision}"`;
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Revision', meta.revision);
  res.setHeader('Last-Modified', new Date(Math.floor(meta.mtime)).toUTCString());
  // Immutable bytes still have revocable access. Always revalidate authority.
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary','Authorization, Cookie, X-MAV-SSO-Authorization, X-MAV-Tenant, X-MAV-Application-Instance-Id');
  if (ifNoneMatchFresh(req, etag)) return res.status(304).end();
  res.setHeader('Accept-Ranges', 'bytes');
  res.type(meta.mime);
  const range = ifRangeAllowsPartial(req, etag, meta.mtime) ? parseByteRange(req.headers.range, buffer.length) : null;
  if (range === 'unsatisfiable') {
    res.setHeader('Content-Range', `bytes */${buffer.length}`);
    return res.status(416).end();
  }
  if (range) {
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${buffer.length}`);
    return res.status(206).send(buffer.subarray(range.start, range.end + 1));
  }
  return res.status(200).send(buffer);
}
export {PROJECT_FILE_CSP as CLOUD_PROJECT_PREVIEW_CSP,PROJECT_FILE_IFRAME_SANDBOX as CLOUD_PROJECT_IFRAME_SANDBOX,sendCloudBytes as sendCloudProjectFileBytes};

/** Legacy list scope 'artifacts' hides dot-segments, generated dependency
 * trees and sidecars; 'all' returns everything the cloud index holds. The
 * cloud index stores no .artifact.json manifest, so artifactKind/
 * artifactManifest fields are never populated here. */
function isVisibleArtifactPath(name: string): boolean {
  const segments = name.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) return false;
  if (segments.some((segment) => isIgnoredProjectDirName(segment))) return false;
  const base = segments.at(-1)!;
  if (base.endsWith('.artifact.json')) return false;
  if (base === 'canvas-state.json') return false;
  return true;
}

/** Label parity with the legacy manifest: an explicit stored label wins;
 * restore checkpoints fall back to "Version N · restored from vM" where M is
 * the parent's positional version number in this path's history. */
function versionLabel(version: CloudProjectFileVersion, index: number, versions: readonly CloudProjectFileVersion[]): string {
  if (version.label !== undefined) return version.label;
  if (version.source === 'restore' && version.parentVersionId !== undefined) {
    const parentIndex = versions.findIndex((candidate) => candidate.id === version.parentVersionId);
    if (parentIndex >= 0) return `Version ${index + 1} · restored from v${parentIndex + 1}`;
  }
  return `Version ${index + 1}`;
}

function toVersionDto(fileName: string, versions: readonly CloudProjectFileVersion[], index: number, currentIndex = versions.length - 1): ProjectFileVersion {
  const version = versions[index]!;
  return {
    id: version.id,
    fileName,
    version: index + 1,
    label: versionLabel(version, index, versions),
    createdAt: Date.parse(version.createdAt),
    source: version.source,
    prompt: version.prompt ?? null,
    ...(version.promptSource !== undefined ? { promptSource: version.promptSource } : {}),
    size: version.size,
    mime: version.mime,
    kind: kindFor(fileName),
    current: index === currentIndex,
    contentDigest: version.sha256,
    ...(version.parentVersionId ? { parentVersionId: version.parentVersionId } : {}),
    ...(version.source === 'restore' && version.parentVersionId ? { restoreFromVersionId: version.parentVersionId } : {}),
  };
}

function fileFromVersion(fileName: string, version: CloudProjectFileVersion | undefined): ProjectFile | null {
  if (!version) return null;
  return {
    name: fileName,
    path: fileName,
    type: 'file',
    size: version.size,
    mtime: Date.parse(version.createdAt),
    kind: kindFor(fileName),
    mime: version.mime,
  };
}

export function registerCloudProjectFileRoutes(app: Express, deps: RegisterCloudProjectFileRoutesDeps) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CLOUD_PROJECT_FILE_MAX_BYTES, files: 12 } });
  const sendMulterError = (res: Response, error: unknown) => sendApiError(res, 400, 'UPLOAD_ERROR', error instanceof Error ? error.message : 'upload failed');

  const decorate=async(projectId:string,files:ProjectFile[]):Promise<ProjectFile[]>=>{
    if(!deps.artifacts)return files;
    const entries=await deps.artifacts.list(projectId);if(!entries.length)return files;
    const heads=new Map((await deps.files.listHeads(projectId)).map(head=>[head.file.name,head.revision]));
    const manifests=new Map(entries.filter(entry=>heads.get(entry.path)===entry.revision).map(entry=>[entry.path,entry.manifest]));
    return files.map(file=>{const manifest=manifests.get(file.name);return manifest?{...file,artifactKind:manifest.kind as NonNullable<ProjectFile['artifactKind']>,artifactManifest:manifest as unknown as NonNullable<ProjectFile['artifactManifest']>}:file;});
  };
  const publication=async(projectId:string,relative:string,bytes:Buffer,artifact:unknown,manifest:unknown)=>{
    if(!deps.artifacts){if(artifact===true||manifest!=null)throw new CanvasStateError(503,'CLOUD_ARTIFACT_PUBLICATION_UNAVAILABLE','Cloud artifact metadata is not configured');return {bytes,manifest:null};}
    if(manifest===undefined){
      const existing=(await deps.artifacts.list(projectId)).find(entry=>entry.path===relative);
      if(existing){const head=(await deps.files.listHeads(projectId)).find(head=>head.file.name===relative);if(head?.revision===existing.revision)manifest=existing.manifest;}
    }
    // Use the same compatibility transform before guarding/storing the exact
    // published bytes. Ordinary non-artifact uploads retain their bytes.
    const normalized=artifact===true||manifest!=null?Buffer.from(normalizeArtifactRuntimeImports(relative,bytes) as Uint8Array):bytes;
    const prepared=prepareCloudArtifact({path:relative,content:normalized,artifact:artifact===true,artifactManifest:manifest});
    if(!prepared)return{bytes:normalized,manifest:null};
    const identifier=(prepared.metadata as {identifier?:unknown}|undefined)?.identifier;
    if(typeof identifier==='string'&&identifier){
      const decorated=await decorate(projectId,await deps.files.list(projectId));
      const prior=decorated.filter(file=>path.posix.dirname(file.name)===path.posix.dirname(relative)&&(file.artifactManifest?.metadata as {identifier?:unknown}|undefined)?.identifier===identifier).map(file=>({name:file.name,size:file.size}));
      return{bytes:normalized,manifest:prepareCloudArtifact({path:relative,content:normalized,artifact:artifact===true,artifactManifest:prepared,priorSiblings:prior})};
    }
    return{bytes:normalized,manifest:prepared};
  };
  const completePublication=async(projectId:string,relative:string,bytes:Buffer,manifest:Record<string,unknown>|null,file:ProjectFile)=>{
    if(manifest){await deps.artifacts!.set(projectId,relative,sha256hex(bytes),manifest);return{...file,artifactKind:manifest.kind as NonNullable<ProjectFile['artifactKind']>,artifactManifest:manifest as unknown as NonNullable<ProjectFile['artifactManifest']>};}
    // A new byte revision cannot inherit an old artifact marker.
    await deps.artifacts?.remove(projectId,relative);return file;
  };

  const requireAuthorized = async (req: Request, res: Response, projectId: string, mode: 'read' | 'write'): Promise<boolean> => {
    if (!deps.registry.get(projectId)) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return false;
    }
    const allowed = await deps.authorize(req, res, projectId, { mode });
    if (!allowed && !res.headersSent) sendApiError(res, 403, 'FORBIDDEN', 'project access denied');
    return allowed;
  };

  const sketchManaged = (relative: string) => Boolean(deps.sketchDocuments) && isSketchDocumentPath(relative);

  const sketchOwnedMutationBlocked = (res: Response, relative: string): boolean => {
    if (!sketchManaged(relative)) return false;
    sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'sketch documents are mutated through the sketch app contract');
    return true;
  };

  const rejectsSpecializedPreview = (req: Request, res: Response): boolean => {
    if (req.query.odCanvasPreview !== undefined || req.query.odThumbnailWidth !== undefined || req.query.odPreviewBridge !== undefined) {
      sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'derived previews are not available on cloud file storage yet');
      return true;
    }
    return false;
  };

  async function sendProjectFile(req: Request, res: Response, projectId: string, relative: string) {
    if((req.query.odCanvasPreview!==undefined||req.query.odThumbnailWidth!==undefined)&&await sendCloudImage(req,res,deps.imageFiles,projectId,relative))return;
    if (rejectsSpecializedPreview(req, res)) return;
    if (deps.sketchDocuments && isSketchDocumentPath(relative)) {
      const scene = await deps.sketchDocuments.read(relative);
      if (typeof scene === 'string') {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        res.type('application/json; charset=utf-8').send(scene);
        return;
      }
      if (scene === null) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }
      // undefined: the sketch app does not project this path — the cloud
      // index is still consulted below.
    }
    const result = await deps.files.read(projectId, relative);
    if (!result) {
      sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      return;
    }
    sendCloudBytes(req, res, {
      mime: effectiveMime(relative, result.file.mime),
      size: result.file.size,
      mtime: result.file.mtime,
      revision: result.revision,
    }, result.buffer);
  }

  app.post('/api/projects/:id/upload', async (req, res, next) => {
    if (!await requireAuthorized(req, res, String(req.params.id), 'write')) return;
    upload.array('files', 12)(req, res, (error: unknown) => {
      if (error) { sendMulterError(res, error); return; }
      next();
    });
  }, async (req, res) => {
    try {
      const projectId = String(req.params.id);
      const incoming = Array.isArray(req.files) ? req.files : [];
      const dir = typeof req.body?.dir === 'string' && req.body.dir.trim() ? req.body.dir : PROJECT_LAYOUT.uploads;
      if (isProjectFileVersionPath(dir)) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }
      let safeDir: string;
      try {
        safeDir = sanitizePath(dir);
      } catch {
        invalidInput('invalid upload directory');
      }
      const prefix = `${safeDir}/`;
      if (isProjectFileVersionPath(prefix)) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }
      const out: Array<ProjectFile & { originalName: string }> = [];
      for (const file of incoming) {
        const originalName = decodeMultipartFilename(file.originalname);
        const safe = sanitizeName(originalName);
        const parsed = path.posix.parse(safe);
        const mime = effectiveMime(`${prefix}${safe}`, file.mimetype);
        await verifyImageBytes(`${prefix}${safe}`, mime, file.buffer);
        let saved: ProjectFile | undefined;
        for (let index = 0; index < 10_000; index += 1) {
          const name = prefix + (index === 0 ? safe : `${parsed.name}-${index}${parsed.ext}`);
          await deps.guardLegacyFileWrite?.(projectId, name);
          try {
            saved = await deps.files.write(projectId, name, file.buffer, mime, { createOnly: true });
            break;
          } catch (error) {
            if (error instanceof CanvasStateError && error.status === 409) continue;
            throw error;
          }
        }
        if (!saved) throw new CanvasStateError(503, 'CANVAS_FILES_UNAVAILABLE', 'could not allocate a unique upload name');
        out.push({ ...saved, originalName });
      }
      res.json({ files: out });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.get('/api/projects/:id/files', async (req, res) => {
    try {
      const projectId = String(req.params.id);
      if (!await requireAuthorized(req, res, projectId, 'read')) return;
      const files = await decorate(projectId,await deps.files.list(projectId));
      if (deps.sketchDocuments) {
        const seen = new Set(files.map((file) => file.name));
        for (const file of await deps.sketchDocuments.listed(projectId)) {
          if (!seen.has(file.name)) {
            seen.add(file.name);
            files.push(file);
          }
        }
      }
      const since = Number(req.query?.since);
      const scoped = req.query.scope === 'all' ? files : files.filter((file) => isVisibleArtifactPath(file.name));
      scoped.sort((a, b) => b.mtime - a.mtime);
      const visible = Number.isFinite(since) && since > 0 ? scoped.filter((file) => Number(file.mtime) > since) : scoped;
      res.json({ files: visible });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.get('/api/projects/:id/archive', async (req, res) => {
    try {
      const projectId = String(req.params.id);
      if (!await requireAuthorized(req, res, projectId, 'read')) return;
      if (req.query.includeInternalState === 'true') {
        sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'internal canvas state is not part of the cloud file archive');
        return;
      }
      const listing = await deps.files.list(projectId);
      let rootPrefix = '';
      if (typeof req.query.root === 'string' && req.query.root.trim()) {
        rootPrefix = `${normalizeSafeProjectFilePath(req.query.root)}/`;
      }
      const entries = listing
        .filter((file) => !rootPrefix || file.name.startsWith(rootPrefix))
        .map((file) => ({ file, rel: rootPrefix ? file.name.slice(rootPrefix.length) : file.name }));
      if (entries.length === 0) {
        throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'archive root is empty');
      }
      let totalBytes = 0;
      const zip = new JSZip();
      for (const { file, rel } of entries) {
        totalBytes += file.size;
        if (totalBytes > CLOUD_ARCHIVE_MAX_BYTES) {
          throw new CanvasStateError(413, 'CANVAS_ARCHIVE_TOO_LARGE', 'archive exceeds the 256 MiB bound');
        }
        const result = await deps.files.read(projectId, file.name);
        if (!result) {
          // A head that vanished mid-archive must fail the whole request —
          // a partial zip would silently drop content.
          throw new CanvasStateError(503, 'CANVAS_FILES_UNAVAILABLE', `file ${JSON.stringify(file.name)} disappeared during archive`);
        }
        zip.file(rel, result.buffer, { date: new Date(file.mtime), binary: true });
      }
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const project = deps.registry.get(projectId);
      res.type('application/zip').attachment(`${sanitizeName(project?.name ?? projectId)}.zip`).send(buffer);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post(
    '/api/projects/:id/files',
    async (req, res, next) => {
      if (!await requireAuthorized(req, res, String(req.params.id), 'write')) return;
      upload.single('file')(req, res, (error: unknown) => {
        if (error) { sendMulterError(res, error); return; }
        next();
      });
    },
    async (req, res) => {
      try {
        const projectId = String(req.params.id);
        const expectedRevision = requestBaseline(req);
        const overwrite = (req.body as { overwrite?: unknown } | undefined)?.overwrite;
        const artifact = (req.body as { artifact?: unknown; artifactManifest?: unknown } | undefined)?.artifact;
        const artifactManifest = (req.body as { artifactManifest?: unknown } | undefined)?.artifactManifest;
        if (!deps.artifacts&&(artifact === true || (artifactManifest !== undefined && artifactManifest !== null))) {
          sendApiError(res, 503, 'CLOUD_ARTIFACT_PUBLICATION_UNAVAILABLE', 'artifact publication is not available on cloud file storage yet');
          return;
        }
        const writeOptions = {
          ...(expectedRevision !== undefined ? { expectedRevision } : {}),
          ...(overwrite === false||artifact===true ? { createOnly: true } : {}),
        };

        if (req.file) {
          const rawName = (req.body as { name?: unknown } | undefined)?.name;
          if (typeof rawName === 'string' && isProjectFileVersionPath(rawName)) {
            sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
            return;
          }
          const desiredName = typeof rawName === 'string'
            ? sanitizeRelativePath(rawName)
            : sanitizeName(decodeMultipartFilename(req.file.originalname));
          const relative = resolveRequestPath(res, desiredName);
          if (!relative) return;
          if (sketchOwnedMutationBlocked(res, relative)) return;
          const mime = effectiveMime(relative, req.file.mimetype);
          await verifyImageBytes(relative, mime, req.file.buffer);
          await deps.guardLegacyFileWrite?.(projectId, relative);
          const published=await publication(projectId,relative,req.file.buffer,artifact,artifactManifest);
          const file = await deps.files.write(projectId, relative, published.bytes, mime, writeOptions);
          const decorated=await completePublication(projectId,relative,published.bytes,published.manifest,file);
          res.json({ file:decorated, revision: sha256hex(published.bytes) });
          return;
        }

        const body = req.body as Record<string, unknown> | undefined;
        const { name, content, encoding } = body ?? {};
        if (typeof name !== 'string' || typeof content !== 'string') {
          sendApiError(res, 400, 'BAD_REQUEST', 'name and content required');
          return;
        }
        if (isProjectFileVersionPath(name)) {
          sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
          return;
        }
        const relative = resolveRequestPath(res, sanitizeRelativePath(name));
        if (!relative) return;
        if (encoding !== undefined && encoding !== 'base64' && encoding !== 'utf8' && encoding !== 'text') {
          sendApiError(res, 400, 'BAD_REQUEST', 'unsupported encoding; expected base64');
          return;
        }
        const buffer = encoding === 'base64' ? decodeStrictBase64(content) : Buffer.from(content, 'utf8');
        if (deps.sketchDocuments && isSketchDocumentPath(relative)) {
          // The injected sketch write carries no baseline/createOnly contract;
          // refusing beats silently dropping optimistic-concurrency semantics.
          if (expectedRevision !== undefined || overwrite === false) {
            sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'sketch write contract cannot carry a revision baseline');
            return;
          }
          const saved = await deps.sketchDocuments.write(relative, buffer.toString('utf8'));
          if (saved) {
            res.json({ file: saved });
            return;
          }
          sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'sketch document store does not own this path');
          return;
        }
        await deps.guardLegacyFileWrite?.(projectId, relative);
        const mime = effectiveMime(relative);
        await verifyImageBytes(relative, mime, buffer);
        const published=await publication(projectId,relative,buffer,artifact,artifactManifest);
        const file = await deps.files.write(projectId, relative, published.bytes, mime, writeOptions);
        const decorated=await completePublication(projectId,relative,published.bytes,published.manifest,file);
        res.json({ file:decorated, revision: sha256hex(published.bytes) });
      } catch (error) {
        sendRouteError(res, error);
      }
    },
  );

  app.post('/api/projects/:id/files/rename', async (req, res) => {
    try {
      const projectId = String(req.params.id);
      const { from, to } = (req.body ?? {}) as { from?: unknown; to?: unknown };
      if (typeof from !== 'string' || typeof to !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'from and to required');
        return;
      }
      if (!await requireAuthorized(req, res, projectId, 'write')) return;
      const source = resolveRequestPath(res, from);
      const destination = resolveRequestPath(res, to);
      if (!source || !destination) return;
      if (sketchOwnedMutationBlocked(res, source) || sketchOwnedMutationBlocked(res, destination)) return;
      await deps.guardLegacyFileWrite?.(projectId, source);
      await deps.guardLegacyFileWrite?.(projectId, destination);
      const baseline = requestBaseline(req);
      const original=deps.artifacts?(await deps.files.listHeads(projectId)).find(head=>head.file.name===source):undefined;
      if(original)await deps.artifacts!.preflightRename(projectId,source,destination,original.revision);
      const file = await deps.files.rename(projectId, source, destination, baseline !== undefined ? { expectedRevision: baseline } : {});
      try {
        await deps.canvasFiles?.renameSketchFile(projectId, source, destination);
      } catch (renameReferenceError) {
        // The cloud head already moved; keep file and card identities aligned
        // by rolling back against the ACTUAL current revision, never a guess.
        let rollbackFailed = false;
        try {
          await deps.guardLegacyFileWrite?.(projectId, destination);
          await deps.guardLegacyFileWrite?.(projectId, source);
          const head = await deps.files.read(projectId, destination);
          if (!head) throw new CanvasStateError(503, 'CANVAS_FILES_UNAVAILABLE', 'renamed head missing for rollback');
          await deps.files.rename(projectId, destination, source, { expectedRevision: head.revision });
        } catch {
          rollbackFailed = true;
        }
        void renameReferenceError;
        if (rollbackFailed) {
          sendApiError(res, 503, 'CLOUD_FILE_RENAME_ROLLBACK_FAILED', 'canvas reference update failed and the rename could not be rolled back');
        } else {
          sendApiError(res, 503, 'CLOUD_FILE_OPERATION_UNAVAILABLE', 'canvas reference update failed; file rename was rolled back');
        }
        return;
      }
      if(original)await deps.artifacts!.rename(projectId,source,destination,original.revision);
      res.json({ oldName: source, newName: destination, file:(await decorate(projectId,[file]))[0] });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (!await requireAuthorized(req, res, projectId, 'read')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      const versions = await deps.files.versions(projectId, relative);
      const head = await deps.files.read(projectId, relative);
      const file = head?.file ?? fileFromVersion(relative, versions.at(-1));
      if (!file) {
        sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      const currentIndex=head?versions.reduce((found,v,i)=>v.sha256===head.revision?i:found,-1):-1;
      res.json({ file, versions: versions.map((_version, index) => toVersionDto(relative, versions, index, currentIndex)) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  // Explicit checkpoint of the current verified head bytes — parity with the
  // legacy manual-version surface. Write-authorized like the legacy route;
  // html-only is enforced inside the service against the real head.
  app.post(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (!await requireAuthorized(req, res, projectId, 'write')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      if (sketchOwnedMutationBlocked(res, relative)) return;
      await deps.guardLegacyFileWrite?.(projectId, relative);
      if(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body))){sendApiError(res,400,'BAD_REQUEST','Version body must be an object');return;}
      const body = (req.body ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(body)) {
        if (!['expectedRevision', 'label', 'prompt', 'source', 'promptSource', 'parentVersionId'].includes(key)) {
          sendApiError(res, 400, 'BAD_REQUEST', `unsupported version field ${key}`);
          return;
        }
      }
      const baseline = requestBaseline(req);
      const options: CloudProjectFileCreateVersionOptions = {};
      if (baseline !== undefined) options.expectedRevision = baseline;
      else if (body.expectedRevision !== undefined) options.expectedRevision = body.expectedRevision as string;
      if (body.label !== undefined) options.label = body.label as string | null;
      if (body.prompt !== undefined) options.prompt = body.prompt as string | null;
      if (body.source !== undefined) options.source = body.source as ProjectFileVersionSource;
      if (body.promptSource !== undefined) options.promptSource = body.promptSource as ProjectFileVersionPromptSource;
      if (body.parentVersionId !== undefined) options.parentVersionId = body.parentVersionId as string;
      const created = await deps.files.createVersion(projectId, relative, options);
      const versions = await deps.files.versions(projectId, relative);
      const index = versions.findIndex((version) => version.id === created.id);
      if(index<0)throw new CanvasStateError(503,'CANVAS_FILES_HISTORY_CORRUPT','Created version is absent from durable history');
      res.json({ version: toVersionDto(relative, versions, index) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions\/([^/]+)\/restore$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      const versionId = String(params[2] ?? '');
      if (!await requireAuthorized(req, res, projectId, 'write')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      const baseline = requestBaseline(req);
      const versionBody=deps.artifacts?await deps.files.readVersion(projectId,relative,versionId):undefined;
      const published=versionBody?await publication(projectId,relative,versionBody.buffer,false,undefined):undefined;
      if(published&&!published.bytes.equals(versionBody!.buffer))throw new CanvasStateError(409,'ARTIFACT_RESTORE_REQUIRES_RECONCILIATION','Restored artifact requires a compatibility edit; restore as an explicit new revision');
      const file = await deps.files.restore(projectId, relative, versionId, baseline !== undefined ? { expectedRevision: baseline } : {});
      const decorated=published?await completePublication(projectId,relative,published.bytes,published.manifest,file):file;
      const versions = await deps.files.versions(projectId, relative);
      const latest = versions.at(-1);
      res.json({ file:decorated, ...(latest ? { version: toVersionDto(relative, versions, versions.length - 1) } : {}) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions\/([^/]+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      const versionId = String(params[2] ?? '');
      if (!await requireAuthorized(req, res, projectId, 'read')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      const result = await deps.files.readVersion(projectId, relative, versionId);
      sendCloudBytes(req, res, {
        mime: effectiveMime(relative, result.file.mime),
        size: result.version.size,
        mtime: Date.parse(result.version.createdAt),
        revision: result.version.sha256,
      }, result.buffer, { immutable: true });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  // Preflight parity with the legacy raw route: artifact fetches are simple
  // GETs today, but a sandboxed iframe (Origin: null) needs an explicit answer.
  app.options(/^\/api\/projects\/[^/]+\/raw\/.+$/u, (req, res) => {
    if (req.headers.origin === 'null') {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.sendStatus(204);
  });

  app.get(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (!await requireAuthorized(req, res, projectId, 'read')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      // Sandboxed iframe previews send Origin: "null"; real cross-origin sites
      // remain blocked by the same-origin policy.
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      await sendProjectFile(req, res, projectId, relative);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.delete(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, async (req, res) => {
    await deleteCloudFile(req, res, String((req.params as unknown as { 0?: string })[0] ?? ''), String((req.params as unknown as { 1?: string })[1] ?? ''));
  });

  // Nested file-preview is explicitly unavailable — registered BEFORE the
  // generic /files/:path reader so the honest 503 wins over a 404-shaped
  // "file named preview not found".
  app.get(/^\/api\/projects\/[^/]+\/files\/[^/]+\/preview$/u, unavailable);

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (!await requireAuthorized(req, res, projectId, 'read')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      await sendProjectFile(req, res, projectId, relative);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.delete(/^\/api\/projects\/([^/]+)\/files\/(.+)$/u, async (req, res) => {
    await deleteCloudFile(req, res, String((req.params as unknown as { 0?: string })[0] ?? ''), String((req.params as unknown as { 1?: string })[1] ?? ''));
  });

  async function deleteCloudFile(req: Request, res: Response, projectId: string, relPath: string) {
    try {
      if (!await requireAuthorized(req, res, projectId, 'write')) return;
      const relative = resolveRequestPath(res, relPath);
      if (!relative) return;
      if (sketchOwnedMutationBlocked(res, relative)) return;
      await deps.guardLegacyFileWrite?.(projectId, relative);
      const baseline = requestBaseline(req);
      await deps.files.delete(projectId, relative, baseline !== undefined ? { expectedRevision: baseline } : {});
      await deps.artifacts?.remove(projectId,relative);
      res.json({ ok: true });
    } catch (error) {
      sendRouteError(res, error);
    }
  }

  // LAST cloud-only guard: legacy file surfaces with no cloud implementation
  // yet. Registered here — before the legacy registrar runs — so they can
  // never fall through to local filesystem handlers. Deliberately scoped to
  // the file surface only; unrelated canvas/media/asset/app/tabs/events
  // routes are untouched.
  app.all('/api/projects/:id/archive/batch', unavailable);
  app.all('/api/projects/:id/folders', unavailable);
  app.all('/api/projects/:id/search', unavailable);
  app.all(/^\/api\/projects\/[^/]+\/text-preview\/.*$/u, unavailable);
  app.all('/api/projects/:id/preview-url', unavailable);
  app.all(/^\/api\/projects\/[^/]+\/preview\/[^/]+\/.+$/u, unavailable);
  app.all(/^\/api\/projects\/[^/]+\/powered\/.+$/u, unavailable);
}
