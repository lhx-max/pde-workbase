import type { Express } from 'express';
import type { BrowserPreferencesService } from '../services/browser-preferences.js';

/** Uses the server's global authorization middleware, never an unrelated app-config API. */
export function registerBrowserPreferenceRoutes(app: Express, service: BrowserPreferencesService): void {
  app.get('/api/browser-preferences', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(service.read()); });
  app.put('/api/browser-preferences', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(service.update(req.body)); });
}
