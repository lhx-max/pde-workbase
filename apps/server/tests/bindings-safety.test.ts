import { afterEach, describe, expect, it } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BindingStore, BindingStoreError } from '../src/storage/bindings.js';

const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bindings-safety-'));
  roots.push(root);
  return { root, file: path.join(root, 'bindings.json'), store: new BindingStore(root) };
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('bindings-safety-')) throw new Error('Unsafe test cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
const input = { canvasInstanceId: 'canvas', nodeId: 'node', appId: 'doc', appInstanceId: 'doc-one', teamId: 'team-a', mirrorPath: 'sources/text/node.md' };

function errorCode(run: () => unknown, code: string, status = 500) {
  expect(run).toThrow(expect.objectContaining({ code, status }));
}

describe('binding index fails closed', () => {
  it('requires an explicit absolute root and treats only absent bindings.json as an empty index', () => {
    for (const root of ['', '.', 'relative']) errorCode(() => new BindingStore(root), 'BINDING_STORAGE_INVALID', 400);
    const { root, store, file } = fixture();
    expect(store.list()).toEqual([]);
    const first = store.upsert(input);
    expect(new BindingStore(root).getActive('canvas', 'node', 'doc')).toEqual(first);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(['bindings.json']);
    expect(first).toBeInstanceOf(Object);
    expect(new BindingStoreError(409, 'BINDING_CONFLICT')).toBeInstanceOf(Error);
  });

  it.each(['', '{broken', 'null', '[]', '{}', '{"version":2,"bindings":[]}', '{"version":1,"bindings":[{}]}'])('never overwrites damaged or unknown schema: %s', serialized => {
    const { file, store } = fixture();
    writeFileSync(file, serialized);
    for (const run of [() => store.list(), () => store.getActive('canvas', 'node'), () => store.upsert(input),
      () => store.archive('canvas'), () => store.reconcileNodes('canvas', [])]) {
      errorCode(run, 'BINDING_STORE_CORRUPT');
      expect(readFileSync(file, 'utf8')).toBe(serialized);
    }
  });

  it('rejects legacy duplicate active targets without dropping either historical row', () => {
    const { store, file } = fixture();
    const row = store.upsert(input);
    const serialized = JSON.stringify({ version: 1, bindings: [row, { ...row, bindingId: 'bind-two', appInstanceId: 'doc-two' }] });
    writeFileSync(file, serialized);
    errorCode(() => store.list(), 'BINDING_CONFLICT', 409);
    errorCode(() => store.upsert(input), 'BINDING_CONFLICT', 409);
    expect(readFileSync(file, 'utf8')).toBe(serialized);
  });

  it('rejects symlinked roots and index files at construction and before reads/writes', () => {
    const { root } = fixture();
    const target = path.join(root, 'target'); mkdirSync(target);
    const linkedRoot = path.join(root, 'linked'); symlinkSync(target, linkedRoot);
    errorCode(() => new BindingStore(linkedRoot), 'BINDING_STORAGE_UNSAFE');
    const storage = path.join(root, 'storage'); mkdirSync(storage);
    const store = new BindingStore(storage);
    const outside = path.join(root, 'outside.json'), linkedFile = path.join(storage, 'bindings.json');
    writeFileSync(outside, 'untouched'); symlinkSync(outside, linkedFile);
    errorCode(() => new BindingStore(storage), 'BINDING_STORAGE_UNSAFE');
    errorCode(() => store.list(), 'BINDING_STORAGE_UNSAFE');
    errorCode(() => store.upsert(input), 'BINDING_STORAGE_UNSAFE');
    expect(readFileSync(outside, 'utf8')).toBe('untouched');
    // This exact in-fixture root is replaced after store construction.
    const original = path.join(root, 'original-storage');
    expect(path.dirname(storage)).toBe(root); expect(path.dirname(original)).toBe(root);
    renameSync(storage, original); symlinkSync(target, storage);
    errorCode(() => store.list(), 'BINDING_STORAGE_UNSAFE');
    errorCode(() => store.archive('canvas'), 'BINDING_STORAGE_UNSAFE');
    expect(readdirSync(target)).toEqual([]);
  });

  it('pins an explicitly resolved root so later ancestor alias changes cannot redirect storage', () => {
    const { root } = fixture();
    const first = path.join(root, 'first'), second = path.join(root, 'second');
    mkdirSync(first); mkdirSync(second);
    const alias = path.join(root, 'alias'), oldAlias = path.join(root, 'old-alias');
    symlinkSync(first, alias);
    const store = new BindingStore(path.join(alias, 'data'));
    const saved = store.upsert(input);
    expect(path.dirname(alias)).toBe(root); expect(path.dirname(oldAlias)).toBe(root);
    renameSync(alias, oldAlias); symlinkSync(second, alias);
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(saved);
    store.archive('canvas', 'node');
    expect(readdirSync(second)).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(first, 'data', 'bindings.json'), 'utf8')).bindings[0].status).toBe('archived');
  });

  it('does not treat a directory at bindings.json as an absent or empty file', () => {
    const { file, store } = fixture(); mkdirSync(file);
    errorCode(() => store.list(), 'BINDING_STORAGE_UNSAFE');
    errorCode(() => store.upsert(input), 'BINDING_STORAGE_UNSAFE');
    expect(lstatSync(file).isDirectory()).toBe(true);
  });
});

describe('one active target with conditional archival', () => {
  it('updates the same binding idempotently but refuses another instance or owner', () => {
    const { store, file } = fixture();
    const first = store.upsert(input);
    const repeated = store.upsert({ ...input, mirrorPath: 'sources/text/new-path.md' });
    expect(repeated.bindingId).toBe(first.bindingId);
    expect(store.list()).toHaveLength(1);
    const before = readFileSync(file, 'utf8');
    errorCode(() => store.upsert({ ...input, appInstanceId: 'doc-two' }), 'BINDING_CONFLICT', 409);
    errorCode(() => store.upsert({ ...input, teamId: 'team-b' }), 'BINDING_CONFLICT', 409);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(store.getActive('canvas', 'node')).toEqual(repeated);
  });

  it('preserves permanently archived rows and ignores a late archive of the replaced target', () => {
    const { store } = fixture();
    const old = store.upsert(input);
    expect(store.archive('canvas', 'node', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-one' })).toBe(1);
    expect(store.upsert(input)).toMatchObject({ bindingId: old.bindingId, status: 'archived', archivedReason: 'asset_archived' });
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.getActive('canvas', 'node', 'doc')).toBeUndefined();
    const replacement = store.upsert({ ...input, appInstanceId: 'doc-two' });
    expect(store.archive('canvas', 'node', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-one' })).toBe(0);
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(replacement);
    expect(store.list({ includeArchived: true })).toHaveLength(2);
    errorCode(() => store.upsert(input), 'BINDING_CONFLICT', 409);
  });

  it('does not restore a card_removed archive over a replacement active target', () => {
    const { store } = fixture(); store.upsert(input);
    store.reconcileNodes('canvas', []);
    const replacement = store.upsert({ ...input, appInstanceId: 'doc-two' });
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(replacement);
    expect(store.list({ includeArchived: true }).find(row => row.appInstanceId === 'doc-one')).toMatchObject({ status: 'archived', archivedReason: 'card_removed' });
    // The old callback can upgrade only its own removed history to asset_archived.
    expect(store.archive('canvas', 'node', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-one' })).toBe(1);
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(replacement);
    store.reconcileNodes('canvas', []);
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.getActive('canvas', 'node', 'doc')?.appInstanceId).toBe('doc-two');
    expect(store.list()).toHaveLength(1);
  });

  it('restores only the newest removed target when historical timestamps tie', () => {
    const { store, file } = fixture(); store.upsert(input);
    store.reconcileNodes('canvas', []);
    store.upsert({ ...input, appInstanceId: 'doc-two' });
    store.reconcileNodes('canvas', []);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    for (const row of state.bindings) row.createdAt = row.updatedAt = '2026-01-01T00:00:00.000Z';
    writeFileSync(file, JSON.stringify(state));
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.list()).toHaveLength(1);
    expect(store.getActive('canvas', 'node', 'doc')?.appInstanceId).toBe('doc-two');
    expect(store.list({ includeArchived: true })).toHaveLength(2);
  });

  it('restores a lone removed link but never an asset/canvas archive', () => {
    const { store } = fixture(); const row = store.upsert(input);
    store.reconcileNodes('canvas', []);
    expect(store.list()).toEqual([]);
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.getActive('canvas', 'node', 'doc')?.bindingId).toBe(row.bindingId);
    expect(store.archive('canvas', undefined, 'canvas_archived')).toBe(1);
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.upsert(input).status).toBe('archived');
    expect(store.list()).toEqual([]);
  });

  it('keeps different Apps independent and requires appId for ambiguous getActive', () => {
    const { store } = fixture(); store.upsert(input);
    const sketch = store.upsert({ ...input, appId: 'sketch', appInstanceId: 'sketch-one' });
    expect(store.list()).toHaveLength(2);
    errorCode(() => store.getActive('canvas', 'node'), 'BINDING_CONFLICT', 409);
    expect(store.archive('canvas', 'node', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-one' })).toBe(1);
    expect(store.getActive('canvas', 'node')).toEqual(sketch);
  });
});
