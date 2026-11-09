/** Per-invocation cloud runtime: resolve platform-injected config, take the
 * ownership-verified single-writer cloud lock, boot the real app server on a
 * disposable working root, serve exactly one request, flush durable state,
 * then release only our own lock. Nothing persists across executions except
 * what the stores committed to Appwrite. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { DecodedRequest, UpstreamResponse } from './transport.js';
import { TransportError } from './transport.js';
import { bridgeRequest } from './bridge.js';
import { AppwriteClient } from '../../../apps/server/src/storage/appwrite-client.js';
import type { CanvasServerOptions } from '../../../apps/server/src/server.js';
import { AppwriteWriterLock, assertPrivateAppwriteStorage } from '@ks-designai/app-cloud-state';
import { createAppWriteAuthorizer, maAuthorityFromEnvironment, type MaAuthorityOptions } from '@ks-designai/app-authority';

export interface FunctionServer {
  app: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  ready: Promise<void>;
  close(): Promise<void>;
}

export interface FunctionDeps {
  env?: Record<string, string | undefined>;
  /** Defaults to the real createCanvasServer (lazy import keeps cold boot honest). */
  createServer?: (options: CanvasServerOptions) => FunctionServer;
  lockFactory?: (options: { client: AppwriteClient; databaseId: string; collectionId: string; serviceId: string }) => { acquire(): Promise<void>; release(): Promise<void> };
  forward?: (app: FunctionServer['app'], req: DecodedRequest, opts: { timeoutMs: number; maxResponseBytes: number }) => Promise<UpstreamResponse>;
  makeWorkRoot?: () => string;
  removeWorkRoot?: (root: string) => void;
  bridgeTimeoutMs?: number;
  /** Streaming (SSE) routes cannot outlive an execution; requests asking for an
   * event stream fail explicitly instead of hanging to the function timeout. */
  streamingUnsupported?: boolean;
}

export interface ResolvedConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
  bucketId: string;
  runtime: { collectionId: string; namespace: string };
  authority?: MaAuthorityOptions;
  trustedAppOrigins?: string[];
  grantsJson?: string;
  imageApp?: { origin: string; applicationId: string };
  webOrigin?: string;
}

type Env = Record<string, string | undefined>;
const pick = (env: Env, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
};

/** Platform config: the per-execution Appwrite key only ever comes from the
 * platform-protected request header area or function env — never from the
 * business body or an ambient host cookie. Nothing is written to process.env. */
export function resolveConfig(env: Env, reqHeaders: Record<string, string>): ResolvedConfig {
  const endpoint = pick(env, 'APPWRITE_FUNCTION_API_ENDPOINT', 'APPWRITE_ENDPOINT');
  const projectId = pick(env, 'APPWRITE_FUNCTION_PROJECT_ID', 'APPWRITE_PROJECT_ID', 'APPWRITE_PROJECT');
  const apiKey = (reqHeaders['x-appwrite-key'] ?? '').trim() || pick(env, 'APPWRITE_FUNCTION_API_KEY', 'APPWRITE_API_KEY');
  const databaseId = pick(env, 'APPWRITE_DATABASE_ID', 'APPWRITE_DATABASE');
  const bucketId = pick(env, 'APPWRITE_BUCKET_ID', 'APPWRITE_BUCKET');
  const collectionId = pick(env, 'APPWRITE_RUNTIME_COLLECTION');
  const namespace = pick(env, 'CANVAS_RUNTIME_NAMESPACE');
  const missing = [
    ['APPWRITE_ENDPOINT|APPWRITE_FUNCTION_API_ENDPOINT', endpoint],
    ['APPWRITE_PROJECT_ID', projectId],
    ['APPWRITE_FUNCTION_API_KEY|x-appwrite-key', apiKey],
    ['APPWRITE_DATABASE_ID', databaseId],
    ['APPWRITE_BUCKET_ID', bucketId],
    ['APPWRITE_RUNTIME_COLLECTION', collectionId],
    ['CANVAS_RUNTIME_NAMESPACE', namespace],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length)
    throw new TransportError(503, 'CANVAS_FUNCTION_NOT_CONFIGURED', `Cloud runtime is not configured: ${missing.join(', ')}`, true);
  // MA authority is mandatory for every business route: without it the app
  // server would serve cloud data under a local/default tenant. Fail before
  // any domain or storage mutation; there is no development-actor fallback.
  const authority = maAuthorityFromEnvironment(env);
  if (!authority)
    throw new TransportError(503, 'MA_AUTHORITY_NOT_CONFIGURED',
      'Verified MA authority is required (MAV_API_ORIGIN or MAV_API_TRANSPORT=appwrite + MAV_APPWRITE_ENDPOINT/PROJECT_ID)', true);
  const imageOrigin = pick(env, 'CANVAS_IMAGE_APP_ORIGIN');
  const imageAppId = pick(env, 'CANVAS_IMAGE_APPLICATION_ID');
  if (Boolean(imageOrigin) !== Boolean(imageAppId))
    throw new TransportError(503, 'CANVAS_FUNCTION_NOT_CONFIGURED', 'Independent Image requires both CANVAS_IMAGE_APP_ORIGIN and CANVAS_IMAGE_APPLICATION_ID', true);
  const trustedOrigins = pick(env, 'CANVAS_TRUSTED_APP_ORIGINS')?.split(',').map(s => s.trim()).filter(Boolean);
  if (imageOrigin && !trustedOrigins?.includes(imageOrigin))
    throw new TransportError(503, 'CANVAS_FUNCTION_NOT_CONFIGURED', 'Independent Image origin must be listed in CANVAS_TRUSTED_APP_ORIGINS', true);
  let webOrigin: string | undefined;
  const webUrl = pick(env, 'CANVAS_WEB_URL');
  if (webUrl) {
    try { webOrigin = new URL(webUrl).origin; }
    catch { throw new TransportError(503, 'CANVAS_FUNCTION_NOT_CONFIGURED', 'CANVAS_WEB_URL is not a valid origin', true); }
  }
  return {
    endpoint: endpoint!, projectId: projectId!, apiKey: apiKey!, databaseId: databaseId!, bucketId: bucketId!,
    runtime: { collectionId: collectionId!, namespace: namespace! },
    ...(authority ? { authority } : {}),
    ...(trustedOrigins?.length ? { trustedAppOrigins: trustedOrigins } : {}),
    ...(env.APP_WRITE_GRANTS_JSON !== undefined ? { grantsJson: env.APP_WRITE_GRANTS_JSON } : {}),
    ...(imageOrigin && imageAppId ? { imageApp: { origin: imageOrigin, applicationId: imageAppId } } : {}),
    ...(webOrigin ? { webOrigin } : {}),
  };
}

const defaultCreateServer = async (options: CanvasServerOptions): Promise<FunctionServer> => {
  const mod = await import('../../../apps/server/src/server.js');
  const server = mod.createCanvasServer(options);
  return { app: (req, res) => server.app(req, res), ready: server.ready, close: () => server.close() };
};

const defaultWorkRoot = (): string => mkdtempSync(path.join(tmpdir(), 'canvas-fn-'));
const defaultRemoveWorkRoot = (root: string) => rmSync(root, { recursive: true, force: true });

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,60}$/;
/** Keep only a validated status+code from infra errors; everything else
 * collapses to a fixed description so storage details never reach callers. */
function sanitize(error: unknown, stage: string): TransportError {
  if (error instanceof TransportError) return error.at(error.stage ?? stage);
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 503;
  const code = SAFE_CODE.test(String((error as { code?: unknown })?.code ?? '')) ? String((error as { code: string }).code) : 'CANVAS_FUNCTION_ERROR';
  const bounded = status >= 400 && status <= 599 ? status : 503;
  return new TransportError(bounded, code, bounded >= 500 ? 'Function execution failed' : 'Request failed', bounded >= 500).at(stage);
}

/** Run one decoded request end-to-end. Throws TransportError;
 * the caller serializes them — this function never responds optimistically.
 *
 * Lock contract (Root §3): acquire before any state load, flush durable state
 * before the response, release only our own lock. When persistence outcome is
 * unknown — the request bridge, the durable flush, or the release could not
 * be confirmed — ephemeral resources are torn down but the owned lock is
 * RETAINED for explicit operator recovery, and the caller always sees 503.
 * Failed release after a confirmed close is never retried and never claimed. */
export async function runInvocation(request: DecodedRequest, deps: FunctionDeps = {}): Promise<UpstreamResponse> {
  const env = deps.env ?? process.env;
  if (deps.streamingUnsupported !== false && (request.headers['accept'] ?? '').includes('text/event-stream'))
    throw new TransportError(501, 'FUNCTION_STREAM_UNSUPPORTED',
      'Event streams cannot outlive one function execution; use the host channel for live subscriptions').at('validate');

  let config: ResolvedConfig;
  try { config = resolveConfig(env, request.headers); }
  catch (error) { throw sanitize(error, 'config'); }

  const clientConfig = { endpoint: config.endpoint, projectId: config.projectId, apiKey: config.apiKey };
  const client = new AppwriteClient(clientConfig);
  // Read-only preflight identical to the CLI's production gate: every business
  // collection plus the runtime collection and our own bucket must exist and
  // be private. Broad grants or missing metadata fail closed — never repair.
  try {
    await assertPrivateAppwriteStorage({
      client, databaseId: config.databaseId, bucketId: config.bucketId,
      collectionIds: ['canvases', 'canvas_files', 'canvas_operations', 'apps', 'card_packs', 'card_grants', config.runtime.collectionId],
    });
  } catch (error) { throw sanitize(error, 'preflight'); }
  const lock = (deps.lockFactory ?? ((o) => new AppwriteWriterLock(o)))({
    client, databaseId: config.databaseId,
    collectionId: config.runtime.collectionId, serviceId: 'canvas',
  });
  const createServer = deps.createServer ?? ((o: CanvasServerOptions) => defaultCreateServer(o));
  const forward = deps.forward ?? ((app, req, o) => bridgeRequest(app, req, o));
  const makeWorkRoot = deps.makeWorkRoot ?? defaultWorkRoot;
  const removeWorkRoot = deps.removeWorkRoot ?? defaultRemoveWorkRoot;

  try { await lock.acquire(); }
  catch (error) {
    // An ambiguous create may have landed: we cannot prove whether the stored
    // lock is ours or a competitor's. Leave the document untouched for
    // operator inspection — never reconcile, never DELETE on contention,
    // never take over stale ownership.
    throw sanitize(error, 'lock');
  }

  let workRoot: string | undefined;
  let server: FunctionServer | undefined;
  let closeAttempted = false;
  let response: UpstreamResponse;
  try {
    workRoot = makeWorkRoot();
    try {
      server = await createServer({
        dataRoot: workRoot,
        host: '127.0.0.1',
        appwrite: {
          endpoint: config.endpoint, projectId: config.projectId,
          databaseId: config.databaseId, bucketId: config.bucketId,
          apiKey: config.apiKey,
          runtime: { collectionId: config.runtime.collectionId, namespace: config.runtime.namespace, singleWriter: true },
        },
        ...(config.authority ? { authority: config.authority } : {}),
        authorizeAction: createAppWriteAuthorizer(config.grantsJson),
        ...(config.trustedAppOrigins ? { trustedAppOrigins: config.trustedAppOrigins } : {}),
        ...(config.imageApp ? { independentImage: config.imageApp } : {}),
        ...(config.webOrigin ? { allowedOrigins: [config.webOrigin] } : {}),
      });
      await server.ready;
    } catch (error) { throw sanitize(error, 'boot'); }
    try { response = await forward(server.app, request, { timeoutMs: deps.bridgeTimeoutMs ?? 25_000, maxResponseBytes: 48 * 1024 * 1024 }); }
    catch (error) { throw sanitize(error, 'forward'); }
    try { closeAttempted = true; await server.close(); }
    catch (error) { throw sanitize(error, 'flush'); }
  } catch (error) {
    // Persistence outcome is unknown: some business/app-state write may or
    // may not have landed. Tear down ephemeral resources (single best-effort
    // close, never retried) but RETAIN the owned lock — an operator must
    // inspect and clear it. The caller only ever sees 503, never success.
    if (server && !closeAttempted) {
      closeAttempted = true;
      await server.close().catch(() => {});
    }
    const failure = error instanceof TransportError ? error : sanitize(error, 'forward');
    const code = SAFE_CODE.test(failure.code) ? failure.code : 'FUNCTION_OUTCOME_UNCERTAIN';
    throw new TransportError(503, code,
      'Execution outcome is uncertain; cloud state was left for operator recovery', true).at(failure.stage ?? 'forward');
  } finally {
    if (workRoot) { try { removeWorkRoot(workRoot); } catch { /* disposable */ } }
  }

  try { await lock.release(); }
  catch {
    throw new TransportError(503, 'FUNCTION_RELEASE_UNCONFIRMED',
      'Writer lock release could not be confirmed; lock retained for operator recovery', true).at('release');
  }
  return response;
}
