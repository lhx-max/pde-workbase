import type { CanvasRelationsLayoutOperation, CanvasLayoutMode } from '@bezier/contracts';
import { CanvasStateError } from './errors.js';

type State = Record<string, unknown>;
type Item = Record<string, unknown> & { id: string };
type Rect = { id: string; x: number; y: number; width: number; height: number };
type Group = Rect & { name: string; memberIds: string[] };
const records = (value: unknown): Item[] => Array.isArray(value) ? value as Item[] : [];
const reject = (message: string, code = 'CANVAS_OPERATION_UNSUPPORTED', status = 400): never => { throw new CanvasStateError(status, code, message); };
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
const validPosition = (x: unknown, y: unknown) => typeof x === 'number' && typeof y === 'number' && [x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e7);

/** Organization groups store membership separately; all card positions remain
 * in world coordinates. Legacy relative-coordinate/business groups are not adapters here. */
export function applyCanvasRelationsLayout(state: State, op: CanvasRelationsLayoutOperation) {
  const next = structuredClone(state);
  const basic = records(next.workbenchBasicNodes), images = records(next.workbenchImages);
  const cards = [...basic, ...images];
  let groups = records(next.workbenchOrganizationGroups) as Group[];
  const edges = records(next.workbenchEdges);
  const keys = new Set<string>(), affected = new Set<string>();
  const owner = (id: string) => groups.find(group => Array.isArray(group.memberIds) && group.memberIds.includes(id));
  function card(id: string, allowedGroup?: string): Item {
    const item = cards.find(node => node.id === id);
    if (!item) return reject(`Node not found: ${id}`, 'CANVAS_NODE_NOT_FOUND', 404);
    if (!images.includes(item) && !['text', 'image', 'sketch', 'storyboard', 'video', 'page'].includes(String(item.kind))) reject('Unsupported card type');
    if (item.source || item.storyboardVideoSource || item.parentId || item.groupId || item.workflowRunId || item.embeddedInSource) reject('Business-owned or legacy grouped cards require their adapter');
    for (const [key, value] of Object.entries(next)) {
      if (key === 'workbenchOrganizationGroups') continue;
      if (/groups|storyboardassets/i.test(key) && JSON.stringify(value)?.includes(JSON.stringify(id))) reject('Business-owned card');
    }
    if (basic.some(node => node.storyboard && (JSON.stringify(node.storyboard).includes(JSON.stringify(id))
      || (typeof item.path === 'string' && JSON.stringify(node.storyboard).includes(JSON.stringify(item.path)))))) reject('Storyboard-owned card');
    const group = owner(id);
    if (group && group.id !== allowedGroup) reject('Select the whole group or remove the card from its group first');
    if (!validPosition(item.x, item.y)) reject('Invalid card coordinates', 'CANVAS_INVALID_INPUT');
    return item;
  }
  function rect(item: Item): Rect {
    let width = positive(item.width, item.kind === 'text' ? 360 : 420);
    let height = positive(item.height, item.kind === 'text' ? 240 : 260);
    if (images.includes(item)) {
      const w = positive(item.naturalWidth, 320), h = positive(item.naturalHeight, 240);
      const scale = Math.min(1, 420 / w, 360 / h);
      width = positive(item.width, Math.round(w * scale)); height = positive(item.height, Math.round(h * scale));
    }
    return { id: item.id, x: Number(item.x), y: Number(item.y), width, height };
  }
  function group(id: string): Group {
    const found = groups.find(item => item.id === id);
    if (!found) return reject(`Group not found: ${id}`, 'CANVAS_GROUP_NOT_FOUND', 404);
    if (!Array.isArray(found.memberIds) || new Set(found.memberIds).size !== found.memberIds.length
      || !validPosition(found.x, found.y) || !Number.isFinite(found.width) || !Number.isFinite(found.height) || found.width <= 0 || found.height <= 0) reject('Invalid group geometry', 'CANVAS_INVALID_INPUT');
    found.memberIds.forEach(id => card(id, found.id));
    return found;
  }
  function fit(memberIds: string[], groupId?: string) {
    const boxes = memberIds.map(id => rect(card(id, groupId)));
    const x = Math.min(...boxes.map(box => box.x)) - 16, y = Math.min(...boxes.map(box => box.y)) - 16;
    const width = Math.max(...boxes.map(box => box.x + box.width)) - x + 16;
    const height = Math.max(...boxes.map(box => box.y + box.height)) - y + 16;
    if (!validPosition(x, y) || !Number.isFinite(width) || !Number.isFinite(height)) reject('Group exceeds coordinate bounds', 'CANVAS_INVALID_INPUT');
    return { x, y, width, height };
  }
  function writeCard(item: Item, x: number, y: number) {
    if (!validPosition(x, y)) reject('Layout exceeds coordinate bounds', 'CANVAS_INVALID_INPUT');
    item.x = x; item.y = y; affected.add(item.id);
    keys.add(images.includes(item) ? 'workbenchImages' : 'workbenchBasicNodes');
  }
  function moveGroup(item: Group, x: number, y: number) {
    const dx = x - item.x, dy = y - item.y;
    for (const id of item.memberIds) { const member = card(id, item.id); writeCard(member, Number(member.x) + dx, Number(member.y) + dy); }
    if (!validPosition(x, y)) reject('Invalid group coordinates', 'CANVAS_INVALID_INPUT');
    item.x = x; item.y = y; affected.add(item.id); keys.add('workbenchOrganizationGroups');
  }
  function protectGroupReferences(item: Group) {
    if (edges.some(edge => edge.source === item.id || edge.target === item.id)) reject('Disconnect group references before changing membership or dissolving');
  }
  if (op.type === 'layout.arrange') {
    const selected = op.nodeIds.map(id => groups.some(item => item.id === id) ? group(id) : rect(card(id)));
    const byMember = new Map(groups.flatMap(item => item.memberIds.map(id => [id, item.id] as const)));
    const links = edges.map(edge => ({ source: byMember.get(String(edge.source)) ?? String(edge.source), target: byMember.get(String(edge.target)) ?? String(edge.target) }));
    const positions = arrangeCanvasRects(selected, op.mode, op.gap ?? 48, op.columns, links);
    for (const position of positions) {
      const container = groups.find(item => item.id === position.id);
      if (container) moveGroup(container, position.x, position.y);
      else writeCard(card(position.id), position.x, position.y);
    }
  } else if (op.type === 'group.create') {
    if (Object.values(next).some(value => Array.isArray(value) && value.some(item => item?.id === op.groupId))) reject('Group ID already exists', 'CANVAS_ID_EXISTS', 409);
    const bounds = fit(op.nodeIds);
    groups.push({ id: op.groupId, name: op.name ?? 'Group', memberIds: [...op.nodeIds], ...bounds });
    keys.add('workbenchOrganizationGroups'); affected.add(op.groupId); op.nodeIds.forEach(id => affected.add(id));
  } else {
    const current = group(op.groupId);
    affected.add(current.id);
    if (op.type === 'group.rename') current.name = op.name;
    if (op.type === 'group.move') moveGroup(current, op.x, op.y);
    if (op.type === 'group.dissolve') { protectGroupReferences(current); groups = groups.filter(item => item.id !== current.id); current.memberIds.forEach(id => affected.add(id)); }
    if (op.type === 'group.add' || op.type === 'group.remove') {
      protectGroupReferences(current);
      for (const id of op.nodeIds) {
        card(id, op.type === 'group.remove' ? current.id : undefined);
        if (op.type === 'group.remove' && !current.memberIds.includes(id)) reject('Card is not a member', 'CANVAS_INVALID_INPUT');
        affected.add(id);
      }
      current.memberIds = op.type === 'group.add' ? [...current.memberIds, ...op.nodeIds] : current.memberIds.filter(id => !op.nodeIds.includes(id));
      // Empty groups retain their last valid frame so they remain selectable.
      if (current.memberIds.length) Object.assign(current, fit(current.memberIds, current.id));
    }
    keys.add('workbenchOrganizationGroups');
  }
  if (keys.has('workbenchOrganizationGroups')) next.workbenchOrganizationGroups = groups;
  return { state: next, keys: [...keys], nodeIds: [...affected] };
}

/** Stable, server-side layout over explicit world-space boxes. No renderer,
 * measurement cache or external layout service is required. */
export function arrangeCanvasRects(boxes: Rect[], mode: CanvasLayoutMode, gap: number, columns?: number, edges: { source: string; target: string }[] = []) {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  const positions = new Map(boxes.map(box => [box.id, { id: box.id, x: box.x, y: box.y }]));
  if (['left', 'center-x', 'right', 'top', 'center-y', 'bottom'].includes(mode)) {
    for (const box of boxes) {
      const p = positions.get(box.id)!;
      if (mode === 'left') p.x = left;
      if (mode === 'center-x') p.x = (left + right - box.width) / 2;
      if (mode === 'right') p.x = right - box.width;
      if (mode === 'top') p.y = top;
      if (mode === 'center-y') p.y = (top + bottom - box.height) / 2;
      if (mode === 'bottom') p.y = bottom - box.height;
    }
  } else if (mode === 'distribute-x' || mode === 'distribute-y') {
    if (boxes.length < 3) reject('Distribution requires at least three items', 'CANVAS_INVALID_INPUT');
    const axis = mode === 'distribute-x' ? 'x' : 'y', dimension = axis === 'x' ? 'width' : 'height';
    const ordered = [...boxes].sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id));
    const first = ordered[0]!, last = ordered.at(-1)!;
    const spacing = (last[axis] + last[dimension] - first[axis] - ordered.reduce((sum, box) => sum + box[dimension], 0)) / (ordered.length - 1);
    if (spacing < 0) reject('Insufficient span for non-overlapping distribution; use row or column', 'CANVAS_INVALID_INPUT');
    let value = first[axis];
    for (const box of ordered) { positions.get(box.id)![axis] = value; value += box[dimension] + spacing; }
  } else if (mode === 'flow') {
    const ids = new Set(boxes.map(box => box.id));
    const links = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);
    const depth = new Map<string, number>();
    const remaining = new Set(ids);
    while (remaining.size) {
      const ready = sorted.filter(box => remaining.has(box.id) && links.filter(edge => edge.target === box.id).every(edge => depth.has(edge.source)));
      if (!ready.length) reject('Cannot lay out cyclic references', 'CANVAS_INVALID_EDGE');
      for (const box of ready) {
        depth.set(box.id, Math.max(0, ...links.filter(edge => edge.target === box.id).map(edge => depth.get(edge.source)! + 1)));
        remaining.delete(box.id);
      }
    }
    let x = left;
    for (let level = 0; level <= Math.max(...depth.values()); level++) {
      const layer = sorted.filter(box => depth.get(box.id) === level); let y = top;
      for (const box of layer) { positions.set(box.id, { id: box.id, x, y }); y += box.height + gap; }
      x += Math.max(...layer.map(box => box.width)) + gap;
    }
  } else {
    const count = mode === 'row' ? sorted.length : mode === 'column' ? 1 : columns ?? Math.ceil(Math.sqrt(sorted.length));
    const widths = Array.from({ length: count }, (_, column) => Math.max(0, ...sorted.filter((_, i) => i % count === column).map(box => box.width)));
    let y = top;
    for (let offset = 0; offset < sorted.length; offset += count) {
      const row = sorted.slice(offset, offset + count); let x = left;
      row.forEach((box, column) => { positions.set(box.id, { id: box.id, x, y }); x += widths[column]! + gap; });
      y += Math.max(...row.map(box => box.height)) + gap;
    }
  }
  return [...positions.values()];
}
