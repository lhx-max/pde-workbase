import type { CanvasImageEditorTarget } from '@bezier/contracts';
import { platformFetchWithContext, type CanvasHostContext } from './api-base';
import { flushCanvasForProject } from './canvas-persistence';

/** Opening is read-only. Image-App creation, storage and detail UI are App-owned. */
export async function openCanvasImageEditor(
  context: CanvasHostContext,
  nodeId: string,
  open: ((target: CanvasImageEditorTarget) => Promise<void>) | undefined,
  isCurrent: () => boolean,
): Promise<void> {
  if (!open) throw new Error('图片模式尚未接入，当前图片和画布内编辑不受影响');
  await flushCanvasForProject(context.projectId);
  if (!isCurrent()) throw new Error('画布已切换，请重新打开图片模式');
  const response = await platformFetchWithContext(context, `/api/apps/canvas/instances/${encodeURIComponent(context.projectId)}/open-editor`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId }),
  });
  const body = await response.json().catch(() => null) as { data?: CanvasImageEditorTarget; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `无法打开图片模式（${response.status}）`);
  const target = body?.data;
  if (!target || target.appId !== 'image' || target.kind !== 'image' || target.nodeId !== nodeId
    || target.canvasInstanceId !== context.projectId || typeof target.filePath !== 'string' || !target.filePath
    || typeof target.name !== 'string' || typeof target.endpoint !== 'string'
    || !Number.isSafeInteger(target.revision) || target.revision < 0) throw new Error('图片模式返回的实例信息不完整，未打开其他图片');
  const endpoint = new URL(target.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('图片 App 地址无效');
  if (!isCurrent()) throw new Error('画布已切换，请重新打开图片模式');
  await open(target);
}
