// Adapted from MarioDesign-FT/design-canvas, excalidraw/src/main.jsx (Apache-2.0).
export type OverviewBounds = [number, number, number, number];
export const OVERVIEW_WIDTH = 216;
export const OVERVIEW_HEIGHT = 144;
export function overviewLayout(bounds: OverviewBounds[], viewport: OverviewBounds) {
  const union = bounds.reduce<OverviewBounds>((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], viewport);
  const width = Math.max(1, union[2] - union[0]);
  const height = Math.max(1, union[3] - union[1]);
  const scale = Math.min(196 / width, 124 / height);
  return { bounds: union, scale, x: 10 + (196 - width * scale) / 2, y: 10 + (124 - height * scale) / 2 };
}
export function overviewRect(bounds: OverviewBounds, layout: ReturnType<typeof overviewLayout>) {
  return { x: layout.x + (bounds[0] - layout.bounds[0]) * layout.scale, y: layout.y + (bounds[1] - layout.bounds[1]) * layout.scale,
    width: Math.max(3, (bounds[2] - bounds[0]) * layout.scale), height: Math.max(3, (bounds[3] - bounds[1]) * layout.scale) };
}
