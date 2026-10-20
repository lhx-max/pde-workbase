import type { WorkflowResultArtifact } from '@bezier/contracts';

export type WorkflowResultPosition = { x: number; y: number };

// React Flow raises a selected node to z-index 1000. Item-level lineage edges
// start inside the result node's outer tray, so they must stay above that
// selected node or the first few pixels are painted over and look detached
// from the item handle.
export const WORKFLOW_RESULT_BRANCH_EDGE_Z_INDEX = 1001;

// Result cards show up to five full title/body items, so a branch can be much
// taller than an ordinary canvas node. Leave enough room for that maximum
// card instead of spacing by the compact/loading-card height.
const RESULT_HORIZONTAL_GAP = 600;
const RESULT_VERTICAL_GAP = 1280;
export const WORKFLOW_RESULT_FALLBACK_ORIGIN: WorkflowResultPosition = { x: 120, y: 120 };

type LayoutArtifact = Pick<WorkflowResultArtifact, 'id'> & Partial<Pick<
  WorkflowResultArtifact, 'parentResultId' | 'parentNodeId'
>>;

/**
 * Resolve a stable, non-overlapping canvas position for every workflow result.
 *
 * The generic workflow runtime does not always have a parent canvas node.  In
 * that case the first result starts a lane and its descendants grow to the
 * right.  Multiple children of the same result grow downward as branches.
 * Explicitly saved positions always win, so refreshing never undoes a user's
 * manual arrangement.
 */
export function resolveWorkflowResultPositions(
  artifacts: LayoutArtifact[],
  savedByArtifactId: Record<string, WorkflowResultPosition>,
  rootPositions: Record<string, WorkflowResultPosition>,
): Record<string, WorkflowResultPosition> {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const indexById = new Map(artifacts.map((artifact, index) => [artifact.id, index]));
  const positions: Record<string, WorkflowResultPosition> = {};
  const resolving = new Set<string>();

  const siblingIndex = (artifact: LayoutArtifact) => artifacts.filter(candidate => (
    candidate.id !== artifact.id
    && candidate.parentResultId === artifact.parentResultId
    && candidate.parentNodeId === artifact.parentNodeId
    && (indexById.get(candidate.id) ?? 0) < (indexById.get(artifact.id) ?? 0)
  )).length;

  const laneIndex = (artifact: LayoutArtifact) => artifacts.filter(candidate => (
    candidate.id !== artifact.id
    && !candidate.parentResultId
    && !candidate.parentNodeId
    && (indexById.get(candidate.id) ?? 0) < (indexById.get(artifact.id) ?? 0)
  )).length;

  const resolve = (artifact: LayoutArtifact): WorkflowResultPosition => {
    const saved = savedByArtifactId[artifact.id];
    if (saved) return saved;
    const existing = positions[artifact.id];
    if (existing) return existing;

    // A malformed/cyclic lineage must still be visible and must not collapse
    // onto every other malformed result at (0, 0).
    if (resolving.has(artifact.id)) {
      const index = indexById.get(artifact.id) ?? 0;
      return {
        x: WORKFLOW_RESULT_FALLBACK_ORIGIN.x + (index % 3) * RESULT_HORIZONTAL_GAP,
        y: WORKFLOW_RESULT_FALLBACK_ORIGIN.y + Math.floor(index / 3) * RESULT_VERTICAL_GAP,
      };
    }
    resolving.add(artifact.id);

    let position: WorkflowResultPosition;
    const parent = artifact.parentResultId ? byId.get(artifact.parentResultId) : undefined;
    if (parent) {
      const parentPosition = resolve(parent);
      position = {
        x: parentPosition.x + RESULT_HORIZONTAL_GAP,
        y: parentPosition.y + siblingIndex(artifact) * RESULT_VERTICAL_GAP,
      };
    } else if (artifact.parentNodeId && rootPositions[artifact.parentNodeId]) {
      const rootPosition = rootPositions[artifact.parentNodeId]!;
      position = {
        x: rootPosition.x + RESULT_HORIZONTAL_GAP,
        y: rootPosition.y + siblingIndex(artifact) * RESULT_VERTICAL_GAP,
      };
    } else {
      position = {
        x: WORKFLOW_RESULT_FALLBACK_ORIGIN.x,
        y: WORKFLOW_RESULT_FALLBACK_ORIGIN.y + laneIndex(artifact) * RESULT_VERTICAL_GAP,
      };
    }

    resolving.delete(artifact.id);
    positions[artifact.id] = position;
    return position;
  };

  for (const artifact of artifacts) {
    positions[artifact.id] = resolve(artifact);
  }
  return positions;
}

/**
 * Find the nearest free result slot to the right of a source card.
 *
 * Search the current row first so the loading feedback stays in view. Only
 * after the nearby columns are occupied do we open another row. The final
 * result inherits this exact position.
 */
export function resolveWorkflowBranchPosition(
  source: WorkflowResultPosition,
  occupied: WorkflowResultPosition[],
): WorkflowResultPosition {
  const occupiedKeys = new Set(occupied.map(position => `${position.x}:${position.y}`));
  for (let row = 0; row < 20; row += 1) {
    for (let column = 1; column < 20; column += 1) {
      const candidate = {
        x: source.x + column * RESULT_HORIZONTAL_GAP,
        y: source.y + row * RESULT_VERTICAL_GAP,
      };
      if (!occupiedKeys.has(`${candidate.x}:${candidate.y}`)) return candidate;
    }
  }
  return {
    x: source.x + RESULT_HORIZONTAL_GAP,
    y: source.y + occupied.length * RESULT_VERTICAL_GAP,
  };
}
