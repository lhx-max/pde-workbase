import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { AppRegistryStore } from '../storage/app-registry.js';
import { CanvasStateError } from '../canvas/errors.js';

const requestId = () => `req_${randomUUID()}`;

function sendAppError(res: Response, error: unknown): void {
  const err = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', String(error));
  res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.status >= 500 } , requestId: requestId() });
}

export interface RegisterAppsRoutesDeps {
  registry: AppRegistryStore;
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
      const teamId = tenantOf(req).teamId;
      const apps = (await deps.registry.list())
        .filter(a => (a.scope ?? 'platform') === 'platform' || a.teamId === teamId);
      res.json({ requestId: requestId(), data: { apps } });
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
      res.status(201).json({ requestId: requestId(), data: { app: row } });
    } catch (error) { sendAppError(res, error); }
  });

  app.delete('/api/apps/:appId', async (req, res) => {
    try {
      const { appId } = req.params;
      if (!appId || appId === 'canvas') throw new CanvasStateError(400, 'BAD_REQUEST', 'cannot unregister canvas itself');
      const existed = await deps.registry.unregister(appId);
      if (!existed) throw new CanvasStateError(404, 'APP_NOT_FOUND', `app ${appId} is not registered`);
      res.json({ requestId: requestId(), data: { unregistered: appId } });
    } catch (error) { sendAppError(res, error); }
  });
}
