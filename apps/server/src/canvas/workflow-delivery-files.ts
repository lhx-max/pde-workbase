import { open, realpath, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowArtifactKind } from '@bezier/contracts';
import { CanvasStateError } from './errors.js';

/** Only the explicit final receipt is authoritative; arbitrary prose paths are not. */
export async function workflowDeliveryFiles(projectRoot: string, input: {
  nodeId: string; kind: WorkflowArtifactKind; content: string; image?: { count?: number };
}): Promise<Array<{ path: string; text?: string }>> {
  const receipts = [...input.content.matchAll(/<workflow-artifacts>([\s\S]*?)<\/workflow-artifacts>/g)].flatMap(match => {
    try {
      const payload = JSON.parse(match[1]!);
      if (!Array.isArray(payload.artifacts)) throw new Error();
      return payload.artifacts as Array<{ nodeId?: string; kind?: string; path?: string }>;
    } catch { throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '产物回执格式错误，未写入画布'); }
  }).filter(item => item && item.nodeId === input.nodeId);
  if (!receipts.length) {
    if (input.kind === 'text' && input.content.trim() && !input.content.includes('<workflow-artifacts>')) return [];
    throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_MISSING', '没有实际产物文件回执，不能将提示词或空卡交付到画布');
  }
  const expectedCount = input.kind === 'image' ? input.image?.count ?? 1 : 1;
  if (receipts.length !== expectedCount) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_COUNT', `需要 ${expectedCount} 个产物文件，实际收到 ${receipts.length} 个`);
  const root = await realpath(projectRoot);
  const seen = new Set<string>();
  return Promise.all(receipts.map(async item => {
    if (item.kind !== input.kind || typeof item.path !== 'string' || !item.path.trim() || path.isAbsolute(item.path) || item.path.includes('\\')) {
      throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '产物类型或项目相对路径不正确');
    }
    const relative = path.posix.normalize(item.path);
    if (relative === '..' || relative.startsWith('../') || seen.has(relative)) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '产物路径越界或重复');
    seen.add(relative);
    const resolved = await realpath(path.join(root, relative)).catch(() => { throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_MISSING', `产物文件不存在：${relative}`); });
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '产物文件不属于当前项目');
    const info = await stat(resolved);
    if (!info.isFile() || info.size === 0) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '产物文件为空或不是文件');
    const file = await open(resolved, 'r');
    const header = Buffer.alloc(64);
    try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
    if (input.kind === 'image') {
      const valid = (relative.match(/\.png$/i) && header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
        || (relative.match(/\.jpe?g$/i) && header[0] === 255 && header[1] === 216 && header[2] === 255)
        || (relative.match(/\.webp$/i) && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP')
        || (relative.match(/\.gif$/i) && /^GIF8[79]a/.test(header.toString('ascii', 0, 6)));
      if (!valid) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '图片文件类型不正确，不能用文本充当图片');
    } else if (input.kind === 'video') {
      const valid = (/\.(mp4|mov|m4v)$/i.test(relative) && header.toString('ascii', 4, 8) === 'ftyp')
        || (/\.webm$/i.test(relative) && header.subarray(0, 4).equals(Buffer.from([26,69,223,163])));
      if (!valid) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '视频文件类型不正确，不能用文本充当视频');
    } else {
      if (info.size > 10 * 1024 * 1024) throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '文本或 HTML 产物超过 10 MB');
      const text = await readFile(resolved, 'utf8');
      if (input.kind === 'text' ? !/\.(md|markdown|txt)$/i.test(relative) || !text.trim() : !/\.html?$/i.test(relative) || !/<html[\s>]/i.test(text) || !/<body[\s>]/i.test(text)) {
        throw new CanvasStateError(400, 'WORKFLOW_ARTIFACT_INVALID', '产物文件格式与目标组件不匹配');
      }
      return { path: relative, text };
    }
    return { path: relative };
  }));
}
