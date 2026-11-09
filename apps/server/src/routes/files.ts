// Adapted from upstream project routes at 319e5ee. File protocol retained;
// database, chat and team policy replaced by explicit registry/authority.
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import type { Express, Request, Response } from 'express';
import { PROJECT_LAYOUT } from '@bezier/contracts';
import type { ProjectFile, ProjectFileTextPreviewResponse, ProjectFileVersion, ProjectFileVersionPromptSource, ProjectFileVersionSource, ProjectFileVersionWarning } from '@bezier/contracts';
import { createCanvasPreview, PREVIEW_WIDTHS, type CanvasPreviewKind } from '../media/canvas-preview.js';
import { createProjectArtifactFile } from '../artifacts/create.js';
import { ArtifactPublicationBlockedError } from '../artifacts/publication-guard.js';
import { ArtifactRegressionError } from '../artifacts/stub-guard.js';
import { validateArtifactManifestInput } from '../artifacts/manifest.js';
import { applyUrlPreviewBridgesToHtml } from '../artifacts/preview-bridges.js';
import { buildDocumentPreview } from '../artifacts/document-preview.js';
import { ensureCurrentProjectFileVersion, isProjectFileVersionPath, listProjectFileVersions, markProjectFileVersionStoreDeleted, readProjectFileVersion, renameProjectFileVersionStore, withProjectFileVersionLock } from '../project-file-versions.js';
import { listFiles, listProjectFolders, createProjectFolder, deleteProjectFolder, searchProjectFiles, readProjectFile, resolveProjectDir, resolveProjectFilePath, parseByteRange, renameProjectFile, deleteProjectFile, writeProjectFile, sanitizeName, sanitizePath, ensureProject, decodeMultipartFilename, buildProjectArchive, buildBatchArchive } from '../projects.js';
import { subscribe } from '../project-watchers.js';
import type { ProjectRegistry } from '../storage/project-registry.js';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { ownsTenantAsset, tenantOf } from '../tenant.js';
import { sendCloudImage } from '../media/cloud-image-response.js';
import type { ImageFileStorage } from '../storage/cloud-image-files.js';

export interface RegisterProjectFileRoutesDeps {
  registry: ProjectRegistry;
  imageFiles?: ImageFileStorage;
  canvasFiles?: { renameSketchFile(projectId: string, from: string, to: string): Promise<void> };
  /** Omitted only for deliberately local, single-user deployments. */
  authorize?: (req: Request, res: Response, projectId: string, options: { mode: 'read' | 'write'; allowNavigationQuery?: boolean }) => boolean | Promise<boolean>;
  /** Non-response-writing permission probe for lazy HTML history initialization. */
  canWrite?: (req: Request, projectId: string) => boolean | Promise<boolean>;
  /** Legacy uploads have no document CAS baseline. The host may reject writes
   * to a currently bound document mirror after the target path is sanitized. */
  guardLegacyFileWrite?: (projectId: string, sanitizedPath: string) => void | Promise<void>;
  /** Sketch document bytes live in the sketch App once it is registered.
   * `undefined` means this canvas is still the store (app not registered). */
  sketchDocuments?: {
    read(path: string): Promise<string | null | undefined>;
    write(path: string, content: string): Promise<ProjectFile | undefined>;
    listed(projectId: string): Promise<ProjectFile[]>;
  };
}
function sendApiError(res: Response, status: number, code: string, message: string, extra?: { details?: unknown }) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

export function registerProjectFileRoutes(app: Express, ctx: RegisterProjectFileRoutesDeps) {
  const { registry } = ctx;
  const PROJECTS_DIR = registry.projectsRoot;
  const uploadRoot = path.join(registry.dataRoot, 'uploads');
  assertProjectPathHasNoSymlinks(registry.dataRoot, 'uploads');
  fs.mkdirSync(uploadRoot, { recursive: true });
  const upload = multer({ dest: uploadRoot, limits: { fileSize: 256 * 1024 * 1024, files: 100 } });
  const sendMulterError = (res: Response, error: Error) => sendApiError(res, 400, 'UPLOAD_ERROR', error.message);
  const authorizeProjectRequest = async (req: Request, res: Response, projectId: string, options: { mode: 'read' | 'write'; allowNavigationQuery?: boolean }) => {
    if (!registry.get(projectId)) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return false; }
    registry.resolveProjectRoot(projectId);
    if (!ctx.authorize) return true;
    const allowed = await ctx.authorize(req, res, projectId, options);
    if (!allowed && !res.headersSent) sendApiError(res, 403, 'FORBIDDEN', 'project access denied');
    return allowed;
  };
  const scopes = new Map<string, { projectId: string; expiresAt: number }>();
  const projectPreviewScopes = {
    mint(projectId: string) {
      for (const [key, value] of scopes) if (value.expiresAt <= Date.now()) scopes.delete(key);
      const scope = randomUUID();
      scopes.set(scope, { projectId, expiresAt: Date.now() + 60 * 60 * 1000 });
      return scope;
    },
    resolve(projectId: string, scope: string): null | undefined {
      const entry = scopes.get(scope);
      if (!entry || entry.projectId !== projectId) return undefined;
      if (entry.expiresAt <= Date.now()) { scopes.delete(scope); return undefined; }
      return null;
    },
  };
  app.get('/api/projects', async (req, res) => {
    const projects = registry.list().filter(project => ownsTenantAsset(project, tenantOf(req)));
    for (const project of projects) if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
    res.json({ projects });
  });
  app.post('/api/projects', async (req, res) => {
    try {
      const id = req.body?.id ?? randomUUID();
      if (ctx.authorize && !await ctx.authorize(req, res, id, { mode: 'write' })) {
        if (!res.headersSent) sendApiError(res, 403, 'FORBIDDEN', 'project creation denied');
        return;
      }
      const tenant = tenantOf(req);
      const project = registry.create({ ...req.body, id, teamId: tenant.teamId, createdBy: tenant.userId });
      res.json({ project });
    } catch (error) { sendApiError(res, 400, 'BAD_REQUEST', String(error)); }
  });
  app.get('/api/projects/:id', async (req, res) => {
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
    res.json({ project: registry.get(req.params.id) });
  });
  app.get('/api/projects/:id/tabs', async (req, res) => {
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
    res.json(registry.getTabs(req.params.id));
  });
  app.put('/api/projects/:id/tabs', async (req, res) => {
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'write' })) return;
    try {
      const { tabs = [], active = null, browserTabs = [], appTabs = [] } = req.body ?? {};
      res.json(registry.setTabs(req.params.id, { tabs, active, browserTabs, appTabs }));
    } catch (error) { sendApiError(res, 400, 'BAD_REQUEST', String(error)); }
  });
  app.get('/api/projects/:id/events', async (req, res) => {
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'read', allowNavigationQuery: true })) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event: string, payload: unknown) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); };
    const sub = subscribe(PROJECTS_DIR, req.params.id, event => send('file-changed', event));
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 20_000);
    heartbeat.unref();
    const cleanup = () => { clearInterval(heartbeat); void sub.unsubscribe(); };
    res.once('close', cleanup);
    res.once('finish', cleanup);
    await sub.ready;
    send('ready', { projectId: req.params.id });
  });
  app.post('/api/projects/:id/upload', async (req, res, next) => {
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'write' })) return;
    upload.array('files', 12)(req, res, error => {
      if (error) { sendMulterError(res, error); return; }
      next();
    });
  }, async (req, res) => {
    const incoming = Array.isArray(req.files) ? req.files : [];
    try {
      const project = registry.get(req.params.id)!;
      const dir = typeof req.body?.dir === 'string' ? req.body.dir : PROJECT_LAYOUT.uploads;
      const prefix = dir ? `${sanitizePath(dir)}/` : '';
      const out = [];
      for (const f of incoming) {
        const originalName = decodeMultipartFilename(f.originalname);
        const safe = sanitizeName(originalName);
        const parsed = path.posix.parse(safe);
        let result: Awaited<ReturnType<typeof writeProjectFile>> | undefined;
        const buffer = await fs.promises.readFile(f.path);
        if (ctx.imageFiles && f.mimetype.startsWith('image/')) {
          const relative = `${prefix}${parsed.name}-${randomUUID().slice(0, 8)}${parsed.ext}`;
          const saved = await ctx.imageFiles.write(project.id, relative, buffer, f.mimetype);
          out.push({ ...saved, originalName });
          continue;
        }
        for (let index = 0; index < 10_000; index++) {
          const name = prefix + (index === 0 ? safe : `${parsed.name}-${index}${parsed.ext}`);
          try {
            result = await writeProjectFile(PROJECTS_DIR, project.id, name, buffer, { overwrite: false }, project.metadata);
            break;
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        if (!result) throw new Error('could not allocate unique upload name');
        if (/\.html?$/i.test(result.name)) {
          const saved = await readProjectFile(PROJECTS_DIR, project.id, result.name, project.metadata);
          await ensureCurrentProjectFileVersion(PROJECTS_DIR, project.id, result.name, saved.buffer.toString('utf8'), { source: 'manual', promptSource: 'manual' }, project.metadata);
        }
        out.push({ ...result, originalName });
      }
      res.json({ files: out });
    } catch (error) { sendApiError(res, 400, 'UPLOAD_ERROR', String(error)); }
    finally { await Promise.all(incoming.map(f => fs.promises.unlink(f.path).catch(() => {}))); }
  });
  app.get('/api/projects/:id/archive', async (req, res) => {
    if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'read' })) return;
    try {
      const archive = await buildProjectArchive(PROJECTS_DIR, req.params.id, req.query.root, registry.get(req.params.id)?.metadata, { includeInternalState: req.query.includeInternalState === 'true' });
      res.type('application/zip').attachment(`${sanitizeName(registry.get(req.params.id)!.name)}.zip`).send(archive.buffer);
    } catch (error) { sendApiError(res, 400, 'BAD_REQUEST', String(error)); }
  });
  const projectPreviewIframeSandbox = 'allow-scripts allow-forms';
  const HTML_PREVIEW_BRIDGE_MAX_BYTES = 2 * 1024 * 1024;
  const HTML_POWERED_PREVIEW_HINT_SCAN_MAX_BYTES = 128 * 1024 * 1024;
  const projectPreviewCsp = [
    `sandbox ${projectPreviewIframeSandbox}`,
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
  const previewScopeRe = /^[A-Za-z0-9_-]{8,128}$/u;

  function setProjectPreviewHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', projectPreviewCsp);
  }

  // "Powered preview" headers — the opposite trade-off from setProjectPreviewHeaders.
  // Real WebGL / Web Worker / WASM sites (Gaussian-splat viewers, physics demos,
  // ffmpeg.wasm, threaded renderers) need capabilities the opaque-origin preview
  // sandbox blocks: same-origin Workers, real Web Storage, and — for threaded
  // WASM — SharedArrayBuffer, which requires the document to be crossOriginIsolated.
  //
  // `Document-Isolation-Policy: isolate-and-credentialless` grants the SERVED
  // document its own cross-origin-isolated agent cluster WITHOUT requiring the
  // embedding app to opt the whole page into COOP/COEP. That is the key that
  // unlocks SharedArrayBuffer for just this iframe. The `credentialless` variant
  // (vs `require-corp`) still lets artifacts pull no-cors cross-origin
  // subresources (CDN fonts/images) — those loads just drop credentials — so
  // enabling isolation does not blank out otherwise-working artifacts.
  //
  // The web host renders the powered iframe with `allow-same-origin` at the
  // daemon's host-swapped preview origin (see
  // apps/web/src/runtime/powered-preview.ts), so this document gets same-origin
  // Workers/storage for sibling /powered assets while the shared /api
  // middleware rejects browser requests from that origin to normal daemon APIs.
  function setPoweredPreviewHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Document-Isolation-Policy', 'isolate-and-credentialless');
    // Let cross-origin-isolated contexts embed these bytes (the doc + its
    // worker/wasm/asset subresources under the same /powered prefix).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // No CORS headers: powered documents and their relative subresources load
    // from the same /powered loopback origin. Foreign browser origins must not
    // get read access to project files by adding an Origin header.
    res.removeHeader('Content-Security-Policy');
  }

  function rejectInternalVersionPath(res: Response, value: unknown): boolean {
    if (!isProjectFileVersionPath(value)) return false;
    sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
    return true;
  }

  function normalizeProjectFileVersionSource(value: unknown): ProjectFileVersionSource | undefined {
    return value === 'ai' || value === 'manual' || value === 'restore' ? value : undefined;
  }

  function parseProjectFileVersionSourceInput(
    value: unknown,
    fieldName: 'source' | 'versionSource',
  ): ProjectFileVersionSource | undefined {
    if (value === undefined || value === null) return undefined;
    const normalized = normalizeProjectFileVersionSource(value);
    if (normalized) return normalized;
    throw new Error(`invalid ${fieldName}; expected one of: ai, manual, restore`);
  }

  function requestProjectFileVersionSource(value: unknown): ProjectFileVersionSource {
    return parseProjectFileVersionSourceInput(value, 'source') ?? 'manual';
  }

  function requestProjectFileVersionUploadSource(body: any): ProjectFileVersionSource {
    const hasVersionSource = body?.versionSource !== undefined && body?.versionSource !== null;
    return parseProjectFileVersionSourceInput(
      hasVersionSource ? body.versionSource : body?.source,
      hasVersionSource ? 'versionSource' : 'source',
    ) ?? 'manual';
  }

  // Prompt provenance comes only from explicit request inputs; no chat/message store is consulted.

  type HtmlVersionOverride = {
    prompt?: string | null;
    promptSource?: ProjectFileVersionPromptSource;
    source?: ProjectFileVersionSource;
    label?: string | null;
    parentVersionId?: string;
  };

  function htmlVersionOptions(
    project: any,
    override?: HtmlVersionOverride,
  ): {
    prompt: string | null;
    promptSource?: ProjectFileVersionPromptSource;
    source?: ProjectFileVersionSource;
    label?: string;
    parentVersionId?: string;
  } {
    const prompt = typeof override?.prompt === 'string' && override.prompt.trim() ? override.prompt.trim() : null;
    const promptSource = override?.promptSource
      ?? (override?.source === 'manual'
        ? 'manual'
        : override?.source === 'restore'
          ? 'restore'
          : undefined);
    const versionOptions: {
      prompt: string | null;
      promptSource?: ProjectFileVersionPromptSource;
      source?: ProjectFileVersionSource;
      label?: string;
      parentVersionId?: string;
    } = {
      prompt,
    };
    if (promptSource) versionOptions.promptSource = promptSource;
    if (override?.source) versionOptions.source = override.source;
    if (typeof override?.label === 'string' && override.label.trim()) {
      versionOptions.label = override.label.trim();
    }
    if (typeof override?.parentVersionId === 'string' && override.parentVersionId.trim()) {
      versionOptions.parentVersionId = override.parentVersionId.trim();
    }
    return versionOptions;
  }

  type HtmlVersionLock = {
    ensureCurrentVersion: (
      content: string,
      options?: ReturnType<typeof htmlVersionOptions>,
    ) => Promise<ProjectFileVersion | null>;
    createVersion: (
      content: string,
      options?: ReturnType<typeof htmlVersionOptions>,
    ) => Promise<ProjectFileVersion>;
    matchVersionContent: (
      content: string,
      versionId?: string,
    ) => Promise<{
      status: 'matched' | 'missing_version' | 'digest_mismatch' | 'unknown';
      version: ProjectFileVersion | null;
    }>;
  };

  async function matchedHtmlParentVersionId(
    project: any,
    fileName: string,
    requestedParentVersionId: unknown,
    versionLock: HtmlVersionLock,
  ): Promise<string | undefined> {
    if (typeof requestedParentVersionId !== 'string' || !requestedParentVersionId.trim()) {
      return undefined;
    }
    const parentVersionId = requestedParentVersionId.trim();
    try {
      const existing = await readProjectFile(
        PROJECTS_DIR,
        project.id,
        fileName,
        project.metadata,
      );
      const match = await versionLock.matchVersionContent(
        existing.buffer.toString('utf8'),
        parentVersionId,
      );
      return match.status === 'matched' && match.version?.id === parentVersionId
        ? parentVersionId
        : undefined;
    } catch {
      // Missing/unreadable pre-edit bytes cannot prove lineage. The write may
      // still proceed, but the new checkpoint must not inherit an origin.
      return undefined;
    }
  }

  function htmlVersionCaptureWarning(err: unknown): ProjectFileVersionWarning {
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: 'PROJECT_FILE_VERSION_CAPTURE_FAILED',
      message: `HTML version could not be saved: ${message}`,
    };
  }

  async function tryEnsureLockedHtmlCurrentVersion(
    project: any,
    fileName: string,
    content: string,
    ensureCurrentVersion: HtmlVersionLock['ensureCurrentVersion'],
    override?: HtmlVersionOverride,
  ): Promise<{ version: ProjectFileVersion | null; versionWarning?: ProjectFileVersionWarning }> {
    if (!/\.html?$/i.test(fileName)) return { version: null };
    try {
      return { version: await ensureCurrentVersion(content, htmlVersionOptions(project, override)) };
    } catch (err) {
      return { version: null, versionWarning: htmlVersionCaptureWarning(err) };
    }
  }

  function fileFromVersionHistory(fileName: string, versions: ProjectFileVersion[]): ProjectFile | null {
    const latest = versions.at(-1);
    if (!latest) return null;
    return {
      name: latest.fileName || fileName,
      path: latest.fileName || fileName,
      type: 'file',
      size: latest.size,
      mtime: latest.createdAt,
      kind: latest.kind,
      mime: latest.mime,
    };
  }

  // Lets a browser (or the desktop export window, which shares the same Chromium
  // session/cache as the web UI) reuse already-downloaded fonts/CSS/images
  // across loads instead of re-fetching them every time — covers, live preview,
  // and screenshot export all hit /raw/. The ETag/Last-Modified are derived from
  // the file's size+mtime, so any agent rewrite changes them and busts the cache
  // immediately; `no-cache` means "always revalidate" (never serve stale without
  // asking), so a 304 only happens when the bytes are genuinely unchanged.
  function setRawRevalidationHeaders(res: Response, meta: { size: number; mtime: number }): string {
    const mtime = Math.floor(meta.mtime);
    const etag = `W/"${meta.size.toString(16)}-${mtime.toString(16)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', new Date(mtime).toUTCString());
    res.setHeader('Cache-Control', 'no-cache');
    return etag;
  }

  function rawRequestIsFresh(req: any, etag: string, mtimeMs: number): boolean {
    // If-None-Match is authoritative when present (RFC 9110 §13.1.3): freshness
    // is decided solely by whether the ETag matches — do NOT fall through to
    // If-Modified-Since. Otherwise a same-second rewrite (ETag changes
    // immediately, but Last-Modified is identical at HTTP-date second
    // granularity) would 304 stale-but-changed bytes when a client sends both a
    // non-matching ETag and the current If-Modified-Since.
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string') {
      return ifNoneMatch.split(',').some((tag) => tag.trim() === etag);
    }
    const ifModifiedSince = req.headers['if-modified-since'];
    if (typeof ifModifiedSince === 'string') {
      const since = Date.parse(ifModifiedSince);
      // Last-Modified is second-resolution, so compare at second granularity.
      if (Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since) return true;
    }
    return false;
  }

  // RFC 9110 §13.1.5: a Range request with If-Range may only be served as 206
  // when the If-Range validator still matches the current representation; if it
  // doesn't (the file changed), the range must be ignored and the full current
  // file returned, so a resumed download can't splice stale + fresh bytes.
  //
  // §13.1.5 also requires the entity-tag form to use a STRONG validator. Our
  // ETag is weak (`W/"size-mtime"` — size+mtime is not byte-exact), so an
  // entity-tag If-Range can never authorize partial content: a same-size rewrite
  // or mtime-granularity collision could otherwise splice stale + fresh bytes
  // under a matching weak tag. We therefore reject ALL entity-tag If-Range values
  // (weak ones explicitly; a strong `"…"` never equals our weak ETag anyway) and
  // honor only the date form.
  function ifRangeAllowsPartial(req: any, _etag: string, mtimeMs: number): boolean {
    const ifRange = req.headers['if-range'];
    if (typeof ifRange !== 'string' || ifRange.length === 0) return true; // no If-Range → honor Range
    const value = ifRange.trim();
    // Any entity-tag (weak `W/"…"` or strong `"…"`) → not a strong match against
    // our weak validator → fall back to the full 200.
    if (value.startsWith('"') || value.startsWith('W/')) return false;
    // Date form: honor the range only if the file has NOT changed since (its
    // current Last-Modified is at/before the If-Range date).
    const since = Date.parse(value);
    return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
  }

  function htmlHasPoweredPreviewSignal(source: string): boolean {
    if (/\bSharedArrayBuffer\b/.test(source)) return true;
    if (/\bnew\s+(?:Worker|SharedWorker)\s*\(/.test(source)) return true;
    if (/\bimportScripts\s*\(/.test(source)) return true;
    if (/\bWebAssembly\s*\.\s*(?:instantiateStreaming|compileStreaming)\b/.test(source)) return true;
    if (/\.wasm\b/.test(source)) return true;
    if (/getContext\s*\(\s*["'`]webgl2["'`]/.test(source)) return true;
    if (/\bOffscreenCanvas\b/.test(source)) return true;
    if (/\bnavigator\s*\.\s*gpu\b/.test(source)) return true;
    return false;
  }

  async function detectPoweredPreviewHint(meta: {
    filePath: string;
    mime: string;
    size: number;
  }): Promise<ProjectFileTextPreviewResponse['poweredPreview']> {
    if (!/^text\/html(?:;|$)/i.test(meta.mime)) {
      return { required: false, scannedBytes: 0, complete: true };
    }
    const scanLimit = Math.min(meta.size, HTML_POWERED_PREVIEW_HINT_SCAN_MAX_BYTES);
    if (scanLimit <= 0) {
      return { required: false, scannedBytes: 0, complete: true };
    }

    let scannedBytes = 0;
    let tail = '';
    for await (const chunk of fs.createReadStream(meta.filePath, {
      start: 0,
      end: scanLimit - 1,
      highWaterMark: 256 * 1024,
    })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      scannedBytes += buffer.byteLength;
      const sample = tail + buffer.toString('utf8');
      if (htmlHasPoweredPreviewSignal(sample)) {
        return {
          required: true,
          scannedBytes,
          complete: scannedBytes >= meta.size,
        };
      }
      tail = sample.slice(-512);
    }

    return {
      required: false,
      scannedBytes,
      complete: scannedBytes >= meta.size,
    };
  }

  async function sendProjectFile(
    req: any,
    res: Response,
    projectId: string,
    relPath: string,
    metadata?: unknown,
    beforeSend?: (mime: string) => void,
    transformFile?: (file: { mime: string; buffer: Buffer }) => Buffer | string | Promise<Buffer | string>,
    revalidate = false,
  ) {
    const meta = await resolveProjectFilePath(
      PROJECTS_DIR,
      projectId,
      relPath,
      metadata,
    );
    beforeSend?.(meta.mime);

    // Called only after the enclosing route authorizes project access. Derivatives
    // use the same real-path guard as originals; no remote URL or user cache path.
    if (req.query.odCanvasPreview !== undefined) {
      const kind = req.query.odCanvasPreview as CanvasPreviewKind;
      const width = Number(req.query.odPreviewWidth ?? (kind === 'video' ? 512 : 256));
      if (!['image', 'poster', 'video'].includes(kind) || !PREVIEW_WIDTHS.some(value => value === width)
        || (kind !== 'image' && width > 512)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid canvas preview options');
      }
      if (kind === 'image' ? !meta.mime.startsWith('image/') : !meta.mime.startsWith('video/')) {
        return sendApiError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'invalid canvas preview source');
      }
      const etag = `W/"canvas-v1-${kind}-${width}-${meta.size}-${meta.mtime}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      if (rawRequestIsFresh(req, etag, meta.mtime)) return res.status(304).end();
      try {
        const body = await createCanvasPreview({ ...meta, kind, width, runtimeDir: registry.dataRoot });
        res.setHeader('Content-Type', kind === 'image' ? 'image/webp' : kind === 'poster' ? 'image/jpeg' : 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        const range = ifRangeAllowsPartial(req, etag, meta.mtime) ? parseByteRange(req.headers.range, body.length) : null;
        if (range === 'unsatisfiable') { res.setHeader('Content-Range', `bytes */${body.length}`); return res.status(416).end(); }
        if (range) {
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${body.length}`);
          return res.status(206).send(body.subarray(range.start, range.end + 1));
        }
        return res.status(200).send(body);
      } catch {
        res.removeHeader('ETag');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Retry-After', '30');
        return sendApiError(res, 503, 'PREVIEW_UNAVAILABLE', 'preview unavailable; use original');
      }
    }

    const isStreamed = meta.mime.startsWith('video/') || meta.mime.startsWith('audio/');
    const shouldStreamBody = isStreamed || !transformFile;
    // A transform (the Vite dev-entry -> dist/index.html substitution, or preview
    // bridge injection) can replace the response bytes — but only for HTML. For
    // HTML the source file's mtime/size is NOT a valid validator, so its ETag is
    // computed from the actual sent bytes after the transform. Everything else
    // (assets, fonts, images, streamed media — where the transform is a no-op)
    // keeps the fast mtime ETag with an early 304.
    const willSubstitute =
      !isStreamed && !!transformFile && /^text\/html(?:;|$)/i.test(meta.mime);

    let currentEtag: string | null = null;
    if (revalidate && !willSubstitute) {
      currentEtag = setRawRevalidationHeaders(res, meta);
      if (rawRequestIsFresh(req, currentEtag, meta.mtime)) {
        return res.status(304).end();
      }
    }

    if (shouldStreamBody) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', meta.mime);

      if (meta.size === 0) {
        res.setHeader('Content-Length', '0');
        return res.status(200).end();
      }

      // Honor Range only when If-Range still matches the current file — otherwise
      // a resumed download after a rewrite would splice stale + fresh bytes.
      const range =
        currentEtag === null || ifRangeAllowsPartial(req, currentEtag, meta.mtime)
          ? parseByteRange(req.headers.range, meta.size)
          : null;

      if (range === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${meta.size}`);
        return res.status(416).end();
      }

      let start;
      let end;
      let statusCode;
      if (range) {
        ({ start, end } = range);
        statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${meta.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
      } else {
        start = 0;
        end = meta.size - 1;
        statusCode = 200;
        res.setHeader('Content-Length', String(meta.size));
      }

      res.status(statusCode);
      const stream = fs.createReadStream(meta.filePath, { start, end });
      stream.on('error', (streamErr: any) => {
        if (!res.headersSent) {
          sendApiError(res, 500, 'STREAM_ERROR', String(streamErr));
        } else {
          res.destroy(streamErr);
        }
      });
      stream.pipe(res);
      return;
    }

    const file = await readProjectFile(PROJECTS_DIR, projectId, relPath, metadata);
    const body = transformFile ? await transformFile(file) : file.buffer;
    if (revalidate && willSubstitute) {
      // Validator from the ACTUAL response bytes, so a change to the substituted
      // content (e.g. dist/index.html) busts the cache even when the source
      // file's mtime is unchanged.
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const etag = `W/"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Last-Modified', new Date(Math.floor(meta.mtime)).toUTCString());
      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((tag) => tag.trim() === etag)) {
        return res.status(304).end();
      }
      return res.type(file.mime).send(buf);
    }
    res.type(file.mime).send(body);
  }

  function previewFilePathForProject(project: any, queryFile: unknown): string {
    if (typeof queryFile === 'string' && queryFile.trim().length > 0) {
      return queryFile;
    }
    const entryFile = project?.metadata?.entryFile;
    return typeof entryFile === 'string' && entryFile.length > 0 ? entryFile : 'index.html';
  }

  function encodeProjectPathForUrl(filePath: string): string {
    return filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  function injectProjectPreviewBase(
    html: string,
    projectId: string,
    ownerFilePath: string,
    scope: string,
  ): string {
    // Respect an artifact-authored base URL. Only generated documents without
    // one need the containment base that keeps runtime-created relative URLs
    // (for example `img.src = payload.logo`) on the minted preview scope.
    if (/<base\b/i.test(html)) return html;
    const ownerDir = path.posix.dirname(ownerFilePath);
    const dirSuffix = ownerDir === '.'
      ? ''
      : `${encodeProjectPathForUrl(ownerDir)}/`;
    const baseTag = `<base href="/api/projects/${encodeURIComponent(projectId)}`
      + `/preview/${encodeURIComponent(scope)}/${dirSuffix}">`;
    const head = /<head\b[^>]*>/i;
    if (head.test(html)) return html.replace(head, (tag) => `${tag}${baseTag}`);
    return `${baseTag}${html}`;
  }

  function rewriteWorkspaceScopedHtmlAssetUrls(
    html: string,
    projectId: string,
    ownerFilePath: string,
    workspaceId: string,
    workspaceMemberId: string,
  ): string {
    const assetAttr = /(\s)(src|poster|data-src)(\s*=\s*)(["'])([^"']*)\4/gi;
    const linkTag = /<link\b[^>]*>/gi;
    const linkHref = /(\shref\s*=\s*)(["'])([^"']*)\2/i;
    const srcsetAttr = /(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi;
    const cssUrl = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    const ownerDir = path.posix.dirname(ownerFilePath);
    const scopeQuery = `workspaceId=${encodeURIComponent(workspaceId)}`
      + `&workspaceMemberId=${encodeURIComponent(workspaceMemberId)}`;

    const rewrite = (ref: string): string => {
      const trimmed = ref.trim();
      if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(trimmed)) return ref;
      const match = trimmed.match(/^([^?#]*)([?#][\s\S]*)?$/);
      const rawPath = match?.[1] ?? trimmed;
      const suffix = match?.[2] ?? '';
      let decodedPath = rawPath;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch {
        return ref;
      }
      const resolved = path.posix.normalize(path.posix.join(ownerDir, decodedPath));
      if (!resolved || resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) {
        return ref;
      }
      const scoped = `/api/projects/${encodeURIComponent(projectId)}/raw/`
        + `${encodeProjectPathForUrl(resolved)}?${scopeQuery}`;
      if (!suffix) return scoped;
      if (suffix.startsWith('#')) return `${scoped}${suffix}`;
      return `${scoped}&${suffix.slice(1)}`;
    };

    let next = html.replace(
      assetAttr,
      (match, space: string, name: string, eq: string, quote: string, value: string) => {
        const rewritten = rewrite(value);
        return rewritten === value ? match : `${space}${name}${eq}${quote}${rewritten}${quote}`;
      },
    );
    next = next.replace(linkTag, (tag) =>
      tag.replace(linkHref, (match, prefix: string, quote: string, value: string) => {
        const rewritten = rewrite(value);
        return rewritten === value ? match : `${prefix}${quote}${rewritten}${quote}`;
      }),
    );
    next = next.replace(srcsetAttr, (match, prefix: string, quote: string, value: string) => {
      // A data URL contains an unescaped comma, so the lightweight candidate
      // splitter below cannot safely rewrite a mixed data-URL srcset. Leave the
      // whole attribute untouched rather than corrupting embedded bytes.
      if (/(?:^|,\s*)data:/i.test(value)) return match;
      const rewritten = value
        .split(',')
        .map((candidate) => {
          const body = candidate.trim();
          if (!body) return candidate;
          const [url = '', ...descriptors] = body.split(/\s+/);
          const rewrittenUrl = rewrite(url);
          if (rewrittenUrl === url) return candidate;
          const leading = candidate.match(/^\s*/)?.[0] ?? '';
          return `${leading}${[rewrittenUrl, ...descriptors].join(' ')}`;
        })
        .join(',');
      return rewritten === value ? match : `${prefix}${quote}${rewritten}${quote}`;
    });
    return next.replace(cssUrl, (match, quote: string, value: string) => {
      const rewritten = rewrite(value);
      return rewritten === value ? match : `url(${quote}${rewritten}${quote})`;
    });
  }

  async function maybeResolveVitePreviewHtml({
    file,
    projectId,
    relPath,
    metadata,
    projectsRoot,
    readProjectFile,
  }: {
    file: { mime: string; buffer: Buffer };
    projectId: string;
    relPath: string;
    metadata?: unknown;
    projectsRoot: string;
    readProjectFile: (projectsRoot: string, projectId: string, relPath: string, metadata?: unknown) => Promise<{ buffer: Buffer }>;
  }): Promise<Buffer | string> {
    if (!/^text\/html(?:;|$)/i.test(file.mime)) return file.buffer;
    const html = file.buffer.toString('utf8');
    if (!isViteDevHtmlEntry(html)) return file.buffer;

    const ownerDir = path.posix.dirname(relPath);
    const distRelPath = ownerDir === '.' ? 'dist/index.html' : `${ownerDir}/dist/index.html`;
    try {
      const distFile = await readProjectFile(projectsRoot, projectId, distRelPath, metadata);
      return rewriteViteDistAssetUrlsForPreview(distFile.buffer.toString('utf8'));
    } catch {
      return file.buffer;
    }
  }

  function isViteDevHtmlEntry(html: string): boolean {
    return /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']\/src\/[^"']+["'][^>]*>\s*<\/script>/i.test(html);
  }

  function rewriteViteDistAssetUrlsForPreview(html: string): string {
    return html.replace(
      /\b(href|src)\s*=\s*(["'])\/assets\//gi,
      (_match, attr: string, quote: string) => `${attr}=${quote}dist/assets/`,
    );
  }

  // Project files. Each project owns a flat folder under .bezier/projects/<id>/
  // containing every file the user has uploaded, pasted, sketched, or that
  // the agent has generated. Names are sanitized; paths are confined to the
  // project's own folder (see apps/daemon/src/projects.ts).
  app.get('/api/projects/:id/files', async (req, res) => {
    try {
      const since = Number(req.query?.since);
      const project = registry.get(req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const files = await listFiles(PROJECTS_DIR, req.params.id, {
        since: Number.isFinite(since) ? since : undefined,
        scope: req.query.scope === 'all' ? 'all' : 'artifacts',
        metadata: project?.metadata,
      });
      if (ctx.sketchDocuments) {
        const remote = await ctx.sketchDocuments.listed(project.id);
        const seen = new Set(files.map(file => file.name));
        for (const file of remote) if (!seen.has(file.name)) files.push(file);
      }
      if (ctx.imageFiles) {
        const seen = new Set(files.map(file => file.name));
        for (const file of await ctx.imageFiles.list(project.id)) if (!seen.has(file.name)) files.push(file);
      }
      /** @type {import('@bezier/contracts').ProjectFilesResponse} */
      const body = { files };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/search', async (req, res) => {
    try {
      const searchProject = registry.get(req.params.id);
      if (!searchProject) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, searchProject.id, { mode: 'read' })) return;
      const query = String(req.query.q ?? '');
      if (!query) {
        sendApiError(res, 400, 'BAD_REQUEST', 'q query parameter is required');
        return;
      }
      const pattern = req.query.pattern ? String(req.query.pattern) : null;
      const max = Math.min(Number(req.query.max) || 200, 1000);
      const matches = await searchProjectFiles(PROJECTS_DIR, req.params.id, query, {
        pattern,
        max,
        metadata: searchProject?.metadata,
      });
      res.json({ query, matches });
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/folders', async (req, res) => {
    try {
      const project = registry.get(req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const folders = await listProjectFolders(PROJECTS_DIR, req.params.id, {
        metadata: project.metadata,
      });
      /** @type {import('@bezier/contracts').ProjectFoldersResponse} */
      const body = { folders };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/projects/:id/folders', async (req, res) => {
    try {
      const { name } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      const project = registry.get(req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write' })) return;
      const folder = await createProjectFolder(
        PROJECTS_DIR,
        req.params.id,
        name,
        project.metadata,
      );
      /** @type {import('@bezier/contracts').ProjectFolderResponse} */
      const body = { folder };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.delete('/api/projects/:id/folders', async (req, res) => {
    try {
      const { path: folderPath } = req.body || {};
      if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'path required');
      }
      const project = registry.get(req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write' })) return;
      await deleteProjectFolder(
        PROJECTS_DIR,
        req.params.id,
        folderPath,
        project.metadata,
      );
      /** @type {import('@bezier/contracts').DeleteProjectFolderResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.get('/api/projects/:id/preview-url', async (req, res) => {
    try {
      const project = registry.get(req.params.id);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const requestedPath = previewFilePathForProject(project, req.query.file);
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        project.id,
        requestedPath,
        project.metadata,
      );
      const scope = projectPreviewScopes.mint(project.id);
      /** @type {import('@bezier/contracts').ProjectPreviewUrlResponse} */
      const body = {
        url: `/api/projects/${encodeURIComponent(project.id)}/preview/${scope}/${encodeProjectPathForUrl(meta.name)}`,
        file: meta.name,
        csp: projectPreviewCsp,
        iframeSandbox: projectPreviewIframeSandbox,
        opaqueOrigin: true,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/text-preview\/(.+)$/u, async (req, res) => {
    let handle: import('fs/promises').FileHandle | null = null;
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, relPath)) return;
      const requestedLimit = Number(req.query.limit);
      const limit = Math.max(
        1024,
        Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 96 * 1024, 512 * 1024),
      );
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        projectId,
        relPath,
        project?.metadata,
      );
      const bytesToRead = Math.min(meta.size, limit);
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const opened = await fs.promises.open(meta.filePath, 'r');
      handle = opened;
      const result = bytesToRead > 0
        ? await opened.read(buffer, 0, bytesToRead, 0)
        : { bytesRead: 0 };
      const text = buffer.subarray(0, result.bytesRead).toString('utf8');
      const poweredPreview = await detectPoweredPreviewHint(meta);
      const body: ProjectFileTextPreviewResponse = {
        text,
        truncated: meta.size > result.bytesRead,
        size: meta.size,
        limit,
        mime: meta.mime,
        kind: meta.kind,
        poweredPreview,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/preview\/([^/]+)\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const scope = String(params[1] ?? '');
      const relPath = String(params[2] ?? '');
      if (!previewScopeRe.test(scope)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'invalid preview scope');
        return;
      }
      const project = registry.get(projectId);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      const previewWorkspace = projectPreviewScopes.resolve(project.id, scope);
      if (previewWorkspace === undefined) {
        sendApiError(res, 404, 'PREVIEW_SCOPE_NOT_FOUND', 'preview scope not found');
        return;
      }
      if (!await authorizeProjectRequest(req, res, projectId, { mode: 'read', allowNavigationQuery: true })) return;
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      await sendProjectFile(
        req,
        res,
        project.id,
        relPath,
        project.metadata,
        () => setProjectPreviewHeaders(res),
        async (file) => maybeResolveVitePreviewHtml({
          file,
          projectId: project.id,
          relPath,
          metadata: project.metadata,
          projectsRoot: PROJECTS_DIR,
          readProjectFile,
        }),
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });


  // Preflight for the raw file route. Current artifact fetches are simple GETs
  // (no preflight needed), but an explicit handler future-proofs the route if
  // artifacts ever add custom request headers.
  app.options(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, (req, res) => {
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
      if (rejectInternalVersionPath(res, relPath)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      // PreviewModal loads artifact HTML via srcdoc, giving the iframe Origin: "null".
      // data: URIs, file://, and some sandboxed iframes also send null — all are
      // local-only callers, so this is safe. Real cross-origin sites send a real
      // origin and remain blocked by the browser's same-origin policy.
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      if (ctx.sketchDocuments && /\.(?:sketch\.json|excalidraw)$/i.test(relPath)) {
        const scene=await ctx.sketchDocuments.read(relPath);
        if(typeof scene==='string'){
          res.set('Cache-Control','private, no-store').type('application/json; charset=utf-8').send(scene);
          return;
        }
        if(scene===null)return sendApiError(res,404,'FILE_NOT_FOUND','Sketch is not present in its App storage');
      }
      if (await sendCloudImage(req, res, ctx.imageFiles, projectId, relPath)) return;
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        projectId,
        relPath,
        project?.metadata,
      );
      const thumbnailWidthInput = req.query.odThumbnailWidth;
      if (thumbnailWidthInput !== undefined) {
        const thumbnailWidth = Number(thumbnailWidthInput);
        if (!Number.isInteger(thumbnailWidth) || thumbnailWidth < 16 || thumbnailWidth > 512) {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'odThumbnailWidth must be an integer between 16 and 512',
          );
        }
        if (!meta.mime.startsWith('image/')) {
          return sendApiError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'thumbnail source must be an image');
        }

        const etag = `W/"thumb-v2-${thumbnailWidth}-${meta.size.toString(16)}-${Math.floor(meta.mtime).toString(16)}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', new Date(Math.floor(meta.mtime)).toUTCString());
        res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=86400');
        if (rawRequestIsFresh(req, etag, meta.mtime)) return res.status(304).end();

        const body = await createCanvasPreview({ ...meta, kind: 'image', width: thumbnailWidth,
          fit: 'cover', runtimeDir: registry.dataRoot });
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', String(body.length));
        return res.status(200).send(body);
      }
      const skipHtmlPreviewBridge =
        /^text\/html(?:;|$)/i.test(meta.mime) && meta.size > HTML_PREVIEW_BRIDGE_MAX_BYTES;

      await sendProjectFile(
        req,
        res,
        projectId,
        relPath,
        project?.metadata,
        undefined,
        skipHtmlPreviewBridge ? undefined : async (file) => {
          const transformed = await maybeResolveVitePreviewHtml({
            file,
            projectId,
            relPath,
            metadata: project?.metadata,
            projectsRoot: PROJECTS_DIR,
            readProjectFile,
          });
          const bridged = applyUrlPreviewBridgesToHtml(
            transformed,
            file.mime,
            req.query.odPreviewBridge,
          );
          const workspaceId = typeof req.query.workspaceId === 'string'
            ? req.query.workspaceId
            : null;
          const workspaceMemberId = typeof req.query.workspaceMemberId === 'string'
            ? req.query.workspaceMemberId
            : null;
          if (!/^text\/html(?:;|$)/i.test(file.mime)) {
            return bridged;
          }
          let html = Buffer.isBuffer(bridged) ? bridged.toString('utf8') : String(bridged);
          if (workspaceId && workspaceMemberId) {
            html = rewriteWorkspaceScopedHtmlAssetUrls(
              html,
              projectId,
              relPath,
              workspaceId,
              workspaceMemberId,
            );
          }
          // Plain raw-file reads (code view, download, API clients) must keep
          // returning the same bytes as before. The containment base is only a
          // URL-preview transport detail requested by FileViewer.
          if (req.query.odPreviewBridge === undefined) return html;
          const scope = projectPreviewScopes.mint(projectId);
          return injectProjectPreviewBase(
            html,
            projectId,
            relPath,
            scope,
          );
        },
        true, // revalidate: emit ETag/Last-Modified so covers/preview/export reuse cached assets
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // Explicitly do not grant CORS for powered previews. Same-origin subresource
  // reads under the powered loopback URL do not preflight; foreign preflights
  // should complete without ACAO so browsers block the read.
  app.options(/^\/api\/projects\/([^/]+)\/powered\/(.+)$/u, (_req, res) => {
    res.sendStatus(204);
  });

  // "Powered preview" file serving. Mirrors /raw but stamps every response
  // (the HTML document AND its relatively-referenced worker/wasm/asset
  // subresources, which resolve under the same /powered/ prefix) with the
  // cross-origin-isolation headers from setPoweredPreviewHeaders. This is the
  // serving half of WebGL/Worker/WASM/SharedArrayBuffer support; the web host
  // decides when to route a preview here (see file-viewer-render-mode.ts).
  app.get(/^\/api\/projects\/([^/]+)\/powered\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, relPath)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        projectId,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        projectId,
        relPath,
        project?.metadata,
      );
      const skipPoweredTransform =
        /^text\/html(?:;|$)/i.test(meta.mime) && meta.size > HTML_PREVIEW_BRIDGE_MAX_BYTES;
      await sendProjectFile(
        req,
        res,
        projectId,
        relPath,
        project?.metadata,
        () => setPoweredPreviewHeaders(res),
        skipPoweredTransform ? undefined : async (file) => {
          const transformed = await maybeResolveVitePreviewHtml({
            file,
            projectId,
            relPath,
            metadata: project?.metadata,
            projectsRoot: PROJECTS_DIR,
            readProjectFile,
          });
          return applyUrlPreviewBridgesToHtml(transformed, file.mime, req.query.odPreviewBridge);
        },
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.delete(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const rawSplat = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, rawSplat)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write' })) return;
      await deleteProjectFile(PROJECTS_DIR, projectId, rawSplat, project?.metadata);
      await markProjectFileVersionStoreDeleted(PROJECTS_DIR, projectId, rawSplat, project?.metadata);
      /** @type {import('@bezier/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.get('/api/projects/:id/files/:name/preview', async (req, res) => {
    try {
      const project = registry.get(req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      const file = await readProjectFile(
        PROJECTS_DIR,
        req.params.id,
        req.params.name,
        project?.metadata,
      );
      const preview = await buildDocumentPreview(file, registry.dataRoot);
      res.json(preview);
    } catch (err: any) {
      const status =
        err && err.statusCode
          ? err.statusCode
          : err && err.code === 'ENOENT'
            ? 404
            : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        err?.message || 'preview unavailable',
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      if (!/\.html?$/i.test(fileName)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'versions are only available for HTML files');
      }
      let file: ProjectFile | Awaited<ReturnType<typeof readProjectFile>> | null = null;
      let historyFileName = fileName;
      let workingFileContent: string | null = null;
      try {
        const workingFile = await readProjectFile(PROJECTS_DIR, project.id, fileName, project.metadata);
        if (!/\.html?$/i.test(workingFile.name)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'versions are only available for HTML files');
        }
        file = workingFile;
        historyFileName = workingFile.name;
        workingFileContent = workingFile.buffer.toString('utf8');
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
      let versions = await listProjectFileVersions(PROJECTS_DIR, project.id, historyFileName, project.metadata);
      // Bootstrapping a baseline version is a WRITE, so it belongs only to a
      // caller with write authority over this project. A readonly member
      // reading a mirror of someone else's shared project gets the truthful
      // empty history instead — the owner's real history can never be here
      // (`.file-versions` is excluded from member mirrors), so synthesizing
      // one would only manufacture history that never existed, inside a
      // project the member is told they cannot modify. The read itself is
      // never refused: browsing history stays open (飞书 recvq56vFjQKfT).
      if (workingFileContent !== null && versions.length === 0
        && (!ctx.authorize || await ctx.canWrite?.(req, project.id) === true)) {
        const initial = await ensureCurrentProjectFileVersion(
          PROJECTS_DIR,
          project.id,
          historyFileName,
          workingFileContent,
          { source: 'manual', promptSource: 'manual' },
          project.metadata,
        );
        if (initial) {
          versions = await listProjectFileVersions(PROJECTS_DIR, project.id, historyFileName, project.metadata);
        }
      }
      file ??= fileFromVersionHistory(historyFileName, versions);
      if (!file) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      }
      /** @type {import('@bezier/contracts').ProjectFileVersionsResponse} */
      const body = { file, versions };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.post(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write' })) return;
      const requestedFile = await readProjectFile(PROJECTS_DIR, project.id, fileName, project.metadata);
      if (!/\.html?$/i.test(requestedFile.name)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'versions are only available for HTML files');
      }
      const manualPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : null;
      const requestedSource = requestProjectFileVersionSource(req.body?.source);
      const versionOptions: {
        prompt: string | null;
        promptSource?: ProjectFileVersionPromptSource;
        source: ProjectFileVersionSource;
        label?: string | null;
        parentVersionId?: string;
      } = {
        prompt: manualPrompt,
        source: requestedSource,
        label: typeof req.body?.label === 'string' ? req.body.label : null,
      };
      if (manualPrompt) {
        versionOptions.promptSource = 'manual';
      } else if (requestedSource === 'manual') {
        versionOptions.promptSource = 'manual';
      } else if (requestedSource === 'restore') {
        versionOptions.promptSource = 'restore';
      }
      const version = await withProjectFileVersionLock(
        PROJECTS_DIR,
        project.id,
        requestedFile.name,
        project.metadata,
        async (versionLock) => {
          const currentFile = await readProjectFile(
            PROJECTS_DIR,
            project.id,
            requestedFile.name,
            project.metadata,
          );
          const parentVersionId = requestedSource === 'manual'
            ? await matchedHtmlParentVersionId(
              project,
              currentFile.name,
              req.body?.parentVersionId,
              versionLock,
            )
            : undefined;
          return versionLock.createVersion(
            currentFile.buffer.toString('utf8'),
            {
              ...versionOptions,
              ...(parentVersionId ? { parentVersionId } : {}),
            },
          );
        },
      );
      if (!version) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'version could not be created');
      }
      /** @type {import('@bezier/contracts').CreateProjectFileVersionResponse} */
      const body = { version };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.post(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions\/([^/]+)\/restore$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      const versionId = String(params[2] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write' })) return;
      const restored = await readProjectFileVersion(
        PROJECTS_DIR,
        project.id,
        fileName,
        versionId,
        project.metadata,
      );
      const requestPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
        ? req.body.prompt.trim()
        : null;
      const prompt = requestPrompt
        ?? restored.version.prompt
        ?? null;
      const { file, version, versionWarning } = await withProjectFileVersionLock(
        PROJECTS_DIR,
        project.id,
        fileName,
        project.metadata,
        async (versionLock) => {
          const file = await writeProjectFile(
            PROJECTS_DIR,
            project.id,
            fileName,
            Buffer.from(restored.content, 'utf8'),
            {},
            project.metadata,
          );
          let version: ProjectFileVersion | null = null;
          let versionWarning: ProjectFileVersionWarning | undefined;
          try {
            version = await versionLock.createVersion(restored.content, {
              prompt,
              promptSource: requestPrompt ? 'manual' : 'restore',
              source: 'restore',
              restoreFromVersionId: restored.version.id,
            });
          } catch (err) {
            versionWarning = htmlVersionCaptureWarning(err);
          }
          return { file, version, versionWarning };
        },
      );
      /** @type {import('@bezier/contracts').RestoreProjectFileVersionResponse} */
      const body = { file, version, ...(versionWarning ? { versionWarning } : {}) };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'VERSION_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)\/versions\/([^/]+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const fileName = String(params[1] ?? '');
      const versionId = String(params[2] ?? '');
      if (rejectInternalVersionPath(res, fileName)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const body = await readProjectFileVersion(
        PROJECTS_DIR,
        project.id,
        fileName,
        versionId,
        project.metadata,
      );
      /** @type {import('@bezier/contracts').ProjectFileVersionResponse} */
      const typedBody = body;
      res.setHeader('Cache-Control', 'no-store');
      res.json(typedBody);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'VERSION_NOT_FOUND' : 'BAD_REQUEST',
        String(err?.message || err),
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileSplat = String(params[1] ?? '');
      if (rejectInternalVersionPath(res, fileSplat)) return;
      const project = registry.get(projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(
        req,
        res,
        project.id,
        { mode: 'read', allowNavigationQuery: true },
      )) return;
      if (ctx.sketchDocuments && /\.(?:sketch\.json|excalidraw)$/i.test(fileSplat)) {
        const remote = await ctx.sketchDocuments.read(fileSplat);
        if (typeof remote === 'string') {
          res.type('application/json; charset=utf-8').send(remote);
          return;
        }
      }
      // Stream originals (especially videos) instead of buffering the whole file.
      if (await sendCloudImage(req, res, ctx.imageFiles, projectId, fileSplat)) return;
      await sendProjectFile(req, res, projectId, fileSplat, project?.metadata, undefined, undefined, true);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // Two ways to upload: multipart for binary files (images), and JSON
  // {name, content, encoding} for sketches and pasted text. The frontend
  // uses both depending on the file source.
  app.post(
    '/api/projects/:id/files',
    async (req, res, next) => {
      if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'write' })) return;
      upload.single('file')(req, res, (err: any) => {
        if (err) return sendMulterError(res, err);
        next();
      });
    },
    async (req, res) => {
      try {
        const uploadProject = registry.get(req.params.id);
        const cleanupRejectedUpload = () => {
          if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
        };
        if (!uploadProject) {
          cleanupRejectedUpload();
          return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        }
        if (!await authorizeProjectRequest(req, res, req.params.id, { mode: 'write' })) {
          cleanupRejectedUpload();
          return;
        }
        await ensureProject(PROJECTS_DIR, req.params.id, uploadProject?.metadata);
        if (req.file) {
          try {
            const buf = await fs.promises.readFile(req.file.path);
            // A caller-supplied `name` may carry an intentional subdirectory
            // (e.g. "imagery/hero.png" from the design-kit uploader). Preserve it
            // with sanitizePath (sanitizes each segment, keeps the slashes) so the
            // file lands where brand.json references it; sanitizeName would flatten
            // the slash to "_" and orphan the asset at the project root. Raw
            // multipart originalnames are plain basenames, so sanitizeName fits.
            const desiredName = req.body?.name
              ? sanitizePath(req.body.name)
              : sanitizeName(decodeMultipartFilename(req.file.originalname));
            if (rejectInternalVersionPath(res, desiredName)) return;
            await ctx.guardLegacyFileWrite?.(req.params.id, desiredName);
            const requestedSource = uploadProject && /\.html?$/i.test(desiredName)
              ? requestProjectFileVersionUploadSource(req.body)
              : null;
            const writeAndCapture = async (versionLock?: HtmlVersionLock) => {
              const parentVersionId = uploadProject && requestedSource === 'manual' && versionLock
                ? await matchedHtmlParentVersionId(
                  uploadProject,
                  desiredName,
                  req.body?.parentVersionId,
                  versionLock,
                )
                : undefined;
              const meta = await writeProjectFile(
                PROJECTS_DIR,
                req.params.id,
                desiredName,
                buf,
                {},
                uploadProject?.metadata,
              );
              const versionCapture = uploadProject && requestedSource && /\.html?$/i.test(meta.name) && versionLock
                ? await (async () => {
                  const savedFile = await readProjectFile(PROJECTS_DIR, uploadProject.id, meta.name, uploadProject.metadata);
                  return tryEnsureLockedHtmlCurrentVersion(
                    uploadProject,
                    meta.name,
                    savedFile.buffer.toString('utf8'),
                    versionLock.ensureCurrentVersion,
                    {
                      prompt: typeof req.body?.versionPrompt === 'string' ? req.body.versionPrompt : null,
                      promptSource: 'manual',
                      source: requestedSource,
                      label: typeof req.body?.versionLabel === 'string' ? req.body.versionLabel : null,
                      ...(parentVersionId ? { parentVersionId } : {}),
                    },
                  );
                })()
                : null;
              return { meta, versionCapture };
            };
            const { meta, versionCapture } = uploadProject && requestedSource
              ? await withProjectFileVersionLock(
                PROJECTS_DIR,
                req.params.id,
                desiredName,
                uploadProject.metadata,
                (versionLock) => writeAndCapture(versionLock),
              )
              : await writeAndCapture();
            /** @type {import('@bezier/contracts').ProjectFileResponse} */
            const body = {
              file: meta,
              ...(versionCapture ? { version: versionCapture.version } : {}),
              ...(versionCapture?.versionWarning ? { versionWarning: versionCapture.versionWarning } : {}),
            };
            return res.json(body);
          } finally {
            fs.promises.unlink(req.file.path).catch(() => {});
          }
        }
        const {
          name,
          content,
          encoding,
          artifactManifest,
          artifact,
          overwrite,
          versionLabel,
          versionPrompt,
          parentVersionId: requestedParentVersionId,
        } = req.body || {};
        if (typeof name !== 'string' || typeof content !== 'string') {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'name and content required',
          );
        }
        if (rejectInternalVersionPath(res, name)) return;
        const desiredName = sanitizePath(name);
        if (rejectInternalVersionPath(res, desiredName)) return;
        await ctx.guardLegacyFileWrite?.(req.params.id, desiredName);
        if (ctx.sketchDocuments && encoding !== 'base64' && artifact !== true && /\.(?:sketch\.json|excalidraw)$/i.test(desiredName)) {
          const saved = await ctx.sketchDocuments.write(desiredName, content);
          if (saved) return res.json({ file: saved });
        }
        const requestedSource = uploadProject && /\.html?$/i.test(desiredName)
          ? requestProjectFileVersionUploadSource(req.body)
          : null;
        if (artifactManifest !== undefined && artifactManifest !== null) {
          const validated = validateArtifactManifestInput(
            artifactManifest,
            name,
          );
          if (!validated.ok) {
            return sendApiError(
              res,
              400,
              'BAD_REQUEST',
              `invalid artifactManifest: ${validated.error}`,
            );
          }
        }
        const buf =
          encoding === 'base64'
            ? Buffer.from(content, 'base64')
            : Buffer.from(content, 'utf8');
        const writeAndCapture = async (versionLock?: HtmlVersionLock) => {
          const parentVersionId = uploadProject && requestedSource === 'manual' && versionLock
            ? await matchedHtmlParentVersionId(
              uploadProject,
              desiredName,
              requestedParentVersionId,
              versionLock,
            )
            : undefined;
          const meta = artifact === true
            ? await createProjectArtifactFile({
              projectsRoot: PROJECTS_DIR,
              projectId: req.params.id,
              input: { name, content, encoding, artifactManifest },
              metadata: uploadProject?.metadata,
              writeProjectFile,
            })
            : await writeProjectFile(
              PROJECTS_DIR,
              req.params.id,
              name,
              buf,
              {
                artifactManifest,
                ...(overwrite === false ? { overwrite: false } : {}),
              },
              uploadProject?.metadata,
            );
          const versionCapture = uploadProject && requestedSource && /\.html?$/i.test(meta.name) && versionLock
            ? await (async () => {
              const savedFile = await readProjectFile(PROJECTS_DIR, uploadProject.id, meta.name, uploadProject.metadata);
              const versionOverride: HtmlVersionOverride = {
                source: requestedSource,
                label: typeof versionLabel === 'string' ? versionLabel : null,
                ...(parentVersionId ? { parentVersionId } : {}),
              };
              if (typeof versionPrompt === 'string') {
                versionOverride.prompt = versionPrompt;
              }
              if (requestedSource === 'manual') {
                versionOverride.promptSource = 'manual';
              } else if (requestedSource === 'restore') {
                versionOverride.promptSource = 'restore';
              }
              return tryEnsureLockedHtmlCurrentVersion(
                uploadProject,
                meta.name,
                savedFile.buffer.toString('utf8'),
                versionLock.ensureCurrentVersion,
                versionOverride,
              );
            })()
            : null;
          return { meta, versionCapture };
        };
        const { meta, versionCapture } = uploadProject && requestedSource
          ? await withProjectFileVersionLock(
            PROJECTS_DIR,
            req.params.id,
            desiredName,
            uploadProject.metadata,
            (versionLock) => writeAndCapture(versionLock),
          )
          : await writeAndCapture();
        /** @type {import('@bezier/contracts').ProjectFileResponse} */
        const body = {
          file: meta,
          ...(versionCapture ? { version: versionCapture.version } : {}),
          ...(versionCapture?.versionWarning ? { versionWarning: versionCapture.versionWarning } : {}),
        };
        res.json(body);
      } catch (err: any) {
        const message = String(err?.message || err);
        if (err?.status === 428 && err?.code === 'DOC_WRITE_CHANNEL_REQUIRED') {
          return sendApiError(res, 428, err.code, message);
        }
        if (/^invalid (source|versionSource);/u.test(message)) {
          return sendApiError(res, 400, 'BAD_REQUEST', message);
        }
        if (err instanceof ArtifactRegressionError) {
          return sendApiError(res, 422, 'ARTIFACT_REGRESSION', err.message, {
            details: {
              identifier: err.identifier,
              newSize: err.newSize,
              priorSize: err.priorSize,
              priorName: err.priorName,
            },
          });
        }
        if (err instanceof ArtifactPublicationBlockedError) {
          return sendApiError(res, 422, 'ARTIFACT_PUBLICATION_BLOCKED', err.message, {
            details: { placeholders: err.placeholders },
          });
        }
        if (err?.code === 'EEXIST') {
          return sendApiError(res, 409, 'FILE_EXISTS', 'file already exists');
        }
        if (err?.code === 'ARTIFACT_MANIFEST_REQUIRED') {
          return sendApiError(res, 400, 'ARTIFACT_MANIFEST_REQUIRED', err.message);
        }
        if (err?.code === 'ARTIFACT_MANIFEST_INVALID') {
          return sendApiError(res, 400, 'BAD_REQUEST', err.message);
        }
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    },
  );

  app.post('/api/projects/:id/files/rename', async (req, res) => {
    try {
      const { from, to } = req.body || {};
      if (typeof from !== 'string' || typeof to !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'from and to required');
      }
      if (rejectInternalVersionPath(res, from) || rejectInternalVersionPath(res, to)) return;
      const project = registry.get(req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, project.id, { mode: 'write' })) return;
      const result = await renameProjectFile(
        PROJECTS_DIR,
        req.params.id,
        from,
        to,
        project?.metadata,
      );
      await renameProjectFileVersionStore(
        PROJECTS_DIR,
        req.params.id,
        result.oldName,
        result.newName,
        project?.metadata,
      );
      try {
        await ctx.canvasFiles?.renameSketchFile(project.id, result.oldName, result.newName);
      } catch (error) {
        // Keep file and card identities aligned when persisting the canvas fails.
        await renameProjectFile(PROJECTS_DIR, project.id, result.newName, result.oldName, project.metadata);
        await renameProjectFileVersionStore(PROJECTS_DIR, project.id, result.newName, result.oldName, project.metadata);
        throw error;
      }
      /** @type {import('@bezier/contracts').RenameProjectFileResponse} */
      const body = result;
      res.json(body);
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        return sendApiError(res, 409, 'CONFLICT', String(err?.message || err));
      }
      const message = String(err?.message || err);
      if (err?.code === 'ENOENT' || message.includes('ENOENT') || message.includes('no such file or directory')) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', message);
      }
      sendApiError(res, 400, 'BAD_REQUEST', message);
    }
  });

  app.delete('/api/projects/:id/files/:name', async (req, res) => {
    try {
      if (rejectInternalVersionPath(res, req.params.name)) return;
      const delProject = registry.get(req.params.id);
      if (!delProject) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      if (!await authorizeProjectRequest(req, res, delProject.id, { mode: 'write' })) return;
      await deleteProjectFile(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      await markProjectFileVersionStoreDeleted(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      /** @type {import('@bezier/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

}
