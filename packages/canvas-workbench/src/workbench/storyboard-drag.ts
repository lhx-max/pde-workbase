import type { Node } from '@xyflow/react';
import { fitGroupBounds } from './canvas-group-operations';

export function didParentRebase(parentId: string | undefined, before: Map<string, { x: number; y: number }>, after: Map<string, { x: number; y: number }>) {
  const previous = parentId ? before.get(parentId) : undefined;
  const next = parentId ? after.get(parentId) : undefined;
  return Boolean(previous && next && (previous.x !== next.x || previous.y !== next.y));
}

/** Translate only a script's owned galleries, never arbitrary connected nodes. */
export function followStoryboardDrag(nodes: Node[], before: Node[], moving: Set<string>): Node[] {
  const old = new Map(before.map(n => [n.id, n]));
  const current = new Map(nodes.map(n => [n.id, n]));
  return nodes.map(node => {
    if (node.type !== 'storyboardGallery' || moving.has(node.id)) return node;
    const owner = node.data.storyboardId as string;
    if (!moving.has(owner)) return node;
    const script = current.get(owner), previous = old.get(owner), group = old.get(node.id);
    if (!script || !previous || !group) return node;
    return { ...node, position: { x: group.position.x + script.position.x - previous.position.x, y: group.position.y + script.position.y - previous.position.y } };
  });
}

/** Fit actual measured children on every drag frame; rebasing keeps world positions. */
export function fitStoryboardDragBounds(nodes: Node[]): Node[] {
  const changes = new Map<string, Node>();
  for (const group of nodes) {
    if (group.type !== 'storyboardGallery') continue;
    const children = nodes.filter(n => n.parentId === group.id);
    const bounds = fitGroupBounds(children.map(n => ({ ...n.position, id: n.id,
      width: n.measured?.width ?? Number(n.style?.width || n.width || 0),
      height: n.measured?.height ?? Number(n.style?.height || n.height || 0),
    })), 24);
    if (!bounds || children.some(n => !n.measured?.height && !n.height && !n.style?.height)) continue;
    if (bounds.x === 0 && bounds.y === 0 && group.style?.width === bounds.width && group.style?.height === bounds.height) continue;
    changes.set(group.id, { ...group, position: { x: group.position.x + bounds.x, y: group.position.y + bounds.y },
      style: { ...group.style, width: bounds.width, height: bounds.height }, width: bounds.width, height: bounds.height,
      measured: { width: bounds.width, height: bounds.height } });
    for (const child of children) changes.set(child.id, { ...child, position: { x: child.position.x - bounds.x, y: child.position.y - bounds.y } });
  }
  return changes.size ? nodes.map(n => changes.get(n.id) || n) : nodes;
}
