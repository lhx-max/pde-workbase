import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { RegisteredApp } from './storage/app-registry.js';
import type { AppActor } from '@ks-designai/app-authority';
import {CanvasStateError} from './canvas/errors.js';

export interface TenantContext extends Partial<Omit<AppActor,'teamId'|'userId'>> { teamId: string; userId: string; /** Set only by a trusted server verifier, never request headers. */ userVerified?: boolean }
const verifiedRequests=new WeakMap<Request,Readonly<AppActor>>();
const requestCredentials=new AsyncLocalStorage<Readonly<Record<string,string>>>();
const requestTrustedOrigins=new AsyncLocalStorage<readonly string[]>();
export function setVerifiedTenant(req:Request,actor:AppActor):void{verifiedRequests.set(req,Object.freeze({...actor,userVerified:true}));}
export function verifiedTenant(req:Request):Readonly<AppActor>|undefined{return verifiedRequests.get(req);}
export function forwardedAuthorityHeaders(target:string):Readonly<Record<string,string>>{
 const headers=requestCredentials.getStore()??{};
 if(Object.keys(headers).length&&!(requestTrustedOrigins.getStore()??[]).includes(new URL(target).origin))
  throw new CanvasStateError(403,'APP_ORIGIN_NOT_TRUSTED','MA credentials may only be sent to configured trusted App origins');
 return headers;
}

const requestTenant = new AsyncLocalStorage<Readonly<TenantContext>>();

/** The verified caller survives async work without borrowing the asset creator's
 * identity. Undefined means background work with no originating HTTP request. */
export function currentRequestTenant(): Readonly<TenantContext> | undefined {
  return requestTenant.getStore();
}

export function runWithRequestTenant<T>(tenant: TenantContext, run: () => T,credentials:Readonly<Record<string,string>>=requestCredentials.getStore()??{},trustedOrigins:readonly string[]=requestTrustedOrigins.getStore()??[]): T {
  return requestTrustedOrigins.run(trustedOrigins,()=>requestCredentials.run(Object.freeze({...credentials}),()=>requestTenant.run(Object.freeze({ ...tenant }), run)));
}

/** Development identity only. Deployed adapters must replace client headers
 * with verified identity before routes run; these headers are not credentials. */
export function tenantOf(req: Request): TenantContext {
  const verified=verifiedRequests.get(req);if(verified)return verified;
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
