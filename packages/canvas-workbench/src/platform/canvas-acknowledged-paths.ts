import { canvasTextPath } from '@bezier/contracts';

type Node = Record<string, unknown> & { id: string; kind: 'text'; projectFilePath: string };
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.filter((node): node is Node =>
  !!node && typeof node === 'object' && typeof node.id === 'string' && node.kind === 'text' && typeof node.projectFilePath === 'string') : [];

/** A receipt may replace an optimistic duplicate/COW path. Delayed view updates
 * still carry that optimistic path; it is not an intentional document rebind.
 * Keep this per provider/project, and correct only the exact superseded path on
 * the same node, retaining its current acknowledged (or newer) path. */
export class CanvasAcknowledgedPaths {
  private readonly corrections = new Map<string, { path: string; superseded: Set<string> }>();

  acknowledge(optimistic: unknown, acknowledged: unknown): void {
    const before = new Map(nodes(optimistic).map(node => [node.id, node]));
    for (const node of nodes(acknowledged)) {
      const previous = before.get(node.id);
      if (!previous || previous.projectFilePath === node.projectFilePath) continue;
      const known = this.corrections.get(node.id);
      const superseded = new Set(known?.superseded);
      superseded.add(previous.projectFilePath);
      if (known) superseded.add(known.path);
      superseded.delete(node.projectFilePath);
      this.corrections.set(node.id, { path: node.projectFilePath, superseded });
    }
  }

  /** Reconstruct duplicate aliases from the immutable serialized request, not
   * mutable React arrays or an SSE snapshot that arrived ahead of the receipt. */
  acknowledgeOperations(request: { operations?: unknown; expectedState?: unknown }, acknowledged: unknown): void {
    if (!Array.isArray(request.operations)) return;
    const state = request.expectedState && typeof request.expectedState === 'object' ? request.expectedState as Record<string, unknown> : {};
    const sources = new Map(nodes(state.workbenchBasicNodes).map(node => [node.id, node]));
    const duplicates: Node[] = [];
    for (const operation of request.operations) {
      if (!operation || operation.type !== 'node.duplicate' || typeof operation.newNodeId !== 'string') continue;
      const source = sources.get(operation.nodeId);
      if (source) duplicates.push({ ...source, id: operation.newNodeId });
    }
    this.acknowledge(duplicates, acknowledged);
    // Editing before the duplicate receipt runs the ordinary inline COW helper,
    // which provisionally assigns canvasTextPath(newNodeId). That path and the
    // shared source alias are the same pending duplicate's identity, not two
    // intentional rebinds. The receipt owns its final independent document path.
    this.acknowledge(duplicates.map(node => ({ ...node, projectFilePath: canvasTextPath(node.id) })), acknowledged);
  }

  reconcile(current: unknown, incoming: unknown): unknown {
    if (!Array.isArray(incoming)) return incoming;
    const prior = new Map(nodes(current).map(node => [node.id, node]));
    let changed = false;
    const next = incoming.map(node => {
      if (!node || typeof node !== 'object' || node.kind !== 'text') return node;
      const correction = this.corrections.get(node.id);
      const currentPath = prior.get(node.id)?.projectFilePath;
      if (!correction || !currentPath || !correction.superseded.has(node.projectFilePath) || currentPath === node.projectFilePath) return node;
      changed = true;
      return { ...node, projectFilePath: currentPath };
    });
    return changed ? next : incoming;
  }
}
