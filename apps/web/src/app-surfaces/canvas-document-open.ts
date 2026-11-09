import { canvasTextPath } from '@bezier/contracts';

export interface CanvasDocumentOpenRequest {
  nodeId?: string;
  path: string;
  content: string;
  preferContent?: boolean;
}

/** Opening is not an edit. Cached card text is never a write precondition. */
export async function readOrSeedCanvasDocument(canvasId: string, request: CanvasDocumentOpenRequest, headers: HeadersInit): Promise<{ content: string; seeded: boolean }> {
  const base = `/api/apps/canvas/instances/${encodeURIComponent(canvasId)}`;
  const file = `${base}/files?path=${encodeURIComponent(request.path)}`;
  const read = async (url: string) => {
    const response = await fetch(url, { headers, cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; error?: { message?: string; code?: string } };
    if (!response.ok) throw Object.assign(new Error(body.error?.message ?? `画布正文读取失败（HTTP ${response.status}）`), { status: response.status, code: body.error?.code });
    if (!body.data) throw new Error('画布未返回有效正文状态，已停止打开以保护草稿');
    return body.data;
  };
  const contentOf = (body: Record<string, unknown>) => {
    if (typeof body.content !== 'string') throw new Error('画布未返回正文，未把读取失败当作空文档');
    return body.content;
  };
  try {
    return { content: contentOf(await read(file)), seeded: false };
  } catch (cause) {
    if ((cause as { status?: number; code?: string }).status !== 404 || (cause as { code?: string }).code !== 'CANVAS_FILE_NOT_FOUND') throw cause;
  }
  // A missing mirror can be materialized from persisted node text, but never
  // from the caller's possibly stale/unsaved text. Capture revision BEFORE the
  // second absence check so any intervening canvas write makes PUT fail closed.
  const snapshot = await read(`${base}/state`);
  if (typeof snapshot.revision !== 'number' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('画布缺少可校验版本，未创建文件；卡片草稿已保留');
  try {
    return { content: contentOf(await read(file)), seeded: false };
  } catch (cause) {
    if ((cause as { status?: number; code?: string }).status !== 404 || (cause as { code?: string }).code !== 'CANVAS_FILE_NOT_FOUND') throw cause;
  }
  const state = snapshot.state as { workbenchBasicNodes?: Array<{ id?: string; kind?: string; text?: string; projectFilePath?: string }> } | undefined;
  const node = state?.workbenchBasicNodes?.find(item => item.id === request.nodeId && item.kind === 'text');
  if (!request.nodeId || typeof node?.text !== 'string') throw new Error('卡片草稿尚未保存为可验证的画布节点，请先保存画布再打开；草稿未被覆盖');
  const nodePath = node.projectFilePath || canvasTextPath(request.nodeId);
  if (nodePath !== request.path) throw new Error('卡片文件位置已变化，未创建旧路径文件；请重新打开，草稿已保留');
  const writeHeaders = new Headers(headers);
  writeHeaders.set('content-type', 'application/json');
  const response = await fetch(file, { method: 'PUT', headers: writeHeaders,
    body: JSON.stringify({ content: node.text, nodeId: request.nodeId, expectedRevision: snapshot.revision, baseContent: node.text }),
  });
  const body = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `画布已发生变化，未创建正文文件（HTTP ${response.status}）；卡片草稿已保留`);
  if (!body.data) throw new Error('画布文件保存结果缺失，请检查同步状态；卡片草稿已保留');
  return { content: contentOf(body.data), seeded: true };
}

/** Returning the observed remote text would make BasicCanvasNode.onPatch turn
 * a read-only open into a write, possibly overwriting typing during the await. */
export function preserveCanvasOpenDraft(request: CanvasDocumentOpenRequest): { content: string } {
  return { content: request.content };
}
