const MIN_ZOOM = 0.02;
const MAX_ZOOM = 4;
const BASE_GAP = 20;
const MIN_SCREEN_GAP = 12;
const DOT_DIAMETER = 1.5;

/**
 * Blend adjacent powers-of-two grids instead of squeezing a fixed world grid.
 * The finer grid spans 12–24 screen px and fades out as it gets denser; its
 * coarser replacement spans 24–48 px. Both stay anchored to the canvas origin.
 * At each level boundary the outgoing coarse grid is the incoming fine grid,
 * so continuous zoom does not visibly pop or reset the pattern.
 *
 * React Flow scales gap and dot size with zoom, but not lineWidth.
 */
export function canvasBackgroundMetrics(requestedZoom: number) {
  const zoom = Number.isFinite(requestedZoom) && requestedZoom > 0
    ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedZoom)) : 1;
  const level = Math.floor(Math.log2((MIN_SCREEN_GAP * 2) / (BASE_GAP * zoom)));
  const gap = BASE_GAP * 2 ** level;
  const progress = Math.min(1, Math.max(0, (gap * zoom - MIN_SCREEN_GAP) / MIN_SCREEN_GAP));
  const fineOpacity = progress * progress * (3 - 2 * progress);
  return {
    zoom,
    dotSize: DOT_DIAMETER / zoom,
    lineWidth: 0.75,
    layers: [
      { level, gap, opacity: fineOpacity },
      { level: level + 1, gap: gap * 2, opacity: 1 - fineOpacity },
    ],
  };
}
