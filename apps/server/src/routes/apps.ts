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
  app.get('/api/apps', async (_req, res) => {
    try {
      const apps = await deps.registry.list();
      res.json({ requestId: requestId(), data: { apps } });
    } catch (error) { sendAppError(res, error); }
  });

  app.post('/api/apps/register', async (req, res) => {
    try {
      const { appId, name, endpoint, description } = (req.body ?? {}) as { appId?: string; name?: string; endpoint?: string; description?: string };
      if (!appId || !name || !endpoint) throw new CanvasStateError(400, 'BAD_REQUEST', 'appId, name and endpoint are required');
      if (!/^https?:\/\//.test(endpoint)) throw new CanvasStateError(400, 'BAD_REQUEST', 'endpoint must be an http(s) URL');
      const row = await deps.registry.register({ appId, name, endpoint: endpoint.replace(/\/+$/, ''), description, status: 'active' });
      res.status(201).json({ requestId: requestId(), data: { app: row } });
    } catch (error) { sendAppError(res, error); }
  });
}
