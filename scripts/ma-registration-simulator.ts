/** Local registration fixture around an unmodified MA-V host. Never deploy this proxy. */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string' }, port: { type: 'string', default: '18581' },
  'host-port': { type: 'string', default: '18580' }, 'canvas-port': { type: 'string', default: '17463' },
  'doc-port': { type: 'string', default: '19000' },
  'sketch-port': { type: 'string', default: '19465' }, 'manifest-dir': { type: 'string' },
} });
const root = values['data-dir'];
if (!root || !path.isAbsolute(root)) throw new Error('--data-dir must be an explicit absolute path');
const portOf = (value: string | undefined) => {
  const port = Number(value); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port'); return port;
};
const port = portOf(values.port), hostPort = portOf(values['host-port']);
const canvasPort = portOf(values['canvas-port']), docPort = portOf(values['doc-port']), sketchPort = portOf(values['sketch-port']);
if (values['manifest-dir'] && !path.isAbsolute(values['manifest-dir'])) throw new Error('--manifest-dir must be absolute');
type Instance = { applicationInstanceId: string; applicationId: string; applicationVersion: string; providerInstanceId: string;
  bizId: string; title: string; status: string; revision: number; createdByUserId: string; createdAt: string; updatedAt: string };
type Links = { applicationInstanceIds: string[]; applicationsRevision: number };
type State = { resourceScopes?: Record<string,{tenantId:string;userId:string}>; instances: Instance[]; links: Record<string, Links>; attempts: Record<string, string>; tabs?: Record<string, { openTabIds: string[]; tabsRevision: number }> };
await mkdir(root, { recursive: true });
const stateFile = path.join(root, 'registration.json');
let state: State;
try { state = JSON.parse(await readFile(stateFile, 'utf8')) as State; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; state = { instances: [], links: {}, attempts: {} }; }
const persist = async () => { await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2)); const { rename } = await import('node:fs/promises'); await rename(`${stateFile}.tmp`, stateFile); };
const manifests = await Promise.all((values['manifest-dir'] ? ['canvas','doc','sketch','image'] : ['canvas', 'doc']).map(async slug => {
  const manifest = JSON.parse(await readFile(values['manifest-dir'] ? path.join(values['manifest-dir'], `${slug}.local.manifest.json`) : new URL(`../docs/verification/ma-registration/${slug}.local.manifest.json`, import.meta.url), 'utf8'));
  manifest.provider.baseUrl = `http://127.0.0.1:${slug === 'doc' ? docPort : slug === 'sketch' ? sketchPort : canvasPort}`;
  return manifest;
}));
const applications = manifests.map(manifest => ({ applicationId: `app_${createHash('sha256').update(`local-simulation:${manifest.slug}`).digest('hex').slice(0, 24)}`,
  developerUserId: 'local_simulator', status: 'published', currentVersion: manifest.version, manifestRevision: 1, manifest,
  createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' }));
const reply = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ma-registration-mode': 'local-simulation' });
  res.end(JSON.stringify({ requestId: `sim_${randomUUID()}`, ...data as object }));
};
const fail = (res: ServerResponse, status: number, code: string, message: string) => reply(res, { error: { code, message } }, status);
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw new Error('Body too large'); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
async function provider(instance: Instance, actionId: string, input: unknown, tenantId: string, sessionId: string, expectedRevision?: unknown) {
  const app = applications.find(item => item.applicationId === instance.applicationId)!;
  const key = randomUUID();
  return fetch(`${app.manifest.provider.baseUrl}/open-platform/v1/instances/${encodeURIComponent(instance.providerInstanceId)}/actions/${actionId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ protocolVersion: '1.0', requestId: key, idempotencyKey: key, applicationId: app.applicationId,
      applicationVersion: app.currentVersion, applicationInstanceId: instance.applicationInstanceId, providerInstanceId: instance.providerInstanceId,
      bizId: instance.bizId, sessionId, actor: { tenantId, userId: instance.createdByUserId }, actionId, input,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}) }),
  });
}
// Serialize fixture mutations so concurrent link/create requests retain their revisions.
let queue = Promise.resolve();
async function simulated(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const method = req.method ?? 'GET';
  const tabMatch = pathname.match(/^\/api\/ma-v\/sessions\/([A-Za-z0-9_]+)\/tabs$/);
  if (tabMatch && method === 'PUT') {
    const body = await bodyOf(req), sessionId = tabMatch[1]!;
    if (!Array.isArray(body.tabIds) || body.tabIds.length > 102 || body.tabIds.some(id => typeof id !== 'string' || !/^(cloud-drive|debug|c_[A-Za-z0-9_]+|ai_[a-f0-9]{24})$/.test(id))) return fail(res, 400, 'BAD_REQUEST', 'Invalid tabs');
    const response = await fetch(`http://127.0.0.1:${hostPort}/api/ma-v/sessions/${sessionId}`, { headers: {
      'x-mav-sso-authorization': String(req.headers['x-mav-sso-authorization'] ?? ''), 'x-mav-tenant': String(req.headers['x-mav-tenant'] ?? 'local'),
    } });
    if (!response.ok) return fail(res, response.status, 'SESSION_UNAVAILABLE', 'Could not read the host session');
    const original = await response.json() as { session: { tabsRevision?: number }; eventCursor: string };
    const current = state.tabs?.[sessionId]?.tabsRevision ?? original.session.tabsRevision ?? 1;
    if (body.expectedTabsRevision !== current) return fail(res, 409, 'TABS_REVISION_CONFLICT', 'Refresh local tabs');
    const tabs = { openTabIds: [...new Set(body.tabIds as string[])], tabsRevision: current + 1 };
    (state.tabs ??= {})[sessionId] = tabs; await persist();
    return reply(res, { ...original, session: { ...original.session, ...tabs } });
  }
  if (pathname === '/api/ma-v/applications' && method === 'GET') return reply(res, { applications });
  let match = pathname.match(/^\/api\/ma-v\/applications\/(app_[a-f0-9]{24})\/instructions$/);
  if (match) {
    const app = applications.find(item => item.applicationId === match![1]);
    return app ? reply(res, { instructions: { applicationId: app.applicationId, version: app.currentVersion, actions: app.manifest.actions } }) : fail(res, 404, 'NOT_FOUND', 'Unknown simulated app');
  }
  match = pathname.match(/^\/api\/ma-v\/projects\/([A-Za-z0-9_]+)\/application-instances$/);
  if (match) {
    const bizId = match[1]!;
    if (method === 'GET') return reply(res, { instances: state.instances.filter(item => item.bizId === bizId) });
    if (method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Unsupported method');
    const body = await bodyOf(req), app = applications.find(item => item.applicationId === body.applicationId);
    if (!app || typeof body.title !== 'string' || typeof body.providerInstanceId !== 'string') return fail(res, 400, 'BAD_REQUEST', 'Invalid instance');
    const attempt = `${bizId}:${req.headers['idempotency-key'] ?? body.providerInstanceId}`;
    const old = state.instances.find(item => item.applicationInstanceId === state.attempts[attempt]);
    if (old) return reply(res, { instance: old });
    const now = new Date().toISOString();
    const instance: Instance = { applicationInstanceId: `ai_${randomUUID().replaceAll('-', '').slice(0, 24)}`, applicationId: app.applicationId,
      applicationVersion: app.currentVersion, providerInstanceId: body.providerInstanceId, bizId, title: body.title,
      status: 'active', revision: 1, createdByUserId: bizId, createdAt: now, updatedAt: now };
    const initialized = await provider(instance, `${app.manifest.slug === 'image' ? 'canvas' : app.manifest.slug}.create`, { name: body.title }, String(req.headers['x-mav-tenant'] ?? 'local'), 'local_simulation');
    if (!initialized.ok) return fail(res, 502, 'LOCAL_PROVIDER_UNAVAILABLE', `Local Provider initialization failed (${initialized.status})`);
    (state.resourceScopes ??= {})[instance.applicationInstanceId] = {tenantId:String(req.headers['x-mav-tenant'] ?? 'local'),userId:instance.createdByUserId};
    state.instances.push(instance); state.attempts[attempt] = instance.applicationInstanceId; await persist(); return reply(res, { instance });
  }
  match = pathname.match(/^\/api\/ma-v\/sessions\/([A-Za-z0-9_]+)\/application-instances$/);
  if (match) {
    const sessionId = match[1]!, links = state.links[sessionId] ?? { applicationInstanceIds: [], applicationsRevision: 1 };
    if (method === 'GET') return reply(res, { sessionId, ...links });
    if (method !== 'PUT') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Unsupported method');
    const body = await bodyOf(req);
    if (body.expectedApplicationsRevision !== links.applicationsRevision) return fail(res, 409, 'REVISION_CONFLICT', 'Refresh simulated links before saving');
    if (!Array.isArray(body.applicationInstanceIds) || body.applicationInstanceIds.some(id => !state.instances.some(item => item.applicationInstanceId === id))) return fail(res, 400, 'BAD_REQUEST', 'Unknown simulated instance');
    const next = { applicationInstanceIds: [...new Set(body.applicationInstanceIds as string[])], applicationsRevision: links.applicationsRevision + 1 };
    state.links[sessionId] = next; await persist(); return reply(res, { sessionId, ...next });
  }
  match = pathname.match(/^\/api\/ma-v\/application-instances\/(ai_[a-f0-9]{24})(?:\/actions\/([a-z][a-z0-9._-]+))?$/);
  if (match) {
    const instance = state.instances.find(item => item.applicationInstanceId === match![1]);
    if (!instance) return fail(res, 404, 'NOT_FOUND', 'Unknown simulated instance');
    if (!match[2] && method === 'GET') return reply(res, { instance });
    const body = await bodyOf(req), sessionId = String(body.sessionId ?? '');
    if (!state.links[sessionId]?.applicationInstanceIds.includes(instance.applicationInstanceId)) return fail(res, 403, 'NOT_LINKED', 'Instance is not linked to this simulated session');
    const app = applications.find(item => item.applicationId === instance.applicationId)!;
    if (!app.manifest.actions.some((item: { id: string }) => item.id === match![2])) return fail(res, 404, 'UNKNOWN_ACTION', 'Action not in manifest');
    const response = await provider(instance, match[2]!, body.input ?? {}, String(req.headers['x-mav-tenant'] ?? 'local'), sessionId, body.expectedRevision);
    const result = await response.json();
    return response.ok ? reply(res, { result }) : reply(res, result, response.status);
  }
  fail(res, 404, 'NOT_FOUND', 'Unknown simulation route');
}
function proxy(req: IncomingMessage, res: ServerResponse, targetPort: number, pathname = req.url ?? '/', extraHeaders:Record<string,string> = {}) {
  const headers = { ...req.headers, ...extraHeaders, host: `127.0.0.1:${targetPort}`, 'accept-encoding': 'identity',
    ...(req.headers.origin ? { origin: `http://127.0.0.1:${targetPort}` } : {}) };
  const outgoing = http.request({ hostname: '127.0.0.1', port: targetPort, path: pathname, method: req.method, headers }, upstream => {
    const contentType = upstream.headers['content-type'] ?? '';
    if (targetPort === hostPort && contentType.includes('text/html')) {
      const chunks: Buffer[] = []; upstream.on('data', chunk => chunks.push(chunk)); upstream.on('end', () => {
        const badge = '<div style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#fff3cd;color:#654c00;border:1px solid #deb887;padding:5px 12px;border-radius:8px;font:12px sans-serif;pointer-events:none">本地模拟登记 · App连接真实本地服务；数据为隔离测试 · 未在云端注册</div>';
        const html = Buffer.concat(chunks).toString('utf8').replace('</body>', `${badge}</body>`);
        const responseHeaders = { ...upstream.headers }; delete responseHeaders['content-length']; delete responseHeaders['content-encoding'];
        res.writeHead(upstream.statusCode ?? 200, responseHeaders); res.end(html);
      });
    } else if (targetPort === hostPort && pathname.startsWith('/api/ma-v/') && contentType.includes('application/json')) {
      const chunks: Buffer[] = []; upstream.on('data', chunk => chunks.push(chunk)); upstream.on('end', () => {
        const overlay = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(overlay);
          if (!value || typeof value !== 'object') return value;
          const record = value as Record<string, unknown>;
          const next = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, overlay(child)]));
          return typeof record.sessionId === 'string' && state.tabs?.[record.sessionId] ? { ...next, ...state.tabs[record.sessionId] } : next;
        };
        let content = Buffer.concat(chunks);
        try { content = Buffer.from(JSON.stringify(overlay(JSON.parse(content.toString('utf8'))))); } catch { /* Preserve upstream errors. */ }
        const responseHeaders = { ...upstream.headers }; delete responseHeaders['content-length'];
        res.writeHead(upstream.statusCode ?? 502, responseHeaders); res.end(content);
      });
    } else { res.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(res); }
  });
  outgoing.on('error', () => { if (!res.headersSent) fail(res, 502, 'LOCAL_UPSTREAM_OFFLINE', 'Local service is offline'); else res.destroy(); });
  req.pipe(outgoing);
}
/** Local fixture resource bridge. No production credentials or authority claims. */
async function localResource(req:IncomingMessage,res:ServerResponse,url:URL){
  const instanceId=url.pathname.slice('/__local-resources/'.length),sessionId=url.searchParams.get('sessionId')??'';
  const instance=state.instances.find(item=>item.applicationInstanceId===instanceId);
  const scope=state.resourceScopes?.[instanceId];
  if(req.method!=='GET'||!instance||!scope||!state.links[sessionId]?.applicationInstanceIds.includes(instanceId))return fail(res,403,'LOCAL_RESOURCE_SCOPE_FORBIDDEN','Resource is not associated with this local fixture instance');
  const app=applications.find(item=>item.applicationId===instance.applicationId);
  if(!app||!['canvas','image'].includes(app.manifest.slug))return fail(res,403,'LOCAL_RESOURCE_SCOPE_FORBIDDEN','Not a canvas-hosted resource');
  const source=new URL(url.searchParams.get('source')??'',`http://127.0.0.1:${port}`);
  const match=source.pathname.match(/^\/canvas-provider\/api\/projects\/([A-Za-z0-9_-]+)\/files\//);
  if(source.origin!==`http://127.0.0.1:${port}`||!match)return fail(res,400,'LOCAL_RESOURCE_PATH_FORBIDDEN','Only this fixture canvas file route is supported');
  const read=await provider(instance,'canvas.read',{},scope.tenantId,sessionId);
  const snapshot=await read.json() as {data?:{canvasInstanceId?:string}};
  if(!read.ok||snapshot.data?.canvasInstanceId!==match[1])return fail(res,403,'LOCAL_RESOURCE_PROJECT_FORBIDDEN','Resource project does not match the provider instance');
  proxy(req,res,canvasPort,source.pathname.slice('/canvas-provider'.length)+source.search,{'x-team-id':scope.tenantId,'x-user-id':scope.userId});
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
  if (req.headers.host !== `127.0.0.1:${port}`) return fail(res, 403, 'LOCAL_ONLY', 'Use the exact loopback origin');
  if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) return fail(res, 403, 'ORIGIN_FORBIDDEN', 'Only the simulation page may call this proxy');
  if (pathname.startsWith('/__local-resources/')) { void localResource(req,res,new URL(req.url!,`http://127.0.0.1:${port}`)).catch(()=>{if(!res.headersSent)fail(res,503,'LOCAL_RESOURCE_UNAVAILABLE','Local resource bridge failed');}); return; }
  if (pathname === '/__registration-simulation') return reply(res, { mode: 'local-simulation', cloudRegistered: false, applications, ...state });
  if (pathname.startsWith('/doc-provider/')) return proxy(req, res, docPort, (req.url ?? '').slice('/doc-provider'.length));
  if (pathname.startsWith('/sketch-provider/')) return proxy(req, res, sketchPort, (req.url ?? '').slice('/sketch-provider'.length));
  if (pathname.startsWith('/canvas-provider/')) return proxy(req, res, canvasPort, (req.url ?? '').slice('/canvas-provider'.length));
  if (/^\/api\/ma-v\/(?:applications(?:\/|$)|projects\/[^/]+\/application-instances$|sessions\/[^/]+\/(?:application-instances|tabs)$|application-instances\/)/.test(pathname)) {
    queue = queue.then(() => simulated(req, res, pathname)).catch(() => { if (!res.headersSent) fail(res, 500, 'SIMULATION_ERROR', 'Local simulation failed; check Provider availability'); });
    return;
  }
  proxy(req, res, hostPort);
});
server.on('upgrade', (req, socket, head) => {
  if (req.headers.host !== `127.0.0.1:${port}`) return socket.destroy();
  const upstream = net.connect(hostPort, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries({ ...req.headers, host: `127.0.0.1:${hostPort}` }).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    upstream.write(head); socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
server.listen(port, '127.0.0.1', () => console.log(`Registration simulation: http://127.0.0.1:${port}; state=${stateFile}`));
