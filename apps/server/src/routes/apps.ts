import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import type { AuditLog } from '../storage/audit-log.js';
import { CanvasStateError } from '../canvas/errors.js';
import { appVisibleToTenant, isLocalAppOperator, tenantOf, forwardedAuthorityHeaders, type AuthorizeAppManagement } from '../tenant.js';

const requestId = () => `req_${randomUUID()}`;

function sendAppError(res: Response, error: unknown): void {
  const err = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', String(error));
  res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.status >= 500 } , requestId: requestId() });
}

export interface RegisterAppsRoutesDeps {
  registry: AppRegistryStore;
  entitlements?: AppEntitlementStore;
  audit?: AuditLog;
  /** Trusted operator-role adapter; local single-user default only. */
  authorizeAppManagement?: AuthorizeAppManagement;
  /** Local-daemon request check (same seam the canvas routes use). */
  authorizeProjectRequest?: (req: Request, res: Response, projectId: string, access?: { mode: 'read' | 'write' }) => Promise<boolean>;
}

/** App catalog: how the manage side discovers which Design Apps exist.
 * `GET /api/apps` lists canvas + self-registered external Apps;
 * `POST /api/apps/register` lets an external App announce its endpoint. */
export function registerAppsRoutes(app: Express, deps: RegisterAppsRoutesDeps): void {
  // Serialize the ownership check and registry mutation: concurrent teams
  // claiming a previously unused global appId must not overwrite each other.
  let mutationTail = Promise.resolve();
  const lockRegistry = async () => {
    const previous = mutationTail;
    let release!: () => void;
    mutationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  };
  const isOperator = deps.authorizeAppManagement ?? isLocalAppOperator;
  const requireOperator = async (req: Request) => {
    if (!await isOperator(req)) throw new CanvasStateError(403, 'APP_MANAGEMENT_FORBIDDEN', 'App governance requires an operator');
  };
  // Team self-registration is allowed, but the globally keyed appId must never
  // replace another team's entry or promote an entry into platform scope.
  const requireAppOwner = async (req: Request, existing: Awaited<ReturnType<AppRegistryStore['get']>>, scope?: string) => {
    if (await isOperator(req)) return;
    const tenant = tenantOf(req);
    if ((scope !== undefined && scope !== 'team') || (existing && (existing.scope !== 'team' || existing.teamId !== tenant.teamId))) {
      throw new CanvasStateError(403, 'APP_MANAGEMENT_FORBIDDEN', 'Only operators can manage platform or other teams’ Apps');
    }
  };

  app.get('/api/apps', async (req, res) => {
    try {
      const tenant = tenantOf(req);
      const apps = (await deps.registry.list())
        .filter(a => appVisibleToTenant(a, tenant))
        .filter(a => !deps.entitlements || deps.entitlements.resolve(a.appId, tenant) === 'allow');
      res.json({ requestId: requestId(), data: { apps } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Entitlement governance table (spec §3.0): operators write rows, hosts
   * and Apps check access. Visibility filter already applies to /api/apps. */
  app.get('/api/apps/entitlements', async (req, res) => {
    try {
      await requireOperator(req);
      res.json({ requestId: requestId(), data: { rules: deps.entitlements?.list(typeof req.query.appId === 'string' ? req.query.appId : undefined) ?? [] } });
    } catch (error) { sendAppError(res, error); }
  });
  app.put('/api/apps/entitlements', async (req, res) => {
    try {
      await requireOperator(req);
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
      await requireOperator(req);
      const { scope, appId } = (req.body ?? {}) as { scope?: string; appId?: string };
      if (!scope || !appId) throw new CanvasStateError(400, 'BAD_REQUEST', 'scope and appId are required');
      if (!deps.entitlements?.remove(scope, appId)) throw new CanvasStateError(404, 'ENTITLEMENT_NOT_FOUND', 'rule not found');
      res.json({ requestId: requestId(), data: { removed: { scope, appId } } });
    } catch (error) { sendAppError(res, error); }
  });
  /** Governance audit tail — who did what to which asset, most recent last. */
  app.get('/api/apps/audit', async (req, res) => {
    try {
      res.json({ requestId: requestId(), data: { entries: deps.audit?.list({ teamId: tenantOf(req).teamId, ...(typeof req.query.limit === 'string' ? { limit: Number(req.query.limit) } : {}) }) ?? [] } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Access check — Apps call this to gate their own actions for a tenant
   * (catalogue visibility alone can't stop direct endpoint calls). */
  app.get('/api/apps/entitlements/check', async (req, res) => {
    try {
      const appId = String(req.query.appId ?? '');
      const tenant = tenantOf(req);
      const registered = await deps.registry.get(appId);
      const allowed = Boolean(registered && registered.status === 'active' && appVisibleToTenant(registered, tenant)
        && (!deps.entitlements || deps.entitlements.resolve(appId, tenant) === 'allow'));
      res.json({ requestId: requestId(), data: { appId, teamId: tenant.teamId, userId: tenant.userId, allowed } });
    } catch (error) { sendAppError(res, error); }
  });

  app.post('/api/apps/register', async (req, res) => {
    const release = await lockRegistry();
    try {
      const { appId, name, endpoint, webUrl, description, scope, manifest } = (req.body ?? {}) as { appId?: string; name?: string; endpoint?: string; webUrl?: string; description?: string; scope?: 'platform' | 'team'; manifest?: Record<string, unknown> };
      if (!appId || !name || !endpoint) throw new CanvasStateError(400, 'BAD_REQUEST', 'appId, name and endpoint are required');
      if (!/^https?:\/\//.test(endpoint)) throw new CanvasStateError(400, 'BAD_REQUEST', 'endpoint must be an http(s) URL');
      try{const target=new URL(endpoint);if(target.username||target.password||target.search||target.hash)throw Error();}catch{throw new CanvasStateError(400,'BAD_REQUEST','App endpoint must be a credential-free URL without query or fragment');}
      if (webUrl !== undefined && !/^https?:\/\//.test(webUrl)) throw new CanvasStateError(400, 'BAD_REQUEST', 'webUrl must be an http(s) URL when provided');
      if (appId === 'canvas') throw new CanvasStateError(400, 'BAD_REQUEST', 'cannot replace canvas itself');
      if (scope !== undefined && scope !== 'team' && scope !== 'platform') throw new CanvasStateError(400, 'BAD_REQUEST', 'scope must be platform or team');
      await requireAppOwner(req, await deps.registry.get(appId), scope ?? 'platform');
      const cleanWebUrl = webUrl?.replace(/\/+$/, '');
      // Team-scoped apps belong to the registering tenant's catalogue only.
      const row = await deps.registry.register({ appId, name, endpoint: endpoint.replace(/\/+$/, ''), ...(cleanWebUrl ? { webUrl: cleanWebUrl } : {}), description, status: 'active', scope: scope === 'team' ? 'team' : 'platform', ...(scope === 'team' ? { teamId: tenantOf(req).teamId } : {}), ...(manifest && typeof manifest === 'object' ? { manifest } : {}) });
      deps.audit?.record({ actor: tenantOf(req), action: 'app.register', appId, targetId: appId, status: 'succeeded', summary: `${name} ${endpoint}` });
      res.status(201).json({ requestId: requestId(), data: { app: row } });
    } catch (error) { sendAppError(res, error); } finally { release(); }
  });

  /** Unified agent doorway: ONE entry point proxies to whichever App is
   * registered — agents never need per-app base URLs. Tenant headers and the
   * idempotency key are forwarded; entitlement deny short-circuits. */
  const proxyToApp = async (req: Request, res: Response, appId: string, suffix: string) => {
    try {
      const app = await deps.registry.get(appId);
      if (!app) throw new CanvasStateError(404, 'APP_NOT_FOUND', `app ${appId} is not registered`);
      if (app.status !== 'active') throw new CanvasStateError(403, 'APP_DISABLED', `app ${appId} is disabled`);
      const tenant = tenantOf(req);
      if (!appVisibleToTenant(app, tenant)) throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'App belongs to another team');
      if (deps.entitlements?.resolve(appId, tenant) === 'deny') throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'App denied for this tenant');
      const url = `${app.endpoint.replace(/\/+$/, '')}${suffix}${typeof req.query === 'object' && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
      const upstream = await fetch(url, {
        method: req.method,
        redirect:'error',
        headers: {
          'content-type': 'application/json',
          'x-team-id': tenant.teamId, 'x-user-id': tenant.userId,
          ...forwardedAuthorityHeaders(url),
          ...(req.get('idempotency-key') ? { 'idempotency-key': req.get('idempotency-key')! } : {}),
        },
        ...(req.method !== 'GET' ? { body: JSON.stringify(req.body ?? {}) } : {}),
      });
      const body = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(body);
    } catch (error) { sendAppError(res, error); }
  };
  // canvas owns its own routes under the same prefix — let them through.
  const external = (appId: string) => appId !== 'canvas';
  app.post('/api/apps/:appId/actions/:actionId', (req, res, next) => { if (!external(req.params.appId)) return next(); return proxyToApp(req, res, req.params.appId, `/actions/${encodeURIComponent(req.params.actionId)}`); });
  app.post('/api/apps/:appId/instances/:instanceId/actions/:actionId', (req, res, next) => { if (!external(req.params.appId)) return next(); return proxyToApp(req, res, req.params.appId, `/instances/${encodeURIComponent(req.params.instanceId)}/actions/${encodeURIComponent(req.params.actionId)}`); });
  app.get('/api/apps/:appId/instances/:instanceId/state', (req, res, next) => { if (!external(req.params.appId)) return next(); return proxyToApp(req, res, req.params.appId, `/instances/${encodeURIComponent(req.params.instanceId)}/state`); });
  app.get('/api/apps/:appId/instances', (req, res, next) => { if (!external(req.params.appId)) return next(); return proxyToApp(req, res, req.params.appId, '/instances'); });

  app.delete('/api/apps/:appId', async (req, res) => {
    const release = await lockRegistry();
    try {
      const { appId } = req.params;
      if (!appId || appId === 'canvas') throw new CanvasStateError(400, 'BAD_REQUEST', 'cannot unregister canvas itself');
      await requireAppOwner(req, await deps.registry.get(appId));
      const existed = await deps.registry.unregister(appId);
      if (!existed) throw new CanvasStateError(404, 'APP_NOT_FOUND', `app ${appId} is not registered`);
      deps.audit?.record({ actor: tenantOf(req), action: 'app.unregister', appId, targetId: appId, status: 'succeeded' });
      res.json({ requestId: requestId(), data: { unregistered: appId } });
    } catch (error) { sendAppError(res, error); } finally { release(); }
  });
}
