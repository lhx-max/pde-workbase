import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { AppActor } from '@ks-designai/app-authority';
import { CanvasStateError } from '../canvas/errors.js';
import type { CanvasStateService, ImageAssetReference } from '../canvas/state.js';
import { verifiedTenant } from '../tenant.js';
import { ImageRemoteError } from '../media/independent-image-client.js';
import type { BoundIndependentImageClient, IndependentImageClient, ImageRemoteScope } from '../media/independent-image-client.js';

/** The only request headers that may carry MA identity toward the target. */
const SSO_HEADER = 'x-mav-sso-authorization';
const TENANT_HEADER = 'x-mav-tenant';
const INSTANCE_HEADER = 'x-mav-application-instance-id';
const MA_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SCOPE_FIELDS = ['teamId', 'userId', 'bizId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const;
const TARGET_FIELDS = ['teamId', 'bizId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const;
const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Verified caller identity -> full six-field MA source scope. Requires a
 * verified tenant; no development actor or client header is ever consulted. */
export function independentImageSourceActor(req: Request): ImageRemoteScope {
  const actor: Readonly<AppActor> | undefined = verifiedTenant(req);
  if (!actor) throw new CanvasStateError(401, 'IMAGE_AUTH_REQUIRED', 'A verified MA identity is required');
  const raw = actor as unknown as Record<string, unknown>;
  const scope: Record<string, string> = {};
  for (const field of SCOPE_FIELDS) {
    const value = raw[field];
    if (typeof value !== 'string' || !MA_ID.test(value))
      throw new CanvasStateError(403, 'IMAGE_IDENTITY_INCOMPLETE', 'Verified identity does not carry the full image scope');
    scope[field] = value;
  }
  return scope as unknown as ImageRemoteScope;
}

/** sha256 of the full verified source identity — opaque, server-side only. */
export function independentImageCallerScope(source: ImageRemoteScope): string {
  return createHash('sha256')
    .update(JSON.stringify(SCOPE_FIELDS.map(field => source[field])))
    .digest('hex');
}

function maHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of [SSO_HEADER, TENANT_HEADER, INSTANCE_HEADER]) {
    const value = req.get(name);
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

type Authorize = (req: Request, res: Response, projectId: string, access: { mode: 'read' | 'write'; capability?: string }) => Promise<boolean>;
type AllowImage = (req: Request, projectId: string, write: boolean) => Promise<void>;

/** Reference-only Image App integration for the canvas server: layout +
 * immutable remote reference + authenticated preview + own delivery receipt.
 * Every route requires a verified MA identity; only the three real MA SSO
 * headers are forwarded, and each target call re-verifies the bound scope.
 * No public bucket URLs, byte copying, canvas-stored Image business data or
 * arbitrary path forwarding. */
export function registerIndependentImageRoutes(app: Express, deps: {
  client: IndependentImageClient;
  canvas: CanvasStateService;
  authorize: Authorize;
  allowImage: AllowImage;
}) {
  const send = (res: Response, error: unknown) => {
    const value = error as { status?: unknown; code?: unknown };
    const status = typeof value.status === 'number' && value.status >= 400 && value.status < 600 ? value.status : 500;
    const code = typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(value.code) ? value.code : 'IMAGE_INTERNAL_ERROR';
    res.status(status).json({ requestId: `req_${randomUUID()}`, error: { code, message: 'Image App request failed', retryable: status >= 500 } });
  };
  const data = (res: Response, result: unknown, status = 200) =>
    res.status(status).json({ requestId: `req_${randomUUID()}`, data: result });
  const bind = async (req: Request, targetInstanceId: string): Promise<{ bound: BoundIndependentImageClient; source: ImageRemoteScope }> => {
    const source = independentImageSourceActor(req);
    return { bound: await deps.client.forRequest(source, maHeaders(req), targetInstanceId), source };
  };
  const guard = async (req: Request, res: Response, projectId: string, write: boolean): Promise<boolean> => {
    if (!verifiedTenant(req)) throw new CanvasStateError(401, 'IMAGE_AUTH_REQUIRED', 'A verified MA identity is required');
    await deps.allowImage(req, projectId, write);
    return deps.authorize(req, res, projectId, { mode: write ? 'write' : 'read', ...(write ? { capability: 'writeFiles' } : {}) });
  };

  const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

  /** Strict resolved reference scope must equal the currently bound target. */
  const scopeMatches = (reference: ImageAssetReference, scope: ImageRemoteScope): boolean =>
    TARGET_FIELDS.every(field => reference[field] === scope[field]);

  app.post('/api/projects/:projectId/image-app/references', (req, res) => { void (async () => {
    const projectId = String(req.params.projectId ?? '');
    if (!await guard(req, res, projectId, true)) return;
    const body = req.body;
    if (!isRecord(body)) throw new CanvasStateError(400, 'IMAGE_REFERENCE_INVALID', 'request body must be an object');
    for (const key of Object.keys(body))
      if (!['applicationInstanceId', 'workspaceId', 'assetId', 'x', 'y', 'name', 'expectedRevision'].includes(key))
        throw new CanvasStateError(400, 'IMAGE_REFERENCE_INVALID', 'request body carries unknown fields');
    if(['applicationInstanceId','workspaceId','assetId'].some(key=>typeof body[key]!=='string')||typeof body.x!=='number'||typeof body.y!=='number'||typeof body.expectedRevision!=='number'||body.name!==undefined&&typeof body.name!=='string')throw new CanvasStateError(400,'IMAGE_REFERENCE_INVALID','Image reference input types are invalid');
    const key = req.get('idempotency-key');
    if (typeof key !== 'string' || !/^[^\x00-\x1f\x7f]{1,128}$/u.test(key))
      throw new CanvasStateError(400, 'IMAGE_REFERENCE_INVALID', 'a 1-128 character idempotency-key header is required');
    const source = independentImageSourceActor(req);
    const headers = maHeaders(req);
    const targetInstanceId = String(body.applicationInstanceId);
    const result = await deps.canvas.attachImageReference(projectId, {
      applicationInstanceId: targetInstanceId,
      workspaceId: String(body.workspaceId),
      assetId: String(body.assetId),
      x: Number(body.x),
      y: Number(body.y),
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      expectedRevision: Number(body.expectedRevision),
      idempotencyKey: key,
      callerScope: independentImageCallerScope(source),
    }, {
      resolve: async () => {
        // Target resolution + remote read run inside the canvas commit lock.
        const bound = await deps.client.forRequest(source, headers, targetInstanceId);
        const state = await bound.state(String(body.workspaceId));
        const asset = state.assets.find(item => item.id === body.assetId);
        if (!asset) throw new CanvasStateError(404, 'IMAGE_ASSET_NOT_FOUND', 'image asset does not exist in the target workspace');
        const scope = bound.scope();
        const reference: ImageAssetReference = {
          applicationId: scope.applicationId,
          applicationInstanceId: scope.applicationInstanceId,
          providerInstanceId: scope.providerInstanceId,
          teamId: scope.teamId,
          bizId: scope.bizId,
          workspaceId: String(body.workspaceId),
          assetId: String(body.assetId),
          mime: typeof asset.mime === 'string' ? asset.mime : '',
          sha256: typeof asset.sha256 === 'string' ? asset.sha256 : '',
          width: typeof asset.width === 'number' ? asset.width : 0,
          height: typeof asset.height === 'number' ? asset.height : 0,
        };
        return {
          reference,
          // Resource identity survives node duplication and removal of another
          // reference; both Canvas and Image authorization still run on reads.
          previewUrl: () => `/api/projects/${encodeURIComponent(projectId)}/image-app/${encodeURIComponent(targetInstanceId)}/api/apps/image/instances/${encodeURIComponent(String(body.workspaceId))}/assets/${encodeURIComponent(String(body.assetId))}`,
        };
      },
    });
    data(res, result, 201);
  })().catch(e => send(res, e)); });

  app.get('/api/projects/:projectId/image-app/references/:nodeId/preview', (req, res) => { void (async () => {
    const projectId = String(req.params.projectId ?? '');
    const nodeId = String(req.params.nodeId ?? '');
    if (!await guard(req, res, projectId, false)) return;
    const snapshot = await deps.canvas.read(projectId);
    const nodes = Array.isArray(snapshot.state.workbenchImages) ? snapshot.state.workbenchImages as Record<string, unknown>[] : [];
    const node = nodes.find(item => item && typeof item === 'object' && item.id === nodeId);
    const reference = isRecord(node?.imageReference) ? node.imageReference as unknown as ImageAssetReference : undefined;
    if (!reference || typeof reference.workspaceId !== 'string' || typeof reference.assetId !== 'string')
      throw new CanvasStateError(404, 'IMAGE_NODE_NOT_FOUND', 'image reference card does not exist');
    const { bound } = await bind(req, reference.applicationInstanceId);
    // The bound target must still be exactly the stored scope — a revoked or
    // re-pointed instance can never serve this card's bytes.
    if (!scopeMatches(reference, bound.scope()))
      throw new CanvasStateError(403, 'IMAGE_TARGET_MISMATCH', 'resolved image target no longer matches the stored reference');
    const state = await bound.state(reference.workspaceId);
    const asset = state.assets.find(item => item.id === reference.assetId);
    if (!asset) throw new CanvasStateError(404, 'IMAGE_ASSET_NOT_FOUND', 'referenced image asset is gone');
    if (asset.sha256 !== reference.sha256 || asset.mime !== reference.mime
      || asset.width !== reference.width || asset.height !== reference.height)
      throw new CanvasStateError(409, 'IMAGE_ASSET_CHANGED', 'referenced image asset no longer matches the stored reference');
    const payload = await bound.asset(reference.workspaceId, reference.assetId);
    if (payload.sha256 !== reference.sha256 || payload.mime !== reference.mime || !RASTER_MIMES.has(payload.mime))
      throw new CanvasStateError(502, 'IMAGE_ASSET_INTEGRITY', 'image asset bytes failed integrity verification');
    res.set({
      'content-type': payload.mime,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      etag: `"${reference.sha256}"`,
    });
    res.send(Buffer.from(payload.bytes));
  })().catch(e => send(res, e)); });

  /** Canonical proxy prefix; every path below maps to a whitelisted bound
   * client method — nothing is forwarded verbatim. */
  const prefix = '/api/projects/:projectId/image-app/:applicationInstanceId/api/apps/image';
  const proxyBind = async (req: Request, res: Response, write: boolean) => {
    const projectId = String(req.params.projectId ?? '');
    if (!await guard(req, res, projectId, write)) return undefined;
    return bind(req, String(req.params.applicationInstanceId));
  };

  app.get(prefix, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, false); if (!bound) return;
    data(res, await bound.bound.manifest());
  })().catch(e => send(res, e)); });

  app.get(`${prefix}/workspaces`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, false); if (!bound) return;
    data(res, {items:await bound.bound.listWorkspaces()});
  })().catch(e => send(res, e)); });
  app.get(`${prefix}/capabilities`,(req,res)=>{void(async()=>{const bound=await proxyBind(req,res,false);if(!bound)return;data(res,await bound.bound.capabilities());})().catch(e=>send(res,e));});

  app.get(`${prefix}/instances/:workspaceId/state`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, false); if (!bound) return;
    data(res, await bound.bound.state(String(req.params.workspaceId)));
  })().catch(e => send(res, e)); });

  app.get(`${prefix}/instances/:workspaceId/jobs/:jobId`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, false); if (!bound) return;
    data(res, await bound.bound.job(String(req.params.workspaceId), String(req.params.jobId)));
  })().catch(e => send(res, e)); });

  app.get(`${prefix}/instances/:workspaceId/assets/:assetId`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, false); if (!bound) return;
    const payload = await bound.bound.asset(String(req.params.workspaceId), String(req.params.assetId));
    res.set({ 'content-type': payload.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'",...(payload.sha256?{etag:'"'+payload.sha256+'"'}:{}) });
    res.send(Buffer.from(payload.bytes));
  })().catch(e => send(res, e)); });

  const postBody = (body: unknown): { input: Record<string, unknown>; expectedRevision: number; key: string } => {
    if (!isRecord(body) || Object.keys(body).some(key=>!['input','expectedRevision'].includes(key)) || !isRecord(body.input)) throw new CanvasStateError(400, 'IMAGE_INPUT_INVALID', 'body must carry an input object');
    if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision))
      throw new CanvasStateError(400, 'IMAGE_INPUT_INVALID', 'expectedRevision must be a safe integer');
    return { input: body.input, expectedRevision: body.expectedRevision, key: '' };
  };

  app.post(`${prefix}/actions/image.create`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, true); if (!bound) return;
    const key = req.get('idempotency-key');
    if (typeof key !== 'string' || !/^[^\x00-\x1f\x7f]{1,128}$/u.test(key))
      throw new CanvasStateError(400, 'IMAGE_INPUT_INVALID', 'a 1-128 character idempotency-key header is required');
    if(!isRecord(req.body)||Object.keys(req.body).some(key=>key!=='input')||!isRecord(req.body.input)||Object.keys(req.body.input).some(key=>key!=='name')||typeof req.body.input.name!=='string')throw new CanvasStateError(400,'IMAGE_INPUT_INVALID','Create requires only input.name');
    const body = req.body.input;
    data(res, await bound.bound.create({ name: typeof body.name === 'string' ? body.name : '' }, key), 201);
  })().catch(e => send(res, e)); });

  app.post(`${prefix}/instances/:workspaceId/assets`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, true); if (!bound) return;
    const key = req.get('idempotency-key');
    if (typeof key !== 'string' || !/^[^\x00-\x1f\x7f]{1,128}$/u.test(key))
      throw new CanvasStateError(400, 'IMAGE_INPUT_INVALID', 'a 1-128 character idempotency-key header is required');
    const body = postBody(req.body);
    data(res, await bound.bound.action(String(req.params.workspaceId), 'image.import', body.input, body.expectedRevision, key));
  })().catch(e => send(res, e)); });

  app.post(`${prefix}/instances/:workspaceId/actions/:actionId`, (req, res) => { void (async () => {
    const bound = await proxyBind(req, res, true); if (!bound) return;
    const key = req.get('idempotency-key');
    if (typeof key !== 'string' || !/^[^\x00-\x1f\x7f]{1,128}$/u.test(key))
      throw new CanvasStateError(400, 'IMAGE_INPUT_INVALID', 'a 1-128 character idempotency-key header is required');
    const body = postBody(req.body);
    // The bound client enforces the published 0.9.0 action allowlist itself.
    data(res, await bound.bound.action(String(req.params.workspaceId), String(req.params.actionId), body.input, body.expectedRevision, key));
  })().catch(e => send(res, e)); });
}

void ImageRemoteError;
