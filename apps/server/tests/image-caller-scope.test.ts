import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { Database } from '../src/storage/database.js';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { CanvasStateService } from '../src/canvas/state.js';
import { MediaAdapterService, type MediaAdapter, type MediaCatalog } from '../src/media/adapter-service.js';
import { ImageAppService } from '../src/media/image-app.js';
import { runWithRequestTenant, type TenantContext } from '../src/tenant.js';

const catalog: MediaCatalog = { providers: [{ id: 'designai', integrated: true }], image: [{ id: 'designai-gpt-image-2', label: 'GPT', provider: 'designai', caps: ['t2i'] }], video: [], audio: {}, aspects: ['1:1'], videoLengthsSec: [], audioDurationsSec: [] };
const VERIFIED = { teamId: 'team-a', bizId: 'biz-a', userId: 'user-a', applicationId: 'app-image', applicationInstanceId: 'inst-a', providerInstanceId: 'pid-a' };
const caller = (over: Record<string, unknown> = {}): TenantContext =>
    ({ ...VERIFIED, ...over, userVerified: true }) as unknown as TenantContext;
const asCaller = <T>(tenant: TenantContext, fn: () => T): Promise<T> => Promise.resolve(runWithRequestTenant(tenant, fn));

const png = sharp({ create: { width: 8, height: 4, channels: 3, background: '#e44' } }).png().toBuffer();
const fixtures: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function fixture() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'image-caller-scope-'));
    const registry = createProjectRegistry(root);
    const project = registry.create({ name: 'Scoped' });
    const db = new Database(path.join(root, 'workspace.sqlite'));
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO projects(id) VALUES(?)').run(project.id);
    const canvas = new CanvasStateService(id => registry.resolveProjectRoot(id));
    const calls: Record<string, unknown>[] = [];
    const bytes = await png;
    const adapter: MediaAdapter = {
        catalog: async () => catalog, config: async () => ({ providers: { test: { configured: true } } }),
        generate: async input => { calls.push(input.request); return { path: String(input.request.output), content: bytes, mime: 'image/png' }; },
    };
    const media = new MediaAdapterService(db, registry, canvas, adapter);
    const image = new ImageAppService(canvas, media);
    const act = async (tenant: TenantContext, actionId: string, input: Record<string, unknown>, key: string, service = image) => {
        for (let attempt = 0; attempt < 20; attempt++) {
            const revision = await canvas.revision(project.id);
            try {
                return await asCaller(tenant, () => service.action(project.id, actionId, input, revision, key));
            }
            catch (error) {
                if ((error as { code?: string }).code === 'CANVAS_REVISION_CONFLICT') continue;
                throw error;
            }
        }
        throw new Error('canvas revision never settled');
    };
    const close = async () => { await media.close(); db.close(); rmSync(root, { recursive: true, force: true }); };
    fixtures.push({ close });
    return { root, registry, project, db, canvas, media, image, calls, act };
}

async function settle(media: MediaAdapterService, ids: string[]) {
    for (const taskId of ids) await media.wait(taskId, AbortSignal.timeout(5000));
    await media.delivery.reconcile();
}

it('replays a verified caller receipt across a reconstructed service without re-dispatch', async () => {
    const f = await fixture();
    const a = caller();
    await f.act(a, 'image.create', { canvasId: f.project.id, nodeId: 'src', x: 0, y: 0, config: { prompt: 'lamp' } }, 'create-1');
    const generated = await f.act(a, 'image.generate', { nodeId: 'src' }, 'gen-1');
    const taskIds = (generated.result as { taskIds: string[] }).taskIds;
    await settle(f.media, taskIds);
    expect(f.calls).toHaveLength(1);
    // Reconstructed services over the same durable state must replay, not charge again.
    const db2 = new Database(path.join(f.root, 'workspace.sqlite'));
    const media2 = new MediaAdapterService(db2, f.registry, f.canvas, f.media.adapter!);
    const image2 = new ImageAppService(f.canvas, media2);
    try {
        const replay = await asCaller(a, () => image2.action(f.project.id, 'image.generate', { nodeId: 'src' }, 0, 'gen-1'));
        expect(replay).toMatchObject({ replayed: true, receiptId: 'gen-1' });
        expect(f.calls).toHaveLength(1);
        const stored = (await f.canvas.read(f.project.id)).state.workbenchImageReceipts as Record<string, { callerScope?: string; receiptId: string }>;
        expect(Object.keys(stored)).toHaveLength(2);
        for (const receipt of Object.values(stored)) expect(receipt.callerScope).toMatch(/^[a-f0-9]{64}$/);
    } finally {
        await media2.close(); db2.close();
    }
});

it('gives a different verified caller an independent claim for the same key and hides foreign receipts', async () => {
    const f = await fixture();
    const a = caller();
    await f.act(a, 'image.create', { canvasId: f.project.id, nodeId: 'src', x: 0, y: 0, config: { prompt: 'lamp' } }, 'create-1');
    const first = await f.act(a, 'image.generate', { nodeId: 'src' }, 'gen-1');
    await settle(f.media, (first.result as { taskIds: string[] }).taskIds);
    const b = caller({ userId: 'user-b' });
    const second = await f.act(b, 'image.generate', { nodeId: 'src' }, 'gen-1');
    expect(second).toMatchObject({ replayed: false, receiptId: 'gen-1' });
    const secondIds = (second.result as { taskIds: string[] }).taskIds;
    expect(secondIds).not.toEqual((first.result as { taskIds: string[] }).taskIds);
    await settle(f.media, secondIds);
    expect(f.calls).toHaveLength(2);
    // Receipt reads are scoped: the foreign caller, another scope and background
    // work see 404 for a receipt that is not theirs, while each owner sees its own.
    await expect(asCaller(a, () => f.image.receipt(f.project.id, 'gen-1'))).resolves.toMatchObject({ receiptId: 'gen-1' });
    await expect(asCaller(b, () => f.image.receipt(f.project.id, 'gen-1'))).resolves.toMatchObject({ receiptId: 'gen-1' });
    await expect(asCaller(caller({ bizId: 'biz-c' }), () => f.image.receipt(f.project.id, 'gen-1'))).rejects.toMatchObject({ status: 404, code: 'IMAGE_RECEIPT_NOT_FOUND' });
    await expect(asCaller(caller({ applicationInstanceId: 'inst-c' }), () => f.image.receipt(f.project.id, 'create-1'))).rejects.toMatchObject({ status: 404, code: 'IMAGE_RECEIPT_NOT_FOUND' });
    await expect(f.image.receipt(f.project.id, 'gen-1')).rejects.toMatchObject({ status: 404, code: 'IMAGE_RECEIPT_NOT_FOUND' });
    await expect(runWithRequestTenant({ teamId: 'team-a', userId: 'user-a' }, () => f.image.receipt(f.project.id, 'gen-1'))).rejects.toMatchObject({ status: 404 });
});

it('conflicts on changed input under the same scope and rejects incomplete identity before storage', async () => {
    const f = await fixture();
    const a = caller();
    await f.act(a, 'image.create', { canvasId: f.project.id, nodeId: 'src', x: 0, y: 0, config: { prompt: 'lamp' } }, 'create-1');
    const before = (await f.canvas.read(f.project.id)).state.workbenchImageReceipts as Record<string, unknown>;
    await expect(asCaller(a, () => f.image.action(f.project.id, 'image.configure', { nodeId: 'src', set: { prompt: 'different' } }, 0, 'create-1')))
        .rejects.toMatchObject({ status: 409, code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    // A verified caller missing an identity field is rejected before any receipt
    // write or dispatch — never silently downgraded to the shared namespace.
    const incomplete = { teamId: 'team-a', bizId: 'biz-a', userId: 'user-a', applicationId: 'app-image', applicationInstanceId: 'inst-a', userVerified: true } as unknown as TenantContext;
    const revision = await f.canvas.revision(f.project.id);
    await expect(asCaller(incomplete, () => f.image.action(f.project.id, 'image.configure', { nodeId: 'src', set: { prompt: 'x' } }, revision, 'k-inc')))
        .rejects.toMatchObject({ status: 503, code: 'MEDIA_CALLER_SCOPE_UNAVAILABLE' });
    const after = (await f.canvas.read(f.project.id)).state.workbenchImageReceipts as Record<string, unknown>;
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(f.calls).toHaveLength(0);
});

it('keeps legacy unscoped receipts working and never lets a verified scope adopt them', async () => {
    const f = await fixture();
    await f.act(caller(), 'image.create', { canvasId: f.project.id, nodeId: 'src', x: 0, y: 0, config: { prompt: 'lamp' } }, 'create-1');
    const input = { nodeId: 'src', set: { prompt: 'legacy' } };
    const first = await f.image.action(f.project.id, 'image.configure', input, await f.canvas.revision(f.project.id), 'raw-9');
    expect(first).toMatchObject({ replayed: false });
    const replay = await f.image.action(f.project.id, 'image.configure', input, 0, 'raw-9');
    expect(replay).toMatchObject({ replayed: true, receiptId: 'raw-9' });
    await expect(asCaller(caller(),()=>f.image.receipt(f.project.id,'raw-9'))).rejects.toMatchObject({status:404});
    // The verified caller with the same raw key does not adopt the legacy claim;
    // it gets its own scoped receipt under an opaque storage key.
    const scoped = await f.act(caller(), 'image.configure', input, 'raw-9');
    expect(scoped).toMatchObject({ replayed: false, receiptId: 'raw-9' });
    const receipts = (await f.canvas.read(f.project.id)).state.workbenchImageReceipts as Record<string, { receiptId: string; callerScope?: string }>;
    expect(receipts['raw-9']).toMatchObject({ receiptId: 'raw-9' });
    expect(receipts['raw-9']!.callerScope).toBeUndefined();
    const scopedKey = Object.keys(receipts).find(k => k.startsWith('irp-') && receipts[k]!.receiptId === 'raw-9');
    expect(scopedKey).toBeTruthy();
    // The scoped receipt stays invisible to unscoped and background readers,
    // while its own caller still reaches it through the raw key.
    await expect(f.image.receipt(f.project.id, scopedKey!)).rejects.toMatchObject({ status: 404 });
    await expect(asCaller(caller(), () => f.image.receipt(f.project.id, 'raw-9'))).resolves.toMatchObject({ receiptId: 'raw-9' });
});

it('returns MEDIA_REQUEST_ID_CONFLICT on a cross-caller delivery task-id collision before dispatch', async () => {
    const f = await fixture();
    await f.canvas.patch(f.project.id, { workbenchImages: [{ id: 'img-target', status: 'generating' }] });
    const uuid = randomUUID();
    const request = { surface: 'image', model: 'designai-gpt-image-2', prompt: 'red', output: 'assets/a.png', clientRequestId: uuid,
        canvasDelivery: { nodeId: 'img-target', kind: 'image', basePath: '', baseVersion: '', fileUrl: `/api/projects/${f.project.id}/files/assets/a.png` } };
    const a = caller();
    const first = await asCaller(a, () => f.media.submit(f.project.id, request));
    expect(first.taskId).toBe(`canvas-${uuid}`);
    const replay = await asCaller(a, () => f.media.submit(f.project.id, request));
    expect(replay).toMatchObject({ taskId: `canvas-${uuid}`, reused: true });
    await expect(asCaller(caller({ userId: 'user-b' }), () => f.media.submit(f.project.id, request)))
        .rejects.toMatchObject({ status: 409, code: 'MEDIA_REQUEST_ID_CONFLICT' });
    // The other caller was never handed the first caller's task, and nothing
    // extra reached the provider.
    await settle(f.media, [first.taskId]);
    await f.media.delivery.reconcile();
    expect(f.calls).toHaveLength(1);
    // Persisted claim ids are scoped hashes; no raw identity or credential is stored.
    const claims = f.db.prepare('SELECT request_id AS id, request_digest AS digest FROM media_task_requests').all() as Array<{ id: string }>;
    expect(claims.some(row => row.id === uuid)).toBe(false);
    expect(claims.every(row => /^mrq-[a-f0-9]{64}$/.test(row.id))).toBe(true);
    const adapterRequests = f.db.prepare('SELECT request_json AS json FROM media_adapter_requests').all() as Array<{ json: string }>;
    for (const row of adapterRequests) {
        expect(row.json).not.toMatch(/bizId|applicationInstanceId|providerInstanceId|userId|sso/i);
    }
});

it('requires a stable request identity for verified generation before catalog or task writes',async()=>{
 const f=await fixture();let catalogCalls=0;f.media.adapter!.catalog=async()=>{catalogCalls++;return catalog;};
 await expect(asCaller(caller(),()=>f.media.submit(f.project.id,{surface:'image',model:'designai-gpt-image-2'}))).rejects.toMatchObject({status:428,code:'MEDIA_IDEMPOTENCY_REQUIRED'});
 expect(catalogCalls).toBe(0);expect(f.calls).toHaveLength(0);expect(f.db.prepare('SELECT count(*) AS n FROM media_tasks').get()).toMatchObject({n:0});
});
it('marks actors only after trusted HTTP verification, never from client identity headers',async()=>{
 const {setVerifiedTenant,tenantOf}=await import('../src/tenant.js');
 const req={get:(key:string)=>key==='x-user-verified'?'true':undefined} as any;
 expect(tenantOf(req).userVerified).toBeUndefined();
 setVerifiedTenant(req,{...VERIFIED} as any);expect(tenantOf(req).userVerified).toBe(true);
});
