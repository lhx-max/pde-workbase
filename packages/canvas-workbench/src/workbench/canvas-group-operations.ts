import { canvasConnectionError } from './canvas-edge-rules';
import { cr } from '../locales/canvas-remainder';

/** Common geometry contract for every group adapter. Unknown dimensions must
 * not collapse a group; callers retain its last valid bounds on null. */
export function fitGroupBounds(members: readonly ({ x: number; y: number; width: number; height: number } | null)[], padding = 16) {
  if (!members.length || !Number.isFinite(padding) || padding < 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const member of members) {
    if (!member || ![member.x, member.y, member.width, member.height].every(Number.isFinite) || member.width <= 0 || member.height <= 0) return null;
    left = Math.min(left, member.x); top = Math.min(top, member.y);
    right = Math.max(right, member.x + member.width); bottom = Math.max(bottom, member.y + member.height);
  }
  return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
}

/** Convert a relative point between origins without changing its world location. */
export function rebaseGroupPoint(point: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }) {
  return { x: point.x + from.x - to.x, y: point.y + from.y - to.y };
}

/** Pure operations shared by group adapters. No persistence or rendering here. */
export type GroupMemberGeometry = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GroupGeometry = {
  id: string;
  memberIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GroupEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
};

/** Preserve world positions; member order is explicit, never inferred from x/y. */
export function planGroupGeometry(id: string, members: readonly GroupMemberGeometry[], padding = 16) {
  if (!id || members.length < 2) throw new Error(cr().pickTwoCards);
  if (new Set(members.map(member => member.id)).size !== members.length) throw new Error(cr().membersUnique);
  if (!Number.isFinite(padding) || padding < 0 || members.some(member =>
    !member.id || member.id === id || ![member.x, member.y, member.width, member.height].every(Number.isFinite)
    || member.width <= 0 || member.height <= 0)) throw new Error(cr().cardPosInvalid);
  const { x, y, width, height } = fitGroupBounds(members, padding)!;
  return {
    group: { id, memberIds: members.map(member => member.id), x, y, width, height },
    placements: members.map(member => ({ ...member, ...rebaseGroupPoint(member, { x: 0, y: 0 }, { x, y }) })),
  };
}

/** Resolve everything before mutating: an unsupported incoming group edge is not broadcast. */
export function planGroupDissolve<E extends GroupEdge>(group: GroupGeometry, members: readonly Pick<GroupMemberGeometry, 'id' | 'x' | 'y'>[], edges: readonly E[]) {
  if (edges.some(edge => edge.target === group.id)) throw new Error(cr().ungroupHasInputs);
  const byId = new Map(members.map(member => [member.id, member]));
  if (byId.size !== members.length || new Set(group.memberIds).size !== group.memberIds.length
    || members.length !== group.memberIds.length || group.memberIds.some(id => !byId.has(id))) {
    throw new Error(cr().membersNotLoaded);
  }
  const positions = group.memberIds.map(id => {
    const member = byId.get(id)!;
    const x = group.x + member.x;
    const y = group.y + member.y;
    if (![x, y].every(Number.isFinite)) throw new Error(cr().memberPosInvalid);
    return { id, x, y };
  });
  // Keep original order at each target. An empty member still gets its edge so
  // its future output remains referenced after the container disappears.
  const proposed: E[] = [];
  const ids = new Set(edges.map(edge => edge.id));
  for (const edge of edges) {
    if (edge.source !== group.id) { proposed.push(edge); continue; }
    if (group.memberIds.length === 0) throw new Error(cr().emptyGroupReferenced);
    if (edge.id.startsWith('chain-') || edge.sourceHandle || Object.keys(edge.data ?? {}).some(key => !['skipSourceContext', 'connectedAt'].includes(key))) {
      throw new Error(cr().specialRefsNeedMember);
    }
    for (const memberId of group.memberIds) {
      let id = `${edge.id}:member:${memberId}`;
      while (ids.has(id)) id += ':copy';
      ids.add(id);
      const { connectedAt: _animation, ...data } = edge.data ?? {};
      proposed.push({ ...edge, id, source: memberId, sourceHandle: undefined, data } as E);
    }
  }
  // Existing direct references can coincide with expanded group references.
  // Merge only equal semantics; do not discard different roles/metadata.
  const normalized: E[] = [];
  for (const edge of proposed) {
    const old = normalized.find(item => item.source === edge.source && item.target === edge.target
      && (item.sourceHandle ?? null) === (edge.sourceHandle ?? null)
      && (item.targetHandle ?? null) === (edge.targetHandle ?? null));
    if (old) {
      if (edges.includes(old) && edges.includes(edge)) { normalized.push(edge); continue; }
      const semantics = (item: GroupEdge) => JSON.stringify(Object.entries(item.data ?? {}).filter(([key]) => key !== 'connectedAt').sort(([a], [b]) => a.localeCompare(b)));
      if (semantics(old) !== semantics(edge)) throw new Error(cr().memberRefsConflict);
      if (edges.includes(edge)) normalized[normalized.indexOf(old)] = edge;
      continue;
    }
    normalized.push(edge);
  }
  for (const edge of normalized.filter(item => !edges.includes(item))) {
    const error = canvasConnectionError(edge, normalized, undefined, undefined, edge.id);
    if (error) throw new Error(error);
  }
  return { positions, edges: normalized };
}

export type GroupCandidate = { id: string; type?: string; parentId?: string; embedded?: boolean; kind?: string };

/** Eligibility is separate from adapter readiness. Unknown and derived nodes fail closed. */
export function groupCandidateReason(node: GroupCandidate): string | null {
  if (node.parentId || node.embedded) return cr().businessObjectNoGroup;
  if (node.type === 'imageAsset') return null;
  if (node.type === 'basicCanvas' && ['text', 'image', 'video', 'page', 'artifact', 'storyboard', 'clip'].includes(node.kind ?? '')) return null;
  if (node.type === 'imageGroup') return cr().noNestedGroups;
  if (node.type === 'storyboardAssetGroup') return cr().roleSceneNeedAdapter;
  return cr().noSafeGroupYet;
}
