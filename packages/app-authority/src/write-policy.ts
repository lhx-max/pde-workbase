import type { AppActor } from './index.js';

/** Service-owned action delegation over MA-verified identities. This is not a
 * second tenant/member directory and never interprets client role headers. */
export interface AppWriteGrant {
  teamId: string;
  bizId: string;
  userId: string;
  applicationId?: string;
  applicationInstanceId?: string;
  actions: string[];
}
export type VerifiedWriteActor = Partial<AppActor> & { teamId: string; userId: string; userVerified?: boolean };
export type AppWriteAuthorizer = (actor: VerifiedWriteActor, action: string) => boolean;

/** Until the host supplies a trusted action authorization adapter, no grant
 * means read-only. The caller must first resolve the actor through MA authority.
 * Grants are server configuration, never request body/headers or stored tokens. */
export function createAppWriteAuthorizer(raw: string | undefined): AppWriteAuthorizer {
  const input: unknown = raw === undefined || raw.trim() === '' ? [] : JSON.parse(raw);
  if (!Array.isArray(input)) throw new Error('App write grants must be an array');
  const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
  const actionName = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9.-]*$/.test(v);
  const grants: AppWriteGrant[] = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid App write grant');
    const g = value as Record<string, unknown>;
    if (Object.keys(g).some(key => !['teamId', 'bizId', 'userId', 'applicationId', 'applicationInstanceId', 'actions'].includes(key))
      || !identifier(g.teamId) || !identifier(g.bizId) || !identifier(g.userId)
      || (g.applicationId !== undefined && !identifier(g.applicationId))
      || (g.applicationInstanceId !== undefined && !identifier(g.applicationInstanceId))
      || !Array.isArray(g.actions) || !g.actions.every(actionName)) throw new Error('Write grants require exact MA scope and action names');
    return { teamId: g.teamId, bizId: g.bizId, userId: g.userId,
      ...(g.applicationId === undefined ? {} : { applicationId: g.applicationId }),
      ...(g.applicationInstanceId === undefined ? {} : { applicationInstanceId: g.applicationInstanceId }), actions: [...g.actions] };
  });
  return (actor, action) => actor.userVerified !== false && identifier(actor.bizId)
    && identifier(actor.applicationId) && identifier(actor.applicationInstanceId) && identifier(actor.providerInstanceId)
    && grants.some(g => g.teamId === actor.teamId && g.bizId === actor.bizId && g.userId === actor.userId
      && (g.applicationId === undefined || g.applicationId === actor.applicationId)
      && (g.applicationInstanceId === undefined || g.applicationInstanceId === actor.applicationInstanceId)
      && g.actions.includes(action));
}
