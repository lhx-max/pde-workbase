import { isCanvasNodeConnectionAllowed } from './canvas-node-catalog';
import { cr } from '../locales/canvas-remainder';

type Link = { id?: string; source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null };
export const isGeneratedCanvasEdge = (id: string) => id.startsWith('chain-');

/** Older menu-wrapped ports accidentally persisted a per-mount Radix DOM id. */
export function stableCanvasHandleId(id: string | null | undefined): string | null {
  return !id || /^radix-[:_]/.test(id) ? null : id;
}

/** Existing graphs remain intact; validate only a proposed connection/reconnection. */
export function canvasConnectionError(link: Link, edges: readonly Link[], sourceKind?: string, targetKind?: string, replacingId?: string): string | null {
  if (!link.source || !link.target) return cr().pickInOut;
  if (link.source === link.target) return cr().noSelfLink;
  if (!isCanvasNodeConnectionAllowed(sourceKind, targetKind)) return cr().cannotLinkTypes;
  const others = edges.filter(edge => !replacingId || edge.id !== replacingId);
  if (others.some(edge => edge.source === link.source && edge.target === link.target
    && stableCanvasHandleId(edge.sourceHandle) === stableCanvasHandleId(link.sourceHandle)
    && stableCanvasHandleId(edge.targetHandle) === stableCanvasHandleId(link.targetHandle))) return cr().portsAlreadyLinked;
  const downstream = new Map<string, string[]>();
  for (const edge of others) {
    if (!edge.source || !edge.target) continue;
    downstream.set(edge.source, [...(downstream.get(edge.source) ?? []), edge.target]);
  }
  const queue = [link.target];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.pop()!;
    if (id === link.source) return cr().noCycles;
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(downstream.get(id) ?? []));
  }
  return null;
}
