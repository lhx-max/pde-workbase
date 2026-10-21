import type { Request } from 'express';
import type { RegisteredApp } from './storage/app-registry.js';

export interface TenantContext { teamId: string; userId: string }

/** Development identity only. Deployed adapters must replace client headers
 * with verified identity before routes run; these headers are not credentials. */
export function tenantOf(req: Request): TenantContext {
  return {
    teamId: req.get('x-team-id')?.trim() || 'local',
    userId: req.get('x-user-id')?.trim() || 'local',
  };
}

export function appVisibleToTenant(app: Pick<RegisteredApp, 'scope' | 'teamId'>, tenant: TenantContext): boolean {
  return (app.scope ?? 'platform') === 'platform' || (app.scope === 'team' && app.teamId === tenant.teamId);
}

export function ownsTenantAsset(asset: { teamId?: string }, tenant: TenantContext): boolean {
  return (asset.teamId ?? 'local') === tenant.teamId;
}

/** Local single-user development convenience, NOT a deployed administrator role. */
export function isLocalAppOperator(req: Request): boolean {
  const tenant = tenantOf(req);
  return tenant.teamId === 'local' && tenant.userId === 'local';
}

/** Supplied by a trusted host identity/role adapter, never a client admin header. */
export type AuthorizeAppManagement = (req: Request) => boolean | Promise<boolean>;
