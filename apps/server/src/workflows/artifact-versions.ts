import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { JsonValue } from '@bezier/contracts';

/** Pin explicit project-file references and output receipts; never infer paths from prose. */
export async function workflowFileVersions(projectRoot: string, value: JsonValue, verifyOnly = false): Promise<JsonValue> {
  const root = await realpath(projectRoot);
  const digest = async (item: Record<string, JsonValue>): Promise<Record<string, JsonValue>> => {
    if (typeof item.path !== 'string' || !item.path || path.isAbsolute(item.path) || item.path.includes('\\')) throw new Error('工作流文件必须使用项目相对路径');
    const relative = path.normalize(item.path);
    if (relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('工作流文件超出项目范围');
    const resolved = await realpath(path.join(root, relative));
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('工作流文件超出项目范围');
    const file = await open(resolved, 'r');
    let sha256: string;
    let bytes: number;
    try {
      const before = await file.stat();
      if (!before.isFile()) throw new Error('工作流输入不是文件');
      const hash = createHash('sha256');
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
      const after = await file.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`文件读取时发生变化：${item.path}`);
      sha256 = hash.digest('hex'); bytes = after.size;
    } finally { await file.close(); }
    if ((typeof item.sha256 === 'string' && item.sha256 !== sha256) || (verifyOnly && typeof item.sha256 !== 'string')) {
      throw new Error(`工作流文件版本不可用：${item.path}，请从来源步骤重新执行`);
    }
    return { ...item, sha256, bytes };
  };
  const walk = async (item: JsonValue): Promise<JsonValue> => {
    if (Array.isArray(item)) return Promise.all(item.map(walk));
    if (item && typeof item === 'object') {
      if (item.kind === 'project-file') return digest(item);
      return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, child]) => [key, await walk(child)])));
    }
    if (typeof item !== 'string' || !item.includes('<workflow-artifacts>')) return item;
    let output = ''; let cursor = 0;
    for (const match of item.matchAll(/<workflow-artifacts>([\s\S]*?)<\/workflow-artifacts>/g)) {
      const payload: unknown = JSON.parse(match[1]!);
      if (!payload || typeof payload !== 'object' || !('artifacts' in payload) || !Array.isArray(payload.artifacts)) throw new Error('产物回执格式错误');
      const artifacts = await Promise.all(payload.artifacts.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('产物回执格式错误');
        return digest(entry as Record<string, JsonValue>);
      }));
      output += item.slice(cursor, match.index) + `<workflow-artifacts>${JSON.stringify({ ...payload, artifacts })}</workflow-artifacts>`;
      cursor = match.index! + match[0].length;
    }
    return output + item.slice(cursor);
  };
  return walk(value);
}
