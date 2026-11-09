import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import {
  BoundIndependentImageClient, ImageRemoteError, IndependentImageClient, type ImageRemoteScope,
} from '../src/media/independent-image-client.js';

/* Fixture mirrors the independent Image backend's published 0.9.0 routes:
 * {requestId,data} envelopes, instance routes under /api/apps/image/instances,
 * raw asset bytes with a sha256 ETag, and no local fallback. */

const WID = `iw${'a'.repeat(32)}`;
const AID = `ia${'b'.repeat(34)}`;
const JID = `ij${'c'.repeat(32)}`;
const RID = `ir${'d'.repeat(32)}`;
const STAMP = '2026-10-23T00:00:00.000Z';

const SOURCE: ImageRemoteScope = {
  teamId: 'team-1', userId: 'user-1', bizId: 'biz-1',
  applicationId: 'canvas-app', applicationInstanceId: 'canvas-inst-1', providerInstanceId: 'canvas-prov-1',
};
const TARGET_ID = 'image-inst-1';
const TARGET: ImageRemoteScope = {
  teamId: 'team-1', userId: 'user-1', bizId: 'biz-1',
  applicationId: 'image-app', applicationInstanceId: TARGET_ID, providerInstanceId: 'image-prov-1',
};
const SSO = 'Bearer sso-token-abc';
const SOURCE_HEADERS: Record<string, string> = {
  'x-mav-sso-authorization': SSO,
  'x-mav-tenant': 'team-1',
  'x-mav-application-instance-id': 'canvas-inst-1',
  // Noise that must never be forwarded upstream.
  cookie: 'session=should-not-leak',
  authorization: 'Bearer foreign-credential',
  'x-forwarded-for': '203.0.113.9',
  origin: 'https://attacker.example',
};

const resourceScope = (scope: ImageRemoteScope) => ({
  teamId: scope.teamId, bizId: scope.bizId, applicationId: scope.applicationId,
  applicationInstanceId: scope.applicationInstanceId, providerInstanceId: scope.providerInstanceId,
});
const WORKSPACE = {
  schemaVersion: 'image-workspace/v1', id: WID, scope: resourceScope(TARGET), name: 'demo',
  revision: 3, sources: [{ assetId: AID, config: {}, editRevision: 0 }], jobIds: [JID],
  createdAt: STAMP, updatedAt: STAMP,
};
const JOB = {
  schemaVersion: 'image-job/v1', id: JID, workspaceId: WID, scope: resourceScope(TARGET),
  createdBy: 'user-1', operationId: RID, status: 'done', input: { kind: 'generate' },
  outputAssetIds: [AID], createdAt: STAMP, updatedAt: STAMP,
};
const MANIFEST = {
  appId: 'image', name: '图片', version: '0.9.0', protocolVersion: 1, tenancy: 'required',
  instanceScope: 'image-owned-workspace', actions: [], endpoints: {},
};
const mutation = (revision: number, result: unknown) => ({ receiptId: RID, replayed: false, revision, result });

interface RecordedRequest { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }
type Handler = (rec: RecordedRequest, res: ServerResponse) => void | Promise<void>;

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function fixture(handler: Handler) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    res.on('error', () => undefined);
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const rec: RecordedRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) };
      requests.push(rec);
      void Promise.resolve(handler(rec, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { requests, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const sendData = (res: ServerResponse, status: number, data: unknown) => {
  const body = JSON.stringify({ requestId: 'req_fixture', data });
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
};
const sendError = (res: ServerResponse, status: number, secretBody = '') => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ requestId: 'req_fixture', error: { code: 'IMAGE_UPSTREAM', message: `upstream detail ${secretBody}`, retryable: false } }));
};

interface ContractOptions { workspace?: Record<string, unknown>; job?: Record<string, unknown>; assetMime?: string; assetEtag?: string | null; assetBytes?: Buffer }
function contract(png: Buffer, sha: string, options: ContractOptions = {}): Handler {
  const workspace = options.workspace ?? WORKSPACE;
  const job = options.job ?? JOB;
  const assetMeta = {
    id: AID, workspaceId: WID, path: 'original/a.png', role: 'original',
    mime: 'image/png', byteLength: png.byteLength, sha256: sha, createdAt: STAMP,
  };
  return (rec, res) => {
    const url = new URL(rec.url, 'http://image.test');
    if (rec.method === 'GET' && url.pathname === '/api/apps/image') return void sendData(res, 200, MANIFEST);
    if (rec.method === 'GET' && url.pathname === '/api/apps/image/workspaces') return void sendData(res, 200, { items: [workspace] });
    if (rec.method === 'POST' && url.pathname === '/api/apps/image/actions/image.create') return void sendData(res, 201, mutation(1, workspace));
    const m = /^\/api\/apps\/image\/instances\/([^/]+)\/(state|assets(?:\/([^/]+))?|jobs\/([^/]+)|actions\/(image\.[a-z.]+))$/.exec(url.pathname);
    if (!m || m[1] !== WID) return void sendError(res, 404);
    if (rec.method === 'GET' && m[2] === 'state') return void sendData(res, 200, { workspace, assets: [assetMeta], jobs: [job] });
    if (rec.method === 'GET' && m[3]) {
      res.writeHead(200, {
        'content-type': options.assetMime ?? 'image/png',
        'content-length': (options.assetBytes ?? png).byteLength,
        ...(options.assetEtag === null ? {} : { etag: `"${options.assetEtag ?? sha}"` }),
      });
      res.end(options.assetBytes ?? png);
      return;
    }
    if (rec.method === 'GET' && m[4]) return void sendData(res, 200, job);
    if (rec.method === 'POST' && m[2] === 'assets') return void sendData(res, 200, mutation(4, assetMeta));
    if (rec.method === 'POST' && m[5]) return void sendData(res, m[5] === 'image.generate' || m[5] === 'image.tool' ? 202 : 200, mutation(4, { accepted: true }));
    sendError(res, 405);
  };
}

type ResolveTarget = (headers: Record<string, string>, targetApplicationInstanceId: string) => Promise<ImageRemoteScope>;
const resolver = (overrides?: Partial<ImageRemoteScope>, capture?: { headers?: Record<string, string>; target?: string }): ResolveTarget =>
  async (headers, targetApplicationInstanceId) => {
    if (capture) { capture.headers = { ...headers }; capture.target = targetApplicationInstanceId; }
    return { ...TARGET, applicationInstanceId: targetApplicationInstanceId, ...overrides };
  };

function client(origin: string, options: { resolve?: ResolveTarget; fetcher?: typeof fetch; timeoutMs?: number; applicationId?: string } = {}) {
  return new IndependentImageClient({
    origin,
    applicationId: options.applicationId ?? 'image-app',
    resolveTarget: options.resolve ?? resolver(),
    ...(options.fetcher !== undefined ? { fetcher: options.fetcher } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}
const bind = (origin: string, options: Parameters<typeof client>[1] & {
  source?: ImageRemoteScope; headers?: Record<string, string>; target?: string;
} = {}) =>
  client(origin, options).forRequest(options.source ?? SOURCE, options.headers ?? SOURCE_HEADERS, options.target ?? TARGET_ID);

const failingFetcher = (calls: unknown[]): typeof fetch =>
  ((...args: unknown[]) => { calls.push(args); return Promise.reject(new Error('fetch must not run')); }) as typeof fetch;

const throwsCode = (fn: () => unknown, code: string) => {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ImageRemoteError);
  expect(caught).toMatchObject({ code });
};

describe('binding and identity', () => {
  it('resolves the target instance under the same SSO and sends only MA headers upstream', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const { requests, origin } = await fixture(contract(png, sha));
    const capture: { headers?: Record<string, string>; target?: string } = {};
    const bound = await bind(origin, { resolve: resolver(undefined, capture) });
    expect(capture.target).toBe(TARGET_ID);
    // Same SSO + tenant as the verified canvas caller, but the TARGET instance.
    expect(capture.headers).toEqual({
      'x-mav-sso-authorization': SSO,
      'x-mav-tenant': 'team-1',
      'x-mav-application-instance-id': TARGET_ID,
    });
    expect(bound).toBeInstanceOf(BoundIndependentImageClient);
    const manifest = await bound.manifest();
    expect(manifest.appId).toBe('image');
    const upstream = requests.at(-1)!;
    expect(upstream.headers['x-mav-sso-authorization']).toBe(SSO);
    expect(upstream.headers['x-mav-tenant']).toBe('team-1');
    expect(upstream.headers['x-mav-application-instance-id']).toBe(TARGET_ID);
    // No cookie, foreign auth, hop-by-hop or client origin is forwarded.
    expect(upstream.headers.cookie).toBeUndefined();
    expect(upstream.headers.authorization).toBeUndefined();
    expect(upstream.headers['x-forwarded-for']).toBeUndefined();
    expect(upstream.headers.origin).toBeUndefined();
  });

  it('rejects missing, malformed or mismatched identity material before resolving', async () => {
    const { origin } = await fixture(() => undefined);
    const calls: unknown[] = [];
    let resolved = 0;
    const resolve: ResolveTarget = async () => { resolved += 1; return TARGET; };
    const attempt = (headers: Record<string, string>, code: string, status: number) =>
      expect(client(origin, { resolve, fetcher: failingFetcher(calls) })
        .forRequest(SOURCE, headers, TARGET_ID)).rejects.toMatchObject({ code, status });
    await attempt({ ...SOURCE_HEADERS, 'x-mav-sso-authorization': '' }, 'IMAGE_REMOTE_AUTH_REQUIRED', 401);
    await attempt({ ...SOURCE_HEADERS, 'x-mav-sso-authorization': 'Basic abc' }, 'IMAGE_REMOTE_AUTH_REQUIRED', 401);
    await attempt({ ...SOURCE_HEADERS, 'x-mav-sso-authorization': 'Bearer ' }, 'IMAGE_REMOTE_AUTH_REQUIRED', 401);
    await attempt({ ...SOURCE_HEADERS, 'x-mav-tenant': 'team-2' }, 'IMAGE_REMOTE_AUTH_REQUIRED', 401);
    await attempt({ ...SOURCE_HEADERS, 'x-mav-application-instance-id': 'canvas-inst-2' }, 'IMAGE_REMOTE_AUTH_REQUIRED', 401);
    await attempt({ ...SOURCE_HEADERS, 'x-mav-application-instance-id': ['canvas-inst-1'] } as unknown as Record<string, string>, 'IMAGE_REMOTE_AUTH_REQUIRED', 401);
    await expect(client(origin, { resolve })
      .forRequest({ ...SOURCE, userId: 'not a valid id!' }, SOURCE_HEADERS, TARGET_ID))
      .rejects.toMatchObject({ code: 'IMAGE_REMOTE_IDENTITY_INVALID', status: 400 });
    await expect(client(origin, { resolve })
      .forRequest(SOURCE, SOURCE_HEADERS, 'bad id!!'))
      .rejects.toMatchObject({ code: 'IMAGE_REMOTE_IDENTITY_INVALID', status: 400 });
    expect(resolved).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('forbids forged resolution, foreign tenancy and wrong application before any image route', async () => {
    const { requests, origin } = await fixture(contract(Buffer.from('x'), '0'.repeat(64)));
    const calls: unknown[] = [];
    const cases: Array<[Partial<ImageRemoteScope>, string]> = [
      [{ userId: 'user-2' }, 'IMAGE_REMOTE_TARGET_MISMATCH'],
      [{ teamId: 'team-2' }, 'IMAGE_REMOTE_TARGET_MISMATCH'],
      [{ bizId: 'biz-foreign' }, 'IMAGE_REMOTE_TARGET_MISMATCH'],
      [{ applicationId: 'other-app' }, 'IMAGE_REMOTE_APPLICATION_MISMATCH'],
      [{ providerInstanceId: 'bad provider!' }, 'IMAGE_REMOTE_RESOLUTION_INVALID'],
    ];
    for (const [overrides, code] of cases)
      await expect(client(origin, { resolve: resolver(overrides), fetcher: failingFetcher(calls) })
        .forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID)).rejects.toMatchObject({ code });
    // A resolve result that names a different instance than requested.
    await expect(client(origin, {
      resolve: async () => ({ ...TARGET, applicationInstanceId: 'image-inst-9' }),
      fetcher: failingFetcher(calls),
    }).forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_TARGET_MISMATCH' });
    expect(calls).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('maps a failing trusted adapter to a sanitized resolution error', async () => {
    const { origin } = await fixture(() => undefined);
    await expect(client(origin, {
      resolve: async () => { throw Object.assign(new Error('sso Bearer sso-token-abc rejected'), { status: 403 }); },
    }).forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID)).rejects.toMatchObject({
      code: 'IMAGE_REMOTE_RESOLUTION_FAILED', status: 403,
    });
    const error = await client(origin, {
      resolve: async () => { throw new Error('network detail Bearer sso-token-abc'); },
    }).forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ImageRemoteError);
    expect(error).toMatchObject({ code: 'IMAGE_REMOTE_RESOLUTION_FAILED', status: 0 });
    expect(String(error)).not.toContain('sso-token-abc');
  });

  it('snapshots identity strings before the first await', async () => {
    const { requests, origin } = await fixture(contract(Buffer.from('x'), '0'.repeat(64)));
    let userReads = 0;
    const source = {
      ...SOURCE,
      get userId() { return userReads++ === 0 ? 'user-1' : 'user-forged'; },
    } as ImageRemoteScope;
    let ssoReads = 0;
    const headers = new Proxy({ ...SOURCE_HEADERS }, {
      get: (target, prop: string) => prop === 'x-mav-sso-authorization' && ssoReads++ > 0
        ? 'Bearer forged-token'
        : target[prop],
    });
    const capture: { headers?: Record<string, string> } = {};
    const bound = await client(origin, { resolve: resolver(undefined, capture) })
      .forRequest(source, headers, TARGET_ID);
    expect(capture.headers?.['x-mav-sso-authorization']).toBe(SSO);
    await bound.manifest();
    expect(requests.at(-1)!.headers['x-mav-sso-authorization']).toBe(SSO);
  });

  it('returns a credential-free cloned scope', async () => {
    const { requests, origin } = await fixture(contract(Buffer.from('x'), '0'.repeat(64)));
    const bound = await bind(origin);
    const scope = bound.scope();
    expect(scope).toEqual(TARGET);
    (scope as { applicationInstanceId: string }).applicationInstanceId = 'tampered';
    await bound.manifest();
    expect(requests.at(-1)!.headers['x-mav-application-instance-id']).toBe(TARGET_ID);
    expect(Object.keys(bound.scope())).toEqual(['teamId', 'userId', 'bizId', 'applicationId', 'applicationInstanceId', 'providerInstanceId']);
    expect(JSON.stringify(bound.scope())).not.toContain('sso-token-abc');
  });

  it('accepts a different source canvas applicationId and validates constructor inputs', async () => {
    const { origin } = await fixture(() => undefined);
    // The verified source caller belongs to the canvas app, not the image app.
    expect(SOURCE.applicationId).not.toBe('image-app');
    await expect(bind(origin)).resolves.toBeInstanceOf(BoundIndependentImageClient);
    for (const origin0 of ['https://example.com/path', 'https://example.com/?q=1', 'https://user:pw@example.com', 'http://example.com', 'not a url'])
      throwsCode(() => client(origin0), 'IMAGE_REMOTE_ORIGIN_INVALID');
    throwsCode(() => client(origin, { applicationId: 'bad app!' }), 'IMAGE_REMOTE_CONFIG_INVALID');
    throwsCode(() => new IndependentImageClient({ origin, applicationId: 'image-app', resolveTarget: undefined as never }), 'IMAGE_REMOTE_CONFIG_INVALID');
    throwsCode(() => client(origin, { timeoutMs: 0 }), 'IMAGE_REMOTE_CONFIG_INVALID');
  });
});

describe('requests', () => {
  it('forwards the stable body, key and revision exactly once per action route', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const { requests, origin } = await fixture(contract(png, sha));
    const bound = await bind(origin);
    const receipt = await bound.action(WID, 'image.configure', { assetId: AID, set: { prompt: 'cat' } }, 3, 'stable-key-1');
    expect(receipt).toMatchObject({ receiptId: RID, replayed: false, revision: 4 });
    const configure = requests.find(r => r.url.includes('/actions/image.configure'))!;
    expect(configure.method).toBe('POST');
    expect(configure.url).toBe(`/api/apps/image/instances/${WID}/actions/image.configure`);
    expect(JSON.parse(configure.body.toString('utf8'))).toEqual({ input: { assetId: AID, set: { prompt: 'cat' } }, expectedRevision: 3 });
    expect(configure.headers['idempotency-key']).toBe('stable-key-1');
    expect(configure.headers['content-type']).toBe('application/json');
    // image.import rides the assets route, not /actions/.
    await bound.action(WID, 'image.import', { path: 'a.png', role: 'original', mime: 'image/png', contentBase64: 'eA==' }, 4, 'stable-key-2');
    const imported = requests.find(r => r.url.endsWith('/assets'))!;
    expect(imported.url).toBe(`/api/apps/image/instances/${WID}/assets`);
    expect(JSON.parse(imported.body.toString('utf8'))).toMatchObject({ expectedRevision: 4 });
    await bound.create({ name: 'new ws' }, 'create-key-1');
    const created = requests.find(r => r.url === '/api/apps/image/actions/image.create')!;
    expect(JSON.parse(created.body.toString('utf8'))).toEqual({ input: { name: 'new ws' } });
    expect(created.headers['idempotency-key']).toBe('create-key-1');
  });

  it('rejects off-allowlist actions, bad revisions, keys and ids without HTTP', async () => {
    const { requests, origin } = await fixture(contract(Buffer.from('x'), '0'.repeat(64)));
    const bound = await bind(origin);
    const before = requests.length;
    await expect(bound.action(WID, 'image.evil', {}, 1, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_ACTION_INVALID' });
    await expect(bound.action(WID, 'image.create', {}, 1, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_ACTION_INVALID' });
    await expect(bound.action(WID, 'other.app', {}, 1, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_ACTION_INVALID' });
    await expect(bound.action(WID, 'image.configure', {}, 0, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_REVISION_INVALID' });
    await expect(bound.action(WID, 'image.configure', {}, -2, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_REVISION_INVALID' });
    await expect(bound.action(WID, 'image.configure', {}, 1.5, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_REVISION_INVALID' });
    await expect(bound.action(WID, 'image.configure', {}, 1, '')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_IDEMPOTENCY_KEY_INVALID' });
    await expect(bound.action(WID, 'image.configure', {}, 1, `k${'x'.repeat(128)}`)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_IDEMPOTENCY_KEY_INVALID' });
    await expect(bound.action(WID, 'image.configure', {}, 1, 'a\nb')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_IDEMPOTENCY_KEY_INVALID' });
    await expect(bound.action('iw123', 'image.configure', {}, 1, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    await expect(bound.action('../escape', 'image.configure', {}, 1, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    await expect(bound.asset(WID, 'ia123')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    await expect(bound.job(WID, 'ijxyz')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    await expect(bound.state('iw' + 'a'.repeat(31))).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    await expect(bound.create({ name: '' }, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    await expect(bound.create({ name: 'ok', extra: 1 } as never, 'k')).rejects.toMatchObject({ code: 'IMAGE_REMOTE_INPUT_INVALID' });
    expect(requests).toHaveLength(before);
  });

  it('returns real PNG bytes with a validated sha256 ETag and allowed mime', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const { origin } = await fixture(contract(png, sha));
    const bound = await bind(origin);
    const asset = await bound.asset(WID, AID);
    expect(asset.mime).toBe('image/png');
    expect(asset.sha256).toBe(sha);
    expect(Buffer.from(asset.bytes).equals(png)).toBe(true);
    expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it('rejects bad integrity tags, disallowed types and oversized declared assets', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    for (const options of [
      { assetEtag: '0'.repeat(64) },
      { assetEtag: null },
      { assetMime: 'text/html' },
      { assetMime: 'application/octet-stream' },
    ] satisfies ContractOptions[]) {
      const { origin } = await fixture(contract(png, sha, options));
      const bound = await bind(origin);
      await expect(bound.asset(WID, AID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_RESPONSE_INVALID' });
    }
  });

  it('enforces the declared-length guard and the streaming byte bound', async () => {
    const { origin } = await fixture((rec, res) => {
      const url = new URL(rec.url, 'http://image.test');
      if (url.pathname.endsWith('/state')) {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': 9 * 1024 * 1024 });
        res.end('{}');
        return;
      }
      // Chunked asset without a content-length; streams past the 30MiB bound.
      res.writeHead(200, { 'content-type': 'image/png', etag: `"${'0'.repeat(64)}"` });
      const chunk = Buffer.alloc(1024 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 31 && res.write(chunk)) sent += 1;
        sent += 1;
        if (sent <= 31) res.once('drain', pump); else res.end();
      };
      pump();
    });
    const bound = await bind(origin);
    await expect(bound.state(WID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_TOO_LARGE', status: 413 });
    await expect(bound.asset(WID, AID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_TOO_LARGE', status: 413 });
  });

  it('maps every non-2xx to a sanitized typed error without upstream body leaks', async () => {
    const secret = 'Bearer topsecret-upstream-value';
    const cases: Array<[number, string]> = [
      [401, 'IMAGE_REMOTE_AUTH_REQUIRED'], [403, 'IMAGE_REMOTE_FORBIDDEN'], [404, 'IMAGE_REMOTE_NOT_FOUND'],
      [409, 'IMAGE_REMOTE_CONFLICT'], [413, 'IMAGE_REMOTE_TOO_LARGE'], [428, 'IMAGE_REMOTE_REVISION_REQUIRED'],
      [429, 'IMAGE_REMOTE_RATE_LIMITED'], [503, 'IMAGE_REMOTE_UNAVAILABLE'], [418, 'IMAGE_REMOTE_REQUEST_FAILED'],
    ];
    for (const [status, code] of cases) {
      const { origin } = await fixture((_rec, res) => sendError(res, status, secret));
      const bound = await bind(origin);
      const error = await bound.manifest().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ImageRemoteError);
      expect(error).toMatchObject({ code, status });
      expect(String(error)).not.toContain('topsecret');
    }
  });

  it('never follows redirects', async () => {
    const { requests, origin } = await fixture((_rec, res) => {
      res.writeHead(302, { location: '/api/apps/image' });
      res.end();
    });
    const bound = await bind(origin);
    await expect(bound.manifest()).rejects.toMatchObject({ code: 'IMAGE_REMOTE_REDIRECT', status: 302 });
    expect(requests).toHaveLength(1);
  });

  it('times out once and reports an unavailable backend without retrying', async () => {
    const { requests, origin } = await fixture(async (_rec, res) => {
      await new Promise(resolve => setTimeout(resolve, 250));
      sendData(res, 200, MANIFEST);
    });
    const bound = await client(origin, { timeoutMs: 30 }).forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID);
    await expect(bound.manifest()).rejects.toMatchObject({ code: 'IMAGE_REMOTE_TIMEOUT' });
    expect(requests).toHaveLength(1);

    const dead = createServer();
    servers.push(dead);
    dead.listen(0, '127.0.0.1');
    await once(dead, 'listening');
    const deadPort = (dead.address() as AddressInfo).port;
    await new Promise<void>(resolve => dead.close(() => resolve()));
    const offline = await client(`http://127.0.0.1:${deadPort}`).forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID);
    await expect(offline.manifest()).rejects.toMatchObject({ code: 'IMAGE_REMOTE_UNAVAILABLE' });
  });

  it('verifies the five-field resource scope on state, jobs and listings', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const foreign = { ...resourceScope(TARGET), bizId: 'biz-foreign' };
    const badWorkspace = { ...WORKSPACE, scope: foreign };
    const badJob = { ...JOB, scope: foreign };
    let fix = await fixture(contract(png, sha, { workspace: badWorkspace }));
    let bound = await bind(fix.origin);
    await expect(bound.state(WID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_RESPONSE_INVALID' });
    await expect(bound.listWorkspaces()).rejects.toMatchObject({ code: 'IMAGE_REMOTE_RESPONSE_INVALID' });

    fix = await fixture(contract(png, sha, { job: badJob }));
    bound = await bind(fix.origin);
    await expect(bound.job(WID, JID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_RESPONSE_INVALID' });
    await expect(bound.state(WID)).rejects.toMatchObject({ code: 'IMAGE_REMOTE_RESPONSE_INVALID' });

    fix = await fixture(contract(png, sha));
    bound = await bind(fix.origin);
    const state = await bound.state(WID);
    expect(state.workspace.id).toBe(WID);
    expect(state.assets[0]!.id).toBe(AID);
    expect(state.jobs[0]!.id).toBe(JID);
    const job = await bound.job(WID, JID);
    expect(job.id).toBe(JID);
    const items = await bound.listWorkspaces();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(WID);
  });

  it('rejects a manifest that is not the independent image contract', async () => {
    const { origin } = await fixture((_rec, res) => sendData(res, 200, { appId: 'other', protocolVersion: 9 }));
    const bound = await bind(origin);
    await expect(bound.manifest()).rejects.toMatchObject({ code: 'IMAGE_REMOTE_RESPONSE_INVALID' });
  });

  it('keeps concurrent bindings isolated without identity bleed', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 7, g: 8, b: 9 } } }).png().toBuffer();
    const sha = createHash('sha256').update(png).digest('hex');
    const { requests, origin } = await fixture(contract(png, sha));
    const sourceB: ImageRemoteScope = {
      teamId: 'team-2', userId: 'user-2', bizId: 'biz-2',
      applicationId: 'canvas-app', applicationInstanceId: 'canvas-inst-2', providerInstanceId: 'canvas-prov-2',
    };
    const targetB: ImageRemoteScope = {
      teamId: 'team-2', userId: 'user-2', bizId: 'biz-2',
      applicationId: 'image-app', applicationInstanceId: 'image-inst-2', providerInstanceId: 'image-prov-2',
    };
    const headersB: Record<string, string> = {
      'x-mav-sso-authorization': 'Bearer sso-token-b',
      'x-mav-tenant': 'team-2',
      'x-mav-application-instance-id': 'canvas-inst-2',
    };
    const client0 = client(origin, {
      resolve: async (_h, id) => id === 'image-inst-2' ? targetB : TARGET,
    });
    const [a, b] = await Promise.all([
      client0.forRequest(SOURCE, SOURCE_HEADERS, TARGET_ID),
      client0.forRequest(sourceB, headersB, 'image-inst-2'),
    ]);
    await Promise.all([a.manifest(), b.manifest(), a.state(WID).catch(() => null), b.manifest()]);
    const aRequests = requests.filter(r => r.headers['x-mav-application-instance-id'] === TARGET_ID);
    const bRequests = requests.filter(r => r.headers['x-mav-application-instance-id'] === 'image-inst-2');
    expect(aRequests.length).toBeGreaterThan(0);
    expect(bRequests.length).toBeGreaterThan(0);
    for (const r of aRequests) {
      expect(r.headers['x-mav-sso-authorization']).toBe(SSO);
      expect(r.headers['x-mav-tenant']).toBe('team-1');
    }
    for (const r of bRequests) {
      expect(r.headers['x-mav-sso-authorization']).toBe('Bearer sso-token-b');
      expect(r.headers['x-mav-tenant']).toBe('team-2');
    }
    expect(requests.filter(r => r.headers['x-mav-application-instance-id'] === 'canvas-inst-1')).toHaveLength(0);
  });
});
