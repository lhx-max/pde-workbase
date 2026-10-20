import type { Edge, Node } from '@xyflow/react';
import type { BasicCanvasNodeData } from '../BasicCanvasNode';
import type { ImageAssetData } from '../ImageAssetNode';
import { computeFlowTopologyPositions, layoutNodeSize, layoutUnits } from '../canvas-flow-layout';
import type {
  CanvasLayoutPosition,
  InstanceKind,
  WorkbenchCardData,
} from './canvas-domain';

const TIDY_COL_GAP = 96;
const TIDY_FLOAT_GAP = 48;

export function tidyNodeSize(node: Node): { w: number; h: number } {
  const size = layoutNodeSize(node);
  return {
    w: size.width,
    h: size.height,
  };
}

function workbenchKind(node: Node | undefined): InstanceKind | '' {
  if (!node || node.type !== 'workbenchCard') return '';
  return (node.data as WorkbenchCardData | undefined)?.instance?.kind || '';
}

export function computeTidyPositions(nodes: Node[], edges: Edge[]): CanvasLayoutPosition[] {
  const compact = compactStoryboardGroups(nodes);
  return [...computeFlowTopologyPositions(compact.nodes, edges), ...compact.positions];
}

/** Explicit tidy only: generated galleries have semantic order, unlike freeform groups. */
export function compactStoryboardGroups(nodes: Node[]) {
  const updates = new Map<string, Node>();
  const positions: CanvasLayoutPosition[] = [];
  for (const group of nodes.filter(node => node.type === 'storyboardGallery' && !node.parentId)) {
    const members = nodes.filter(node => node.parentId === group.id && !node.hidden);
    if (!members.length) continue;
    const order = (group.data as { members?: { id: string }[] }).members?.map(member => member.id) || [];
    members.sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.id.localeCompare(b.id);
    });
    const controls = members.filter(node => node.id.startsWith('storyboard-assets:'));
    const cards = members.filter(node => !controls.includes(node));
    let controlWidth = 0, controlHeight = 0;
    const place = (node: Node, x: number, y: number) => {
      positions.push({ id: node.id, x, y });
      updates.set(node.id, { ...node, position: { x, y } });
    };
    for (const control of controls) {
      place(control, 24, 24 + controlHeight);
      controlWidth = Math.max(controlWidth, tidyNodeSize(control).w);
      controlHeight += tidyNodeSize(control).h + 32;
    }
    const columns = Math.min(2, cards.length);
    const widths = Array.from({ length: columns }, (_, col) => Math.max(...cards.filter((_, i) => i % columns === col).map(card => tidyNodeSize(card).w)));
    let y = 24;
    for (let row = 0; row * columns < cards.length; row++) {
      const batch = cards.slice(row * columns, (row + 1) * columns);
      let x = 24 + (controlWidth ? controlWidth + 32 : 0);
      for (const [col, card] of batch.entries()) {
        place(card, x, y); x += widths[col]! + 32;
      }
      y += Math.max(...batch.map(card => tidyNodeSize(card).h)) + 64;
    }
    const width = 48 + controlWidth + (controlWidth && cards.length ? 32 : 0) + widths.reduce((a, b) => a + b, 0) + Math.max(0, columns - 1) * 32;
    const height = 48 + Math.max(Math.max(0, controlHeight - 32), cards.length ? y - 24 - 64 : 0);
    updates.set(group.id, { ...group, width, height, measured: { width, height }, style: { ...group.style, width, height } });
  }
  return { nodes: nodes.map(node => updates.get(node.id) || node), positions };
}

const TASK_TYPE_LAYOUT_BUCKETS = ['plan', 'visual', 'presentation', 'web', 'video', 'other'] as const;
type TaskTypeLayoutBucket = typeof TASK_TYPE_LAYOUT_BUCKETS[number];

function taskTypeLayoutBucket(node: Node): TaskTypeLayoutBucket {
  if (node.type === 'workbenchCard') {
    const kind = workbenchKind(node);
    return TASK_TYPE_LAYOUT_BUCKETS.includes(kind as TaskTypeLayoutBucket) ? kind as TaskTypeLayoutBucket : 'other';
  }
  if (
    node.type === 'workflowStage'
    || node.type === 'workflowPending'
    || node.type === 'resultCard'
    || node.type === 'evaluationResult'
    || node.type === 'processFlow'
    || node.type === 'processKnowledge'
  ) return 'plan';
  if (['imageAsset', 'imageGroup', 'storyboardGallery', 'storyboardImageStack'].includes(node.type || '')) return 'visual';
  if (node.type === 'video' || node.type === 'videoCanvas' || node.type === 'clip') return 'video';
  if (node.type === 'basicCanvas') {
    const basic = (node.data as BasicCanvasNodeData | undefined)?.node;
    if (basic?.kind === 'page') {
      return basic.artifactFormat === 'presentation' ? 'presentation' : 'web';
    }
    if (basic?.kind === 'image' || basic?.kind === 'sketch') return 'visual';
    if (basic?.kind === 'video' || basic?.kind === 'clip') return 'video';
    if (basic?.kind === 'storyboard') return 'plan';
    if (basic?.kind === 'text' || basic?.kind === 'artifact') return 'plan';
  }
  return 'other';
}

export function computeTypePositions(nodes: Node[], edges: Edge[]): CanvasLayoutPosition[] {
  const compact = compactStoryboardGroups(nodes);
  nodes = compact.nodes;
  ({ nodes, edges } = layoutUnits(nodes, edges));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visible = nodes.filter(node => (
    node.type !== 'promptCard'
    && !(node.parentId && byId.get(node.parentId)?.type === 'imageGroup')
  ));
  const imageParent = new Map<string, string>();
  for (const node of visible) {
    if (node.type !== 'imageAsset') continue;
    const image = (node.data as ImageAssetData | undefined)?.image;
    if (image?.parentImageId && byId.has(image.parentImageId)) imageParent.set(node.id, image.parentImageId);
    else if (image?.parentGroupId && byId.has(image.parentGroupId)) imageParent.set(node.id, image.parentGroupId);
  }
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source?.type === 'imageAsset' && target?.type === 'imageAsset' && !imageParent.has(target.id)) {
      imageParent.set(target.id, source.id);
    }
  }
  const familyKey = (node: Node) => {
    let id = node.id;
    const seen = new Set<string>();
    while (imageParent.has(id) && !seen.has(id)) {
      seen.add(id);
      id = imageParent.get(id)!;
    }
    return id;
  };
  const depthOf = (node: Node) => {
    let id = node.id;
    let depth = 0;
    const seen = new Set<string>();
    while (imageParent.has(id) && !seen.has(id)) {
      seen.add(id);
      id = imageParent.get(id)!;
      depth += 1;
    }
    return depth;
  };
  const stableCompare = (a: Node, b: Node) => (
    a.position.y - b.position.y
    || a.position.x - b.position.x
    || a.id.localeCompare(b.id)
  );
  const buckets = new Map<TaskTypeLayoutBucket, Node[]>(TASK_TYPE_LAYOUT_BUCKETS.map(bucket => [bucket, []]));
  for (const node of visible) buckets.get(taskTypeLayoutBucket(node))!.push(node);
  const typeById = new Map(visible.map(node => [node.id, taskTypeLayoutBucket(node)]));
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!typeById.has(edge.source) || typeById.get(edge.source) !== typeById.get(edge.target)) continue;
    const parents = incoming.get(edge.target) ?? [];
    if (!parents.includes(edge.source)) parents.push(edge.source);
    incoming.set(edge.target, parents);
  }
  const depthMemo = new Map<string, number>();
  const flowDepth = (id: string, ancestry = new Set<string>()): number => {
    const known = depthMemo.get(id);
    if (known !== undefined) return known;
    if (ancestry.has(id)) return 0;
    const nextAncestry = new Set(ancestry).add(id);
    const parents = incoming.get(id) ?? [];
    const depth = parents.length
      ? Math.max(...parents.map(parentId => flowDepth(parentId, nextAncestry) + 1))
      : 0;
    depthMemo.set(id, depth);
    return depth;
  };
  for (const [bucket, group] of buckets) {
    group.sort(bucket === 'visual'
      ? (a, b) => (
        Number(a.type !== 'workbenchCard') - Number(b.type !== 'workbenchCard')
        || flowDepth(a.id) - flowDepth(b.id)
        || familyKey(a).localeCompare(familyKey(b))
        || depthOf(a) - depthOf(b)
        || stableCompare(a, b)
      )
      : (a, b) => flowDepth(a.id) - flowDepth(b.id) || stableCompare(a, b));
  }
  const positions: CanvasLayoutPosition[] = [];
  let x = 80;
  for (const bucket of TASK_TYPE_LAYOUT_BUCKETS) {
    const group = buckets.get(bucket)!;
    if (!group.length) continue;
    const width = Math.max(...group.map(node => tidyNodeSize(node).w));
    let y = 80;
    for (const node of group) {
      const size = tidyNodeSize(node);
      positions.push({ id: node.id, x, y });
      y += size.h + TIDY_FLOAT_GAP;
    }
    x += width + TIDY_COL_GAP;
  }
  return [...positions, ...compact.positions];
}
