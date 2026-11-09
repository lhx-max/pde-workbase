/** Canvas-side client for the independent Image App's public HTTP gateway
 * (designai-app-image independent backend, manifest version 0.9.0).
 *
 * The client is app-owned and calls only the published public routes:
 *   GET  /api/apps/image                                     manifest
 *   GET  /api/apps/image/workspaces                          workspace list
 *   POST /api/apps/image/actions/image.create                workspace create
 *   GET  /api/apps/image/instances/{iw…}/state               workspace state
 *   POST /api/apps/image/instances/{iw…}/assets              image.import
 *   GET  /api/apps/image/instances/{iw…}/assets/{ia…}        asset bytes
 *   GET  /api/apps/image/instances/{iw…}/jobs/{ij…}          job read
 *   POST /api/apps/image/instances/{iw…}/actions/{image.*}   workspace actions
 *
 * Identity is never caller-declared: forRequest snapshots the verified source
 * scope and MA headers, then resolves the target instance through the injected
 * trusted MA adapter under the same SSO. The resolved target must share the
 * verified user/team/biz, belong to the configured Image application and be
 * exactly the requested instance. Credentials stay request-local — they are
 * never stored, returned, logged or copied into errors, receipts or data. This
 * client never persists Image business data anywhere in Canvas. */
import { createHash } from 'node:crypto';

/** MA-published identifier rule for every scope and header identity value. */
const MA_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const MA_SSO = /^Bearer [A-Za-z0-9\-._~+/]+=*$/i;
const MA_SSO_MAX = 16384;
/** Own-domain identifier shapes published by the independent backend. */
const WORKSPACE_ID = /^iw[0-9a-f]{32}$/;
const ASSET_ID = /^ia[0-9a-f]{34}$/;
const JOB_ID = /^ij[0-9a-f]{32}$/;
const RECEIPT_ID = /^ir[0-9a-f]{32}$/;
const STABLE_KEY = /^[^\x00-\x1f\x7f]{1,128}$/u;
const JSON_LIMIT = 8 * 1024 * 1024;
const ASSET_LIMIT = 30 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_NAME_LENGTH = 500;
/** MIME types the current Image backend can emit on the asset route. */
const ASSET_MIMES: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/json',
]);
const CREATE_ACTION = 'image.create';
/** Instance-scoped actions published by the independent 0.9.0 manifest. */
const WORKSPACE_ACTIONS: ReadonlySet<string> = new Set([
  'image.import', 'image.configure', 'image.generate', 'image.regenerate',
  'image.tool', 'image.edit.save', 'image.cancel', 'image.archive',
]);
/** Full independent 0.9.0 action allowlist; create is app-level via create(). */
export const INDEPENDENT_IMAGE_ACTIONS: readonly string[] = [CREATE_ACTION, ...WORKSPACE_ACTIONS];
const SCOPE_FIELDS = ['teamId', 'userId', 'bizId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const;
/** Resource scope excludes the per-request user; identity rows never embed it. */
const RESOURCE_FIELDS = ['teamId', 'bizId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const;
const SSO_HEADER = 'x-mav-sso-authorization';
const TENANT_HEADER = 'x-mav-tenant';
const INSTANCE_HEADER = 'x-mav-application-instance-id';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Verified remote scope (MA source of truth); never carries credentials. */
export interface ImageRemoteScope {
  teamId: string;
  userId: string;
  bizId: string;
  applicationId: string;
  applicationInstanceId: string;
  providerInstanceId: string;
}

export interface IndependentImageClientOptions {
  /** Exact HTTPS origin; loopback HTTP is permitted only outside production. */
  origin: string;
  /** Configured MA applicationId of the independent Image app. */
  applicationId: string;
  /** Trusted MA adapter: verifies the same SSO/tenant against the target
   * application instance and returns the authoritative remote scope. */
  resolveTarget: (headers: Record<string, string>, targetApplicationInstanceId: string) => Promise<ImageRemoteScope>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface ImageRemoteMutation {
  receiptId: string;
  replayed: boolean;
  revision: number;
  result: unknown;
}

export interface ImageWorkspaceState {
  workspace: Record<string, unknown>;
  assets: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
}

export interface ImageAssetPayload {
  bytes: Uint8Array;
  mime: string;
  sha256?: string;
}

/** Sanitized typed error: an HTTP status when upstream responded, else 0.
 * Codes are always IMAGE_REMOTE_* and messages never carry credential material
 * or raw upstream bodies. */
export class ImageRemoteError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ImageRemoteError';
    this.status = status;
    this.code = code;
  }
}

/** Function declaration (not a const arrow) so calls terminate control flow
 * for the strict analyzer: every `fail` narrows the failing branch away. */
function fail(status: number, code: string, message: string): never {
  throw new ImageRemoteError(status, code, message);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isTransportAbort = (error: unknown): boolean => {
  const name = (error as { name?: unknown })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
};

/** Copy all six identity fields exactly once, before any await, so a mutating
 * or getter-backed caller object cannot swap identity mid-resolution. */
const snapshotScope = (value: unknown): ImageRemoteScope => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    teamId: raw.teamId as string, userId: raw.userId as string, bizId: raw.bizId as string,
    applicationId: raw.applicationId as string, applicationInstanceId: raw.applicationInstanceId as string,
    providerInstanceId: raw.providerInstanceId as string,
  };
};

const assertScope = (scope: ImageRemoteScope, code: string): ImageRemoteScope => {
  for (const field of SCOPE_FIELDS)
    if (typeof scope[field] !== 'string' || !MA_ID.test(scope[field])) fail(400, code, 'Image remote identity is incomplete or malformed');
  return scope;
};

const headerMap = (headers: Readonly<Record<string, string>>): Map<string, unknown> => {
  const map = new Map<string, unknown>();
  if (headers && typeof headers === 'object')
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, value);
    }
  return map;
};

const scopeMatches = (value: unknown, scope: ImageRemoteScope): boolean =>
  isPlainObject(value) && RESOURCE_FIELDS.every(field => value[field] === scope[field]);

function assertWorkspaceId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !WORKSPACE_ID.test(id))
    fail(400, 'IMAGE_REMOTE_INPUT_INVALID', 'Image workspace identifier is malformed');
}
function assertAssetId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ASSET_ID.test(id))
    fail(400, 'IMAGE_REMOTE_INPUT_INVALID', 'Image asset identifier is malformed');
}
function assertJobId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !JOB_ID.test(id))
    fail(400, 'IMAGE_REMOTE_INPUT_INVALID', 'Image job identifier is malformed');
}
function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !STABLE_KEY.test(key))
    fail(400, 'IMAGE_REMOTE_IDEMPOTENCY_KEY_INVALID', 'Idempotency key must be 1-128 characters of non-control text');
}
function assertRevision(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    fail(400, 'IMAGE_REMOTE_REVISION_INVALID', 'expectedRevision must be a positive safe integer');
}

const REMOTE_ERROR_BY_STATUS: Readonly<Record<number, string>> = {
  401: 'IMAGE_REMOTE_AUTH_REQUIRED',
  403: 'IMAGE_REMOTE_FORBIDDEN',
  404: 'IMAGE_REMOTE_NOT_FOUND',
  409: 'IMAGE_REMOTE_CONFLICT',
  413: 'IMAGE_REMOTE_TOO_LARGE',
  428: 'IMAGE_REMOTE_REVISION_REQUIRED',
  429: 'IMAGE_REMOTE_RATE_LIMITED',
  503: 'IMAGE_REMOTE_UNAVAILABLE',
};

interface GatewayTransport {
  origin: string;
  fetcher: typeof fetch;
  timeoutMs: number;
}

export class IndependentImageClient {
  private readonly transport: GatewayTransport;
  private readonly applicationId: string;
  private readonly resolveTarget: IndependentImageClientOptions['resolveTarget'];

  constructor(options: IndependentImageClientOptions) {
    if (!options || typeof options !== 'object')
      fail(0, 'IMAGE_REMOTE_CONFIG_INVALID', 'Image gateway client configuration is required');
    let parsed: URL;
    try { parsed = new URL(options.origin); }
    catch { fail(0, 'IMAGE_REMOTE_ORIGIN_INVALID', 'Image gateway origin must be an exact absolute URL origin'); }
    if (parsed!.origin !== options.origin || parsed!.username || parsed!.password)
      fail(0, 'IMAGE_REMOTE_ORIGIN_INVALID', 'Image gateway origin must not carry credentials, path, query or fragment');
    const loopbackHttp = parsed!.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed!.hostname);
    if (parsed!.protocol !== 'https:' && !(loopbackHttp && process.env.NODE_ENV !== 'production'))
      fail(0, 'IMAGE_REMOTE_ORIGIN_INVALID', 'Image gateway requires an exact HTTPS origin');
    if (!MA_ID.test(options.applicationId))
      fail(0, 'IMAGE_REMOTE_CONFIG_INVALID', 'Configured image application id is invalid');
    if (typeof options.resolveTarget !== 'function')
      fail(0, 'IMAGE_REMOTE_CONFIG_INVALID', 'A trusted target resolution adapter is required');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
      fail(0, 'IMAGE_REMOTE_CONFIG_INVALID', 'Image gateway timeout must be a bounded positive integer');
    this.transport = {
      origin: parsed!.origin,
      fetcher: options.fetcher ?? fetch,
      timeoutMs,
    };
    this.applicationId = options.applicationId;
    this.resolveTarget = options.resolveTarget;
  }

  /** Bind the verified source request to a target Image application instance.
   * All identity and credential strings are snapshotted before the first
   * await; only the SSO, tenant and target-instance headers reach the trusted
   * resolution adapter — caller-supplied actor fields are never consulted. */
  async forRequest(
    source: Readonly<ImageRemoteScope>,
    sourceHeaders: Readonly<Record<string, string>>,
    targetApplicationInstanceId: string,
  ): Promise<BoundIndependentImageClient> {
    const src = assertScope(snapshotScope(source), 'IMAGE_REMOTE_IDENTITY_INVALID');
    const headers = headerMap(sourceHeaders);
    const credential = headers.get(SSO_HEADER);
    const tenant = headers.get(TENANT_HEADER);
    const instance = headers.get(INSTANCE_HEADER);
    const target = typeof targetApplicationInstanceId === 'string' ? `${targetApplicationInstanceId}` : '';
    if (typeof credential !== 'string' || credential.length > MA_SSO_MAX || !MA_SSO.test(credential))
      fail(401, 'IMAGE_REMOTE_AUTH_REQUIRED', 'A valid MA SSO credential is required');
    if (typeof tenant !== 'string' || !MA_ID.test(tenant) || tenant !== src.teamId)
      fail(401, 'IMAGE_REMOTE_AUTH_REQUIRED', 'MA tenant header does not match the verified caller');
    if (typeof instance !== 'string' || !MA_ID.test(instance) || instance !== src.applicationInstanceId)
      fail(401, 'IMAGE_REMOTE_AUTH_REQUIRED', 'MA application-instance header does not match the verified caller');
    if (!MA_ID.test(target))
      fail(400, 'IMAGE_REMOTE_IDENTITY_INVALID', 'Target image instance identifier is invalid');

    let resolvedValue: ImageRemoteScope | undefined;
    try {
      const work = this.resolveTarget(
        { [SSO_HEADER]: credential, [TENANT_HEADER]: tenant, [INSTANCE_HEADER]: target },
        target,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ImageRemoteError(0, 'IMAGE_REMOTE_TIMEOUT', 'Image target resolution timed out')), this.transport.timeoutMs);
      });
      void work.then(() => clearTimeout(timer), () => clearTimeout(timer));
      resolvedValue = await Promise.race([work, deadline]);
    } catch (error) {
      if (error instanceof ImageRemoteError) throw error;
      const status = (error as { status?: unknown })?.status;
      fail(status === 401 ? 401 : status === 403 ? 403 : 0, 'IMAGE_REMOTE_RESOLUTION_FAILED', 'Target image instance could not be resolved');
    }
    if (!resolvedValue || typeof resolvedValue !== 'object')
      fail(0, 'IMAGE_REMOTE_RESOLUTION_INVALID', 'Image target resolution returned no scope');
    const dst = assertScope(snapshotScope(resolvedValue), 'IMAGE_REMOTE_RESOLUTION_INVALID');
    if (dst.userId !== src.userId || dst.teamId !== src.teamId || dst.bizId !== src.bizId)
      fail(403, 'IMAGE_REMOTE_TARGET_MISMATCH', 'Resolved image scope does not share the verified caller tenancy');
    if (dst.applicationId !== this.applicationId)
      fail(403, 'IMAGE_REMOTE_APPLICATION_MISMATCH', 'Resolved instance does not belong to the configured image application');
    if (dst.applicationInstanceId !== target)
      fail(403, 'IMAGE_REMOTE_TARGET_MISMATCH', 'Resolved identity does not match the requested image instance');
    return BoundIndependentImageClient.bind(this.transport, dst, credential, tenant);
  }
}

/** Request-bound client: identity and credential are captured per binding and
 * are never shared across concurrent bindings. */
export class BoundIndependentImageClient {
  private constructor(
    private readonly transport: GatewayTransport,
    private readonly target: ImageRemoteScope,
    private readonly credential: string,
    private readonly tenant: string,
  ) {}

  static bind(transport: GatewayTransport, target: ImageRemoteScope, credential: string, tenant: string): BoundIndependentImageClient {
    return new BoundIndependentImageClient(transport, { ...target }, credential, tenant);
  }

  /** Clone of the verified target scope; credentials are never exposed. */
  scope(): ImageRemoteScope {
    return { ...this.target };
  }
  /** Request-bound runtime readiness, separate from static action metadata. */
  async capabilities():Promise<Record<string,unknown>>{
    const data=await this.json('GET','/api/apps/image/capabilities');
    if(!Array.isArray(data.tools)||data.tools.some(value=>!isPlainObject(value)||typeof value.id!=='string'||typeof value.configured!=='boolean'))fail(503,'IMAGE_REMOTE_RESPONSE_INVALID','Image tool capabilities are malformed');
    return data;
  }

  async manifest(): Promise<Record<string, unknown>> {
    const data = await this.json('GET', '/api/apps/image');
    if (data.appId !== 'image' || data.protocolVersion !== 1)
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Remote manifest is not the independent image contract');
    return data;
  }

  async listWorkspaces(): Promise<Record<string, unknown>[]> {
    const data = await this.json('GET', '/api/apps/image/workspaces');
    const items = data.items;
    if (!Array.isArray(items) || items.some(item =>
      !isPlainObject(item) || typeof item.id !== 'string' || !WORKSPACE_ID.test(item.id) || !scopeMatches(item.scope, this.target)))
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image workspace list is outside the bound scope');
    return items as Record<string, unknown>[];
  }

  async state(workspaceId: string): Promise<ImageWorkspaceState> {
    assertWorkspaceId(workspaceId);
    const data = await this.json('GET', `/api/apps/image/instances/${encodeURIComponent(workspaceId)}/state`);
    const workspace = data.workspace;
    if (!isPlainObject(workspace) || workspace.id !== workspaceId || !scopeMatches(workspace.scope, this.target))
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image workspace state is outside the bound scope');
    const assets = data.assets, jobs = data.jobs;
    if (!Array.isArray(assets) || !Array.isArray(jobs))
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image workspace state is malformed');
    for (const asset of assets)
      if (!isPlainObject(asset) || typeof asset.id !== 'string' || !ASSET_ID.test(asset.id) || asset.workspaceId !== workspaceId)
        fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image workspace asset entry is malformed');
    for (const job of jobs)
      if (!isPlainObject(job) || typeof job.id !== 'string' || !JOB_ID.test(job.id) || job.workspaceId !== workspaceId || !scopeMatches(job.scope, this.target))
        fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image workspace job entry is outside the bound scope');
    return { workspace, assets: assets as Record<string, unknown>[], jobs: jobs as Record<string, unknown>[] };
  }

  async job(workspaceId: string, jobId: string): Promise<Record<string, unknown>> {
    assertWorkspaceId(workspaceId);
    assertJobId(jobId);
    const data = await this.json('GET', `/api/apps/image/instances/${encodeURIComponent(workspaceId)}/jobs/${encodeURIComponent(jobId)}`);
    if (data.id !== jobId || data.workspaceId !== workspaceId || !scopeMatches(data.scope, this.target))
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image job is outside the bound scope');
    return data;
  }

  /** Asset bytes are served only through the authenticated asset route; the
   * client never follows public bucket URLs. Content type is restricted to the
   * backend's media set and the sha256 ETag must match the actual bytes. */
  async asset(workspaceId: string, assetId: string): Promise<ImageAssetPayload> {
    assertWorkspaceId(workspaceId);
    assertAssetId(assetId);
    const response = await this.request('GET', `/api/apps/image/instances/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}`, { jsonAccept: false });
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ASSET_MIMES.has(mime))
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image asset content type is not an allowed media type');
    const etag = /^"([0-9a-f]{64})"$/.exec(response.headers.get('etag') ?? '');
    if (!etag)
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image asset integrity tag is missing');
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d{1,10}$/.test(declared.trim()) || Number(declared) > ASSET_LIMIT))
      fail(413, 'IMAGE_REMOTE_TOO_LARGE', 'Image asset exceeds the byte limit');
    const bytes = await this.readBody(response, ASSET_LIMIT);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== etag[1])
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image asset bytes fail the integrity check');
    return { bytes, mime, sha256 };
  }

  async create(input: { name: string }, idempotencyKey: string): Promise<ImageRemoteMutation> {
    if (!isPlainObject(input) || Object.keys(input).some(field => field !== 'name')
      || typeof input.name !== 'string' || !input.name.trim() || input.name.length > MAX_NAME_LENGTH)
      fail(400, 'IMAGE_REMOTE_INPUT_INVALID', 'Image workspace create input must be exactly {name}');
    assertKey(idempotencyKey);
    const data = await this.json('POST', '/api/apps/image/actions/image.create', {
      body: { input: { name: input.name } },
      key: idempotencyKey,
    });
    return this.mutation(data);
  }

  /** image.import posts to the workspace assets route; every other action goes
   * to /actions/image.*. Bodies carry exactly {input, expectedRevision}. */
  async action(
    workspaceId: string,
    actionId: string,
    input: Record<string, unknown>,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<ImageRemoteMutation> {
    assertWorkspaceId(workspaceId);
    assertRevision(expectedRevision);
    assertKey(idempotencyKey);
    if (actionId === CREATE_ACTION)
      fail(400, 'IMAGE_REMOTE_ACTION_INVALID', 'image.create is app-level; use create()');
    if (typeof actionId !== 'string' || !WORKSPACE_ACTIONS.has(actionId))
      fail(400, 'IMAGE_REMOTE_ACTION_INVALID', 'Image action is not in the independent 0.9.0 allowlist');
    if (!isPlainObject(input))
      fail(400, 'IMAGE_REMOTE_INPUT_INVALID', 'Image action input must be an object');
    const route = actionId === 'image.import'
      ? `/api/apps/image/instances/${encodeURIComponent(workspaceId)}/assets`
      : `/api/apps/image/instances/${encodeURIComponent(workspaceId)}/actions/${actionId}`;
    const data = await this.json('POST', route, { body: { input, expectedRevision }, key: idempotencyKey });
    return this.mutation(data);
  }

  private mutation(data: Record<string, unknown>): ImageRemoteMutation {
    if (typeof data.receiptId !== 'string' || !RECEIPT_ID.test(data.receiptId)
      || typeof data.replayed !== 'boolean'
      || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1
      || data.result === undefined)
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image mutation receipt is malformed');
    return { receiptId: data.receiptId as string, replayed: data.replayed as boolean, revision: data.revision as number, result: data.result };
  }

  private headers(extra: Record<string, string>): Record<string, string> {
    return {
      [SSO_HEADER]: this.credential,
      [TENANT_HEADER]: this.tenant,
      [INSTANCE_HEADER]: this.target.applicationInstanceId,
      ...extra,
    };
  }

  /** Single-shot request: no retries, no redirects, no forwarded cookies,
   * auth, hop-by-hop or browser origin headers — only the MA identity
   * headers plus the route's own contract headers. */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; key?: string; jsonAccept?: boolean },
  ): Promise<Response> {
    const extra: Record<string, string> = {};
    if (options.jsonAccept !== false) extra.accept = 'application/json';
    if (options.body !== undefined) extra['content-type'] = 'application/json';
    if (options.key !== undefined) extra['idempotency-key'] = options.key;
    let response: Response;
    try {
      response = await this.transport.fetcher(this.transport.origin + path, {
        method,
        headers: this.headers(extra),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(this.transport.timeoutMs),
      });
    } catch (error) {
      if (isTransportAbort(error)) fail(0, 'IMAGE_REMOTE_TIMEOUT', 'Image backend request timed out');
      fail(0, 'IMAGE_REMOTE_UNAVAILABLE', 'Image backend is unavailable');
    }
    const status = response!.status;
    if (status >= 300 && status < 400)
      fail(status, 'IMAGE_REMOTE_REDIRECT', 'Image backend attempted a redirect');
    if (!response!.ok)
      fail(status, REMOTE_ERROR_BY_STATUS[status] ?? 'IMAGE_REMOTE_REQUEST_FAILED', 'Image backend rejected the request');
    return response!;
  }

  private async json(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; key?: string } = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request(method, path, { ...options, jsonAccept: true });
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d{1,10}$/.test(declared.trim()) || Number(declared) > JSON_LIMIT))
      fail(413, 'IMAGE_REMOTE_TOO_LARGE', 'Image response exceeds the JSON byte limit');
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json')
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image backend returned a non-JSON payload');
    const bytes = await this.readBody(response, JSON_LIMIT);
    let envelope: unknown;
    try { envelope = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image backend returned invalid JSON'); }
    if (!isPlainObject(envelope) || !isPlainObject(envelope.data))
      fail(0, 'IMAGE_REMOTE_RESPONSE_INVALID', 'Image response does not carry the expected data object');
    return envelope.data;
  }

  /** Bounded streaming read; the declared length guard ran before this and the
   * running total still caps whatever actually arrives. */
  private async readBody(response: Response, limit: number): Promise<Uint8Array> {
    try {
      const body = response.body;
      if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limit) {
              await reader.cancel().catch(() => undefined);
              fail(413, 'IMAGE_REMOTE_TOO_LARGE', 'Image response exceeds the byte limit');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > limit)
        fail(413, 'IMAGE_REMOTE_TOO_LARGE', 'Image response exceeds the byte limit');
      return new Uint8Array(buffer);
    } catch (error) {
      if (error instanceof ImageRemoteError) throw error;
      if (isTransportAbort(error)) fail(0, 'IMAGE_REMOTE_TIMEOUT', 'Image backend request timed out');
      fail(0, 'IMAGE_REMOTE_UNAVAILABLE', 'Image backend response could not be read');
    }
  }
}

