export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasViewportBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

type FocusedNodeViewportInput = {
  viewportWidth: number;
  viewportHeight: number;
  node: CanvasRect;
  maxZoom?: number;
  minZoom?: number;
  inset?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
};

type ViewportCardPlacementInput = {
  bounds: CanvasViewportBounds;
  center: { x: number; y: number };
  width: number;
  height: number;
  occupied: CanvasRect[];
  gap?: number;
};

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function overlapsWithGap(candidate: CanvasRect, occupied: CanvasRect, gap: number) {
  return candidate.x < occupied.x + occupied.width + gap
    && candidate.x + candidate.width + gap > occupied.x
    && candidate.y < occupied.y + occupied.height + gap
    && candidate.y + candidate.height + gap > occupied.y;
}

/**
 * Centers one node in the readable part of the canvas. The asymmetric top
 * inset leaves room for node labels and floating editing controls.
 */
export function focusedNodeViewport({
  viewportWidth,
  viewportHeight,
  node,
  maxZoom = 2,
  minZoom = 0.1,
  inset,
}: FocusedNodeViewportInput): CanvasViewport {
  const top = inset?.top ?? 136;
  const right = inset?.right ?? 64;
  const bottom = inset?.bottom ?? 64;
  const left = inset?.left ?? 64;
  const availableWidth = Math.max(1, viewportWidth - left - right);
  const availableHeight = Math.max(1, viewportHeight - top - bottom);
  const width = Math.max(1, node.width);
  const height = Math.max(1, node.height);
  const zoom = clamp(
    Math.min(availableWidth / width, availableHeight / height),
    minZoom,
    maxZoom,
  );
  const centerX = left + availableWidth / 2;
  const centerY = top + availableHeight / 2;

  return {
    x: centerX - (node.x + width / 2) * zoom,
    y: centerY - (node.y + height / 2) * zoom,
    zoom,
  };
}

/**
 * Finds a free top-left position without allowing a newly created card to
 * drift outside the user's current canvas viewport.
 */
export function placeCardInViewport({
  bounds,
  center,
  width,
  height,
  occupied,
  gap = 24,
}: ViewportCardPlacementInput) {
  const minX = bounds.left;
  const minY = bounds.top;
  const maxX = Math.max(minX, bounds.right - width);
  const maxY = Math.max(minY, bounds.bottom - height);
  const origin = {
    x: clamp(center.x - width / 2, minX, maxX),
    y: clamp(center.y - height / 2, minY, maxY),
  };

  const STEP = 48;
  const MAX_RINGS = 24;
  const seen = new Set<string>();
  const candidates: Array<{ x: number; y: number }> = [];
  const addCandidate = (x: number, y: number) => {
    const next = { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
    const key = `${next.x}:${next.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(next);
  };

  addCandidate(origin.x, origin.y);
  for (let ring = 1; ring <= MAX_RINGS; ring += 1) {
    for (let offset = -ring; offset <= ring; offset += 1) {
      addCandidate(origin.x + offset * STEP, origin.y - ring * STEP);
      addCandidate(origin.x + offset * STEP, origin.y + ring * STEP);
      addCandidate(origin.x - ring * STEP, origin.y + offset * STEP);
      addCandidate(origin.x + ring * STEP, origin.y + offset * STEP);
    }
  }

  return candidates.find(position => {
    const candidate = { ...position, width, height };
    return !occupied.some(rect => overlapsWithGap(candidate, rect, gap));
  }) ?? origin;
}
