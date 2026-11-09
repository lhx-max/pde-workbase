import type { Express, Response } from 'express';
import { BrowserResourceError, parseBrowserResourceCommand, type BrowserResourceErrorCode } from '@bezier/contracts';
import type { RequestHandler } from 'express';
import type { BrowserResourceCommand, BrowserResourceResult } from '@bezier/contracts';
import type { ProjectRegistry } from '../storage/project-registry.js';

export interface RegisterBrowserResourceRoutesDeps {
 registry: ProjectRegistry;
 http: {requireLocalDaemonRequest: RequestHandler};
 authorizeProjectRequest: (req: Parameters<RequestHandler>[0], res: Response, projectId: string, options: {mode:'read'}) => Promise<boolean>;
 desktopBrowserResources?: (command: BrowserResourceCommand) => Promise<BrowserResourceResult>;
}

const failures: Record<BrowserResourceErrorCode, { status: number; message: string }> = {
  unavailable: { status: 503, message: 'Enable resource capture in the current desktop tab first' },
  'invalid-request': { status: 400, message: 'Invalid browser resource request' },
  unauthorized: { status: 403, message: 'A valid desktop-issued browser resource grant is required' },
  'stale-document': { status: 409, message: 'The browser document changed; refresh the resource list' },
  'unsupported-resource': { status: 422, message: 'This browser resource cannot be read' },
  'too-large': { status: 413, message: 'The browser resource exceeds the size limit' },
  timeout: { status: 504, message: 'The browser resource request timed out' },
  'read-failed': { status: 502, message: 'The browser resource could not be read' },
};

function sendFailure(res: Response, code: BrowserResourceErrorCode): void {
  if (!Object.hasOwn(failures, code)) code = 'read-failed';
  const failure = failures[code];
  res.status(failure.status).json({ error: { code, message: failure.message } });
}

/** HTTP is only a transport for native grants, never an alternate grant issuer. */
export function registerBrowserResourceRoutes(app: Express, ctx: RegisterBrowserResourceRoutesDeps): void {
  app.post('/api/projects/:id/browser-resources/:action', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }, ctx.http.requireLocalDaemonRequest, async (req, res) => {
    try {
      const input = req.body;
      const allowed = req.params.action === 'read' ? ['sessionId', 'resourceId', 'navigationId'] : ['sessionId'];
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !allowed.includes(key)) || Object.keys(req.query).length) {
        sendFailure(res, 'invalid-request'); return;
      }
      const accessToken = req.headers['x-browser-resource-token'];
      if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 256
        || /[\s,\x00-\x1f\x7f]/.test(accessToken)) {
        sendFailure(res, 'unauthorized'); return;
      }
      const command = parseBrowserResourceCommand({ ...input, action: req.params.action, projectId: req.params.id, accessToken });
      // A project ACL is necessary but never sufficient: the executor separately
      // verifies the in-memory grant and its exact project/tab/navigation binding.
      if (!await ctx.authorizeProjectRequest(req, res, command.projectId, { mode: 'read' })) return;
      if (!ctx.registry.get(command.projectId)) {
        res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } }); return;
      }
      if (!ctx.desktopBrowserResources) { sendFailure(res, 'unavailable'); return; }
      res.json(await ctx.desktopBrowserResources(command));
    } catch (error) {
      // Never echo native/transport exception text: it may contain a URL or token.
      sendFailure(res, error instanceof BrowserResourceError ? error.code : 'read-failed');
    }
  });
}
