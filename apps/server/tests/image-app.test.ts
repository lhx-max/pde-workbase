import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createCanvasServer, type CanvasServer } from '../src/server.js';
import type { MediaAdapter } from '../src/media/adapter-service.js';
import { ImageAppService } from '../src/media/image-app.js';
import { buildHttpCliRequest } from '../src/http-cli.js';
const fixtures: Array<{
    api: CanvasServer;
    server: ReturnType<CanvasServer['app']['listen']>;
    root: string;
}> = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const f of fixtures.splice(0)) {
    await f.api.close();
    await new Promise<void>(r => f.server.close(() => r()));
    await rm(f.root, { recursive: true, force: true });
} });
async function fixture(generate?: MediaAdapter['generate']) {
    const bytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#4a9' } }).png().toBuffer();
    const calls: Record<string, unknown>[] = [];
    const adapter: MediaAdapter = { catalog: async () => ({ providers: [{ id: 'designai' }], image: [{ id: 'designai-gpt-image-2', label: 'GPT', provider: 'designai', caps: ['t2i'] }, { id: 'designai-gemini-image', label: 'Gemini', provider: 'designai', caps: ['t2i'] }], video: [], audio: {}, aspects: ['1:1', '4:3'], videoLengthsSec: [], audioDurationsSec: [] }), config: async () => ({ providers: { designai: { configured: true } } }), generate: async (input) => { calls.push(input.request); return generate ? generate(input) : { path: String(input.request.output), content: bytes, mime: 'image/png' }; } };
    const root = await mkdtemp(path.join(tmpdir(), 'image-app-'));
    const api = createCanvasServer({ dataRoot: root, media: adapter });
    await api.ready;
    const project = api.registry.create({ name: 'Image App', teamId: 'local', createdBy: 'local' });
    const server = api.app.listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    fixtures.push({ api, server, root });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw Error('address');
    const base = `http://127.0.0.1:${address.port}`;
    async function action(name: string, input: Record<string, unknown>, options: {
        key?: string;
        revision?: number;
        team?: string;
        app?: boolean;
    } = {}) {
        const revision = options.revision ?? await api.canvas.revision(project.id);
        const response = await fetch(`${base}/api/apps/image/${options.app ? '' : 'instances/' + project.id + '/'}actions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': options.key ?? crypto.randomUUID(), 'x-team-id': options.team ?? 'local' }, body: JSON.stringify({ input, expectedRevision: revision }) });
        return { status: response.status, body: await response.json() as any };
    }
    async function create(config: Record<string, unknown> = {}) { const r = await action('image.create', { canvasId: project.id, nodeId: 'source', x: 10, y: 20, config: { prompt: 'mint lamp', ...config } }, { app: true }); expect(r.status).toBe(200); return r; }
    async function settle(ids: string[]) { for (const id of ids)
        await api.media.wait(id, AbortSignal.timeout(5000)); await api.media.delivery.reconcile(); await vi.waitFor(async () => { const images = (await api.canvas.read(project.id)).state.workbenchImages as any[]; expect(images.filter(v => ids.includes(v.taskId)).every(v => v.status !== 'generating')).toBe(true); }); }
    return { api, project, base, action, create, settle, calls, bytes };
}
it('discovers strict App actions and persists card configuration via the real CLI request shape', async () => {
    const f = await fixture();
    await f.create();
    const manifest = (await (await fetch(f.base + '/api/apps/image')).json() as any).data;
    expect(manifest.actions.map((v: any) => v.actionId)).toEqual(expect.arrayContaining(['image.configure', 'image.generate', 'image.regenerate', 'image.status', 'image.cancel']));
    const directory = (await (await fetch(f.base + '/api/apps')).json() as any).data.apps;
    expect(directory.find((v: any) => v.appId === 'image').manifest.openEditor.available).toBe(false);
    const file = path.join(fixtures[0]!.root, 'config.json');
    await (await import('node:fs/promises')).writeFile(file, JSON.stringify({ nodeId: 'source', set: { prompt: 'dog', model: 'designai-gemini-image', aspect: '4:3', resolution: '4K', count: 3 } }));
    const revision = await f.api.canvas.revision(f.project.id);
    const request = await buildHttpCliRequest(['apps', 'call', 'image', 'image.configure', '--instance', f.project.id, '--server-url', f.base, '--body-file', file, '--expected-revision', String(revision), '--idempotency-key', 'config-1']);
    expect(new Headers(request.init.headers).get('idempotency-key')).toBe('config-1');
    expect(JSON.parse(String(request.init.body)).expectedRevision).toBe(revision);
    const response = await fetch(request.url, request.init);
    expect(response.status).toBe(200);
    const saved = await f.api.canvas.read(f.project.id);
    expect((saved.state.workbenchTaskDrafts as any).source).toMatchObject({ text: 'dog', models: ['designai-gemini-image'], imageRatio: '4:3', imageResolution: '4K', imageCount: 3 });
    const replay = await f.action('image.configure', { nodeId: 'source', set: { count: 3, prompt: 'dog', resolution: '4K', aspect: '4:3', model: 'designai-gemini-image' } }, { key: 'config-1', revision });
    expect(replay.body.data.replayed).toBe(true);
});
it('generates N real files once, returns durable receipts, and regenerates without replacing existing outputs', async () => {
    const f = await fixture();
    await f.create({ count: 2 });
    const input = { nodeId: 'source' }, revision = await f.api.canvas.revision(f.project.id);
    const generated = await f.action('image.generate', input, { key: 'batch-one', revision });
    expect([200, 202], JSON.stringify(generated.body)).toContain(generated.status);
    const ids = generated.body.data.result.taskIds as string[];
    expect(ids).toHaveLength(2);
    await f.settle(ids);
    expect(f.calls).toHaveLength(2);
    const replay = await new ImageAppService(f.api.canvas, f.api.media).action(f.project.id, 'image.generate', input, revision, 'batch-one');
    expect('replayed' in replay && replay.replayed).toBe(true);
    expect(f.calls).toHaveLength(2);
    const receipt = (await (await fetch(f.base + `/api/apps/image/instances/${f.project.id}/action-receipts/batch-one`)).json() as any).data;
    expect(receipt.status).toBe('succeeded');
    let images = (await f.api.canvas.read(f.project.id)).state.workbenchImages as any[];
    const paths = images.map(v => v.path);
    expect(images.every(v => v.status === 'ready' && v.naturalWidth === 16)).toBe(true);
    const next = await f.action('image.regenerate', { nodeId: 'source', set: { prompt: 'new dog', count: 1, aspect: '4:3' } });
    expect([200, 202], JSON.stringify(next.body)).toContain(next.status);
    await f.settle(next.body.data.result.taskIds);
    images = (await f.api.canvas.read(f.project.id)).state.workbenchImages as any[];
    expect(images).toHaveLength(3);
    expect(images.map(v => v.path)).toEqual(expect.arrayContaining(paths));
    expect(f.calls.at(-1)).toMatchObject({ prompt: 'new dog', aspect: '4:3' });
});
it('rejects stale revisions, invalid settings, changed idempotency bodies and cross-team reads/writes', async () => {
    const f = await fixture();
    const created = await f.create();
    expect((await f.action('image.configure', { nodeId: 'source', set: { count: 5 } })).status).toBe(400);
    expect((await f.action('image.configure', { nodeId: 'source', set: { references: ['https://bad/a.png'] } })).status).toBe(400);
    expect((await f.action('image.configure', { nodeId: 'source', set: { prompt: 'x' } }, { revision: 0 })).status).toBe(409);
    expect((await f.action('image.create', { canvasId: f.project.id, nodeId: 'different', x: 0, y: 0 }, { app: true, key: created.body.data.receiptId })).status).toBe(409);
    expect((await f.action('image.configure', { nodeId: 'source', set: { prompt: 'x' } }, { team: 'other' })).status).toBe(403);
    expect((await fetch(f.base + `/api/apps/image/instances/${f.project.id}/state`, { headers: { 'x-team-id': 'other' } })).status).toBe(403);
    expect(f.calls).toHaveLength(0);
});
it('reports actual provider failure and releases the card for an explicit new attempt', async () => {
    const f = await fixture(async () => { throw new Error('provider unavailable'); });
    await f.create();
    const r = await f.action('image.generate', { nodeId: 'source' });
    await f.settle(r.body.data.result.taskIds);
    const status = await f.action('image.status', { nodeId: 'source' });
    expect(status.body.data.result.outputs[0]).toMatchObject({ status: 'failed', error: 'provider unavailable' });
    expect(f.calls).toHaveLength(1);
    const retry = await f.action('image.regenerate', { nodeId: 'source' });
    expect([200, 202], JSON.stringify(retry.body)).toContain(retry.status);
    await f.settle(retry.body.data.result.taskIds);
    expect(f.calls).toHaveLength(2);
});
it('blocks duplicate active batches and conditionally cancels a task owned by this card', async () => {
    const f = await fixture(input => new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    await f.create();
    const run = await f.action('image.generate', { nodeId: 'source' });
    const taskId = run.body.data.result.taskIds[0];
    expect((await f.action('image.generate', { nodeId: 'source' })).status).toBe(409);
    expect((await f.action('image.cancel', { nodeId: 'missing', taskId })).status).toBe(404);
    const cancel = await f.action('image.cancel', { nodeId: 'source', taskId });
    expect(cancel.body.data.status).toBe('succeeded');
    await f.settle([taskId]);
    expect(f.api.media.get(taskId)?.status).toBe('interrupted');
    expect(f.calls).toHaveLength(1);
});
it('requires an explicit receipt key and revision before writes or provider calls', async () => {
    const f = await fixture();
    const endpoint = f.base + '/api/apps/image/actions/image.create';
    const a = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { canvasId: f.project.id, x: 0, y: 0 } }) });
    expect(a.status).toBe(428);
    expect(f.calls).toHaveLength(0);
});
it('preserves text references when changing image settings and inherits settings from generated result cards', async () => {
    const f = await fixture();
    await f.create();
    const before = await f.api.canvas.read(f.project.id), drafts = before.state.workbenchTaskDrafts as any;
    await f.api.canvas.patch(f.project.id, { workbenchTaskDrafts: { ...drafts, source: { ...drafts.source, attachments: [{ path: 'notes/brief.md', mimeType: 'text/markdown', name: 'Brief', size: 8 }] } } });
    expect((await f.action('image.configure', { nodeId: 'source', set: { count: 1 } })).status).toBe(200);
    expect(((await f.api.canvas.read(f.project.id)).state.workbenchTaskDrafts as any).source.attachments).toMatchObject([{ path: 'notes/brief.md' }]);
    const generated = await f.action('image.generate', { nodeId: 'source', set: { prompt: 'green', aspect: '4:3' } });
    await f.settle(generated.body.data.result.taskIds);
    const resultId = generated.body.data.result.nodeIds[0];
    const status = await f.action('image.status', { nodeId: resultId });
    expect(status.body.data.result.config).toMatchObject({ prompt: 'green', aspect: '4:3', model: 'designai-gpt-image-2' });
});
it('prevents image writes through disabled App entitlement and requires task ownership for cancellation', async () => {
    const f = await fixture();
    await f.create();
    expect((await f.action('image.cancel', { nodeId: 'source', taskId: 'unrelated' })).status).toBe(404);
    const deny = await fetch(f.base + '/api/apps/entitlements', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: '*', appId: 'image', effect: 'deny' }) });
    expect(deny.status).toBe(200);
    expect((await f.action('image.generate', { nodeId: 'source' })).status).toBe(403);
    expect(f.calls).toHaveLength(0);
});
it('rejects direct canvas writes that forge or erase image action receipts',async()=>{
 const f=await fixture();await f.create();
 const response=await fetch(f.base+`/api/projects/${f.project.id}/canvas/state`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({changes:{workbenchImageReceipts:{}},expectedRevision:await f.api.canvas.revision(f.project.id)})});
 expect(response.status).toBe(403);expect(f.calls).toHaveLength(0);
});
it('does not announce success before backend delivery has committed the image to canvas',async()=>{
 const f=await fixture();await f.create();
 const result=await f.action('image.generate',{nodeId:'source'});const key=result.body.data.receiptId;
 await f.settle(result.body.data.result.taskIds);
 const original=f.api.media.snapshot.bind(f.api.media);
 const spy=vi.spyOn(f.api.media,'snapshot').mockImplementation(task=>({...original(task),status:'done',canvasDelivery:{status:'pending',error:null}}));
 try{expect((await new ImageAppService(f.api.canvas,f.api.media).receipt(f.project.id,key)).status).toBe('accepted');}finally{spy.mockRestore();}
});

it('executes image.tool once through the existing queue, preserves the original and keeps generation settings',async()=>{
 const f=await fixture();await f.create({prompt:'original prompt',count:2});
 const generated=await f.action('image.generate',{nodeId:'source',set:{count:1}},{key:'source-generation'});
 await f.settle(generated.body.data.result.taskIds);
 const before=await f.api.canvas.read(f.project.id);
 const originals=before.state.workbenchImages as Array<{id:string;path?:string}>;
 const source=originals.find(image=>image.path)!;expect(source.path).toBeTruthy();
 const draft=JSON.stringify((before.state.workbenchTaskDrafts as Record<string,unknown>).source);
 const input={nodeId:source.id,kind:'multi-angle',params:{mode:'camera',rotation:20,tilt:0,zoom:50}};
 const result=await f.action('image.tool',input,{key:'tool-once',revision:before.revision});
 expect([200,202],JSON.stringify(result.body)).toContain(result.status);
 await f.settle(result.body.data.result.taskIds);
 const replay=await f.action('image.tool',input,{key:'tool-once',revision:before.revision});
 expect(replay.body.data.replayed).toBe(true);expect(f.calls).toHaveLength(2);
 expect(f.calls[1]).toMatchObject({tool:{kind:'multi-angle',source:source.path},images:[source.path]});
 const after=await f.api.canvas.read(f.project.id);
 expect((after.state.workbenchImages as Array<{id:string;path:string}>).find(image=>image.id===source.id)?.path).toBe(source.path);
 expect(JSON.stringify((after.state.workbenchTaskDrafts as Record<string,unknown>).source)).toBe(draft);
 const invalid=await f.action('image.tool',{...input,params:{token:'do-not-persist'}});
 expect(invalid.status).toBe(400);expect(f.calls).toHaveLength(2);
});
