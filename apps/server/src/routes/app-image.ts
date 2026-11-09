import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { imageAppManifest } from '@ks-designai/image-card-pack/server';
import { CanvasStateError } from '../canvas/errors.js';
import type { ImageAppService } from '../media/image-app.js';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import type { AuditLog } from '../storage/audit-log.js';
import { appVisibleToTenant, tenantOf } from '../tenant.js';
type Authorize = (req: Request, res: Response, projectId: string, access: {
    mode: 'read' | 'write';
    capability?: string;
}) => Promise<boolean>;
/** Real image App protocol, mounted in the host alongside its cloud-storage adapter.
 * It does not announce a detail editor or invent an independent image database. */
export function registerImageAppRoutes(app: Express, deps: {
    service: ImageAppService;
    authorize: Authorize;
    apps: AppRegistryStore;
    entitlements: AppEntitlementStore;
    audit: AuditLog;
    allowedKinds: (projectId: string) => Promise<string[] | undefined>;
}) {
    const send = (res: Response, error: unknown) => { const value = error as {
        status?: number;
        code?: string;
        message?: string;
    }; res.status(value.status ?? 500).json({ requestId: `req_${randomUUID()}`, error: { code: value.code ?? 'IMAGE_INTERNAL_ERROR', message: value.message ?? 'Image App request failed', retryable: (value.status ?? 500) >= 500 } }); };
    const allow = async (req: Request, res: Response, projectId: string, write: boolean) => {
        const app = await deps.apps.get('image');
        if (!app || app.status !== 'active' || !appVisibleToTenant(app, tenantOf(req)) || deps.entitlements.resolve('image', tenantOf(req)) === 'deny')
            throw new CanvasStateError(403, 'IMAGE_APP_FORBIDDEN', 'Image App is not available to this caller');
        if (!await deps.authorize(req, res, projectId, { mode: write ? 'write' : 'read', ...(write ? { capability: 'writeFiles' } : {}) }))
            return false;
        if (write) {
            const kinds = await deps.allowedKinds(projectId);
            if (kinds && !kinds.includes('*') && !kinds.includes('image'))
                throw new CanvasStateError(403, 'CARD_KIND_NOT_ALLOWED', 'Image cards are not allowed in this workspace');
        }
        return true;
    };
    const data = (res: Response, result: unknown, status = 200) => res.status(status).json({ requestId: `req_${randomUUID()}`, data: result });
    app.get('/api/apps/image', (req, res) => { void (async () => { const row = await deps.apps.get('image'); if (!row || !appVisibleToTenant(row, tenantOf(req)) || deps.entitlements.resolve('image', tenantOf(req)) === 'deny')
        throw new CanvasStateError(403, 'IMAGE_APP_FORBIDDEN', 'Image App unavailable'); data(res, imageAppManifest); })().catch(e => send(res, e)); });
    app.get('/api/apps/image/permissions', (_req, res) => data(res, { available: true, provider: 'host-project-and-card-grants', externalTeamProvider: { available: false }, detailEditor: { available: false } }));
    app.get('/api/apps/image/instances', async (req, res) => { try {
        const projectId = String(req.query.canvasId ?? '');
        if (!projectId)
            throw new CanvasStateError(400, 'IMAGE_CANVAS_REQUIRED', 'Pass canvasId to list this image workspace');
        if (!await allow(req, res, projectId, false))
            return;
        data(res, { instances: [await deps.service.state(projectId)] });
    }
    catch (e) {
        send(res, e);
    } });
    app.get('/api/apps/image/instances/:instanceId/artifacts',async(req,res)=>{try{if(!await allow(req,res,req.params.instanceId,false))return;data(res,{document:await deps.service.artifact(req.params.instanceId,String(req.query.path??''))});}catch(e){send(res,e);}});
    app.get('/api/apps/image/instances/:instanceId/tools',async(req,res)=>{try{if(!await allow(req,res,req.params.instanceId,false))return;data(res,await deps.service.tools());}catch(e){send(res,e);}});
    app.get('/api/apps/image/instances/:instanceId/state', async (req, res) => { try {
        if (!await allow(req, res, req.params.instanceId, false))
            return;
        data(res, await deps.service.state(req.params.instanceId));
    }
    catch (e) {
        send(res, e);
    } });
    app.get('/api/apps/image/instances/:instanceId/action-receipts/:receiptId', async (req, res) => { try {
        if (!await allow(req, res, req.params.instanceId, false))
            return;
        data(res, await deps.service.receipt(req.params.instanceId, req.params.receiptId));
    }
    catch (e) {
        send(res, e);
    } });
    const action = async (req: Request, res: Response) => {
        try {
            const actionId = String(req.params.actionId), body = req.body ?? {};
            if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input))
                throw new CanvasStateError(400, 'IMAGE_INVALID_INPUT', 'input must be an object');
            const projectId = String(req.params.instanceId ?? body.input.canvasId ?? '');
            if (!projectId)
                throw new CanvasStateError(400, 'IMAGE_CANVAS_REQUIRED', 'canvasId is required');
            if (!req.params.instanceId && actionId !== 'image.create' || req.params.instanceId && actionId === 'image.create')
                throw new CanvasStateError(404, 'IMAGE_ACTION_NOT_FOUND', 'Action has a different target scope');
            if (!await allow(req, res, projectId, !['image.status','image.edit.read'].includes(actionId)))
                return;
            const result = await deps.service.action(projectId, actionId, body.input, body.expectedRevision, req.get('idempotency-key'));
            if (!['image.status','image.edit.read'].includes(actionId))
                deps.audit.record({ actor: tenantOf(req), action: actionId, appId: 'image', targetId: projectId, status: result.status === 'failed' ? 'failed' : 'succeeded', summary: JSON.stringify({ nodeId: body.input.nodeId, receiptId: 'receiptId' in result ? result.receiptId : undefined }) });
            data(res, result, result.status === 'accepted' ? 202 : 200);
        }
        catch (e) {
            send(res, e);
        }
    };
    app.post('/api/apps/image/actions/:actionId', action);
    app.post('/api/apps/image/instances/:instanceId/actions/:actionId', action);
}
