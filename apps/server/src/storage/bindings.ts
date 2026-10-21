import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Central card↔App binding index (data-model §三). Apps keep their own
 * nodeId/mirror pointers too, but governance (list all bound assets of a
 * canvas, archive bindings when a card dies, migrate between Apps) reads
 * this table. Upserts are idempotent by canvasInstanceId+nodeId+appInstanceId. */
export interface Binding {
  bindingId: string;
  canvasInstanceId: string;
  nodeId: string;
  kind?: string;
  appId: string;
  appInstanceId: string;
  mirrorPath?: string;
  teamId?: string;
  status: 'active' | 'archived';
  archivedReason?: 'card_removed' | 'asset_archived' | 'canvas_archived';
  createdAt: string;
  updatedAt: string;
}

interface State { version: 1; bindings: Binding[] }

export class BindingStore {
  private readonly file: string;
  constructor(dataRoot: string) {
    mkdirSync(dataRoot, { recursive: true });
    this.file = path.join(dataRoot, 'bindings.json');
  }

  private load(): State {
    try {
      const state = JSON.parse(readFileSync(this.file, 'utf8')) as State;
      return state.version === 1 && Array.isArray(state.bindings) ? state : { version: 1, bindings: [] };
    } catch { return { version: 1, bindings: [] }; }
  }

  private save(state: State) {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  list(filter?: { canvasInstanceId?: string; nodeId?: string; appId?: string; teamId?: string; includeArchived?: boolean }): Binding[] {
    return this.load().bindings.filter(b =>
      (!filter?.canvasInstanceId || b.canvasInstanceId === filter.canvasInstanceId) &&
      (!filter?.nodeId || b.nodeId === filter.nodeId) &&
      (!filter?.appId || b.appId === filter.appId) &&
      (!filter?.teamId || (b.teamId ?? 'local') === filter.teamId) &&
      (filter?.includeArchived || b.status === 'active'));
  }

  upsert(input: { canvasInstanceId: string; nodeId: string; appId: string; appInstanceId: string; kind?: string; mirrorPath?: string; teamId?: string }): Binding {
    const state = this.load();
    const index = state.bindings.findIndex(b => b.canvasInstanceId === input.canvasInstanceId && b.nodeId === input.nodeId && b.appId === input.appId && b.appInstanceId === input.appInstanceId);
    const now = new Date().toISOString();
    const row: Binding = {
      bindingId: index >= 0 ? state.bindings[index]!.bindingId : `bind-${randomUUID().slice(0, 8)}`,
      canvasInstanceId: input.canvasInstanceId, nodeId: input.nodeId,
      ...(input.kind ? { kind: input.kind } : {}),
      appId: input.appId, appInstanceId: input.appInstanceId,
      ...(input.mirrorPath ? { mirrorPath: input.mirrorPath } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      status: index >= 0 ? state.bindings[index]!.status : 'active',
      ...(index >= 0 && state.bindings[index]!.archivedReason ? { archivedReason: state.bindings[index]!.archivedReason } : {}),
      createdAt: index >= 0 ? state.bindings[index]!.createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) state.bindings[index] = row; else state.bindings.push(row);
    this.save(state);
    return row;
  }

  /** A card is a reference, not ownership of an App asset. Removing it only
   * archives the link. Undo may restore that link, but never revives an asset
   * explicitly archived in its App. Shared by UI PATCH and operations. */
  reconcileNodes(canvasInstanceId: string, nodes: readonly { id?: unknown }[]): void {
    const state = this.load();
    const present = new Set(nodes.map(node => node.id));
    let changed = false;
    for (const binding of state.bindings) {
      if (binding.canvasInstanceId !== canvasInstanceId) continue;
      if (!present.has(binding.nodeId) && binding.status === 'active') {
        binding.status = 'archived'; binding.archivedReason = 'card_removed'; changed = true;
        binding.updatedAt = new Date().toISOString();
      } else if (present.has(binding.nodeId) && binding.status === 'archived' && binding.archivedReason === 'card_removed') {
        binding.status = 'active'; delete binding.archivedReason; changed = true;
        binding.updatedAt = new Date().toISOString();
      }
    }
    if (changed) this.save(state);
  }

  /** Archive — never delete rows; governance keeps the history. */
  archive(canvasInstanceId: string, nodeId?: string, reason: Binding['archivedReason'] = 'asset_archived'): number {
    const state = this.load();
    let count = 0;
    for (const b of state.bindings) {
      if (b.canvasInstanceId === canvasInstanceId && (!nodeId || b.nodeId === nodeId)
        && (b.status === 'active' || (b.archivedReason === 'card_removed' && reason !== 'card_removed'))) {
        b.status = 'archived'; b.archivedReason = reason; b.updatedAt = new Date().toISOString(); count++;
      }
    }
    if (count) this.save(state);
    return count;
  }
}
