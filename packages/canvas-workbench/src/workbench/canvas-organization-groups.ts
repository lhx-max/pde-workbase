import type { Node } from '@xyflow/react';
import { fitGroupBounds, rebaseGroupPoint, groupCandidateReason, planGroupGeometry, type GroupGeometry } from './canvas-group-operations';
import { canvasConnectionError } from './canvas-edge-rules';
import { cr } from '../locales/canvas-remainder';

export type OrganizationGroup = GroupGeometry & { name: string };
type Position = { id: string; x: number; y: number };

/** Legacy image groups store relative coordinates; share the same expansion
 * rules, then rebase every member so siblings keep their world position. */
export function moveRelativeGroupMembers<T extends GroupGeometry>(positions: Position[], groups: T[], nodes: Node[]) {
  const named = groups.map(group => ({ ...group, name: '' }));
  const owners = new Map(groups.flatMap(group => group.memberIds.map(id => [id, group] as const)));
  const world = nodes.map(node => {
    const owner = owners.get(node.id);
    return owner ? { ...node, position: { x: owner.x + node.position.x, y: owner.y + node.position.y } } : node;
  });
  const moved = organizationMove(positions, named, world);
  const changes = new Map(moved.positions.map(item => [item.id, item]));
  const nextGroups = groups.map((group, index) => {
    const next = moved.groups[index]!;
    return next.x === group.x && next.y === group.y && next.width === group.width && next.height === group.height
      ? group : { ...group, x: next.x, y: next.y, width: next.width, height: next.height };
  });
  for (const node of world) {
    const owner = owners.get(node.id);
    if (!owner) continue;
    const next = nextGroups.find(group => group.id === owner.id)!;
    const position = changes.get(node.id) ?? node.position;
    if (changes.has(node.id) || next !== owner) changes.set(node.id, { id: node.id, ...rebaseGroupPoint(position, { x: 0, y: 0 }, next) });
  }
  return { groups: nextGroups, positions: [...changes.values()] };
}

function organizationCandidateReason(node: Node) {
  const data = node.data as { node?: { kind?: string }; image?: { embeddedInSource?: boolean }; instance?: { kind?: string } };
  // Only the independent image generator is supported, not arbitrary legacy workflows.
  if (node.type === 'workbenchCard' && data.instance?.kind === 'visual' && !node.parentId) return null;
  return groupCandidateReason({ id: node.id, type: node.type, parentId: node.parentId,
    embedded: data.image?.embeddedInSource, kind: data.node?.kind });
}

export function createOrganizationGroup(id: string, selected: Node[], groups: OrganizationGroup[]): OrganizationGroup {
  for (const node of selected) {
    const reason = organizationCandidateReason(node);
    if (reason) throw new Error(reason);
    if (groups.some(group => group.memberIds.includes(node.id))) throw new Error(cr().alreadyInGroup);
  }
  const { group } = planGroupGeometry(id, selected.map(node => ({
    id: node.id, ...node.position,
    width: node.measured?.width ?? node.width ?? Number(node.style?.width),
    height: node.measured?.height ?? node.height ?? Number(node.style?.height),
  })));
  return { ...group, name: cr().groupN(groups.length + 1) };
}

/** Validate the entire selection before changing membership; no card or edge is rewritten. */
export function addOrganizationMembers(groupId: string, selected: Node[], groups: OrganizationGroup[], edges: readonly { source: string; target: string }[] = []) {
  const group = groups.find(item => item.id === groupId);
  if (!group) throw new Error(cr().groupGone);
  const incoming = selected.filter(node => node.id !== groupId && !group.memberIds.includes(node.id));
  if (!incoming.length) throw new Error(cr().pickExternalCards);
  for (const node of incoming) {
    const reason = organizationCandidateReason(node);
    if (reason) throw new Error(reason);
    if (groups.some(item => item.memberIds.includes(node.id))) throw new Error(cr().moveOutFirst);
  }
  const dependencies = [...edges, ...groups.flatMap(item => item.memberIds.map(source => ({ source, target: item.id })))];
  for (const node of incoming) {
    const dependency = { source: node.id, target: groupId };
    const error = canvasConnectionError(dependency, dependencies);
    if (error) throw new Error(cr().cannotMoveIn(error));
    dependencies.push(dependency);
  }
  const { group: candidate } = planGroupGeometry('bounds', [
    { id: group.id, x: group.x, y: group.y, width: group.width, height: group.height },
    ...incoming.map(node => ({ id: node.id, x: node.position.x - 16, y: node.position.y - 16,
      width: (node.measured?.width ?? node.width ?? Number(node.style?.width)) + 32,
      height: (node.measured?.height ?? node.height ?? Number(node.style?.height)) + 32 })),
  ], 0);
  const x = Math.min(group.x, candidate.x);
  const y = Math.min(group.y, candidate.y);
  return groups.map(item => item.id !== groupId ? item : {
    ...item, x, y,
    width: Math.max(group.x + group.width, candidate.x + candidate.width) - x,
    height: Math.max(group.y + group.height, candidate.y + candidate.height) - y,
    memberIds: [...item.memberIds, ...incoming.map(node => node.id)],
  });
}

export function removeOrganizationMembers(ids: string[], groups: OrganizationGroup[]) {
  const removed = new Set(ids);
  return groups.map(group => group.memberIds.some(id => removed.has(id))
    ? { ...group, memberIds: group.memberIds.filter(id => !removed.has(id)) } : group);
}

/** The group owns membership; existing card coordinates stay world-space for business consumers. */
export function organizationMembers(nodes: Node[], groups: OrganizationGroup[]): Node[] {
  const owners = new Map(groups.flatMap(group => group.memberIds.map(id => [id, group] as const)));
  return nodes.map(node => {
    const group = owners.get(node.id);
    if (!group || node.parentId) return node;
    return { ...node, parentId: group.id, position: { x: node.position.x - group.x, y: node.position.y - group.y } };
  });
}

/** Convert child drags back to world space; moving a group translates even unselected members once. */
export function organizationMove(positions: Position[], groups: OrganizationGroup[], nodes: Node[]) {
  const moved = new Map(positions.map(position => [position.id, position]));
  const result = new Map(moved);
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const group of groups) {
    const origin = moved.get(group.id) ?? group;
    for (const id of group.memberIds) {
      const child = moved.get(id);
      const node = byId.get(id);
      if (child) result.set(id, { id, x: origin.x + child.x, y: origin.y + child.y });
      else if (moved.has(group.id) && node) result.set(id, { id, x: node.position.x + origin.x - group.x, y: node.position.y + origin.y - group.y });
    }
    result.delete(group.id);
  }
  return { positions: [...result.values()], groups: groups.map(group => {
    const position = moved.get(group.id);
    const origin = position ?? group;
    let left = origin.x, top = origin.y;
    let right = origin.x + group.width, bottom = origin.y + group.height;
    const bounds = group.memberIds.map(id => {
      const node = byId.get(id);
      const child = result.get(id) ?? node?.position;
      const width = node?.measured?.width ?? node?.width ?? Number(node?.style?.width);
      const height = node?.measured?.height ?? node?.height ?? Number(node?.style?.height);
      return child && [child.x, child.y, width, height].every(Number.isFinite) && width > 0 && height > 0
        ? { x: child.x, y: child.y, width, height } : null;
    });
    // Tighten only after a member move and only with complete measurements.
    // A parent-only move or temporarily unmeasured member must not collapse it.
    const fitted = group.memberIds.some(id => moved.has(id)) ? fitGroupBounds(bounds) : null;
    if (fitted) {
      left = fitted.x; top = fitted.y;
      right = fitted.x + fitted.width; bottom = fitted.y + fitted.height;
    }
    // With incomplete measurements, retain safe expansion rather than clipping
    // unknown members. Membership and business world coordinates never change.
    for (const id of group.memberIds) {
      if (!moved.has(id)) continue;
      const child = result.get(id);
      const node = byId.get(id);
      if (!child || !node) continue;
      const width = node.measured?.width ?? node.width ?? Number(node.style?.width);
      const height = node.measured?.height ?? node.height ?? Number(node.style?.height);
      if (![child.x, child.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
      left = Math.min(left, child.x - 16);
      top = Math.min(top, child.y - 16);
      right = Math.max(right, child.x + width + 16);
      bottom = Math.max(bottom, child.y + height + 16);
    }
    if (left === group.x && top === group.y && right - left === group.width && bottom - top === group.height) return group;
    return { ...group, x: left, y: top, width: right - left, height: bottom - top };
  }) };
}
