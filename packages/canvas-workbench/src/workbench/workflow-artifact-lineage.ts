import type { CanvasBasicNode } from './BasicCanvasNode';

export type MaterializedWorkflowArtifactLineage = {
  sourceResultId: string;
  sourceItemIds: string[];
  targetNodeId: string;
};

/** Preserve which historical result card produced each editable canvas node. */
export function materializedWorkflowArtifactLineage(
  nodes: CanvasBasicNode[],
): MaterializedWorkflowArtifactLineage[] {
  return nodes.flatMap(node => {
    const sourceResultId = node.source?.resultId?.trim();
    return sourceResultId
      ? [{
          sourceResultId,
          sourceItemIds: [...new Set((node.source?.itemIds ?? []).filter(item => Boolean(item.trim())))],
          targetNodeId: node.id,
        }]
      : [];
  });
}
