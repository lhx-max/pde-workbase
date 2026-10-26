/** Real cross-App cloud reference acceptance harness (isolated non-production
 * probe). Proves a Canvas document + reference journal live on real Appwrite
 * while Image bytes stay inside the Image App's own backend and only ever
 * travel over the authenticated public HTTP contract. Source Canvas here is a
 * dedicated integration probe — not the production canvas and not formal MA:
 * the MA authority and revocation/cross-biz behavior come from an owned local
 * fixture fed by a Root-owned Image UI fixture descriptor. The only cloud
 * writes are one new canvases document and this probe's own writer-lock row
 * in app_runtime_state; no registry/app-menu/shared-SDK writes, no bucket IO,
 * no legacy/user project access. */
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { AppwriteClient } from '../apps/server/src/storage/appwrite-client.js';
import { AppwriteWriterLock } from '../packages/app-cloud-state/src/index.js';
import { createMaAuthority } from '../packages/app-authority/src/index.js';
import { CanvasStateService } from '../apps/server/src/canvas/state.js';
import type { CanvasFileContent } from '../apps/server/src/canvas/persistence.js';
import { AppwriteCanvasPersistence } from '../apps/server/src/storage/canvas-appwrite-persistence.js';
import { registerCanvasStateRoutes } from '../apps/server/src/routes/canvas.js';
import { independentImageCallerScope, registerIndependentImageRoutes } from '../apps/server/src/routes/independent-image.js';
import { IndependentImageClient } from '../apps/server/src/media/independent-image-client.js';
import { runWithRequestTenant, setVerifiedTenant, verifiedTenant } from '../apps/server/src/tenant.js';
import { CanvasStateError } from '../apps/server/src/canvas/errors.js';

if (process.env.NODE_ENV === 'production') throw Error('Non-production only; this harness is an isolated acceptance probe');

const { values } = parseArgs({ options: {
  prefs: { type: 'string' },
  'image-fixture': { type: 'string' },
  output: { type: 'string' },
  serve: { type: 'boolean', default: false },
  'canvas-database': { type: 'string', default: 'canvas_app_dev' },
} });
for (const key of ['prefs', 'image-fixture', 'output'] as const)
  if (!values[key] || !path.isAbsolute(values[key]!)) throw Error(`Absolute --${key} is required`);
const output = values.output!;
const serve = values.serve === true;
const databaseId = values['canvas-database']!;
if (!/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/.test(databaseId)) throw Error('Invalid --canvas-database');

// Console session is read privately: it is never logged, returned or written
// to any report. Same shape as the other cloud probes (prefs[prefs.current]).
const prefs = JSON.parse(await readFile(values.prefs!, 'utf8')) as { current?: string } & Record<string, { cookie?: unknown }>;
const sessionCookie = prefs[prefs.current ?? '']?.cookie;
if (typeof sessionCookie !== 'string' || !sessionCookie) throw Error('prefs carry no usable console session cookie');

const MA_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const MA_SSO = /^Bearer [A-Za-z0-9\-._~+/]+=*$/i;
const IMAGE_WORKSPACE_ID = /^iw[0-9a-f]{32}$/;
const MA_HEADERS = ['x-mav-sso-authorization', 'x-mav-tenant', 'x-mav-application-instance-id'] as const;
const SCOPE_FIELDS = ['teamId', 'userId', 'bizId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const;
const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Root-owned Image UI fixture descriptor. The three MA headers are a toy
 * fixture identity — never a real user SSO. */
interface FixtureCaller { teamId: string; userId: string; bizId: string; applicationId: string; applicationInstanceId: string; providerInstanceId: string }
const fixtureRaw = JSON.parse(await readFile(values['image-fixture']!, 'utf8')) as Record<string, unknown>;
const need: (cond: unknown, why: string) => asserts cond = (cond, why) => { if (!cond) throw Error(`image fixture: ${why}`); };
need(fixtureRaw.profile === 'real-image-cloud-explicit-local-ma-ui-fixture', 'profile must be real-image-cloud-explicit-local-ma-ui-fixture');
const callerRaw = fixtureRaw.caller as Record<string, unknown> | undefined;
need(callerRaw && typeof callerRaw === 'object' && !Array.isArray(callerRaw), 'caller must be an object');
for (const field of SCOPE_FIELDS) need(typeof callerRaw[field] === 'string' && MA_ID.test(callerRaw[field] as string), `caller.${field} is invalid`);
const caller = callerRaw as unknown as FixtureCaller;
const headersRaw = fixtureRaw.headers as Record<string, unknown> | undefined;
need(headersRaw && typeof headersRaw === 'object' && !Array.isArray(headersRaw), 'headers must be an object');
need(Object.keys(headersRaw).sort().join(',') === [...MA_HEADERS].sort().join(','), 'headers must be exactly the three MA SSO headers');
need(typeof headersRaw['x-mav-sso-authorization'] === 'string' && MA_SSO.test(headersRaw['x-mav-sso-authorization']), 'x-mav-sso-authorization must be a Bearer token');
need(headersRaw['x-mav-tenant'] === caller.teamId, 'x-mav-tenant must equal caller.teamId');
need(headersRaw['x-mav-application-instance-id'] === caller.applicationInstanceId, 'x-mav-application-instance-id must equal caller.applicationInstanceId');
const fixtureHeaders = headersRaw as Record<(typeof MA_HEADERS)[number], string>;
need(typeof fixtureRaw.workspaceId === 'string' && IMAGE_WORKSPACE_ID.test(fixtureRaw.workspaceId), 'workspaceId must be an iw… id');
const workspaceId = fixtureRaw.workspaceId;
const backendUrl = new URL(String(fixtureRaw.backend));
need(backendUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(backendUrl.hostname)
  && !backendUrl.username && !backendUrl.password && backendUrl.origin === String(fixtureRaw.backend).replace(/\/+$/, ''),
  'backend must be an exact loopback http origin');
const imageOrigin = backendUrl.origin;
const fixtureUrl = typeof fixtureRaw.url === 'string' ? fixtureRaw.url : undefined;

const nonce = randomUUID().replaceAll('-', '').slice(0, 10);
const probeProjectId = `imref-${nonce}`; // <=36 chars, unique, this probe's only new document id
const sourceInstance = `imref-src-${nonce}`;
const sourceProvider = `imref-prv-${nonce}`;
const crossBizInstance = `imref-xbiz-${nonce}`;
const unknownInstance = `imref-none-${nonce}`;
const sourceScope: FixtureCaller = {
  teamId: caller.teamId, userId: caller.userId, bizId: caller.bizId,
  applicationId: 'canvas', applicationInstanceId: sourceInstance, providerInstanceId: sourceProvider,
};
const callerScopeHash = independentImageCallerScope(sourceScope);
const sourceHeaders: Record<string, string> = {
  'x-mav-sso-authorization': fixtureHeaders['x-mav-sso-authorization'],
  'x-mav-tenant': caller.teamId,
  'x-mav-application-instance-id': sourceInstance,
};

/** Every Appwrite route the Canvas-side client touches is traced; /storage and
 * any foreign database are forbidden outright (they fail the probe loudly, not
 * silently). Only the requested canvas database is reachable. */
const storageCalls: string[] = [];
const foreignDatabaseCalls: string[] = [];
class ProbeAppwriteClient extends AppwriteClient {
  private trace(method: string, route: string): void {
    if (route.startsWith('/storage/')) {
      storageCalls.push(`${method} ${route}`);
      throw new CanvasStateError(503, 'CANVAS_STORAGE_FORBIDDEN', 'This probe forbids Canvas bucket IO');
    }
    const database = /^\/databases\/([^/]+)(?:\/|$)/.exec(route)?.[1];
    if (database && database !== encodeURIComponent(databaseId)) {
      foreignDatabaseCalls.push(`${method} ${route}`);
      throw new CanvasStateError(503, 'CANVAS_DATABASE_FORBIDDEN', 'This probe forbids foreign databases');
    }
  }
  override async call<T>(method: string, route: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
    this.trace(method, route); return super.call(method, route, body, extra);
  }
  override async getOrNull<T>(route: string): Promise<T | null> { this.trace('GET', route); return super.getOrNull(route); }
  override async download(route: string): Promise<Uint8Array> { this.trace('GET', route); return super.download(route); }
  override async upload(bucketId: string, fileId: string, name: string, bytes: Uint8Array, mime: string) {
    this.trace('POST', `/storage/buckets/${bucketId}/files`); return super.upload(bucketId, fileId, name, bytes, mime);
  }
}
const client = new ProbeAppwriteClient({
  endpoint: 'https://frontend-cloud.corp.kuaishou.com/v1', projectId: 'grworkspace', sessionCookie, sessionMode: 'admin',
});
const lock = new AppwriteWriterLock({ client, databaseId, collectionId: 'app_runtime_state', serviceId: 'canvas-image-ref-probe' });
const persistence = new AppwriteCanvasPersistence(client, databaseId);
let fileContentCalls = 0;
const forbiddenContent = (): CanvasFileContent => ({
  read: async () => { fileContentCalls++; throw new CanvasStateError(503, 'CANVAS_FILE_IO_FORBIDDEN', 'Canvas file content is outside this probe'); },
  write: async () => { fileContentCalls++; throw new CanvasStateError(503, 'CANVAS_FILE_IO_FORBIDDEN', 'Canvas file content is outside this probe'); },
});
const canvas = new CanvasStateService(() => null, undefined, undefined, { persistence, content: forbiddenContent() });

/** Owned local MA fixture: published /api/ma-v/v1/me + application-instances/:id
 * contract. Accepts ONLY the Image fixture's toy SSO + tenant. The source
 * instance resolves to a fresh canvas nonce identity sharing the Image
 * caller's user/team/biz; the target instance resolves to the fixture caller's
 * real target scope; a cross-biz fixture instance proves tenancy mismatch. */
const maState = { targetRevoked: false };
const maJson = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
};
const maServer = createServer((req, res) => {
  if (req.headers.authorization !== fixtureHeaders['x-mav-sso-authorization'] || req.headers['x-mav-tenant'] !== caller.teamId)
    return maJson(res, 403, { error: { code: 'MA_FIXTURE_FORBIDDEN' } });
  const route = req.url ?? '';
  if (req.method === 'GET' && route === '/api/ma-v/v1/me')
    return maJson(res, 200, { data: { userId: caller.userId, status: 'active' } });
  const inst = /^\/api\/ma-v\/v1\/application-instances\/([^/?]+)$/.exec(route);
  if (req.method === 'GET' && inst) {
    const id = decodeURIComponent(inst[1]!);
    if (id === sourceInstance)
      return maJson(res, 200, { data: { applicationId: 'canvas', applicationInstanceId: id, providerInstanceId: sourceProvider, bizId: caller.bizId, status: 'active' } });
    if (id === caller.applicationInstanceId) {
      if (maState.targetRevoked) return maJson(res, 403, { error: { code: 'MA_INSTANCE_REVOKED' } });
      return maJson(res, 200, { data: { applicationId: caller.applicationId, applicationInstanceId: id, providerInstanceId: caller.providerInstanceId, bizId: caller.bizId, status: 'active' } });
    }
    if (id === crossBizInstance)
      return maJson(res, 200, { data: { applicationId: caller.applicationId, applicationInstanceId: id, providerInstanceId: `imref-xp-${nonce}`, bizId: `biz-foreign-${nonce}`, status: 'active' } });
    return maJson(res, 403, { error: { code: 'MA_INSTANCE_UNKNOWN' } });
  }
  maJson(res, 404, { error: { code: 'MA_ROUTE_UNKNOWN' } });
});

// express is an apps/server dependency; require it through that package so the
// probe uses the server's own pinned copy instead of a hoisted one.
const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url));
type ExpressApp = Parameters<typeof registerIndependentImageRoutes>[0];
type ExpressRequest = Parameters<typeof verifiedTenant>[0];
type Authorize = Parameters<typeof registerIndependentImageRoutes>[1]['authorize'];
type AllowImage = Parameters<typeof registerIndependentImageRoutes>[1]['allowImage'];
type ExpressResponse = Parameters<Authorize>[1];
type NextFn = (err?: unknown) => void;
interface ExpressModule {
  (): ExpressApp;
  json(options?: { limit?: string }): (req: ExpressRequest, res: ExpressResponse, next: NextFn) => void;
}
const express = serverRequire('express') as ExpressModule;

let authority: ReturnType<typeof createMaAuthority>;
let targetResolves = 0;
const resolveTarget = async (headers: Record<string, string>) => { targetResolves++; return authority(headers); };
const exactSourceScope = (actor: unknown): boolean => {
  const a = actor as Record<string, unknown> | undefined;
  return !!a && SCOPE_FIELDS.every(field => a[field] === sourceScope[field]);
};

/** Probe guard: allows ONLY the nonce project and the exact verified fixture
 * source scope; writes are allowed for that same explicit fixture only. */
const authorize: Authorize = async (req, res, projectId) => {
  if (projectId !== probeProjectId) { res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }); return false; }
  if (!verifiedTenant(req)) { res.status(401).json({ error: { code: 'IMAGE_AUTH_REQUIRED', message: 'A verified MA identity is required' } }); return false; }
  if (!exactSourceScope(verifiedTenant(req))) { res.status(403).json({ error: { code: 'INSTANCE_FORBIDDEN', message: 'Canvas does not belong to the verified source scope' } }); return false; }
  return true;
};
const allowImage: AllowImage = async (req, projectId) => {
  if (projectId !== probeProjectId || !exactSourceScope(verifiedTenant(req)))
    throw new CanvasStateError(403, 'IMAGE_APP_FORBIDDEN', 'Image App is unavailable for this scope');
};

const verifyMiddleware = (req: ExpressRequest, res: ExpressResponse, next: NextFn): void => {
  if (req.method === 'OPTIONS') { next(); return; }
  void (async () => {
    // The request envelope never supplies identity: only the three MA headers,
    // re-verified against the authority fixture on every request.
    const actor = await authority(req.headers);
    setVerifiedTenant(req, actor);
    const credentials: Record<string, string> = {};
    for (const key of MA_HEADERS) { const value = req.get(key); if (typeof value === 'string') credentials[key] = value; }
    runWithRequestTenant(actor, next, credentials, [imageOrigin]);
  })().catch((error: unknown) => {
    const status = (error as { status?: unknown })?.status;
    res.status(status === 403 ? 403 : 401).json({ error: { code: 'IMAGE_AUTH_REQUIRED', message: 'A verified MA identity is required' } });
  });
};

const catalogUnavailable = (_req: ExpressRequest, res: ExpressResponse): void => {
  res.status(503).json({ error: { code: 'MEDIA_CATALOG_UNAVAILABLE', message: 'media catalog is not part of this isolated probe' } });
};

const buildApp = (imageClient: IndependentImageClient): ExpressApp => {
  const app = express();
  app.use(verifyMiddleware);
  app.use(express.json({ limit: '42mb' }));
  app.get('/api/media/catalog', catalogUnavailable);
  app.get('/api/projects/:projectId/media/catalog', catalogUnavailable);
  registerCanvasStateRoutes(app, { canvasState: canvas, resolveProjectRoot: () => null, authorizeProjectRequest: authorize });
  registerIndependentImageRoutes(app, { client: imageClient, canvas, authorize, allowImage });
  app.use((error: unknown, _req: ExpressRequest, res: ExpressResponse, _next: NextFn) => {
    const value = error as { status?: unknown; code?: unknown };
    res.status(typeof value.status === 'number' && value.status >= 400 && value.status < 600 ? value.status : 500)
      .json({ error: { code: typeof value.code === 'string' ? value.code : 'PROBE_ERROR', message: 'probe request failed' } });
  });
  return app;
};

const servers = new Set<Server>();
const listen = (server: Server) => new Promise<string>((resolve, reject) => {
  servers.add(server);
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
});
const listenApp = (app: ExpressApp) => new Promise<{ base: string; server: Server }>((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server }));
  servers.add(server); server.once('error', reject);
});
const stop = async (server: Server) => {
  if (!servers.delete(server)) return;
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
};

interface HttpResult { status: number; json?: Record<string, unknown>; bytes?: Uint8Array; contentType: string; etag: string | null }
const http = async (base: string, method: 'GET' | 'POST' | 'PATCH', route: string, options: { headers?: Record<string, string> | false; body?: unknown; key?: string } = {}): Promise<HttpResult> => {
  const headers: Record<string, string> = options.headers === false ? {} : { ...sourceHeaders, ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  const response = await fetch(base + route, {
    method, headers, redirect: 'manual', credentials: 'omit',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  let json: Record<string, unknown> | undefined;
  if (contentType === 'application/json') { try { json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; } catch { /* non-object JSON */ } }
  return { status: response.status, json, bytes, contentType, etag: response.headers.get('etag') };
};

const checks: string[] = [];
const check = (name: string, ok: boolean) => { assert(ok, name); checks.push(name); };
let failure: string | undefined;
let assetId = '';
let assetMime = '';
let nodeId = '';
let receiptId = '';
let reference: Record<string, unknown> = {};
let base = '';
let attachRevision = 0;
const collectionAcl: Record<string, unknown> = {};

try {
  await lock.acquire();
  checks.push('canvas-image-ref-probe acquired its exclusive writer lock on app_runtime_state');
  const maOrigin = await listen(maServer);
  authority = createMaAuthority({ transport: { origin: maOrigin } });
  const imageClient = new IndependentImageClient({ origin: imageOrigin, applicationId: caller.applicationId, resolveTarget });
  const app = buildApp(imageClient);
  base = (await listenApp(app)).base;
  // A closed loopback port gives a real transport failure for the same wiring.
  const probe = createServer();
  const deadPort = await new Promise<number>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', () => resolve((probe.address() as { port: number }).port)); });
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const deadApp = buildApp(new IndependentImageClient({ origin: `http://127.0.0.1:${deadPort}`, applicationId: caller.applicationId, resolveTarget }));
  const dead = await listenApp(deadApp);
  const referencesRoute = `/api/projects/${encodeURIComponent(probeProjectId)}/image-app/references`;

  check('Unverified source is rejected on canvas state read',
    (await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/canvas/state`, { headers: false })).status === 401);
  check('Unverified source is rejected on image reference write',
    (await http(base, 'POST', referencesRoute, { headers: false, body: {}, key: 'x' })).status === 401);
  const unavailable = await http(dead.base, 'POST', referencesRoute, {
    body: { applicationInstanceId: caller.applicationInstanceId, workspaceId, assetId: `ia${'0'.repeat(34)}`, x: 0, y: 0, expectedRevision: 0 }, key: `dead-${nonce}`,
  });
  check('Unreachable Image backend fails specifically (IMAGE_REMOTE_*)',
    unavailable.status >= 500 && String((unavailable.json?.error as Record<string, unknown> | undefined)?.code).startsWith('IMAGE_REMOTE_'));
  await stop(dead.server);

  const empty = await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/canvas/state`);
  const emptyImages = (empty.json?.state as Record<string, unknown> | undefined)?.workbenchImages;
  check('Source canvas document starts empty at revision 0',
    empty.status === 200 && empty.json?.ok === true && empty.json?.revision === 0
    && (emptyImages === undefined || (Array.isArray(emptyImages) && emptyImages.length === 0)));

  const imageState = await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/image-app/${encodeURIComponent(caller.applicationInstanceId)}/api/apps/image/instances/${encodeURIComponent(workspaceId)}/state`);
  const assets = (imageState.json?.data as Record<string, unknown> | undefined)?.assets;
  check('Bound Image workspace state returns real assets through the canvas proxy route', imageState.status === 200 && Array.isArray(assets));
  const rasters = (assets as Record<string, unknown>[]).filter(a =>
    typeof a.id === 'string' && RASTER_MIMES.has(String(a.mime)) && /^[0-9a-f]{64}$/.test(String(a.sha256))
    && Number.isSafeInteger(a.width) && Number.isSafeInteger(a.height));
  const chosen = rasters.find(a => a.mime === 'image/png') ?? rasters[0];
  assert(chosen, 'fixture workspace carries no usable raster asset (no model calls are ever made)');
  assetId = String(chosen.id); assetMime = String(chosen.mime);

  const bindKey = `bind-${nonce}`;
  const attachBody = { applicationInstanceId: caller.applicationInstanceId, workspaceId, assetId, x: 120, y: 80, expectedRevision: 0 };
  const attached = await http(base, 'POST', referencesRoute, { body: attachBody, key: bindKey });
  check('POST image-app/references binds the existing Image asset onto the fresh canvas document', attached.status === 201);
  const bound = attached.json?.data as Record<string, unknown>;
  attachRevision = Number(bound?.revision);
  nodeId = String(bound?.nodeId ?? ''); receiptId = String(bound?.receiptId ?? '');
  reference = (bound?.reference ?? {}) as Record<string, unknown>;
  check('Reference ack carries deterministic node id, durable receipt and verified asset metadata',
    bound?.replayed === false && /^imref-[0-9a-f]{32}$/.test(nodeId) && /^ir[0-9a-f]{32}$/.test(receiptId)
    && attachRevision > 0 && reference.assetId === assetId && reference.applicationInstanceId === caller.applicationInstanceId
    && reference.sha256 === chosen.sha256);

  const cloud = await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/canvas/state`);
  const state = (cloud.json?.state ?? {}) as Record<string, unknown>;
  const images = (state.workbenchImages ?? []) as Record<string, unknown>[];
  const node = images.find(item => item.id === nodeId);
  check('Cloud canvas state carries only the reference layout entry and the own receipt journal',
    cloud.status === 200 && cloud.json?.revision === attachRevision
    && ['workbenchImages', 'workbenchImageReferenceReceipts'].every(k => Object.hasOwn(state, k))
    && Object.keys(state).every(k => ['workbenchImages', 'workbenchImageReferenceReceipts'].includes(k))
    && !JSON.stringify(state).includes('data:'));
  const NODE_FIELDS = new Set(['id', 'x', 'y', 'name', 'src', 'status', 'naturalWidth', 'naturalHeight', 'imageReference']);
  check('Image node stores only layout, authenticated src and the verified imageReference — no config/tasks/edits/bytes',
    !!node && Object.keys(node).every(key => NODE_FIELDS.has(key))
    && node.src === `/api/projects/${encodeURIComponent(probeProjectId)}/image-app/${encodeURIComponent(caller.applicationInstanceId)}/api/apps/image/instances/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}`);
  assert.deepEqual(node?.imageReference, reference);
  checks.push('Stored imageReference equals the ack reference verbatim');
  const receipts = (state.workbenchImageReferenceReceipts ?? {}) as Record<string, Record<string, unknown>>;
  check('Own reference journal holds exactly this caller-scoped key',
    Object.keys(receipts).length === 1 && receipts[`${callerScopeHash}:${bindKey}`]?.receiptId === receiptId
    && receipts[`${callerScopeHash}:${bindKey}`]?.nodeId === nodeId);
  const doc = await client.getOrNull<{ $id?: string; revision?: number }>(`${client.docsPath(databaseId, 'canvases')}/${encodeURIComponent(probeProjectId)}`);
  check('The probe canvas document exists on real Appwrite under the nonce id', doc?.$id === probeProjectId);

  const preview = await http(base, 'GET', String(node!.src));
  const png = preview.bytes ? Buffer.from(preview.bytes) : Buffer.alloc(0);
  check('Authenticated preview serves the stored Image asset bytes privately',
    preview.status === 200 && preview.contentType === 'image/png'
    && png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
  check('Preview bytes hash and PNG dimensions match the stored reference',
    preview.etag === `"${String(reference.sha256)}"`
    && createHash('sha256').update(png).digest('hex') === reference.sha256
    && png.readUInt32BE(16) === reference.width && png.readUInt32BE(20) === reference.height);

  const resolvesBefore = targetResolves;
  const replay = await http(base, 'POST', referencesRoute, { body: attachBody, key: bindKey });
  check('Exact key+body+base replay returns the original ack revision with no additional target resolve',
    replay.status === 201 && (replay.json?.data as Record<string, unknown>)?.replayed === true
    && (replay.json?.data as Record<string, unknown>)?.nodeId === nodeId
    && (replay.json?.data as Record<string, unknown>)?.revision === attachRevision
    && targetResolves === resolvesBefore);
  const stale = await http(base, 'POST', referencesRoute, { body: { ...attachBody, expectedRevision: 0 }, key: `stale-${nonce}` });
  check('Stale base revision conflicts with 409 and no canvas mutation', stale.status === 409);
  const conflict = await http(base, 'POST', referencesRoute, { body: { ...attachBody, x: 9999, expectedRevision: attachRevision }, key: bindKey });
  check('Same idempotency key with different input conflicts with 409', conflict.status === 409);
  const afterConflict = await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/canvas/state`);
  const afterState = (afterConflict.json?.state ?? {}) as Record<string, unknown>;
  check('Failed writes left no canvas mutations (revision, node set and journal unchanged)',
    afterConflict.json?.revision === attachRevision
    && Object.keys(afterState.workbenchImageReferenceReceipts ?? {}).length === 1
    && (afterState.workbenchImages as unknown[]).length === 1);

  const unknown = await http(base, 'POST', referencesRoute, { body: { ...attachBody, applicationInstanceId: unknownInstance, expectedRevision: attachRevision }, key: `unk-${nonce}` });
  check('Unknown target instance fails resolution with 403 before any write', unknown.status === 403);
  const cross = await http(base, 'POST', referencesRoute, { body: { ...attachBody, applicationInstanceId: crossBizInstance, expectedRevision: attachRevision }, key: `xbiz-${nonce}` });
  check('Cross-biz resolved target is rejected 403 and never mutates canvas', cross.status === 403
    && Number((await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/canvas/revision`)).json?.revision) === attachRevision);

  maState.targetRevoked = true;
  check('Target revocation turns the authenticated preview into 403',
    (await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/image-app/references/${encodeURIComponent(nodeId)}/preview`)).status === 403);
  maState.targetRevoked = false;
  check('Preview recovers after the revocation flag is lifted',
    (await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/image-app/references/${encodeURIComponent(nodeId)}/preview`)).status === 200);

  const freshCanvas = new CanvasStateService(() => null, undefined, undefined, { persistence, content: forbiddenContent() });
  const restored = await freshCanvas.read(probeProjectId);
  const restoredImages = (restored.state.workbenchImages ?? []) as Record<string, unknown>[];
  check('A fresh CanvasStateService over the same Appwrite persistence restores the reference with an empty cache',
    restored.revision === attachRevision && restoredImages.some(item => item.id === nodeId));
  const replayed = await freshCanvas.attachImageReference(probeProjectId, {
    applicationInstanceId: caller.applicationInstanceId, workspaceId, assetId, x: 120, y: 80,
    expectedRevision: 0, idempotencyKey: bindKey, callerScope: callerScopeHash,
  }, { resolve: async () => { throw new CanvasStateError(503, 'RESOLVE_FORBIDDEN', 'a replayed receipt must never re-resolve'); } });
  check('The fresh service replays the durable receipt without resolving or writing',
    replayed.replayed === true && replayed.nodeId === nodeId && replayed.revision === attachRevision);

  const currentRevision = Number((await http(base, 'GET', `/api/projects/${encodeURIComponent(probeProjectId)}/canvas/revision`)).json?.revision);
  const second = await http(base, 'POST', referencesRoute, { body: { ...attachBody, expectedRevision: currentRevision }, key: `bind2-${nonce}` });
  check('A new idempotency key on the same asset attaches a different node id (key participates in node identity)',
    second.status === 201 && (second.json?.data as Record<string, unknown>)?.replayed === false
    && /^imref-[0-9a-f]{32}$/.test(String((second.json?.data as Record<string, unknown>)?.nodeId))
    && (second.json?.data as Record<string, unknown>)?.nodeId !== nodeId);

  check('Canvas never touched bucket storage, foreign databases or file content; Image bytes only via public HTTP',
    storageCalls.length === 0 && foreignDatabaseCalls.length === 0 && fileContentCalls === 0);
  for (const collection of ['canvases', 'canvas_operations']) {
    const meta = await client.getOrNull<{ documentSecurity?: boolean; $permissions?: string[] }>(
      `/databases/${encodeURIComponent(databaseId)}/collections/${encodeURIComponent(collection)}`);
    collectionAcl[collection] = { documentSecurity: meta?.documentSecurity ?? null, permissions: meta?.$permissions ?? null };
  }
  checks.push('Existing canvases/canvas_operations collection ACL read back read-only (development ACL, not production-private)');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = {
  profile: 'real-cross-app-cloud-reference-ma-protocol-fixture',
  checkedAt: new Date().toISOString(),
  database: databaseId,
  passed: !failure,
  projectId: probeProjectId,
  sourceInstance,
  targetApplicationInstanceId: caller.applicationInstanceId,
  workspaceId,
  chosenAsset: assetId ? { id: assetId, mime: assetMime } : null,
  targetResolves,
  checks,
  resources: {
    canvasDocument: `${databaseId}/canvases/${probeProjectId} (retained, never deleted)`,
    writerLock: `${databaseId}/app_runtime_state service=canvas-image-ref-probe (released on close; foreign rows never deleted)`,
    maAuthority: 'owned native loopback fixture for /api/ma-v/v1/me + application-instances/:id',
    imageBackend: imageOrigin,
    ...(fixtureUrl ? { fixtureUrl } : {}),
  },
  storageEvidence: {
    canvasBucketCalls: storageCalls.length,
    foreignDatabaseCalls,
    canvasFileContentCalls: fileContentCalls,
    imageBytes: 'authenticated public image asset route only; no Image database or bucket access from Canvas',
  },
  collectionAcl,
  serve,
  limitations: [
    'source Canvas is an isolated integration probe on real Appwrite, not the full production canvas deployment',
    'MA verification, revocation and cross-biz behavior come from an owned local fixture accepting only the fixture toy SSO — no formal MA/host/Agent claim',
    'development Appwrite metadata ACL is reported read-only as observed; legacy dev canvases may carry read(users), so no production-private claim is made',
    'no model calls, no registry/app-menu/shared-SDK writes; the probe canvas document is retained',
    'Cookie/prefs are read privately and never appear in this report; the optional connection file may carry the toy fixture SSO only',
  ],
  ...(failure ? { failure } : {}),
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

if (serve && !failure && base) {
  const connection = {
    profile: 'real-cloud-reference-fixture',
    url: base,
    projectId: probeProjectId,
    headers: sourceHeaders,
    credentialsNotice: 'toy fixture SSO identity only — not a real user SSO or Appwrite credential',
    targetApplicationInstanceId: caller.applicationInstanceId,
    workspaceId,
    imageOrigin,
    pid: process.pid,
  };
  const connectionPath = `${output}.connection.json`;
  await writeFile(connectionPath, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
  await chmod(connectionPath, 0o600);
  console.log(JSON.stringify({ serving: true, url: base, projectId: probeProjectId, connection: connectionPath }));
  await new Promise<void>(resolve => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
}

for (const server of [...servers]) await stop(server);
await lock.release().catch((error: unknown) => { console.error(`writer lock release failed: ${error instanceof Error ? error.message : String(error)}`); });
console.log(JSON.stringify({ passed: !failure, checks: checks.length, projectId: probeProjectId, output, ...(failure ? { failure } : {}) }));
if (failure) process.exitCode = 1;
