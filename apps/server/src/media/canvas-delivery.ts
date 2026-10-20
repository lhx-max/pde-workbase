import type { Database } from '../storage/database.js';
import path from 'node:path';
import sharp from 'sharp';
import { realpath, stat } from 'node:fs/promises';
import { withCanvasResultHistory } from '@bezier/contracts';
import { CanvasStateService } from '../canvas/state.js';
import { getMediaTask, type MediaTaskRow } from './tasks.js';

type Target = { nodeId: string; kind: 'image' | 'video'; basePath: string; baseVersion: string; fileUrl: string };
type Row = { taskId: string; projectId: string; targetJson: string; status: string };
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.map(object) : [];

/** Durable delivery receipts do not execute or retry a provider. */
export class MediaCanvasDelivery {
  private settling = new Set<string>();
  constructor(private db: Database, private canvas: CanvasStateService,
    private root: (projectId: string) => string | null) {
    db.exec(`CREATE TABLE IF NOT EXISTS media_canvas_deliveries (
      task_id TEXT PRIMARY KEY REFERENCES media_tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT
    )`);
  }

  async accept(task: MediaTaskRow | { id: string; projectId: string; surface?: string; model?: string; startedAt: number }, request: Record<string, any>): Promise<void> {
    const target = object(request.canvasDelivery);
    if (!target.nodeId || !['image', 'video'].includes(target.kind) || target.kind !== task.surface) throw new Error('无效的媒体交付目标');
    const descriptor: Target = { nodeId: String(target.nodeId), kind: target.kind, basePath: String(target.basePath || ''),
      baseVersion: String(target.baseVersion || ''), fileUrl: String(target.fileUrl || '') };
    // URL is a local project-file renderer only, never an external delivery destination.
    const url = new URL(descriptor.fileUrl, 'http://canvas.local');
    if (url.origin !== 'http://canvas.local' || !url.pathname.startsWith(`/api/projects/${encodeURIComponent(task.projectId)}/files/`)) throw new Error('无效的媒体预览地址');
    this.db.prepare('INSERT OR IGNORE INTO media_canvas_deliveries(task_id, project_id, target_json) VALUES (?, ?, ?)')
      .run(task.id, task.projectId, JSON.stringify(descriptor));
    await this.canvas.updateMediaState(task.projectId, state => {
      const key = descriptor.kind === 'video' ? 'workbenchBasicNodes' : 'workbenchImages';
      const nodes = list(state[key]);
      const node = nodes.find(node => node.id === descriptor.nodeId);
      if (!node || (descriptor.kind === 'video' && node.kind !== 'video')) throw new Error('生成目标已删除，未开始执行');
      const marker = object(node.mediaDelivery);
      if (marker.taskId === task.id || marker.taskIds?.includes(task.id)) return state;
      const sameBatch = descriptor.kind === 'image' && descriptor.baseVersion && marker.batchId === descriptor.baseVersion;
      if (marker.status === 'pending' && !sameBatch) throw new Error('目标已有任务执行中，请等待当前任务完成');
      const currentPath = descriptor.kind === 'video' ? node.projectFilePath : node.path;
      const version = descriptor.kind === 'video' ? node.activeVideoResultId : node.replacementRequestId;
      if ((!sameBatch && (currentPath || '') !== descriptor.basePath) || (version || '') !== descriptor.baseVersion) throw new Error('目标版本已变化，未开始执行');
      const patch = descriptor.kind === 'video' ? {
        videoTask: { id: task.id, status: 'running', backendOwned: true, createdAt: task.startedAt,
          model: task.model, aspect: request.aspect, length: request.length, resolution: request.resolution, progress: [] },
      } : { taskId: task.id, status: node.path ? node.status : 'generating', error: undefined,
        mediaRequest: Object.fromEntries(['surface', 'model', 'prompt', 'operation', 'aspect', 'resolution', 'quality', 'image', 'images', 'imageUrl', 'imageUrls', 'output', 'slot', 'lineage']
          .filter(key => request[key] !== undefined).map(key => [key, request[key]])) };
      return { ...state, [key]: nodes.map(item => item.id === node.id ? { ...item, ...patch,
        mediaDelivery: { taskId: task.id, taskIds: [...(sameBatch ? marker.taskIds || [] : []), task.id], batchId: descriptor.baseVersion, status: 'pending' } } : item) };
    });
  }

  async reconcile(): Promise<void> {
    const rows = this.db.prepare("SELECT task_id AS taskId FROM media_canvas_deliveries WHERE status = 'pending'").all() as { taskId: string }[];
    await Promise.all(rows.map(row => this.settle(row.taskId)));
  }

  receipt(taskId: string): { status: string; error: string | null } | undefined {
    return this.db.prepare('SELECT status, error FROM media_canvas_deliveries WHERE task_id = ?').get(taskId) as { status: string; error: string | null } | undefined;
  }

  async assertPendingTarget(taskId: string): Promise<void> {
    const row = this.db.prepare('SELECT project_id AS projectId, target_json AS targetJson FROM media_canvas_deliveries WHERE task_id = ?').get(taskId) as Row | undefined;
    if (!row) throw new Error('媒体交付记录不存在，未提交供应商');
    const target = JSON.parse(row.targetJson) as Target;
    const state = (await this.canvas.read(row.projectId)).state;
    const node = list(state[target.kind === 'video' ? 'workbenchBasicNodes' : 'workbenchImages']).find(node => node.id === target.nodeId);
    const marker = object(node?.mediaDelivery);
    const version = target.kind === 'video' ? node?.activeVideoResultId : node?.replacementRequestId;
    const currentPath = target.kind === 'video' ? node?.projectFilePath : node?.path;
    const sameBatch = target.kind === 'image' && target.baseVersion && marker.batchId === target.baseVersion;
    if (!node || (!marker.taskIds?.includes(taskId) && marker.taskId !== taskId)
      || (version || '') !== target.baseVersion || (!sameBatch && (currentPath || '') !== target.basePath)) {
      throw new Error('目标已删除或版本已变化，未提交供应商');
    }
  }

  async settle(taskId: string): Promise<void> {
    if (this.settling.has(taskId)) return;
    const row = this.db.prepare('SELECT task_id AS taskId, project_id AS projectId, target_json AS targetJson, status FROM media_canvas_deliveries WHERE task_id = ?').get(taskId) as Row | undefined;
    const task = getMediaTask(this.db, taskId);
    if (!row || row.status !== 'pending' || !task) return;
    this.settling.add(taskId);
    try {
      const target = JSON.parse(row.targetJson) as Target;
      if (!['done', 'failed', 'interrupted'].includes(task.status)) {
        if (target.kind === 'video') await this.canvas.updateMediaState(row.projectId, state => {
          const nodes = list(state.workbenchBasicNodes);
          const node = nodes.find(node => node.id === target.nodeId);
          if (node?.videoTask?.id !== taskId || JSON.stringify(node.videoTask.progress) === JSON.stringify(task.progress)) return state;
          return { ...state, workbenchBasicNodes: nodes.map(item => item === node ? {
            ...item, videoTask: { ...item.videoTask, progress: task.progress },
          } : item) };
        });
        return;
      }
      const file = object(task.file);
      let output = typeof file.name === 'string' ? file.name : '';
      let failure = task.error?.message || '';
      if (task.status !== 'done' && !failure) failure = '媒体生成中断';
      let dimensions: { naturalWidth?: number; naturalHeight?: number } = {};
      if (task.status === 'done') {
        const root = this.root(row.projectId);
        if (!root || !output || file.stub || file.intentionalStub || file.usedStubFallback) failure = '任务未返回真实媒体文件';
        else {
          try {
            const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path.resolve(root, output))]);
            if (!realFile.startsWith(`${realRoot}${path.sep}`) || !(await stat(realFile)).isFile() || !(await stat(realFile)).size) failure = '媒体文件不可用';
            else if (target.kind === 'image') {
              const metadata = await sharp(realFile, { limitInputPixels: 80_000_000 }).metadata();
              dimensions = { naturalWidth: metadata.width, naturalHeight: metadata.height };
            }
          } catch { failure = '媒体文件不可用'; }
        }
      }
      let status = 'delivered';
      await this.canvas.updateMediaState(row.projectId, state => {
        const key = target.kind === 'video' ? 'workbenchBasicNodes' : 'workbenchImages';
        const nodes = list(state[key]);
        const node = nodes.find(node => node.id === target.nodeId);
        const marker = object(node?.mediaDelivery);
        if (marker.completedTaskIds?.includes(taskId)) return state;
        const rejectedPlaceholder = node && !node.path && node.taskId === taskId && !marker.taskId && task.status === 'failed';
        if (!node || (!rejectedPlaceholder && marker.taskId !== taskId && !marker.taskIds?.includes(taskId))) {
          status = 'conflict';
          // Deleting the derivative must not leave its source permanently busy.
          if (target.kind === 'image' && nodes.some(item => item.cutoutTaskId === taskId)) {
            return { ...state, [key]: nodes.map(item => item.cutoutTaskId === taskId ? { ...item, cutoutTaskId: undefined } : item) };
          }
          return state;
        }
        const currentPath = target.kind === 'video' ? node.projectFilePath : node.path;
        const version = target.kind === 'video' ? node.activeVideoResultId : node.replacementRequestId;
        const sameBatch = target.kind === 'image' && target.baseVersion && marker.batchId === target.baseVersion;
        if ((!sameBatch && (currentPath || '') !== target.basePath) || (version || '') !== target.baseVersion) {
          status = 'conflict'; failure = '目标版本已变化，生成结果保留在项目文件中，未覆盖';
        }
        const remaining = (marker.taskIds || []).filter((id: string) => id !== taskId);
        let next: Record<string, any> = { ...node, mediaDelivery: { ...marker, taskIds: remaining,
          completedTaskIds: [...(marker.completedTaskIds || []), taskId], status: remaining.length ? 'pending' : failure ? 'failed' : 'delivered', error: failure || undefined } };
        if (target.kind === 'video') {
          const oldTask = object(node.videoTask);
          if (oldTask.id !== taskId) { status = 'conflict'; return state; }
          next = { ...next, videoTask: { ...oldTask, status: failure || task.status !== 'done' ? 'failed' : 'done',
            progress: task.progress, error: failure || undefined, ...(failure ? {} : { path: output }) } };
          if (!failure && task.status === 'done') {
            const result = { id: taskId, path: output, createdAt: task.startedAt, model: task.model,
              aspect: oldTask.aspect, length: oldTask.length, resolution: oldTask.resolution };
            next = { ...next, projectFilePath: output, sourceMime: 'video/mp4', activeVideoResultId: taskId,
              videoResults: [...list(node.videoResults).filter(item => item.id !== taskId), result] };
          }
        } else if (!failure && task.status === 'done') {
          const url = new URL(target.fileUrl, 'http://canvas.local');
          url.pathname = `/api/projects/${encodeURIComponent(row.projectId)}/files/${output.split('/').map(encodeURIComponent).join('/')}`;
          const historySource = node.path ? next : { ...next, src: undefined, naturalWidth: undefined, naturalHeight: undefined };
          next = withCanvasResultHistory(historySource, { ...dimensions, path: output, src: `${url.pathname}${url.search}`, status: 'ready', error: undefined,
            name: output.split('/').at(-1), cutoutTaskId: undefined }, ['path', 'src', 'naturalWidth', 'naturalHeight']) as typeof next;
        } else next = { ...next, status: node.path ? node.status : 'failed', error: failure || '媒体生成中断', cutoutTaskId: undefined };
        return { ...state, [key]: nodes.map(item => item.id === node.id ? next
          : node.cutoutSourceImageId === item.id && item.cutoutTaskId === taskId ? { ...item, cutoutTaskId: undefined } : item) };
      });
      this.db.prepare('UPDATE media_canvas_deliveries SET status = ?, error = ? WHERE task_id = ?')
        .run(status, failure || null, taskId);
    } finally { this.settling.delete(taskId); }
  }
}
