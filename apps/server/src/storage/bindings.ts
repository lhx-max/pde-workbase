import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Storage failures and conflicting bindings are explicit, never an empty index. */
export class BindingStoreError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

/** Central card↔App index. History is retained; only one binding per
 * canvasInstanceId+nodeId+appId may be active. */
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
type BindingInput = Pick<Binding, 'canvasInstanceId' | 'nodeId' | 'appId' | 'appInstanceId' | 'kind' | 'mirrorPath' | 'teamId'>;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const keyOf = (binding: Pick<Binding, 'canvasInstanceId' | 'nodeId' | 'appId'>) => JSON.stringify([binding.canvasInstanceId, binding.nodeId, binding.appId]);
const conflict = (message: string): never => { throw new BindingStoreError(409, 'BINDING_CONFLICT', message); };
const corrupt = (): never => { throw new BindingStoreError(500, 'BINDING_STORE_CORRUPT', 'Binding index is damaged or has an unsupported schema'); };

function validateState(value: unknown): State {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return corrupt();
  const state = value as State;
  if (state.version !== 1 || !Array.isArray(state.bindings)) return corrupt();
  const ids = new Set<string>(), active = new Set<string>();
  for (const row of state.bindings) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || ![row.bindingId, row.canvasInstanceId, row.nodeId, row.appId, row.appInstanceId, row.createdAt, row.updatedAt].every(text)
      || ![row.kind, row.mirrorPath, row.teamId].every(item => item === undefined || text(item))
      || !['active', 'archived'].includes(row.status)
      || (row.archivedReason !== undefined && !['card_removed', 'asset_archived', 'canvas_archived'].includes(row.archivedReason))
      || (row.status === 'active' && row.archivedReason !== undefined)
      || ids.has(row.bindingId)) return corrupt();
    ids.add(row.bindingId);
    if (row.status === 'active') {
      const key = keyOf(row);
      if (active.has(key)) conflict('Binding index has multiple active targets for one card/App');
      active.add(key);
    }
  }
  return state;
}

export class BindingStore {
  private readonly root: string;
  private readonly file: string;
  constructor(dataRoot: string) {
    if (!dataRoot || !path.isAbsolute(dataRoot)) throw new BindingStoreError(400, 'BINDING_STORAGE_INVALID', 'An explicit absolute dataRoot is required');
    this.root = path.resolve(dataRoot);
    this.file = path.join(this.root, 'bindings.json');
    try {
      this.assertEntry(this.root, true, true);
      mkdirSync(this.root, { recursive: true });
      this.assertEntry(this.root, true);
      // Pin the explicit directory after rejecting a symlink at its leaf.
      // Platform aliases (e.g. /var -> /private/var) remain usable, while a
      // later change to an ancestor alias cannot redirect this store.
      this.root = realpathSync(this.root);
      this.file = path.join(this.root, 'bindings.json');
      this.assertEntry(this.file, false, true);
    } catch (error) { this.storageFailure(error); }
  }

  private storageFailure(error: unknown): never {
    if (error instanceof BindingStoreError) throw error;
    throw new BindingStoreError(500, 'BINDING_STORAGE_ERROR', 'Binding index storage could not be accessed');
  }

  private assertEntry(file: string, directory: boolean, allowMissing = false): void {
    // Targets are fixed beneath the explicit root, never request-controlled paths.
    if (file !== this.root && path.dirname(file) !== this.root) throw new BindingStoreError(500, 'BINDING_STORAGE_UNSAFE', 'Binding storage path escaped dataRoot');
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) {
        throw new BindingStoreError(500, 'BINDING_STORAGE_UNSAFE', 'Binding storage must not use symlinks or special files');
      }
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private load(): State {
    let descriptor: number | undefined;
    let serialized: string;
    try {
      this.assertEntry(this.root, true);
      this.assertEntry(this.file, false, true);
      try { descriptor = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, bindings: [] };
        throw error;
      }
      serialized = readFileSync(descriptor, 'utf8');
    } catch (error) { return this.storageFailure(error); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
    let value: unknown;
    try { value = JSON.parse(serialized); } catch { return corrupt(); }
    return validateState(value);
  }

  private save(state: State): void {
    validateState(state);
    const tmp = path.join(this.root, `bindings.json.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      this.assertEntry(this.root, true);
      this.assertEntry(this.file, false, true);
      this.assertEntry(tmp, false, true);
      descriptor = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, JSON.stringify(state, null, 2), 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      // Check the exact source and destination again before atomic publication.
      this.assertEntry(this.root, true);
      this.assertEntry(tmp, false);
      this.assertEntry(this.file, false, true);
      renameSync(tmp, this.file);
      descriptor = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      fsyncSync(descriptor);
    } catch (error) { this.storageFailure(error); }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  }

  list(filter?: { canvasInstanceId?: string; nodeId?: string; appId?: string; teamId?: string; includeArchived?: boolean }): Binding[] {
    return this.load().bindings.filter(b =>
      (!filter?.canvasInstanceId || b.canvasInstanceId === filter.canvasInstanceId) &&
      (!filter?.nodeId || b.nodeId === filter.nodeId) &&
      (!filter?.appId || b.appId === filter.appId) &&
      (!filter?.teamId || (b.teamId ?? 'local') === filter.teamId) &&
      (filter?.includeArchived || b.status === 'active'));
  }

  getActive(canvasInstanceId: string, nodeId: string, appId?: string): Binding | undefined {
    const rows = this.list({ canvasInstanceId, nodeId, ...(appId ? { appId } : {}) });
    if (rows.length > 1) conflict('Multiple Apps are bound to this card; specify appId');
    return rows[0];
  }

  upsert(input: BindingInput): Binding {
    if (![input.canvasInstanceId, input.nodeId, input.appId, input.appInstanceId].every(text)
      || ![input.kind, input.mirrorPath, input.teamId].every(item => item === undefined || text(item))) {
      throw new BindingStoreError(400, 'BINDING_INVALID_INPUT', 'Binding identifiers must be non-empty strings');
    }
    const state = this.load(), key = keyOf(input);
    const active = state.bindings.find(b => keyOf(b) === key && b.status === 'active');
    if (active && active.appInstanceId !== input.appInstanceId) conflict('Card/App is already bound to another instance');
    const index = state.bindings.findIndex(b => keyOf(b) === key && b.appInstanceId === input.appInstanceId);
    const previous = index >= 0 ? state.bindings[index]! : undefined;
    if (previous && input.teamId !== undefined && (previous.teamId ?? 'local') !== input.teamId) conflict('Binding tenant cannot be reassigned');
    const now = new Date().toISOString();
    const row: Binding = {
      ...previous,
      bindingId: previous?.bindingId ?? `bind-${randomUUID()}`,
      canvasInstanceId: input.canvasInstanceId, nodeId: input.nodeId,
      ...(input.kind ? { kind: input.kind } : {}),
      appId: input.appId, appInstanceId: input.appInstanceId,
      ...(input.mirrorPath ? { mirrorPath: input.mirrorPath } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      // Upsert never revives archives. Only card_removed reconciliation may do so.
      status: previous?.status ?? 'active',
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    if (index >= 0) state.bindings[index] = row; else state.bindings.push(row);
    this.save(state);
    return row;
  }

  /** Undo restores a removed link only if that card/App has no replacement. */
  reconcileNodes(canvasInstanceId: string, nodes: readonly { id?: unknown }[]): void {
    const state = this.load(), present = new Set(nodes.map(node => node.id));
    let changed = false;
    for (const binding of state.bindings) {
      if (binding.canvasInstanceId === canvasInstanceId && !present.has(binding.nodeId) && binding.status === 'active') {
        binding.status = 'archived'; binding.archivedReason = 'card_removed'; changed = true;
        binding.updatedAt = new Date().toISOString();
      }
    }
    const active = new Set(state.bindings.filter(b => b.status === 'active').map(keyOf));
    // If historical removed links compete, restore the most recently updated one.
    const removed = state.bindings.filter(b => b.canvasInstanceId === canvasInstanceId && present.has(b.nodeId)
      && b.status === 'archived' && b.archivedReason === 'card_removed')
      .reverse().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
    for (const binding of removed) {
      const key = keyOf(binding);
      if (active.has(key)) continue;
      binding.status = 'active'; delete binding.archivedReason;
      binding.updatedAt = new Date().toISOString(); active.add(key); changed = true;
    }
    if (changed) this.save(state);
  }

  /** Conditional archival prevents an old App callback from killing its replacement. */
  archive(canvasInstanceId: string, nodeId?: string, reason: Binding['archivedReason'] = 'asset_archived', expected?: { appId: string; appInstanceId: string }): number {
    const state = this.load();
    let count = 0;
    for (const b of state.bindings) {
      if (b.canvasInstanceId === canvasInstanceId && (!nodeId || b.nodeId === nodeId)
        && (!expected || (b.appId === expected.appId && b.appInstanceId === expected.appInstanceId))
        && (b.status === 'active' || (b.archivedReason === 'card_removed' && reason !== 'card_removed'))) {
        b.status = 'archived'; b.archivedReason = reason; b.updatedAt = new Date().toISOString(); count++;
      }
    }
    if (count) this.save(state);
    return count;
  }
}
