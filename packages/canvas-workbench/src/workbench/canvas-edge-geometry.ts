import { Position, type Node } from '@xyflow/react';
import { stableCanvasHandleId } from './canvas-edge-rules';

type Point = { x: number; y: number };
type Bounds = { measured?: { width?: number; height?: number }; internals: { positionAbsolute: Point } };

/** Default ports belong to the card boundary. Named ports belong to their
 * branch/item, so preserve React Flow's measured position. All coordinates
 * are canvas-world coordinates; zoom must never be applied a second time. */
export function canvasEdgeAnchor(node: Bounds | undefined, handleId: string | null | undefined, position: Position, fallback: Point): Point {
  if (stableCanvasHandleId(handleId) || !node) return fallback;
  const { width, height } = node.measured ?? {};
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return fallback;
  const { x, y } = node.internals.positionAbsolute;
  switch (position) {
    case Position.Left: return { x, y: y + height / 2 };
    case Position.Right: return { x: x + width, y: y + height / 2 };
    case Position.Top: return { x: x + width / 2, y };
    case Position.Bottom: return { x: x + width / 2, y: y + height };
  }
}

/** Precompute ancestor state once per projection, not once per edge or frame. */
export function canvasEdgeNodeStates(nodes: Node[], selected: ReadonlySet<string>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const states = new Map<string, { visible: boolean; related: boolean; z: number; edgeFloor: number }>();
  const visit = (id: string, visiting = new Set<string>()): ReturnType<typeof states.get> => {
    if (states.has(id)) return states.get(id);
    const node = byId.get(id);
    if (!node || visiting.has(id)) return undefined;
    visiting.add(id);
    const parent = node.parentId ? visit(node.parentId, visiting) : undefined;
    const ownZ = (node.zIndex ?? 0) + (selected.has(id) ? 1000 : 0);
    const state = {
      visible: !node.hidden && (!node.parentId || !!parent?.visible),
      related: selected.has(id) || !!parent?.related,
      z: Math.max(ownZ, parent ? parent.z + 1 : ownZ),
      edgeFloor: parent ? parent.z + 1 : -1,
    };
    states.set(id, state);
    visiting.delete(id);
    return state;
  };
  for (const node of nodes) visit(node.id);
  return states;
}
