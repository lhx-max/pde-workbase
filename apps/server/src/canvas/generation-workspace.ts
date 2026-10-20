import type { CanvasArtifactGenerationBinding, CanvasTextGenerationBinding } from '@bezier/contracts';
import {
  canvasArtifactTargetDigest,
  prepareCanvasArtifactWorkspace,
  prepareCanvasTextWorkspace,
  type CanvasArtifactWorkspace,
  type CanvasWorkingCopy,
} from './artifact-workspace.js';

export interface CanvasGenerationWorkspaceInput {
  runtimeDataDir: string;
  runId: string;
  projectId: string | null | undefined;
  projectRoot: string | null | undefined;
  artifact?: CanvasArtifactGenerationBinding | undefined;
  text?: CanvasTextGenerationBinding | undefined;
  nodes: unknown;
  /** References have already passed the request's project-path authorization. */
  references: string[];
  requestedReferenceCount: number;
}

/** Business ownership and candidate files are independent of Agent/transport.
 * The caller must enforce host containment before spawning any selected runtime.
 * Only the daemon's version-aware delivery service may publish from this copy.
 */
export function prepareCanvasGenerationWorkspace(input: CanvasGenerationWorkspaceInput): {
  workspace: CanvasWorkingCopy;
  artifact: CanvasArtifactWorkspace | null;
} {
  if (!input.projectId || !input.projectRoot) throw new Error('画布生成需要有效的项目工作目录');
  if (input.references.length !== input.requestedReferenceCount) throw new Error('生成参考文件缺失或越界，未执行');
  const binding = input.artifact ?? input.text;
  if (!binding) throw new Error('画布生成缺少目标绑定');
  const node = Array.isArray(input.nodes)
    ? input.nodes.find((value: Record<string, unknown>) => value?.id === binding.nodeId) as Record<string, unknown> | undefined
    : undefined;
  if (!node || (input.artifact && node.kind !== 'page')) throw new Error('生成目标卡片已不存在，未执行');
  const references = [...new Set([...input.references,
    ...(typeof node.projectFilePath === 'string' && node.projectFilePath ? [node.projectFilePath] : [])])];
  const common = { runtimeDataDir: input.runtimeDataDir, projectRoot: input.projectRoot, runId: input.runId, references };
  if (input.artifact) {
    const artifact = prepareCanvasArtifactWorkspace({ ...common, outputPath: input.artifact.outputPath ?? '',
      target: { nodeId: binding.nodeId, requestId: binding.requestId, digest: canvasArtifactTargetDigest(node) } });
    return { workspace: artifact, artifact };
  }
  return { workspace: prepareCanvasTextWorkspace(common), artifact: null };
}
