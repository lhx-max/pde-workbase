import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import type { AuditLog } from '../storage/audit-log.js';
import { CanvasStateError } from '../canvas/errors.js';

const requestId = () => `req_${randomUUID()}`;

function sendAppError(res: Response, error: unknown): void {
  const err = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', String(error));
  res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.status >= 500 } , requestId: requestId() });
}

export interface RegisterAppsRoutesDeps {
  registry: AppRegistryStore;
  entitlements?: AppEntitlementStore;
  audit?: AuditLog;
  /** Local-daemon request check (same seam the canvas routes use). */
  authorizeProjectRequest?: (req: Request, res: Response, projectId: string, access?: { mode: 'read' | 'write' }) => Promise<boolean>;
}

/** App catalog: how the manage side discovers which Design Apps exist.
 * `GET /api/apps` lists canvas + self-registered external Apps;
 * `POST /api/apps/register` lets an external App announce its endpoint. */
export function registerAppsRoutes(app: Express, deps: RegisterAppsRoutesDeps): void {
  const tenantOf = (req: Request): { teamId: string; userId: string } => ({
    teamId: typeof req.headers['x-team-id'] === 'string' && req.headers['x-team-id'] ? req.headers['x-team-id'] : 'local',
    userId: typeof req.headers['x-user-id'] === 'string' && req.headers['x-user-id'] ? req.headers['x-user-id'] : 'local',
  });

  app.get('/api/apps', async (req, res) => {
    try {
      const tenant = tenantOf(req);
      const apps = (await deps.registry.list())
        .filter(a => (a.scope ?? 'platform') === 'platform' || a.teamId === tenant.teamId)
        .filter(a => !deps.entitlements || deps.entitlements.resolve(a.appId, tenant) === 'allow');
      res.json({ requestId: requestId(), data: { apps } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Entitlement governance table (spec §3.0): operators write rows, hosts
   * and Apps check access. Visibility filter already applies to /api/apps. */
  app.get('/api/apps/entitlements', async (req, res) => {
    try {
      res.json({ requestId: requestId(), data: { rules: deps.entitlements?.list(typeof req.query.appId === 'string' ? req.query.appId : undefined) ?? [] } });
    } catch (error) { sendAppError(res, error); }
  });
  app.put('/api/apps/entitlements', async (req, res) => {
    try {
      if (!deps.entitlements) throw new CanvasStateError(501, 'ENTITLEMENTS_UNAVAILABLE', 'entitlement store not configured');
      const { scope, appId, effect } = (req.body ?? {}) as { scope?: string; appId?: string; effect?: 'allow' | 'deny' };
      if (!scope || !appId || (effect !== 'allow' && effect !== 'deny')) throw new CanvasStateError(400, 'BAD_REQUEST', 'scope, appId and effect(allow|deny) are required');
      if (scope !== '*' && !/^team:[A-Za-z0-9_-]+$|^user:[A-Za-z0-9_-]+$/.test(scope)) throw new CanvasStateError(400, 'BAD_REQUEST', 'scope must be * | team:<id> | user:<id>');
      const rule = deps.entitlements.put({ scope, appId, effect, updatedBy: tenantOf(req).userId });
      deps.audit?.record({ actor: tenantOf(req), action: 'entitlement.put', appId, targetId: rule.id, status: 'succeeded', summary: `${scope} ${effect}` });
      res.json({ requestId: requestId(), data: { rule } });
    } catch (error) { sendAppError(res, error); }
  });
  app.delete('/api/apps/entitlements', async (req, res) => {
    try {
      const { scope, appId } = (req.body ?? {}) as { scope?: string; appId?: string };
      if (!scope || !appId) throw new CanvasStateError(400, 'BAD_REQUEST', 'scope and appId are required');
      if (!deps.entitlements?.remove(scope, appId)) throw new CanvasStateError(404, 'ENTITLEMENT_NOT_FOUND', 'rule not found');
      res.json({ requestId: requestId(), data: { removed: { scope, appId } } });
    } catch (error) { sendAppError(res, error); }
  });
  /** Access check — Apps call this to gate their own actions for a tenant
   * (catalogue visibility alone can't stop direct endpoint calls). */
  app.get('/api/apps/entitlements/check', async (req, res) => {
    try {
      const appId = String(req.query.appId ?? '');
      const tenant = tenantOf(req);
      const allowed = !deps.entitlements || deps.entitlements.resolve(appId, tenant) === 'allow';
      res.json({ requestId: requestId(), data: { appId, teamId: tenant.teamId, userId: tenant.userId, allowed } });
    } catch (error) { sendAppError(res, error); }
  });

  app.post('/api/apps/register', async (req, res) => {
    try {
      const { appId, name, endpoint, webUrl, description, scope } = (req.body ?? {}) as { appId?: string; name?: string; endpoint?: string; webUrl?: string; description?: string; scope?: 'platform' | 'team' };
      if (!appId || !name || !endpoint) throw new CanvasStateError(400, 'BAD_REQUEST', 'appId, name and endpoint are required');
      if (!/^https?:\/\//.test(endpoint)) throw new CanvasStateError(400, 'BAD_REQUEST', 'endpoint must be an http(s) URL');
      if (webUrl !== undefined && !/^https?:\/\//.test(webUrl)) throw new CanvasStateError(400, 'BAD_REQUEST', 'webUrl must be an http(s) URL when provided');
      const cleanWebUrl = webUrl?.replace(/\/+$/, '');
      // Team-scoped apps belong to the registering tenant's catalogue only.
      const row = await deps.registry.register({ appId, name, endpoint: endpoint.replace(/\/+$/, ''), ...(cleanWebUrl ? { webUrl: cleanWebUrl } : {}), description, status: 'active', scope: scope === 'team' ? 'team' : 'platform', ...(scope === 'team' ? { teamId: tenantOf(req).teamId } : {}) });
      deps.audit?.record({ actor: tenantOf(req), action: 'app.register', appId, targetId: appId, status: 'succeeded', summary: `${name} ${endpoint}` });
      res.status(201).json({ requestId: requestId(), data: { app: row } });
    } catch (error) { sendAppError(res, error); }
  });

  app.delete('/api/apps/:appId', async (req, res) => {
    try {
      const { appId } = req.params;
      if (!appId || appId === 'canvas') throw new CanvasStateError(400, 'BAD_REQUEST', 'cannot unregister canvas itself');
      const existed = await deps.registry.unregister(appId);
      if (!existed) throw new CanvasStateError(404, 'APP_NOT_FOUND', `app ${appId} is not registered`);
      deps.audit?.record({ actor: tenantOf(req), action: 'app.unregister', appId, targetId: appId, status: 'succeeded' });
      res.json({ requestId: requestId(), data: { unregistered: appId } });
    } catch (error) { sendAppError(res, error); }
  });
}
