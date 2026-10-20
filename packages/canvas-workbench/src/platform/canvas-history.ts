type State = Record<string, unknown>;
type Part = string | { id: string; index: number };
type Change = { path: Part[]; before: unknown; after: unknown };
const keys = new Set(['dismissedWorkflowResults', 'workbenchInstances', 'workbenchBasicNodes', 'workbenchImages', 'workbenchImageGroups', 'workbenchOrganizationGroups', 'workbenchWorkflowRunGroups', 'workbenchPromptCards', 'workbenchEdges', 'workbenchWorkflowStagePositionsV2', 'workbenchTaskDrafts', 'storyboardAssetGroupPositions']);
const equal = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const entities = (v: unknown): v is Array<Record<string, unknown> & { id: string }> => Array.isArray(v) && v.every(item => object(item) && typeof item.id === 'string');

function diff(before: unknown, after: unknown, path: Part[], output: Change[]) {
  if (equal(before, after)) return;
  if (entities(before) && entities(after)) {
    const old = new Map(before.map(item => [item.id, item]));
    const indexes = new Map(before.map((item, index) => [item.id, index]));
    const next = new Map(after.map(item => [item.id, item]));
    for (const id of new Set([...old.keys(), ...next.keys()])) diff(old.get(id), next.get(id), [...path, { id, index: indexes.get(id) ?? -1 }], output);
  } else if (object(before) && object(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[key], after[key], [...path, key], output);
  } else output.push({ path, before, after });
}

function changes(before: State, after: State) {
  const result: Change[] = [];
  for (const key of keys) {
    const fallback = key === 'workbenchWorkflowRunGroups' || key === 'dismissedWorkflowResults' || key === 'workbenchTaskDrafts' || key === 'workbenchWorkflowStagePositionsV2' || key === 'storyboardAssetGroupPositions' ? {} : [];
    diff(before[key] ?? fallback, after[key] ?? fallback, [key], result);
  }
  return result;
}

function restore(current: unknown, path: Part[], expected: unknown, value: unknown): unknown {
  if (!path.length) return equal(current, expected) ? value : current;
  const [part, ...rest] = path;
  if (typeof part === 'string') {
    if (!object(current)) return current;
    const next = restore(current[part], rest, expected, value);
    if (equal(next, current[part])) return current;
    const result = { ...current };
    if (next === undefined) delete result[part]; else result[part] = next;
    return result;
  }
  if (!part || !entities(current)) return current;
  const index = current.findIndex(item => item.id === part.id);
  const next = restore(current[index], rest, expected, value);
  if (equal(next, current[index])) return current;
  const result = [...current];
  if (next === undefined) result.splice(index, 1);
  else if (index < 0) result.splice(part.index < 0 ? result.length : part.index, 0, next as typeof current[number]);
  else result[index] = next as typeof current[number];
  return result;
}

/** Session-local field deltas. Remote changes to the same field win over undo. */
export class CanvasHistory {
  private past: Change[][] = [];
  private future: Change[][] = [];
  clear() { this.past = []; this.future = []; }
  record(before: State, after: State) {
    const entry = changes(before, after);
    if (!entry.length) return;
    this.past = [...this.past.slice(-49), entry];
    this.future = [];
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  step(current: State, redo = false): State {
    const from = redo ? this.future : this.past;
    const to = redo ? this.past : this.future;
    const entry = from.pop();
    if (!entry) return current;
    let next: unknown = current;
    for (const change of [...entry].reverse()) next = restore(next, change.path, change.after, change.before);
    // Only the changes actually applied can be redone; preserve concurrent updates.
    const inverse = changes(current, next as State);
    if (inverse.length) { to.push(inverse); if (to.length > 50) to.shift(); }
    return next as State;
  }
}
