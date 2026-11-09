import { CanvasStateError } from './errors.js';
import { records } from './operations.js';

const active = new Set(['pending', 'queued', 'running', 'generating', 'starting', 'processing', 'submitting']);
const transientKeys = new Set(['generation', 'generationProgress', 'videoTask', 'videoSubmitRequestId', 'mediaDelivery', 'mediaRequest', 'replacementRequestId', 'requestId', 'runId', 'stepRunId', 'agentStepRunId', 'taskId', 'taskIds', 'cutoutTaskId', 'workbenchMediaSubmissions', 'workbenchTaskDrafts']);
const populated = (value: unknown) => !!value && typeof value === 'object' && Object.keys(value).length > 0;
const businessOwned = (node: Record<string, unknown>) => node.source || node.storyboardVideoSource || node.workflowRunId
  || node.sourceInstanceId || node.embeddedInSource || node.ordinaryGlowSyncGroupId || node.compose;

/** Checkpoint scope is authored ordinary canvas state. Business containers and
 * live execution require their own recovery protocol, never a generic rewind. */
export function assertCanvasSnapshotReady(state: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(state)) {
    if (/workflow|instances|clip/i.test(key) && populated(value))
      throw new CanvasStateError(400, 'CANVAS_SNAPSHOT_UNSUPPORTED', '含工作流或剪辑的画布暂不支持状态快照');
  }
  if (populated(state.workbenchMediaSubmissions))
    throw new CanvasStateError(409, 'CANVAS_SNAPSHOT_BUSY', '还有待提交的媒体任务，请等待完成');
  for (const node of records(state.workbenchBasicNodes)) {
    if (!['text', 'page', 'sketch', 'storyboard', 'video'].includes(String(node.kind)) || businessOwned(node))
      throw new CanvasStateError(400, 'CANVAS_SNAPSHOT_UNSUPPORTED', '含业务专属卡片的画布需要专用恢复适配器');
  }
  for (const node of records(state.workbenchImages)) {
    if (businessOwned(node))
      throw new CanvasStateError(400, 'CANVAS_SNAPSHOT_UNSUPPORTED', '含业务专属图片的画布需要专用恢复适配器');
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (active.has(String(item.status))) throw new CanvasStateError(409, 'CANVAS_SNAPSHOT_BUSY', '画布任务执行或交付中，请等待完成后再保存或恢复快照');
    Object.values(item).forEach(visit);
  };
  visit(state);
}

/** Keep authored content and references, discard execution identities. A
 * restored checkpoint must not poll, resubmit, or adopt an old task result. */
export function canvasSnapshotState(state: Record<string, unknown>): Record<string, unknown> {
  // Older cards keep their only output on a completed execution object. Move
  // that output into authored bindings before removing execution identities.
  const normalized = { ...state };
  if (Array.isArray(state.workbenchBasicNodes)) normalized.workbenchBasicNodes = records(state.workbenchBasicNodes).map(node => {
    const task = node.videoTask as Record<string, unknown> | undefined;
    const generation = node.generation as Record<string, unknown> | undefined;
    if (node.kind === 'video' && task?.status === 'done' && typeof task.path === 'string' && task.path) {
      const results = [...records(node.videoResults)];
      const { id: _id, status: _status, progress: _progress, ...output } = task;
      const existing = results.find(result => result.path === task.path);
      let resultId = existing?.id || `snapshot-video-${node.id}`;
      for (let suffix = 1; !existing && results.some(result => result.id === resultId); suffix++) resultId = `snapshot-video-${node.id}-${suffix}`;
      const videoResults = existing ? results : [...results, { ...output, id: resultId, createdAt: task.createdAt ?? Number.MAX_SAFE_INTEGER }];
      videoResults.sort((a,b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
      const selected = videoResults.find(result => result.id === node.activeVideoResultId) ?? videoResults.at(-1)!;
      return { ...node, projectFilePath: node.projectFilePath || selected.path, activeVideoResultId: selected.id, videoResults };
    }
    if (node.kind === 'page' && !node.projectFilePath && generation?.status === 'succeeded' && typeof generation.previewPath === 'string')
      return { ...node, projectFilePath: generation.previewPath };
    return node;
  });
  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copy);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !transientKeys.has(key)).map(([key, item]) => [key, copy(item)]));
  };
  return copy(normalized) as Record<string, unknown>;
}
