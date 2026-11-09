import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {Database} from '../../src/storage/database.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { CanvasStateService } from '../../src/canvas/state.js';
import { MediaCanvasDelivery } from '../../src/media/canvas-delivery.js';
import { insertMediaTask, migrateMediaTasks, updateMediaTask } from '../../src/media/tasks.js';

let db: Database;
let root: string;
let canvas: CanvasStateService;
let delivery: MediaCanvasDelivery;
const target = (kind = 'image', basePath = '', baseVersion = '') => ({
  nodeId: 'target', kind, basePath, baseVersion, fileUrl: '/api/projects/p/files/output.png',
});
const nodes = async (kind = 'image') => (await canvas.read('p')).state[kind === 'image' ? 'workbenchImages' : 'workbenchBasicNodes'] as any[];
async function accept(id = 'one', kind = 'image', basePath = '', baseVersion = '') {
  const task = insertMediaTask(db, { id, projectId: 'p', surface: kind, model: 'fixture' });
  await delivery.accept(task, { canvasDelivery: target(kind, basePath, baseVersion), aspect: '16:9' });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'media-delivery-'));
  db = new Database(':memory:');
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p')");
  migrateMediaTasks(db);
  canvas = new CanvasStateService(() => root);
  delivery = new MediaCanvasDelivery(db, canvas, () => root);
  await canvas.updateMediaState('p', () => ({ workbenchImages: [{ id: 'target', x: 23, status: 'generating' }],
    workbenchBasicNodes: [{ id: 'target', kind: 'video', x: 42 }] }));
  await sharp({ create: { width: 4, height: 2, channels: 3, background: '#fff' } }).png().toFile(path.join(root, 'output.png'));
});
afterEach(async () => { vi.restoreAllMocks(); db.close(); await rm(root, { recursive: true, force: true }); });

it('delivers without a mounted page, probes dimensions and replays without duplicate history', async () => {
  await accept();
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  await delivery.reconcile();
  expect((await nodes())[0]).toMatchObject({ path: 'output.png', status: 'ready', naturalWidth: 4, naturalHeight: 2, x: 23 });
  const saved = await canvas.read('p');
  // Crash between atomic canvas write and receipt acknowledgement.
  db.prepare("UPDATE media_canvas_deliveries SET status = 'pending'").run();
  await new MediaCanvasDelivery(db, canvas, () => root).reconcile();
  expect(await canvas.read('p')).toEqual(saved);
});
it('delivers an authoritative cloud image without requiring a local project file', async () => {
  const bytes = await sharp({create:{width:7,height:5,channels:3,background:'#fff'}}).png().toBuffer();
  const remote = { read: vi.fn(async () => ({buffer:bytes,file:{name:'cloud-only.png',size:bytes.length,mtime:1,kind:'image' as const,mime:'image/png'}})), write:vi.fn(), list:vi.fn() };
  delivery = new MediaCanvasDelivery(db,canvas,()=>null,remote);
  await accept();
  updateMediaTask(db,'one',{status:'done',file:{name:'cloud-only.png'}});
  await delivery.reconcile();
  expect((await nodes())[0]).toMatchObject({path:'cloud-only.png',status:'ready',naturalWidth:7,naturalHeight:5});
  expect(remote.read).toHaveBeenCalledWith('p','cloud-only.png');
});
it('recovers video completion after service restart, retaining progress and existing results', async () => {
  await accept('one', 'video');
  updateMediaTask(db, 'one', { status: 'running', progress: ['upstream accepted'] });
  await delivery.reconcile();
  expect((await nodes('video'))[0].videoTask.progress).toEqual(['upstream accepted']);
  await writeFile(path.join(root, 'output.mp4'), Buffer.from('local video fixture'));
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.mp4' } });
  await new MediaCanvasDelivery(db, canvas, () => root).reconcile();
  expect((await nodes('video'))[0]).toMatchObject({ projectFilePath: 'output.mp4', activeVideoResultId: 'one', x: 42,
    videoTask: { status: 'done', backendOwned: true }, videoResults: [{ id: 'one', path: 'output.mp4' }] });
});
it('never recreates a deleted target', async () => {
  await accept();
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: [] }));
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  await delivery.reconcile();
  expect(await nodes()).toEqual([]);
});
it('clears the cutout source busy marker even when its derivative was deleted', async () => {
  await accept();
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: [{ id: 'source', path: 'source.png', cutoutTaskId: 'one' }] }));
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  await delivery.reconcile();
  expect(await nodes()).toEqual([{ id: 'source', path: 'source.png' }]);
});
it('does not dispatch a queued request after target deletion', async () => {
  await accept();
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: [] }));
  await expect(delivery.assertPendingTarget('one')).rejects.toThrow('未提交供应商');
});
it('does not overwrite a selected version within a replacement batch', async () => {
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: [{ id: 'target', path: 'original.png', replacementRequestId: 'batch' }] }));
  await accept('one', 'image', 'original.png', 'batch');
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: (state.workbenchImages as any[]).map(n => ({ ...n, replacementRequestId: undefined })) }));
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  await delivery.reconcile();
  expect((await nodes())[0].path).toBe('original.png');
});
it('retains the previous video on an interrupted upstream task', async () => {
  await canvas.updateMediaState('p', state => ({ ...state, workbenchBasicNodes: [{ id: 'target', kind: 'video', projectFilePath: 'old.mp4', activeVideoResultId: 'old' }] }));
  await accept('one', 'video', 'old.mp4', 'old');
  updateMediaTask(db, 'one', { status: 'interrupted', error: { message: '上游状态未知，未确认取消' } });
  await delivery.reconcile();
  expect((await nodes('video'))[0]).toMatchObject({ projectFilePath: 'old.mp4', activeVideoResultId: 'old', videoTask: { status: 'failed', error: '上游状态未知，未确认取消' } });
});
it('preserves a manually selected version and records a delivery conflict', async () => {
  await accept();
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: (state.workbenchImages as any[]).map(n => ({ ...n, path: 'selected.png', status: 'ready' })) }));
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  await delivery.reconcile();
  expect((await nodes())[0]).toMatchObject({ path: 'selected.png', status: 'ready' });
  expect(db.prepare('SELECT status FROM media_canvas_deliveries').get()).toEqual({ status: 'conflict' });
});
it('retries storage delivery failures without submitting another provider task', async () => {
  await accept();
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  vi.spyOn(canvas, 'updateMediaState').mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(delivery.reconcile()).rejects.toThrow('disk unavailable');
  expect(db.prepare('SELECT status FROM media_canvas_deliveries').get()).toEqual({ status: 'pending' });
  await delivery.reconcile();
  expect((await nodes())[0].path).toBe('output.png');
  expect(db.prepare('SELECT count(*) AS n FROM media_tasks').get()).toEqual({ n: 1 });
});
it.each([{ name: 'missing.png' }, { name: '../escape.png' }, { name: 'output.png', intentionalStub: true }])('rejects unusable output %j', async file => {
  await accept();
  updateMediaTask(db, 'one', { status: 'done', file });
  await delivery.reconcile();
  expect((await nodes())[0]).toMatchObject({ status: 'failed' });
  expect((await nodes())[0].path).toBeUndefined();
});
it('isolates same-target tasks but supports multiple results in one explicit replacement batch', async () => {
  await canvas.updateMediaState('p', state => ({ ...state, workbenchImages: [{ id: 'target', path: 'original.png', replacementRequestId: 'batch' }] }));
  await accept('one', 'image', 'original.png', 'batch');
  await accept('two', 'image', 'original.png', 'batch');
  const unrelated = insertMediaTask(db, { id: 'other', projectId: 'p', surface: 'image' });
  await expect(delivery.accept(unrelated, { canvasDelivery: target() })).rejects.toThrow('执行中');
  updateMediaTask(db, 'one', { status: 'done', file: { name: 'output.png' } });
  await delivery.settle('one');
  await sharp(path.join(root, 'output.png')).toFile(path.join(root, 'second.png'));
  updateMediaTask(db, 'two', { status: 'done', file: { name: 'second.png' } });
  await delivery.settle('two');
  expect((await nodes())[0].resultHistory.map((item: any) => item.path)).toEqual(['original.png', 'output.png', 'second.png']);
});
