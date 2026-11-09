import type { Edge, Node } from '@xyflow/react';

export type FlowLayoutPosition = { id: string; x: number; y: number };

const ORIGIN_X = 80;
const ORIGIN_Y = 80;
const COLUMN_GAP = 96;
const LANE_GAP = 112;
const SIBLING_GAP = 56;
const ORPHAN_GAP = 48;
const FALLBACK_WIDTH = 420;
const FALLBACK_HEIGHT = 260;

export function layoutNodeSize(node: Node) {
  const dimension = (...values: unknown[]) => values.find(value => typeof value === 'number' && Number.isFinite(value) && value > 0) as number;
  return {
    width: dimension(node.measured?.width, node.width, node.style?.width, FALLBACK_WIDTH),
    height: dimension(node.measured?.height, node.height, node.style?.height, FALLBACK_HEIGHT),
  };
}
const sizeOf = layoutNodeSize;

/** Layout operates on containment roots, never on parent-relative children.
 * This contract covers future group types without maintaining a renderer allowlist.
 */
export function layoutUnits(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const rootOf = (id: string): string => {
    const visited = new Set<string>();
    while (byId.get(id)?.parentId && byId.has(byId.get(id)!.parentId!)) {
      if (visited.has(id)) return [...visited].sort()[0]!;
      visited.add(id);
      id = byId.get(id)!.parentId!;
    }
    return id;
  };
  const visible = nodes.filter(node => !node.hidden && node.type !== 'promptCard' && rootOf(node.id) === node.id);
  const roots = new Set(visible.map(node => node.id));
  const projected: Edge[] = [];
  const seen = new Set<string>();
  const add = (source?: string | null, target?: string | null) => {
    if (!source || !target) return;
    source = rootOf(source); target = rootOf(target);
    const key = JSON.stringify([source, target]);
    if (source === target || !roots.has(source) || !roots.has(target) || seen.has(key)) return;
    seen.add(key);
    projected.push({ id: key, source, target });
  };
  for (const edge of edges) add(edge.source, edge.target);
  for (const node of nodes) {
    if (node.type === 'storyboardGallery') {
      const gallery = node.data as { storyboardId?: string; kind?: string };
      if (gallery.kind === 'shot') add(gallery.storyboardId, node.id);
      else add(node.id, gallery.storyboardId);
    }
    const data = node.data as { parentId?: string; image?: { parentImageId?: string; parentGroupId?: string; sourceInstanceId?: string } };
    add(data?.parentId, node.id);
    const image = data?.image;
    add(image?.parentImageId || image?.parentGroupId || image?.sourceInstanceId, node.id);
  }
  // Account for unmeasured containers and members extending beyond their frame.
  const units = visible.map(root => {
    const size = sizeOf(root);
    let width = size.width, height = size.height;
    for (const child of nodes) {
      if (child.id === root.id || child.hidden || rootOf(child.id) !== root.id) continue;
      let x = 0, y = 0, current: Node | undefined = child;
      const visited = new Set<string>();
      while (current && current.id !== root.id && !visited.has(current.id)) {
        visited.add(current.id);
        x += current.position.x; y += current.position.y;
        current = byId.get(current.parentId!);
      }
      width = Math.max(width, x + sizeOf(child).width);
      height = Math.max(height, y + sizeOf(child).height);
    }
    return { ...root, measured: { width, height } };
  });
  return { nodes: units, edges: projected };
}

function stableNodeCompare(a: Node, b: Node) {
  return a.position.y - b.position.y
    || a.position.x - b.position.x
    || a.id.localeCompare(b.id);
}

/** Place only a newly delivered branch; existing user positions are obstacles. */
export function placeNewStoryboardBranch(nodes: Node[], scriptId: string): FlowLayoutPosition[] {
  const units = layoutUnits(nodes, []).nodes;
  const script = units.find(node => node.id === scriptId);
  if (!script) return [];
  const branch = units.filter(node => node.id === scriptId || (node.type === 'storyboardGallery'
    && node.data.storyboardId === scriptId && node.data.kind !== 'shot'));
  const ids = new Set(branch.map(node => node.id));
  const planned = computeFlowTopologyPositions(branch, []);
  const anchor = planned.find(position => position.id === scriptId)!;
  const sizes = new Map(branch.map(node => [node.id, sizeOf(node)]));
  const left = Math.min(...planned.map(p => p.x));
  const top = Math.min(...planned.map(p => p.y));
  const width = Math.max(...planned.map(p => p.x + sizes.get(p.id)!.width)) - left;
  const height = Math.max(...planned.map(p => p.y + sizes.get(p.id)!.height)) - top;
  const x = script.position.x - anchor.x + left;
  let y = script.position.y - anchor.y + top;
  const obstacles = units.filter(node => !ids.has(node.id));
  for (let attempt = 0; attempt <= obstacles.length; attempt++) {
    const hits = obstacles.filter(node => {
      const size = sizeOf(node);
      return x < node.position.x + size.width + COLUMN_GAP && x + width + COLUMN_GAP > node.position.x
        && y < node.position.y + size.height + LANE_GAP && y + height + LANE_GAP > node.position.y;
    });
    if (!hits.length) break;
    y = Math.max(...hits.map(node => node.position.y + sizeOf(node).height + LANE_GAP));
  }
  return planned.map(p => ({ id: p.id, x: x + p.x - left, y: y + p.y - top }));
}

/**
 * 以画布真实 source → target 连线计算横向拓扑层级。
 *
 * 类型只负责补充没有显式边的父子关系，绝不再决定列。这样同一类型的连续
 * 工作流结果会依次向右，而分支才在同一列纵向展开。
 */
export function computeFlowTopologyPositions(nodes: Node[], edges: Edge[]): FlowLayoutPosition[] {
  ({ nodes, edges } = layoutUnits(nodes, edges));
  // A storyboard and its input galleries are one layout unit, not unrelated
  // DAG roots. This is only a layout projection; no persistent parent/clamp.
  const byId = new Map(nodes.map(node => [node.id, node]));
  const inputs = new Map<string, Node[]>();
  for (const node of nodes) {
    const data = node.data as { storyboardId?: string; kind?: string };
    if (node.type !== 'storyboardGallery' || !data.storyboardId || !byId.has(data.storyboardId)
      || (data.kind !== 'character' && data.kind !== 'scene')) continue;
    const list = inputs.get(data.storyboardId) || [];
    list.push(node); inputs.set(data.storyboardId, list);
  }
  const owner = new Map<string, string>();
  const offsets = new Map<string, FlowLayoutPosition[]>();
  const bundles = new Map<string, Node>();
  // Reserve the same input column for sibling scripts, including image stacks.
  const inputColumnWidth = Math.max(0, ...[...inputs.values()].flatMap(groups => groups.map(group => sizeOf(group).width)));
  for (const [id, groups] of inputs) {
    const script = byId.get(id)!;
    groups.sort((a, b) => String(a.data.kind).localeCompare(String(b.data.kind)));
    const inputWidth = inputColumnWidth;
    const scriptX = inputWidth + COLUMN_GAP;
    let y = 0;
    const placements = groups.map(group => {
      owner.set(group.id, id);
      const placement = { id: group.id, x: 0, y };
      y += sizeOf(group).height + SIBLING_GAP;
      return placement;
    });
    placements.push({ id, x: scriptX, y: 0 });
    offsets.set(id, placements);
    bundles.set(id, { ...script, measured: {
      width: scriptX + sizeOf(script).width,
      height: Math.max(sizeOf(script).height, y - SIBLING_GAP),
    } });
  }
  const projectedNodes = nodes.filter(node => !owner.has(node.id)).map(node => bundles.get(node.id) || node);
  const projectedEdges = edges.map(edge => ({ ...edge, source: owner.get(edge.source) || edge.source, target: owner.get(edge.target) || edge.target }));
  return computeUnitTopologyPositions(projectedNodes, projectedEdges).flatMap(position => {
    const members = offsets.get(position.id);
    return members ? members.map(member => ({ id: member.id, x: position.x + member.x, y: position.y + member.y })) : [position];
  });
}

function computeUnitTopologyPositions(nodes: Node[], edges: Edge[]): FlowLayoutPosition[] {
  const allById = new Map(nodes.map(node => [node.id, node]));
  const visible = nodes.filter(node => (
    node.type !== 'promptCard'
    && !(node.parentId && allById.get(node.parentId)?.type === 'imageGroup')
  ));
  const byId = new Map(visible.map(node => [node.id, node]));
  const outgoing = new Map<string, Set<string>>(visible.map(node => [node.id, new Set()]));
  const incoming = new Map<string, Set<string>>(visible.map(node => [node.id, new Set()]));
  const neighbours = new Map<string, Set<string>>(visible.map(node => [node.id, new Set()]));

  const addArc = (sourceId: string | undefined | null, targetId: string | undefined | null) => {
    if (!sourceId || !targetId || sourceId === targetId || !byId.has(sourceId) || !byId.has(targetId)) return;
    outgoing.get(sourceId)!.add(targetId);
    incoming.get(targetId)!.add(sourceId);
    neighbours.get(sourceId)!.add(targetId);
    neighbours.get(targetId)!.add(sourceId);
  };

  for (const edge of edges) addArc(edge.source, edge.target);
  for (const node of visible) {
    const data = node.data as {
      parentId?: string;
      image?: {
        sourceInstanceId?: string | null;
        parentImageId?: string | null;
        parentGroupId?: string | null;
      };
    } | undefined;
    addArc(data?.parentId, node.id);
    if (node.type === 'imageAsset') {
      addArc(data?.image?.parentImageId || data?.image?.parentGroupId || data?.image?.sourceInstanceId, node.id);
    }
  }

  const components: Node[][] = [];
  const seen = new Set<string>();
  for (const start of [...visible].sort(stableNodeCompare)) {
    if (seen.has(start.id)) continue;
    const stack = [start.id];
    const component: Node[] = [];
    seen.add(start.id);
    while (stack.length) {
      const id = stack.pop()!;
      const node = byId.get(id);
      if (node) component.push(node);
      for (const neighbour of neighbours.get(id) || []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    components.push(component.sort(stableNodeCompare));
  }

  const componentAnchor = (component: Node[]) => {
    const ids = new Set(component.map(node => node.id));
    return component
      .filter(node => ![...(incoming.get(node.id) || [])].some(id => ids.has(id)))
      .sort(stableNodeCompare)[0] || [...component].sort(stableNodeCompare)[0]!;
  };
  const connected = components
    .filter(component => component.length > 1)
    .sort((a, b) => stableNodeCompare(componentAnchor(a), componentAnchor(b)));
  const orphans = components.flatMap(component => component.length === 1 ? component : []);
  const positions: FlowLayoutPosition[] = [];
  let laneTop = ORIGIN_Y;
  let widestLane = FALLBACK_WIDTH * 3;

  for (const component of connected) {
    const ids = new Set(component.map(node => node.id));
    const indegree = new Map(component.map(node => [
      node.id,
      [...(incoming.get(node.id) || [])].filter(id => ids.has(id)).length,
    ]));
    const rank = new Map(component.map(node => [node.id, 0]));
    const ready = component.filter(node => indegree.get(node.id) === 0).sort(stableNodeCompare);
    const processed = new Set<string>();

    while (ready.length) {
      const current = ready.shift()!;
      processed.add(current.id);
      for (const targetId of outgoing.get(current.id) || []) {
        if (!ids.has(targetId)) continue;
        rank.set(targetId, Math.max(rank.get(targetId) || 0, (rank.get(current.id) || 0) + 1));
        const nextIndegree = (indegree.get(targetId) || 0) - 1;
        indegree.set(targetId, nextIndegree);
        if (nextIndegree === 0) {
          ready.push(byId.get(targetId)!);
          ready.sort(stableNodeCompare);
        }
      }
    }

    // 用户手工反接形成环时，不让整个整理失效；环内节点按当前水平顺序展开。
    const cyclic = component
      .filter(node => !processed.has(node.id))
      .sort((a, b) => a.position.x - b.position.x || stableNodeCompare(a, b));
    let cycleRank = Math.max(0, ...rank.values());
    for (const node of cyclic) {
      cycleRank += 1;
      rank.set(node.id, cycleRank);
    }

    const layers = new Map<number, Node[]>();
    for (const node of component) {
      const layer = rank.get(node.id) || 0;
      const group = layers.get(layer) || [];
      group.push(node);
      layers.set(layer, group);
    }
    for (const group of layers.values()) group.sort(stableNodeCompare);
    const orderedLayers = [...layers.keys()].sort((a, b) => a - b);
    const layerWidths = new Map(orderedLayers.map(layer => [
      layer,
      Math.max(...layers.get(layer)!.map(node => sizeOf(node).width)),
    ]));
    const layerHeights = new Map(orderedLayers.map(layer => [
      layer,
      layers.get(layer)!.reduce((sum, node, index) => (
        sum + sizeOf(node).height + (index > 0 ? SIBLING_GAP : 0)
      ), 0),
    ]));
    const laneHeight = Math.max(...layerHeights.values());
    let x = ORIGIN_X;
    for (const layer of orderedLayers) {
      const group = layers.get(layer)!;
      const width = layerWidths.get(layer)!;
      let y = laneTop + (laneHeight - layerHeights.get(layer)!) / 2;
      for (const node of group) {
        const size = sizeOf(node);
        positions.push({ id: node.id, x: x + (width - size.width) / 2, y });
        y += size.height + SIBLING_GAP;
      }
      x += width + COLUMN_GAP;
    }
    widestLane = Math.max(widestLane, x - COLUMN_GAP - ORIGIN_X);
    laneTop += laneHeight + LANE_GAP;
  }

  if (orphans.length) {
    let x = ORIGIN_X;
    let y = laneTop;
    let rowHeight = 0;
    for (const node of orphans.sort(stableNodeCompare)) {
      const size = sizeOf(node);
      if (x > ORIGIN_X && x + size.width > ORIGIN_X + widestLane) {
        x = ORIGIN_X;
        y += rowHeight + ORPHAN_GAP;
        rowHeight = 0;
      }
      positions.push({ id: node.id, x, y });
      x += size.width + ORPHAN_GAP;
      rowHeight = Math.max(rowHeight, size.height);
    }
  }

  return positions;
}
