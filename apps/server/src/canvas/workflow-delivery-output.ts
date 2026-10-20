import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowArtifactKind, WorkflowArtifactFile, WorkflowMaterializedContent } from '@bezier/contracts';
import { workflowFileVersions } from '../workflows/artifact-versions.js';

/** Resolve the files actually attached to the completed canvas artifact. */
export async function workflowDeliveryOutput(root: string, kind: WorkflowArtifactKind, nodeId: string, state: Record<string, unknown>): Promise<WorkflowMaterializedContent> {
  const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
  const nodes = kind === 'image'
    ? records(state.workbenchImages).filter(item => item.id === nodeId || String(item.id).startsWith(`${nodeId}-image-`))
    : records(state.workbenchBasicNodes).filter(item => item.id === nodeId);
  const paths = nodes.map(item => kind === 'image' ? item.path : item.projectFilePath);
  if (!paths.length || paths.some(file => typeof file !== 'string' || !file)) throw new Error('产物缺少可传递的实际文件');
  const files = await workflowFileVersions(root, paths.map(file => ({ kind: 'project-file', path: file as string }))) as WorkflowArtifactFile[];
  let content = '';
  if (kind === 'text' || kind === 'page' || kind === 'presentation') {
    const bytes = await readFile(path.join(root, files[0]!.path));
    if (createHash('sha256').update(bytes).digest('hex') !== files[0]!.sha256) throw new Error('读取产物时文件已变化');
    content = bytes.toString('utf8');
  }
  return { content, files };
}
