import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSyncJournal, type DocumentSyncEntry } from '../src/storage/document-sync-journal.js';

const faults = vi.hoisted(() => ({ syncCalls: 0, failOnSync: 0 }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync(fd: number) {
    faults.syncCalls++;
    if (faults.failOnSync === faults.syncCalls) throw new Error('Injected fsync failure');
    actual.fsyncSync(fd);
  } };
});
const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'document-sync-journal-'));
  roots.push(root);
  return { root, directory: path.join(root, 'document-sync'), journal: new DocumentSyncJournal(root) };
};
afterEach(() => {
  faults.failOnSync = 0; faults.syncCalls = 0;
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('document-sync-journal-')) throw new Error('Unsafe test cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
const entry: DocumentSyncEntry = {
  projectId: 'project', nodeId: 'node', appId: 'doc', teamId: 'team', userId: 'user',
  generation: 1, canvasRevision: 0, mirrorPath: 'sources/text/node.md', title: '', content: '', baseContent: '', remoteContent: '',
  status: 'pending', attempts: 0, nextAttemptAt: 0, updatedAt: 0, error: '',
};
const filename = (value = entry) => createHash('sha256').update(JSON.stringify([value.projectId, value.nodeId])).digest('hex') + '.json';
const input = (patch: Partial<DocumentSyncEntry> = {}) => {
  const { generation: _generation, status: _status, attempts: _attempts, nextAttemptAt: _nextAttemptAt, updatedAt: _updatedAt, ...body } = { ...entry, ...patch };
  return body;
};
const errorCode = (run: () => unknown, code: string, status = 500) => expect(run).toThrow(expect.objectContaining({ code, status }));

describe('document sync journal storage safety', () => {
  it('requires an explicit absolute root and round-trips empty content fields with private file modes', () => {
    for (const root of ['', '.', 'relative']) errorCode(() => new DocumentSyncJournal(root), 'DOCUMENT_SYNC_STORAGE_INVALID', 400);
    const { root, directory, journal } = fixture();
    expect(journal.get(entry.projectId, entry.nodeId)).toBeUndefined();
    expect(journal.list()).toEqual([]);
    faults.syncCalls = 0;
    journal.put(entry);
    expect(faults.syncCalls).toBe(2); // payload and containing directory
    expect(new DocumentSyncJournal(root).get(entry.projectId, entry.nodeId)).toEqual(entry);
    expect(readdirSync(directory)).toEqual([filename()]);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    expect(lstatSync(path.join(directory, filename())).mode & 0o777).toBe(0o600);
  });

  it.each(['', '{broken', 'null', '[]', '{}', JSON.stringify({ ...entry, unknownVersion: 2 }),
    JSON.stringify({ ...entry, status: 'unknown' }), JSON.stringify({ ...entry, generation: 0 }),
    JSON.stringify({ ...entry, attempts: -1 }), JSON.stringify({ ...entry, canvasRevision: 0.5 }),
    JSON.stringify({ ...entry, nextAttemptAt: null }), JSON.stringify({ ...entry, updatedAt: 'today' }),
    JSON.stringify({ ...entry, content: null }), JSON.stringify({ ...entry, baseContent: 1 }),
    JSON.stringify({ ...entry, remoteContent: [] }), JSON.stringify({ ...entry, documentId: '' }),
    JSON.stringify({ ...entry, projectId: '' })])('fails closed without overwriting malformed schema %s', serialized => {
    const { directory, journal } = fixture();
    const file = path.join(directory, filename()); writeFileSync(file, serialized);
    for (const run of [() => journal.get(entry.projectId, entry.nodeId), () => journal.list(), () => journal.list('other-project'),
      () => journal.put(entry), () => journal.enqueue(input()), () => journal.update(entry, { status: 'synced' })]) {
      errorCode(run, 'DOCUMENT_SYNC_CORRUPT');
      expect(readFileSync(file, 'utf8')).toBe(serialized);
    }
  });

  it('validates hashes and refuses unknown committed filenames rather than ignoring or deleting them', () => {
    const { directory, journal } = fixture();
    const file = path.join(directory, filename());
    writeFileSync(file, JSON.stringify({ ...entry, nodeId: 'wrong-node' }));
    errorCode(() => journal.get(entry.projectId, entry.nodeId), 'DOCUMENT_SYNC_CORRUPT');
    errorCode(() => journal.list(), 'DOCUMENT_SYNC_CORRUPT');
    writeFileSync(file, JSON.stringify(entry));
    const unknown = path.join(directory, 'unknown.json'); writeFileSync(unknown, JSON.stringify(entry));
    errorCode(() => journal.list(), 'DOCUMENT_SYNC_CORRUPT');
    expect(readFileSync(unknown, 'utf8')).toBe(JSON.stringify(entry));
    // Independent known entries remain individually readable.
    expect(journal.get(entry.projectId, entry.nodeId)).toEqual(entry);
  });

  it('ignores leftover temporary files without reading or cleaning them', () => {
    const { directory, journal } = fixture(); journal.put(entry);
    const tmp = path.join(directory, `${filename()}.old.tmp`); writeFileSync(tmp, 'unfinished json');
    const linkedTmp = path.join(directory, 'untrusted.tmp'); symlinkSync('/does-not-exist', linkedTmp);
    expect(journal.list()).toEqual([entry]);
    expect(readFileSync(tmp, 'utf8')).toBe('unfinished json');
    expect(lstatSync(linkedTmp).isSymbolicLink()).toBe(true);
  });

  it('rejects invalid writes before publishing and leaves the current entry intact', () => {
    const { directory, journal } = fixture(); journal.put(entry);
    for (const patch of [{ generation: Infinity }, { updatedAt: NaN }, { generation: -1 }, { content: undefined }, { userId: '' }]) {
      errorCode(() => journal.put({ ...entry, ...patch } as DocumentSyncEntry), 'DOCUMENT_SYNC_INVALID_INPUT', 400);
      expect(journal.get(entry.projectId, entry.nodeId)).toEqual(entry);
    }
    expect(readdirSync(directory)).toEqual([filename()]);
  });

  it('rejects root, journal directory and committed entry symlinks on both initial and later access', () => {
    const { root, directory, journal } = fixture();
    const target = path.join(root, 'target'); mkdirSync(target);
    const linkedRoot = path.join(root, 'linked-root'); symlinkSync(target, linkedRoot);
    errorCode(() => new DocumentSyncJournal(linkedRoot), 'DOCUMENT_SYNC_STORAGE_UNSAFE');
    const outside = path.join(root, 'outside.json'); writeFileSync(outside, JSON.stringify(entry));
    symlinkSync(outside, path.join(directory, filename()));
    for (const run of [() => journal.get(entry.projectId, entry.nodeId), () => journal.list(), () => journal.put(entry)]) {
      errorCode(run, 'DOCUMENT_SYNC_STORAGE_UNSAFE');
    }
    expect(readFileSync(outside, 'utf8')).toBe(JSON.stringify(entry));
    const oldDirectory = path.join(root, 'old-document-sync');
    expect(path.dirname(directory)).toBe(root); expect(path.dirname(oldDirectory)).toBe(root);
    renameSync(directory, oldDirectory); symlinkSync(target, directory);
    errorCode(() => new DocumentSyncJournal(root), 'DOCUMENT_SYNC_STORAGE_UNSAFE');
    errorCode(() => journal.list(), 'DOCUMENT_SYNC_STORAGE_UNSAFE');
    errorCode(() => journal.put(entry), 'DOCUMENT_SYNC_STORAGE_UNSAFE');
    expect(readdirSync(target)).toEqual([]);
  });

  it('does not confuse missing journal directories or directory-shaped entries with absent intents', () => {
    const { root, directory, journal } = fixture();
    mkdirSync(path.join(directory, filename()));
    errorCode(() => journal.get(entry.projectId, entry.nodeId), 'DOCUMENT_SYNC_STORAGE_UNSAFE');
    const moved = path.join(root, 'moved');
    expect(path.dirname(directory)).toBe(root); expect(path.dirname(moved)).toBe(root);
    renameSync(directory, moved);
    errorCode(() => journal.get(entry.projectId, entry.nodeId), 'DOCUMENT_SYNC_STORAGE_ERROR');
    errorCode(() => journal.list(), 'DOCUMENT_SYNC_STORAGE_ERROR');
  });

  it('pins the explicit root so later ancestor alias replacement cannot redirect writes', () => {
    const { root } = fixture();
    const first = path.join(root, 'first'), second = path.join(root, 'second'); mkdirSync(first); mkdirSync(second);
    const alias = path.join(root, 'alias'), oldAlias = path.join(root, 'old-alias'); symlinkSync(first, alias);
    const journal = new DocumentSyncJournal(path.join(alias, 'data')); journal.put(entry);
    expect(path.dirname(alias)).toBe(root); expect(path.dirname(oldAlias)).toBe(root);
    renameSync(alias, oldAlias); symlinkSync(second, alias);
    journal.put({ ...entry, content: 'still in original root' });
    expect(journal.get(entry.projectId, entry.nodeId)?.content).toBe('still in original root');
    expect(readdirSync(second)).toEqual([]);
  });

  it('preserves the previous intent if payload fsync fails and leaves the temporary file for inspection', () => {
    const { directory, journal } = fixture(); journal.put(entry);
    faults.syncCalls = 0; faults.failOnSync = 1;
    errorCode(() => journal.put({ ...entry, content: 'not durable' }), 'DOCUMENT_SYNC_STORAGE_ERROR');
    expect(journal.get(entry.projectId, entry.nodeId)).toEqual(entry);
    expect(journal.list()).toEqual([entry]);
    expect(readdirSync(directory).filter(name => name.endsWith('.tmp'))).toHaveLength(1);
  });

  it('does not roll back published content after directory fsync fails', () => {
    const { journal } = fixture(); journal.put(entry);
    faults.syncCalls = 0; faults.failOnSync = 2;
    const next = { ...entry, content: 'published' };
    errorCode(() => journal.put(next), 'DOCUMENT_SYNC_STORAGE_ERROR');
    expect(journal.get(entry.projectId, entry.nodeId)).toEqual(next);
  });
});

describe('journal enqueue and update semantics remain unchanged', () => {
  it('keeps per-card records independent and validates before project filtering', () => {
    const { journal } = fixture(); journal.put(entry);
    const other = { ...entry, projectId: 'other', content: 'other' }; journal.put(other);
    expect(journal.list('other')).toEqual([other]);
    expect(journal.list().map(row => row.projectId).sort()).toEqual(['other', 'project']);
  });

  it('deduplicates the same canvas intent, increments generations and preserves an outstanding baseline', () => {
    const { journal } = fixture();
    const first = journal.enqueue(input({ content: 'first', baseContent: 'baseline', documentId: 'doc-one' }));
    expect(first).toMatchObject({ generation: 1, status: 'pending', attempts: 0, nextAttemptAt: 0 });
    expect(journal.enqueue(input({ content: 'first', baseContent: 'ignored duplicate' }))).toEqual(first);
    const second = journal.enqueue(input({ content: 'second', canvasRevision: 1, baseContent: 'must not replace outstanding baseline' }));
    expect(second).toMatchObject({ generation: 2, content: 'second', baseContent: 'baseline', documentId: 'doc-one' });
    expect(journal.update(first, { status: 'synced' })).toBe(false);
    expect(journal.update(second, { status: 'synced', content: 'confirmed' })).toBe(true);
    const third = journal.enqueue(input({ content: 'third', canvasRevision: 2, baseContent: '' }));
    expect(third).toMatchObject({ generation: 3, baseContent: '', documentId: 'doc-one', status: 'pending' });
  });

  it('never lets an older canvas callback replace a newer durable intent or its actor', () => {
    const { directory, journal } = fixture();
    journal.enqueue(input({ content: 'initial', canvasRevision: 1, userId: 'first-actor' }));
    const newer = journal.enqueue(input({ content: 'new-content', canvasRevision: 30, userId: 'new-actor', baseContent: 'new-base' }));
    const before = readFileSync(path.join(directory, filename()), 'utf8');
    const late = journal.enqueue(input({ content: 'old-content', canvasRevision: 20, userId: 'old-actor', baseContent: 'old-base', documentId: 'old-doc' }));
    expect(late).toEqual(newer);
    expect(late).toMatchObject({ generation: 2, canvasRevision: 30, content: 'new-content', userId: 'new-actor' });
    expect(journal.get(entry.projectId, entry.nodeId)).toEqual(newer);
    expect(readFileSync(path.join(directory, filename()), 'utf8')).toBe(before);
  });

  it('uses prior synced content as a baseline when the next input omits it, and returns false for absent updates', () => {
    const { journal } = fixture();
    expect(journal.update(entry, { status: 'synced' })).toBe(false);
    journal.put({ ...entry, status: 'synced', content: 'previous confirmed' });
    const nextInput = input({ content: 'new', canvasRevision: 1 }); delete nextInput.baseContent;
    expect(journal.enqueue(nextInput).baseContent).toBe('previous confirmed');
  });
});
