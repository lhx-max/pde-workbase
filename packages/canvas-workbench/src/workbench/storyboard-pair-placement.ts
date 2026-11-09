export type CanvasPlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const STORYBOARD_PAIR_GAP = 160;

function overlapsWithClearance(
  candidate: CanvasPlacementRect,
  obstacle: CanvasPlacementRect,
  clearance: number,
) {
  return candidate.x < obstacle.x + obstacle.width + clearance
    && candidate.x + candidate.width + clearance > obstacle.x
    && candidate.y < obstacle.y + obstacle.height + clearance
    && candidate.y + candidate.height + clearance > obstacle.y;
}

/** Stable downward packing: never gives up into an occupied rectangle. */
export function avoidStoryboardCollisions<T extends CanvasPlacementRect>(candidate: T, obstacles: readonly CanvasPlacementRect[], clearance = 48): T {
  let next = { ...candidate };
  for (let attempt = 0; attempt <= obstacles.length; attempt += 1) {
    const hits = obstacles.filter(rect => overlapsWithClearance(next, rect, clearance));
    if (!hits.length) return next;
    next = { ...next, y: Math.max(...hits.map(rect => rect.y + rect.height + clearance)) };
  }
  return next;
}

/**
 * Keep the generated text and storyboard as one visual unit.
 *
 * Collision avoidance moves the pair vertically instead of repeatedly pushing
 * only the text card farther left, so their horizontal relationship is stable.
 */
export function findStoryboardPairPlacement({
  obstacles,
  sourceHeight,
  sourceWidth,
  target,
}: {
  obstacles: readonly CanvasPlacementRect[];
  sourceHeight: number;
  sourceWidth: number;
  target: CanvasPlacementRect;
}) {
  const verticalStep = 96;
  const clearance = 48;

  for (let attempt = 0; attempt <= 40; attempt += 1) {
    const verticalOffset = attempt === 0
      ? 0
      : Math.ceil(attempt / 2) * verticalStep * (attempt % 2 === 1 ? 1 : -1);
    const targetCandidate = { ...target, y: target.y + verticalOffset };
    const sourceCandidate = {
      x: target.x - sourceWidth - STORYBOARD_PAIR_GAP,
      y: targetCandidate.y + (target.height - sourceHeight) / 2,
      width: sourceWidth,
      height: sourceHeight,
    };
    const collides = obstacles.some(obstacle => (
      overlapsWithClearance(sourceCandidate, obstacle, clearance)
      || overlapsWithClearance(targetCandidate, obstacle, clearance)
    ));
    if (!collides) return { source: sourceCandidate, target: targetCandidate };
  }

  return {
    source: {
      x: target.x - sourceWidth - STORYBOARD_PAIR_GAP,
      y: target.y + (target.height - sourceHeight) / 2,
      width: sourceWidth,
      height: sourceHeight,
    },
    target,
  };
}
