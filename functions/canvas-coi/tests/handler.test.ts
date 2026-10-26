/** Real handler + real app server against an in-memory Appwrite fixture.
 * Every invocation runs the full pipeline: transport decode → config →
 * writer lock → createCanvasServer boot → loopback bridge → durable flush →
 * release → transport encode. Only Appwrite/MA transport is emulated. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAppwriteFixture } from './fixture.js';
import { createCanvasFunctionHandler } from '../src/handler.js';
import { runInvocation, type FunctionDeps } from '../src/runtime.js';
import { decodeRequest, BINARY_REQUEST_MEDIA_TYPE, type FnRequest } from '../src/transport.js';
import { stateDocumentId, MANIFEST_SLOT, writerLockDocumentId } from '@ks-designai/app-cloud-state';

const KEY = 'k9-platform-key';
const MA = 'https://ma.test/v1';
const AW = 'https://appwrite.test/v1';
const SSO = 'Bearer sso-u1';
const SSO_NO_GRANT = 'Bearer sso-u3';
const SSO_REVOKED = 'Bearer sso-gone';
const INSTANCE = 'inst1';
const INST_META = { bizId: 'biz1', applicationId: 'canvas', providerInstanceId: 'prov1' };
const SECRET_MARKER = 's3cr3t-marker-4f8b2c';

const fixture = createAppwriteFixture({
  apiKey: KEY,
  maEndpoint: MA,
  actors: {
    [SSO]: { userId: 'u1', instances: { [INSTANCE]: INST_META } },
    [SSO_NO_GRANT]: { userId: 'u3', instances: { [INSTANCE]: INST_META } },
    [SSO_REVOKED]: { userId: 'u9', revoked: true, instances: {} },
  },
});
vi.stubGlobal('fetch', fixture.fetch);

const GRANTS = [{ teamId: 'team1', bizId: 'biz1', userId: 'u1', actions: [
  'canvas.create', 'canvas.write', 'canvas.operations', 'canvas.rename', 'canvas.delete',
  'canvas.archive', 'document.create', 'node.create', 'node.update',
] }];

const baseEnv = {
  APPWRITE_ENDPOINT: AW, APPWRITE_PROJECT_ID: 'p1',
  APPWRITE_DATABASE_ID: 'db1', APPWRITE_BUCKET_ID: 'b1',
  APPWRITE_RUNTIME_COLLECTION: 'rt', CANVAS_RUNTIME_NAMESPACE: 'ns',
  APPWRITE_FUNCTION_API_KEY: KEY,
  MAV_API_TRANSPORT: 'appwrite', MAV_APPWRITE_ENDPOINT: MA, MAV_APPWRITE_PROJECT_ID: 'map1',
  APP_WRITE_GRANTS_JSON: JSON.stringify(GRANTS),
};

const seedManifest = (namespace: string) => {
  const key = 'db1/rt';
  const map = fixture.collections.get(key) ?? new Map();
  fixture.collections.set(key, map);
  const id = stateDocumentId(namespace, MANIFEST_SLOT);
  map.set(id, {
    namespace, slot: MANIFEST_SLOT, revision: 0,
    payload: JSON.stringify({ kind: 'app-cloud-state/manifest', schemaVersion: 1, namespace }),
    updatedAt: new Date().toISOString(), $id: id,
  });
};

const envFor = (namespace: string) => ({ ...baseEnv, CANVAS_RUNTIME_NAMESPACE: namespace });

const maHeaders = (credential = SSO, tenant = 'team1', instance = INSTANCE) => ({
  'x-mav-sso-authorization': credential, 'x-mav-tenant': tenant,
  'x-mav-application-instance-id': instance, 'x-appwrite-key': KEY,
});

interface Captured { status: number; body: unknown; logs: string[]; errors: string[] }
const invoke = async (handler: ReturnType<typeof createCanvasFunctionHandler>, req: FnRequest): Promise<Captured> => {
  const captured: Captured = { status: 0, body: undefined, logs: [], errors: [] };
  const res = {
    json: (b: unknown, s?: number) => { captured.status = s ?? 200; captured.body = b; return b; },
    text: (b: string, s?: number) => { captured.status = s ?? 200; captured.body = b; return b; },
  };
  await handler({ req, res, log: m => captured.logs.push(m), error: m => captured.errors.push(m) });
  return captured;
};

const req = (o: { method?: string; path: string; headers?: Record<string, string>; body?: unknown; queryString?: string; rawBodyText?: string }): FnRequest => ({
  method: o.method ?? 'GET',
  path: o.path,
  headers: { ...maHeaders(), ...(o.headers ?? {}) },
  ...(o.queryString !== undefined ? { queryString: o.queryString } : {}),
  ...(o.body !== undefined ? { bodyText: typeof o.body === 'string' ? o.body : JSON.stringify(o.body) } : { bodyText: o.rawBodyText ?? '' }),
});

const jsonReq = (o: { method?: string; path: string; headers?: Record<string, string>; body?: unknown; queryString?: string }) =>
  req({ ...o, headers: { ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) } });

beforeAll(() => {
  seedManifest('ns');
});

describe('canvas function — full pipeline on in-memory Appwrite', () => {
  const handler = createCanvasFunctionHandler({ env: envFor('ns') });

  it('serves health and capability manifest through the real app', async () => {
    const health = await invoke(handler, req({ path: '/api/health' }));
    expect(health.status).toBe(200);
    expect((health.body as { ok: boolean }).ok).toBe(true);
    const manifest = await invoke(handler, req({ path: '/api/apps/canvas' }));
    expect(manifest.status).toBe(200);
    expect((manifest.body as { data: { appId: string } }).data.appId).toBe('canvas');
  });

  it('creates an instance, applies operations, replays idempotently and persists across executions', async () => {
    const created = await invoke(handler, jsonReq({
      method: 'POST', path: '/api/apps/canvas/actions/canvas.create',
      body: { input: { instanceId: 'cv-1', name: 'Function canvas' } },
    }));
    expect(created.status).toBe(201);
    expect((created.body as { data: { result: { instanceId: string } } }).data.result.instanceId).toBe('cv-1');

    const listed = await invoke(handler, req({ path: '/api/apps/canvas/instances' }));
    expect((listed.body as { data: { instances: { instanceId: string }[] } }).data.instances.map(i => i.instanceId)).toContain('cv-1');

    const opBody = { operationId: 'op-1', baseRevision: 0, operations: [{ type: 'node.create', node: { id: 't1', kind: 'text', title: 'T', text: 'hi', x: 0, y: 0 } }] };
    const applied = await invoke(handler, jsonReq({ method: 'POST', path: '/api/apps/canvas/instances/cv-1/operations', body: opBody }));
    expect(applied.status).toBe(200);
    const appliedData = (applied.body as { data: { receipt: { status: string }; revision: number } }).data;
    expect(appliedData.receipt.status).toBe('applied');
    expect(appliedData.revision).toBeGreaterThan(0);

    // Same request replayed in a later execution: journaled, not re-applied.
    const replayed = await invoke(handler, jsonReq({ method: 'POST', path: '/api/apps/canvas/instances/cv-1/operations', body: opBody }));
    expect((replayed.body as { data: { replayed: boolean; revision: number } }).data.replayed).toBe(true);
    expect((replayed.body as { data: { revision: number } }).data.revision).toBe(appliedData.revision);

    // Same operationId with different input is a conflict, not a new version.
    const conflict = await invoke(handler, jsonReq({
      method: 'POST', path: '/api/apps/canvas/instances/cv-1/operations',
      body: { ...opBody, operations: [{ type: 'node.create', node: { id: 't2', kind: 'text', text: 'other', x: 1, y: 1 } }] },
    }));
    expect(conflict.status).toBe(409);

    // Stale base revision rejected.
    const stale = await invoke(handler, jsonReq({
      method: 'POST', path: '/api/apps/canvas/instances/cv-1/operations',
      body: { operationId: 'op-2', baseRevision: 0, operations: [{ type: 'node.create', node: { id: 't9', kind: 'text', text: 'x', x: 0, y: 0 } }] },
    }));
    expect(stale.status).toBe(409);

    // Cross-execution durability: a fresh invocation reloads committed state.
    const state = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(state.status).toBe(200);
    expect((state.body as { data: { revision: number } }).data.revision).toBe(appliedData.revision);
    expect(JSON.stringify(state.body)).toContain('"t1"');

    const receipt = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/operations/op-1' }));
    expect((receipt.body as { data: { receipt: { operationId: string } } }).data.receipt.operationId).toBe('op-1');
  });

  it('round-trips multipart upload and raw binary download through the byte wrappers', async () => {
    const boundary = '----fnTestBoundary77';
    const payload = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const pre = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const post = `\r\n--${boundary}--\r\n`;
    const multipart = Buffer.concat([Buffer.from(pre, 'utf8'), Buffer.from(payload), Buffer.from(post, 'utf8')]);
    const upload = await invoke(handler, req({
      method: 'POST', path: '/api/projects/cv-1/files',
      headers: { 'content-type': BINARY_REQUEST_MEDIA_TYPE },
      rawBodyText: JSON.stringify({
        version: 1, bodyEncoding: 'base64',
        contentType: `multipart/form-data; boundary=${boundary}`,
        body: multipart.toString('base64'),
      }),
    }));
    expect(upload.status).toBe(200);
    const name = (upload.body as { file: { name: string } }).file.name;

    const raw = await invoke(handler, req({ path: `/api/projects/cv-1/raw/${encodeURIComponent(name)}` }));
    expect(raw.status).toBe(200);
    const wrapped = raw.body as { functionTransport: string; bodyEncoding: string; body: string; headers: Record<string, string> };
    expect(wrapped.functionTransport).toBe('designai.function-http/v1');
    expect(wrapped.bodyEncoding).toBe('base64');
    expect(new Uint8Array(Buffer.from(wrapped.body, 'base64'))).toEqual(payload);
    expect(Object.keys(wrapped.headers)).not.toContain('set-cookie');
    expect(Object.keys(wrapped.headers)).not.toContain('location');
  });

  it('fails closed: missing identity, forged body actor, cross-tenant, revoked credential, no write grant', async () => {
    const noIdentity = await invoke(handler, req({ path: '/api/apps/canvas', headers: { 'x-mav-sso-authorization': '', 'x-mav-tenant': '', 'x-mav-application-instance-id': '' } }));
    expect(noIdentity.status).toBe(401);

    // A self-reported body actor carries no authority.
    const forged = await invoke(handler, jsonReq({
      method: 'POST', path: '/api/apps/canvas/actions/canvas.create',
      headers: { 'x-mav-sso-authorization': '', 'x-mav-tenant': '', 'x-mav-application-instance-id': '' },
      body: { actor: { userId: 'admin', teamId: 'team1' }, input: { instanceId: 'cv-evil' } },
    }));
    expect(forged.status).toBe(401);
    expect(fixture.doc('db1', 'canvases', 'cv-evil')).toBeUndefined();

    const crossTenant = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state', headers: maHeaders(SSO, 'team2') }));
    expect(crossTenant.status).toBe(403);

    const revoked = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state', headers: maHeaders(SSO_REVOKED) }));
    expect(revoked.status).toBe(401);

    const noGrant = await invoke(handler, jsonReq({
      method: 'POST', path: '/api/apps/canvas/actions/canvas.create',
      headers: maHeaders(SSO_NO_GRANT), body: { input: { instanceId: 'cv-u3' } },
    }));
    expect(noGrant.status).toBe(403);
    expect(fixture.doc('db1', 'canvases', 'cv-u3')).toBeUndefined();

    const unknown = await invoke(handler, req({ path: '/api/definitely-not-a-route' }));
    expect(unknown.status).toBe(404);
  });

  it('rejects event-stream subscriptions explicitly instead of hanging', async () => {
    const out = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/events', headers: { accept: 'text/event-stream' } }));
    expect(out.status).toBe(501);
    expect((out.body as { error: { code: string } }).error.code).toBe('FUNCTION_STREAM_UNSUPPORTED');
  });

  it('refuses hostile wrappers and never trusts the key in the business body', async () => {
    const hostile = await invoke(handler, req({
      method: 'POST', path: '/api/apps/canvas/instances/cv-1/state',
      headers: { 'content-type': BINARY_REQUEST_MEDIA_TYPE },
      rawBodyText: JSON.stringify({ version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA', headers: { 'x-mav-tenant': 'x' } }),
    }));
    expect(hostile.status).toBe(400);

    const noKeyEnv = { ...envFor('ns2') } as Record<string, string>;
    delete noKeyEnv.APPWRITE_FUNCTION_API_KEY;
    seedManifest('ns2');
    const noKeyHandler = createCanvasFunctionHandler({ env: noKeyEnv });
    const headers = maHeaders(); headers['x-appwrite-key'] = '';
    const bodyKey = await invoke(noKeyHandler, jsonReq({
      method: 'POST', path: '/api/apps/canvas/actions/canvas.create',
      headers, body: { apiKey: KEY, 'x-appwrite-key': KEY, input: { instanceId: 'cv-key' } },
    }));
    expect(bodyKey.status).toBe(503);
    expect((bodyKey.body as { error: { code: string } }).error.code).toBe('CANVAS_FUNCTION_NOT_CONFIGURED');
    expect(fixture.doc('db1', 'canvases', 'cv-key')).toBeUndefined();
  });

  it('requires MA authority configuration for every business route', async () => {
    const env = { ...envFor('ns3') } as Record<string, string>;
    delete env.MAV_API_TRANSPORT; delete env.MAV_APPWRITE_ENDPOINT; delete env.MAV_APPWRITE_PROJECT_ID;
    seedManifest('ns3');
    const noMa = createCanvasFunctionHandler({ env });
    const out = await invoke(noMa, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(out.status).toBe(503);
    expect((out.body as { error: { code: string } }).error.code).toBe('MA_AUTHORITY_NOT_CONFIGURED');
    const out2 = await invoke(noMa, req({ path: '/api/health' }));
    expect(out2.status).toBe(503);
  });

  it('read-only private-storage preflight gates all business writes', async () => {
    // Private metadata everywhere → normal request proceeds (proven by the
    // entire suite above; this case additionally asserts no writes occur on
    // the gated path).
    const lockId = writerLockDocumentId('canvas');
    const map = fixture.collections.get('db1/rt')!;
    expect(map.has(lockId)).toBe(false);

    // A broad-grant collection fails closed before the writer lock or any
    // business document is touched.
    fixture.setCollectionMeta('canvases', { permissions: ['read("any")'], documentSecurity: true });
    const open = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(open.status).toBe(503);
    expect((open.body as { error: { code: string } }).error.code).toBe('CLOUD_STORAGE_NOT_PRIVATE');
    expect(map.has(lockId)).toBe(false);
    fixture.setCollectionMeta('canvases', undefined);

    fixture.setBucketMeta('b1', { fileSecurity: false });
    const openBucket = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(openBucket.status).toBe(503);
    expect((openBucket.body as { error: { code: string } }).error.code).toBe('CLOUD_STORAGE_NOT_PRIVATE');
    expect(map.has(lockId)).toBe(false);
    fixture.setBucketMeta('b1', undefined);

    // Metadata unreachable → fail closed, still no writes.
    fixture.setFailing(true);
    const down = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(down.status).toBe(503);
    expect((down.body as { error: { code: string } }).error.code).toBe('CLOUD_STORAGE_UNAVAILABLE');
    expect(map.has(lockId)).toBe(false);
    fixture.setFailing(false);
  });

  it('ambiguous lock create: document may have landed — leave it, never reconcile', async () => {
    const lockId = writerLockDocumentId('canvas');
    const map = fixture.collections.get('db1/rt')!;
    seedManifest('ns-ambig');
    const h = createCanvasFunctionHandler({ env: envFor('ns-ambig') });
    fixture.landAndFailNextDocument();
    const out = await invoke(h, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(out.status).toBe(503);
    // The lock document landed despite the failed response — it stays for the
    // operator; this execution never issues a DELETE.
    const landed = map.get(lockId);
    expect(landed).toBeTruthy();
    // A later admission sees the held lock and fails closed — no takeover.
    const next = await invoke(h, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(next.status).toBe(503);
    expect(map.get(lockId)).toEqual(landed);
    map.delete(lockId); // operator recovery
  });

  it('keeps a foreign writer lock and refuses to proceed', async () => {
    const foreignOwner = randomUUID();
    const map = fixture.collections.get('db1/rt')!;
    const id = writerLockDocumentId('canvas');
    map.set(id, {
      namespace: '__app_writer_locks__', slot: 'service:canvas', revision: 0,
      payload: JSON.stringify({ kind: 'exclusive-app-writer', version: 1, serviceId: 'canvas', ownerId: foreignOwner, startedAt: new Date().toISOString() }),
      updatedAt: new Date().toISOString(), $id: id,
    });
    const out = await invoke(handler, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(out.status).toBe(503);
    expect(map.has(id)).toBe(true); // never deleted or overwritten
    map.delete(id); // operator recovery for the remaining tests
  });

  it('retains its own lock after an uncertain outcome and blocks later admissions', async () => {
    seedManifest('ns-unc');
    let calls = 0;
    const failing = createCanvasFunctionHandler({
      env: envFor('ns-unc'),
      forward: async () => { calls += 1; throw new Error(`downstream boom ${SECRET_MARKER}`); },
    });
    const out = await invoke(failing, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(calls).toBe(1); // no automatic retry/replay
    expect(out.status).toBe(503);
    expect(JSON.stringify(out.body)).not.toContain(SECRET_MARKER);
    for (const line of [...out.logs, ...out.errors]) expect(line).not.toContain(SECRET_MARKER);
    const lockId = writerLockDocumentId('canvas');
    expect(fixture.collections.get('db1/rt')!.has(lockId)).toBe(true); // retained, not released

    const next = await invoke(failing, req({ path: '/api/apps/canvas/instances/cv-1/state' }));
    expect(next.status).toBe(503); // own retained lock blocks admission
    expect(calls).toBe(1);

    fixture.collections.get('db1/rt')!.delete(lockId); // operator recovery
  });
});

describe('canvas function — injected failure paths', () => {
  const cannedEnv = envFor('ns-inject');
  const cannedServer = (over: Partial<{ close(): Promise<void> }> = {}) => ({
    app: (_req: unknown, res: { end(): void }) => res.end(),
    ready: Promise.resolve(),
    close: vi.fn(async () => {}),
    ...over,
  });
  const deps = (over: Partial<FunctionDeps>): FunctionDeps => ({ env: cannedEnv, ...over });
  const decoded = decodeRequest(req({ path: '/api/health' }));

  it('release failure after a confirmed close returns 503 with no retry', async () => {
    const server = cannedServer();
    const release = vi.fn(async () => { throw new Error(`release fail ${SECRET_MARKER}`); });
    const acquire = vi.fn(async () => {});
    await expect(runInvocation(decoded, deps({
      createServer: () => server as never,
      lockFactory: () => ({ acquire, release }),
      forward: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: new Uint8Array([123, 125]) }),
    }))).rejects.toMatchObject({ status: 503, code: 'FUNCTION_RELEASE_UNCONFIRMED', stage: 'release' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('flush failure retains the lock and never reports success', async () => {
    const server = cannedServer({ close: vi.fn(async () => { throw new Error(`flush fail ${SECRET_MARKER}`); }) });
    const release = vi.fn(async () => {});
    await expect(runInvocation(decoded, deps({
      createServer: () => server as never,
      lockFactory: () => ({ acquire: vi.fn(async () => {}), release }),
      forward: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: new Uint8Array([123, 125]) }),
    }))).rejects.toMatchObject({ status: 503 });
    expect(release).not.toHaveBeenCalled();
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('forward failure tears down ephemerals once, retains lock, reports 503', async () => {
    const server = cannedServer();
    const release = vi.fn(async () => {});
    await expect(runInvocation(decoded, deps({
      createServer: () => server as never,
      lockFactory: () => ({ acquire: vi.fn(async () => {}), release }),
      forward: async () => { throw new Error('bridge down'); },
    }))).rejects.toMatchObject({ status: 503 });
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('secret markers in thrown causes never reach response or logs', async () => {
    const handler = createCanvasFunctionHandler(deps({
      createServer: () => { throw new Error(`storage rejected key=${SECRET_MARKER} token=${SECRET_MARKER}`); },
      lockFactory: () => ({ acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) }),
    }));
    const out = await invoke(handler, req({ path: '/api/health' }));
    expect(out.status).toBe(503);
    expect(JSON.stringify(out.body)).not.toContain(SECRET_MARKER);
    for (const line of [...out.logs, ...out.errors]) expect(line).not.toContain(SECRET_MARKER);
    for (const line of [...out.logs, ...out.errors]) expect(line).toMatch(/^canvas function status=\d+ code=[A-Z][A-Z0-9_]+ stage=[a-z-]+$/);
  });
});
