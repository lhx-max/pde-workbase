import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { createCanvasServer, type CanvasServerOptions } from '../src/server.js';
import { createAppWriteAuthorizer, type AppActor } from '@ks-designai/app-authority';
import { Database } from '../src/storage/database.js';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { CanvasStateService } from '../src/canvas/state.js';
import { MediaAdapterService, type MediaAdapter, type MediaCatalog } from '../src/media/adapter-service.js';
import { ImageAppService } from '../src/media/image-app.js';
import { runWithRequestTenant, type TenantContext } from '../src/tenant.js';

const catalog: MediaCatalog = { providers: [{ id: 'designai', integrated: true }], image: [{ id: 'designai-gpt-image-2', label: 'GPT', provider: 'designai', caps: ['t2i'] }], video: [], audio: {}, aspects: ['1:1'], videoLengthsSec: [], audioDurationsSec: [] };
const png = sharp({ create: { width: 8, height: 4, channels: 3, background: '#4a9' } }).png().toBuffer();
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

// ---------------------------------------------------------------------------
// Service-level fixture: ImageAppService + media queue over a real canvas state,
// driven only through verified-caller context (runWithRequestTenant) — never
// through self-reported identity headers.
// ---------------------------------------------------------------------------
const VERIFIED = { teamId: 'team-a', bizId: 'biz-a', userId: 'user-a', applicationId: 'app-image', applicationInstanceId: 'inst-a', providerInstanceId: 'pid-a' };
const caller = (over: Record<string, unknown> = {}): TenantContext =>
    ({ ...VERIFIED, ...over, userVerified: true }) as unknown as TenantContext;
const asCaller = <T>(tenant: TenantContext, fn: () => T): Promise<T> => Promise.resolve(runWithRequestTenant(tenant, fn));

async function serviceFixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'image-app-audit-'));
    const registry = createProjectRegistry(root);
    const project = registry.create({ name: 'Audit' });
    const second = registry.create({ name: 'Foreign' });
    const db = new Database(path.join(root, 'workspace.sqlite'));
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO projects(id) VALUES(?)').run(project.id);
    db.prepare('INSERT INTO projects(id) VALUES(?)').run(second.id);
    const canvas = new CanvasStateService(id => registry.resolveProjectRoot(id));
    const calls: Record<string, unknown>[] = [];
    const bytes = await png;
    const adapter: MediaAdapter = {
        catalog: async () => catalog, config: async () => ({ providers: { designai: { configured: true } } }),
        generate: async input => { calls.push(input.request); return { path: String(input.request.output), content: bytes, mime: 'image/png' }; },
    };
    const media = new MediaAdapterService(db, registry, canvas, adapter);
    const image = new ImageAppService(canvas, media);
    const seedSource = async (nodeId = 'src', file = 'outputs/images/seed.png') => {
        await canvas.patch(project.id, { workbenchImages: [{ id: nodeId, path: file, status: 'ready', naturalWidth: 8, naturalHeight: 4 }] });
        const abs = path.join(registry.resolveProjectRoot(project.id), file);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, bytes);
    };
    const act = async (tenant: TenantContext, actionId: string, input: Record<string, unknown>, key: string, projectId = project.id) => {
        for (let attempt = 0; attempt < 20; attempt++) {
            const revision = await canvas.revision(projectId);
            try { return await asCaller(tenant, () => image.action(projectId, actionId, input, revision, key)); }
            catch (error) { if ((error as { code?: string }).code === 'CANVAS_REVISION_CONFLICT') continue; throw error; }
        }
        throw new Error('canvas revision never settled');
    };
    const settle = async (ids: string[]) => { for (const id of ids) await media.wait(id, AbortSignal.timeout(5000)); await media.delivery.reconcile(); };
    cleanup.push(async () => { await media.close(); db.close(); await rm(root, { recursive: true, force: true }); });
    return { root, registry, project, second, db, canvas, media, image, calls, act, seedSource, settle };
}

it('image.tool dispatch derives the source from the bound card and keeps generation settings', async () => {
    const f = await serviceFixture();
    await f.seedSource();
    const a = caller();
    const done = await f.act(a, 'image.tool', { nodeId: 'src', kind: 'multi-angle', params: { mode: 'camera', rotation: 20, tilt: 0, zoom: 50 } }, 'tool-ok');
    const taskIds = (done.result as { taskIds: string[] }).taskIds;
    expect(taskIds).toHaveLength(1);
    await f.settle(taskIds);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ tool: { kind: 'multi-angle', source: 'outputs/images/seed.png' }, images: ['outputs/images/seed.png'], model: 'designai-gpt-image-2' });
    const images = (await f.canvas.read(f.project.id)).state.workbenchImages as Array<{ id: string; path?: string }>;
    expect(images.find(v => v.id === 'src')?.path).toBe('outputs/images/seed.png');
});

it('image.tool rejects caller-supplied pointers, credential keys and unknown fields before dispatch', async () => {
    const f = await serviceFixture();
    await f.seedSource();
    const a = caller();
    const bads: Record<string, unknown>[] = [
        { nodeId: 'src', kind: 'multi-angle', params: { mode: 'camera', rotation: 0, tilt: 0, zoom: 0 }, source: 'outputs/evil.png' },
        { nodeId: 'src', kind: 'erase', params: { mask: 'outputs/images/seed.png' }, token: 'x' },
        { nodeId: 'src', kind: 'precision-edit', params: { point: { x: 0.5, y: 0.5, authorization: 'Bearer x' }, instruction: 'edit' } },
        { nodeId: 'src', kind: 'erase', params: { mask: 'https://evil.example/m.png' } },
        { nodeId: 'src', kind: 'erase', params: { mask: '../secret.png' } },
        { nodeId: 'src', kind: 'not-a-tool', params: {} },
    ];
    for (const input of bads) await expect(f.act(a, 'image.tool', input, randomUUID())).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
    const receipts = (await f.canvas.read(f.project.id)).state.workbenchImageReceipts as Record<string, unknown>;
    expect(Object.keys(receipts ?? {})).toHaveLength(0);
});

it('image.tool fails closed for JSON-primary tools and unbound/missing source cards', async () => {
    const f = await serviceFixture();
    await f.seedSource();
    await f.canvas.patch(f.project.id, { workbenchImages: [{ id: 'src', path: 'outputs/images/seed.png', status: 'ready', naturalWidth: 8, naturalHeight: 4 }, { id: 'busy', status: 'generating' }] });
    const a = caller();
    await expect(f.act(a,'image.tool',{nodeId:'src',kind:'mockup-surface',params:{}},randomUUID())).rejects.toMatchObject({status:503,code:'IMAGE_TOOL_ADAPTER_UNAVAILABLE'});
    await expect(f.act(a, 'image.tool', { nodeId: 'ghost', kind: 'multi-angle', params: { mode: 'camera', rotation: 0, tilt: 0, zoom: 0 } }, randomUUID())).rejects.toMatchObject({ status: 404, code: 'IMAGE_NODE_NOT_FOUND' });
    await expect(f.act(a, 'image.tool', { nodeId: 'busy', kind: 'multi-angle', params: { mode: 'camera', rotation: 0, tilt: 0, zoom: 0 } }, randomUUID())).rejects.toMatchObject({ status: 409, code: 'IMAGE_NOT_READY' });
    expect(f.calls).toHaveLength(0);
});

it('scopes receipts and task cancellation to the owning caller, card and project', async () => {
    const f = await serviceFixture();
    await f.seedSource();
    await f.canvas.patch(f.project.id, { workbenchTaskDrafts: { src: { text: 'lamp' } } });
    const a = caller();
    const generated = await f.act(a, 'image.generate', { nodeId: 'src' }, 'gen-a');
    const ids = (generated.result as { taskIds: string[] }).taskIds;
    await f.settle(ids);
    // Foreign verified caller cannot read or adopt the receipt.
    const b = caller({ userId: 'user-b' });
    await expect(asCaller(b, () => f.image.receipt(f.project.id, 'gen-a'))).rejects.toMatchObject({ status: 404, code: 'IMAGE_RECEIPT_NOT_FOUND' });
    const stored = (await f.canvas.read(f.project.id)).state.workbenchImageReceipts as Record<string, { callerScope?: string }>;
    const storageKey = Object.keys(stored).find(k => stored[k]?.callerScope);
    await expect(asCaller(b, () => f.image.receipt(f.project.id, storageKey!))).rejects.toMatchObject({ status: 404 });
    // Same changed-body conflict under the same key.
    await expect(f.act(a, 'image.generate', { nodeId: 'src', set: { prompt: 'different' } }, 'gen-a')).rejects.toMatchObject({ status: 409, code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    // Cancellation is bound to card lineage and project.
    const foreignTask = await f.media.submit(f.second.id, { surface: 'image', model: 'designai-gpt-image-2', prompt: 'x', output: 'outputs/p2.png', clientRequestId: randomUUID() });
    await expect(f.act(a, 'image.cancel', { nodeId: 'src', taskId: foreignTask.taskId }, 'cancel-foreign'))
        .rejects.toMatchObject({ status: 404, code: 'IMAGE_TASK_NOT_FOUND' });
    await f.media.cancel(foreignTask.taskId);
    await f.canvas.patch(f.project.id, { workbenchImages: [{ id: 'src', path: 'outputs/images/seed.png', status: 'ready', naturalWidth: 8, naturalHeight: 4 }, { id: 'other', path: 'outputs/images/seed.png', status: 'ready', naturalWidth: 8, naturalHeight: 4 }] });
    await expect(f.act(a, 'image.cancel', { nodeId: 'other', taskId: ids[0]! }, 'cancel-wrong-node'))
        .rejects.toMatchObject({ status: 404, code: 'IMAGE_TASK_NOT_FOUND' });
});

// ---------------------------------------------------------------------------
// HTTP-level fixture: createCanvasServer with MA authority + exact write grants.
// ---------------------------------------------------------------------------
const listen = (s: Server) => new Promise<string>(resolve => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as { port: number }).port}`)));
const stop = (s: Server) => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); });
const GRANT = { teamId: 'team', bizId: 'business', userId: 'reader', applicationId: 'app_canvas', applicationInstanceId: 'ma-instance' };

async function maFixture(policy?: (actor: AppActor, action: string) => boolean, extra: Partial<CanvasServerOptions> = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'image-audit-ma-'));
    const bytes = await png;
    const calls: Record<string, unknown>[] = [];
    const adapter: MediaAdapter = {
        catalog: async () => catalog, config: async () => ({ providers: { designai: { configured: true } } }),
        generate: async input => { calls.push(input.request); return { path: String(input.request.output), content: bytes, mime: 'image/png' }; },
    };
    // The fake MA endpoint binds userId to the presented credential so a second
    // verified user exercises the same instance without sharing grants.
    const fetcher: typeof fetch = async (input, init) => {
        const credential = new Headers(init?.headers).get('authorization') ?? '';
        const me = String(input).endsWith('/me');
        return new Response(JSON.stringify({ data: me
            ? { userId: credential === 'Bearer second' ? 'mallory' : 'reader', status: 'active' }
            : { applicationInstanceId: 'ma-instance', providerInstanceId: 'provider', applicationId: 'app_canvas', bizId: 'business', status: 'active' } }),
            { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = createCanvasServer({ dataRoot: root, media: adapter, authority: { transport: { origin: 'http://127.0.0.1:1' }, fetcher }, ...(policy ? { authorizeAction: policy } : {}), ...extra });
    await api.ready;
    const server = createServer(api.app);
    const base = await listen(server);
    cleanup.push(async () => { await stop(server); await api.close(); await rm(root, { recursive: true, force: true }); });
    api.registry.create({ id: 'existing', name: 'Existing', teamId: 'team', metadata: { kind: 'other', appAuthority: { bizId: 'business', applicationId: 'app_canvas', providerInstanceId: 'provider', applicationInstanceId: 'ma-instance' } } });
    api.registry.create({ id: 'other-biz', name: 'OtherBiz', teamId: 'team', metadata: { kind: 'other', appAuthority: { bizId: 'other-business', applicationId: 'app_canvas', providerInstanceId: 'provider', applicationInstanceId: 'ma-instance' } } });
    api.registry.create({ id: 'other-team', name: 'OtherTeam', teamId: 'other-team', metadata: { kind: 'other', appAuthority: { bizId: 'business', applicationId: 'app_canvas', providerInstanceId: 'provider', applicationInstanceId: 'ma-instance' } } });
    await api.canvas.patch('existing', { workbenchImages: [{ id: 'src', path: 'outputs/seed.png', status: 'ready', naturalWidth: 8, naturalHeight: 4 }], workbenchTaskDrafts: { src: { text: 'lamp' } } });
    const request = (route: string, o: { method?: string; body?: unknown; headers?: Record<string, string>; verified?: boolean } = {}) => {
        const headers: Record<string, string> = { 'content-type': 'application/json', ...(o.verified === false ? {} : { 'x-mav-sso-authorization': 'Bearer valid', 'x-mav-tenant': 'team', 'x-mav-application-instance-id': 'ma-instance' }), ...o.headers };
        return fetch(base + route, { method: o.method ?? 'GET', headers, ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
    };
    const act = async (name: string, input: Record<string, unknown>, o: { key?: string; headers?: Record<string, string> } = {}) =>
        request(`/api/apps/image/instances/existing/actions/${name}`, { method: 'POST', body: { input, expectedRevision: await api.canvas.revision('existing') }, headers: { 'idempotency-key': o.key ?? randomUUID(), ...o.headers } });
    return { request, act, api, calls };
}

it('keeps verified image reads open but denies every write without an exact grant', async () => {
    const f = await maFixture();
    expect((await f.request('/api/apps/image/instances/existing/state')).status).toBe(200);
    const status = await f.act('image.status', { nodeId: 'src' });
    expect(status.status).toBe(200);
    for (const [name, input] of [
        ['image.configure', { nodeId: 'src', set: { prompt: 'x' } }],
        ['image.generate', { nodeId: 'src' }],
        ['image.tool', { nodeId: 'src', kind: 'multi-angle', params: { mode: 'camera', rotation: 0, tilt: 0, zoom: 0 } }],
        ['image.cancel', { nodeId: 'src', taskId: 'x' }],
    ] as const) {
        const response = await f.act(name, input);
        expect(response.status, name).toBe(403);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe('APP_WRITE_FORBIDDEN');
    }
    const created = await f.request('/api/apps/image/actions/image.create', { method: 'POST', body: { input: { canvasId: 'existing', nodeId: 'n', x: 0, y: 0 }, expectedRevision: await f.api.canvas.revision('existing') } });
    expect(created.status).toBe(403);
    expect(f.calls).toHaveLength(0);
});

it('grants only the exact delegated image actions to the exact verified user', async () => {
    const f = await maFixture(createAppWriteAuthorizer(JSON.stringify([{ ...GRANT, actions: ['image.configure', 'image.generate'] }])));
    expect((await f.act('image.tool', { nodeId: 'src', kind: 'multi-angle', params: { mode: 'camera', rotation: 0, tilt: 0, zoom: 0 } })).status).toBe(403);
    expect((await f.act('image.configure', { nodeId: 'src', set: { prompt: 'lamp' } }, { key: 'cfg-1' })).status).toBe(200);
    const generated = await f.act('image.generate', { nodeId: 'src' }, { key: 'gen-1' });
    expect([200, 202]).toContain(generated.status);
    // A second verified user in the same tenant and instance holds no grants.
    expect((await f.act('image.configure', { nodeId: 'src', set: { prompt: 'mallory' } }, { headers: { 'x-mav-sso-authorization': 'Bearer second' } })).status).toBe(403);
    // ...but still reads the same instance state.
    expect((await f.request('/api/apps/image/instances/existing/state', { headers: { 'x-mav-sso-authorization': 'Bearer second' } })).status).toBe(200);
});

it('ignores forged identity headers and rejects missing SSO before any storage or dispatch', async () => {
    const f = await maFixture(createAppWriteAuthorizer(JSON.stringify([{ ...GRANT, actions: ['image.configure'] }])));
    // Forged dev-mode headers cannot change the verified actor: the write below
    // succeeds only because 'reader' is granted — proving the forged user was ignored.
    const forged = await f.act('image.configure', { nodeId: 'src', set: { prompt: 'forged' } }, { headers: { 'x-user-id': 'mallory', 'x-team-id': 'mallory-team', 'x-user-verified': 'true' } });
    expect(forged.status).toBe(200);
    // A request with no MA credential never reaches a route.
    const missing = await f.request('/api/apps/image/instances/existing/state', { verified: false });
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('SSO_CREDENTIAL_REQUIRED');
    expect(f.calls).toHaveLength(0);
});

it('enforces tenant and business-instance boundaries on the image routes', async () => {
    const f = await maFixture(createAppWriteAuthorizer(JSON.stringify([{ ...GRANT, actions: ['image.configure', 'image.generate'] }])));
    // Cross-tenant: verified as another tenant, the image instance is invisible.
    expect((await f.request('/api/apps/image/instances/existing/state', { headers: { 'x-mav-tenant': 'other-team' } })).status).toBe(403);
    // Same tenant, different business space: complete appAuthority mismatch.
    const other = await f.request('/api/apps/image/instances/other-biz/state');
    expect(other.status).toBe(403);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe('INSTANCE_FORBIDDEN');
    // Foreign project content routes share the same boundary.
    expect((await f.request('/api/projects/other-team/canvas/state')).status).toBe(403);
    // No operator authority is configured, so entitlement mutation is closed.
    const deny = await f.request('/api/apps/entitlements', { method: 'PUT', body: { scope: 'team:team', appId: 'image', effect: 'deny' } });
    expect(deny.status).toBe(403);
});

it('verified write grant cancels an in-flight image task before delivery publishes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'image-audit-ma-cancel-'));
    const calls: Record<string, unknown>[] = [];
    const adapter: MediaAdapter = {
        catalog: async () => catalog, config: async () => ({ providers: { designai: { configured: true } } }),
        generate: async input => {
            calls.push(input.request);
            input.signal.throwIfAborted();
            await new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
            throw new Error('unreachable');
        },
    };
    const fetcher: typeof fetch = async input => new Response(JSON.stringify({ data: String(input).endsWith('/me') ? { userId: 'reader', status: 'active' } : { applicationInstanceId: 'ma-instance', providerInstanceId: 'provider', applicationId: 'app_canvas', bizId: 'business', status: 'active' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const api = createCanvasServer({ dataRoot: root, media: adapter, authority: { transport: { origin: 'http://127.0.0.1:1' }, fetcher }, authorizeAction: createAppWriteAuthorizer(JSON.stringify([{ ...GRANT, actions: ['image.generate', 'image.cancel'] }])) });
    await api.ready;
    const server = createServer(api.app);
    const base = await listen(server);
    cleanup.push(async () => { await stop(server); await api.close(); await rm(root, { recursive: true, force: true }); });
    api.registry.create({ id: 'existing', name: 'Existing', teamId: 'team', metadata: { kind: 'other', appAuthority: { bizId: 'business', applicationId: 'app_canvas', providerInstanceId: 'provider', applicationInstanceId: 'ma-instance' } } });
    await api.canvas.patch('existing', { workbenchImages: [{ id: 'src', path: 'outputs/seed.png', status: 'ready', naturalWidth: 8, naturalHeight: 4 }], workbenchTaskDrafts: { src: { text: 'lamp' } } });
    const headers = { 'content-type': 'application/json', 'x-mav-sso-authorization': 'Bearer valid', 'x-mav-tenant': 'team', 'x-mav-application-instance-id': 'ma-instance' };
    const generated = await fetch(`${base}/api/apps/image/instances/existing/actions/image.generate`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'gen-c' }, body: JSON.stringify({ input: { nodeId: 'src' }, expectedRevision: await api.canvas.revision('existing') }) });
    expect([200, 202]).toContain(generated.status);
    const taskId = (((await generated.json()) as { data: { result: { taskIds: string[] } } }).data.result.taskIds)[0]!;
    const cancelled = await fetch(`${base}/api/apps/image/instances/existing/actions/image.cancel`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'cancel-c' }, body: JSON.stringify({ input: { nodeId: 'src', taskId }, expectedRevision: await api.canvas.revision('existing') }) });
    expect(cancelled.status).toBe(200);
    await api.media.wait(taskId, AbortSignal.timeout(5000));
    expect(['interrupted', 'cancelled', 'failed']).toContain(api.media.get(taskId)?.status);
});
