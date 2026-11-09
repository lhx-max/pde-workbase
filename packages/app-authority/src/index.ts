/** MA's published /me + application-instance read contract, adapted by Apps.
 * No organization mirror, provisional /resolve endpoint, or self-reported
 * X-Team-Id/X-User-Id authentication is introduced here.
 */
export { createAppWriteAuthorizer, type AppWriteAuthorizer, type AppWriteGrant, type VerifiedWriteActor } from './write-policy.js';
export interface AppActor {
  teamId: string; userId: string; bizId: string;
  applicationId: string; applicationInstanceId: string; providerInstanceId: string;
}
export interface MaAuthorityOptions {
  transport: { origin: string } | { endpoint: string; projectId: string };
  fetcher?: typeof fetch;
  timeoutMs?: number;
}
export class AuthorityError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function maAuthorityFromEnvironment(env:Record<string,string|undefined>):MaAuthorityOptions|undefined{
  if(env.MAV_API_TRANSPORT==='appwrite'){
    if(!env.MAV_APPWRITE_ENDPOINT||!env.MAV_APPWRITE_PROJECT_ID)throw new AuthorityError(503,'MA_AUTH_NOT_CONFIGURED','MA Function authority endpoint and project are required');
    return{transport:{endpoint:env.MAV_APPWRITE_ENDPOINT,projectId:env.MAV_APPWRITE_PROJECT_ID}};
  }
  if(env.MAV_API_ORIGIN)return{transport:{origin:env.MAV_API_ORIGIN}};
  return undefined;
}
type Headers = Record<string, string | string[] | undefined>;
function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new AuthorityError(401, 'AUTH_CONTEXT_REQUIRED', `Missing or invalid ${field}`);
  return value;
}
export function createMaAuthority(options: MaAuthorityOptions) {
  const target = new URL('endpoint' in options.transport ? options.transport.endpoint : options.transport.origin);
  if (target.username || target.password || target.search || target.hash
    || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(target.hostname))))
    throw new AuthorityError(503, 'MA_AUTH_NOT_CONFIGURED', 'Invalid MA authority endpoint');
  const transport = options.transport;
  return async (headers: Headers): Promise<AppActor> => {
    const credential = headers['x-mav-sso-authorization'];
    if (typeof credential !== 'string' || credential.length > 16384 || !/^Bearer [A-Za-z0-9\-._~+/]+=*$/i.test(credential))
      throw new AuthorityError(401, 'SSO_CREDENTIAL_REQUIRED', 'MA SSO credential required');
    const tenant = required(headers['x-mav-tenant'], 'MA tenant');
    const instanceId = required(headers['x-mav-application-instance-id'], 'MA application instance');
    const request = async (route: string): Promise<Record<string, unknown>> => {
      const forwarded = { authorization: credential, 'x-mav-tenant': tenant, accept: 'application/json' };
      try {
        let response: Response;
        if ('endpoint' in transport) {
          response = await (options.fetcher ?? fetch)(transport.endpoint, { method: 'POST', redirect: 'error', credentials: 'omit',
            headers: { 'content-type':'application/json', 'x-appwrite-project':transport.projectId },
            body: JSON.stringify({ async:false, path:`/api/ma-v/v1${route}`, method:'GET', headers:forwarded }), signal:AbortSignal.timeout(options.timeoutMs ?? 10000) });
        } else response = await (options.fetcher ?? fetch)(`${transport.origin.replace(/\/+$/,'')}/api/ma-v/v1${route}`, {
          headers:forwarded,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(options.timeoutMs ?? 10000) });
        if (!response.ok) throw new AuthorityError(response.status===401||response.status===403?response.status:503,'MA_AUTH_REJECTED','MA authority rejected the request');
        let body = await response.json() as Record<string, unknown>;
        if ('endpoint' in transport) {
          if (body.status!=='completed') throw new AuthorityError(503,'MA_AUTH_UNAVAILABLE','MA verification did not complete');
          const status=body.responseStatusCode;
          if (status!==200) throw new AuthorityError(status===401||status===403?status:503,'MA_AUTH_REJECTED','MA authority rejected the request');
          body=JSON.parse(String(body.responseBody));
        }
        if (!body.data || typeof body.data!=='object' || Array.isArray(body.data)) throw new AuthorityError(503,'MA_AUTH_INVALID_RESPONSE','Invalid MA verification response');
        return body.data as Record<string,unknown>;
      } catch(error) { if(error instanceof AuthorityError)throw error;throw new AuthorityError(503,'MA_AUTH_UNAVAILABLE','MA authority unavailable'); }
    };
    const user=await request('/me');
    if(user.status!=='active')throw new AuthorityError(403,'USER_INACTIVE','MA user is not active');
    const userId=required(user.userId,'verified MA user');
    // Reading this instance must succeed under the SAME SSO and tenant. MA,
    // rather than a browser-provided actor, owns membership and visibility.
    const instance=await request(`/application-instances/${encodeURIComponent(instanceId)}`);
    if(instance.applicationInstanceId!==instanceId||instance.status!=='active')throw new AuthorityError(403,'INSTANCE_FORBIDDEN','MA instance is not active or mismatched');
    return {teamId:tenant,userId,bizId:required(instance.bizId,'MA business space'),applicationId:required(instance.applicationId,'MA application'),applicationInstanceId:instanceId,providerInstanceId:required(instance.providerInstanceId,'MA provider instance')};
  };
}
