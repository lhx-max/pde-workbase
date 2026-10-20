import type { CanvasTextGenerationResult } from '../platform/agent-bridge';
import { withCanvasResultHistory } from '@bezier/contracts';
import type { CanvasBasicNode } from './BasicCanvasNode';
import { createDefaultStoryboardPlan, parseStoryboardGenerationResult } from './storyboard-card';
import { canvasTextPatchWithCopyOnWrite } from './model/canvas-text-files';
import { cr } from '../locales/canvas-remainder';

/** Apply terminal chat deliveries without allowing stale requests to cross nodes. */
export function applyCanvasTextGenerationResults(
  nodes: CanvasBasicNode[],
  results: CanvasTextGenerationResult[],
): CanvasBasicNode[] {
  if (results.length === 0) return nodes;
  const resultsByRequest = new Map(
    results.map(result => [result.binding.requestId, result]),
  );
  let changed = false;
  const next = nodes.map(node => {
    if ((node.kind !== 'text' && node.kind !== 'storyboard') || !node.generation) return node;
    // A request is applied exactly once. FileWorkspace retains terminal chat
    // deliveries so a remount can recover a still-running card, but replaying
    // the same successful storyboard would mint fresh shot ids on every render.
    const result = resultsByRequest.get(node.generation.requestId);
    if (!result || result.binding.nodeId !== node.id) return node;
    const recoveredTextCandidate = node.generation.status === 'failed'
      && result.binding.outputKind === 'text' && result.status === 'succeeded';
    const enrichCandidateRun = node.generation.candidateText && !node.generation.runId && result.runId;
    if (node.generation.status !== 'running' && !recoveredTextCandidate && !enrichCandidateRun) return node;

    changed = true;
    if (node.kind === 'storyboard' && node.generation.baseStoryboard !== undefined
      && node.generation.baseStoryboard !== JSON.stringify(node.storyboard ?? null)) {
      return {
        ...node,
        generation: {
          ...node.generation,
          status: 'failed' as const,
          error: cr().storyboardModifiedKept,
        },
      };
    }
    if (result.status === 'succeeded' && result.content && node.kind === 'text') {
      if (result.binding.outputKind === 'text') {
        return {
          ...node,
          generation: { ...node.generation, status: 'succeeded' as const, candidateText: result.content, runId: result.runId, error: undefined },
        };
      }
      const textPatch = canvasTextPatchWithCopyOnWrite(nodes, node.id, { text: result.content });
      return withCanvasResultHistory(node, {
        ...node,
        ...textPatch,
        generation: { requestId: result.binding.requestId, status: 'succeeded' as const },
      }, textPatch.projectFilePath ? ['text', 'projectFilePath'] : ['text']);
    }
    if (result.status === 'succeeded' && result.content && node.kind === 'storyboard') {
      try {
        return withCanvasResultHistory(node, {
          ...node,
          storyboard: parseStoryboardGenerationResult(
            result.content,
            node.storyboard || createDefaultStoryboardPlan(),
            node.storyboardRequirements,
          ),
          storyboardEntryMode: 'edit' as const,
          generation: { requestId: result.binding.requestId, status: 'succeeded' as const },
        }, ['storyboard']);
      } catch (error) {
        return {
          ...node,
          generation: {
            requestId: result.binding.requestId,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : cr().storyboardParseFail,
          },
        };
      }
    }
    return {
      ...node,
      generation: {
        ...node.generation,
        runId: result.runId,
        requestId: result.binding.requestId,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      },
    };
  });
  return changed ? next : nodes;
}
