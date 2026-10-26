import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { BindingStore } from '../src/storage/bindings.js';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';
import { AuditLog } from '../src/storage/audit-log.js';
import { DocumentSyncJournal, type DocumentSyncEntry } from '../src/storage/document-sync-journal.js';

/** In-memory JsonStatePort double: synchronous reads see enqueued writes,
 * serialized payloads are cloned, and injected failures poison nothing else. */
class FakeStatePort implements JsonStatePort {
  readonly ready: Promise<void> = Promise.resolve();
  readonly slots = new Map<string, unknown>();
  flushes = 0;
  failRead: Error | undefined;
  failWrite: Error | undefined;
  failFlush: Error | undefined;
  onFlush: (() => void) | undefined;
  read(key: string): unknown {
    if (this.failRead) throw this.failRead;
    const value = this.slots.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  write(key: string, value: unknown): void {
    if (this.failWrite) throw this.failWrite;
    this.slots.set(key, JSON.parse(JSON.stringify(value)));
  }
  async flush(): Promise<void> {
    this.flushes++;
    this.onFlush?.();
    if (this.failFlush) throw this.failFlush;
  }
}

const roots: string[] = [];
/** A real temp parent for cleanup tracking; the dataRoot itself is never created. */
const cloudRoot = () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'cloud-control-'));
  roots.push(base);
  return { base, dataRoot: path.join(base, 'authoritative') };
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('cloud-control-')) throw new Error('Unsafe test cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
const errorCode = (run: () => unknown, code: string, status = 500) => expect(run).toThrow(expect.objectContaining({ code, status }));

const bindingInput = { canvasInstanceId: 'canvas', nodeId: 'node', appId: 'doc', appInstanceId: 'doc-one', teamId: 'team-a', mirrorPath: 'sources/text/node.md' };
const tenant = { teamId: 'team-a', userId: 'bob' };

describe('cloud binding store keeps exact semantics over a state port', () => {
  it('creates no local authoritative files and round-trips through reconstruction', () => {
    const { base, dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const store = new BindingStore(dataRoot, port);
    const first = store.upsert(bindingInput);
    expect(first.status).toBe('active');
    const slot = port.slots.get('bindings') as { version: number; bindings: unknown[] };
    expect(slot.version).toBe(1);
    expect(slot.bindings).toHaveLength(1);
    // A new store over the same port data is the recovery path.
    const reopened = new BindingStore(dataRoot, port);
    expect(reopened.getActive('canvas', 'node', 'doc')).toEqual(first);
    expect(reopened.list()).toEqual([first]);
    expect(existsSync(dataRoot)).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it('preserves the archived lifecycle and tenant guards', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const store = new BindingStore(dataRoot, port);
    const first = store.upsert(bindingInput);
    store.reconcileNodes('canvas', []);
    expect(store.list()).toEqual([]);
    // A replacement target makes the old archived row history only.
    const replacement = store.upsert({ ...bindingInput, appInstanceId: 'doc-two' });
    store.reconcileNodes('canvas', [{ id: 'node' }]);
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(replacement);
    expect(store.list({ includeArchived: true })).toHaveLength(2);
    // Tenant reassignment and a conflicting live instance stay forbidden.
    errorCode(() => store.upsert({ ...bindingInput, appInstanceId: 'doc-two', teamId: 'team-b' }), 'BINDING_CONFLICT', 409);
    errorCode(() => store.upsert(bindingInput), 'BINDING_CONFLICT', 409);
    expect(store.archive('canvas', 'node', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-one' })).toBe(1);
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(replacement);
    expect(new BindingStore(dataRoot, port).list({ includeArchived: true })).toHaveLength(2);
    expect(first.bindingId).not.toBe(replacement.bindingId);
  });

  it('treats only an absent slot as empty and fails closed on malformed data', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const store = new BindingStore(dataRoot, port);
    expect(store.list()).toEqual([]);
    const row = store.upsert(bindingInput);
    for (const damaged of ['text', 7, null, [], {}, { version: 2, bindings: [] }, { version: 1, bindings: [{}] },
      { version: 1, bindings: [row, { ...row, bindingId: 'bind-two', appInstanceId: 'doc-two' }] }]) {
      port.slots.set('bindings', damaged);
      for (const run of [() => store.list(), () => store.upsert(bindingInput), () => store.archive('canvas'), () => store.reconcileNodes('canvas', [])]) {
        expect(run).toThrow(expect.objectContaining({ status: expect.any(Number), code: expect.stringMatching(/^BINDING/) }));
      }
    }
  });

  it('propagates storage failures instead of returning an empty or stale index', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const store = new BindingStore(dataRoot, port);
    const row = store.upsert(bindingInput);
    port.failWrite = new Error('injected write failure');
    expect(() => store.upsert({ ...bindingInput, mirrorPath: 'other.md' })).toThrow('injected write failure');
    port.failWrite = undefined;
    port.failRead = new Error('injected read failure');
    expect(() => store.list()).toThrow('injected read failure');
    expect(() => store.getActive('canvas', 'node', 'doc')).toThrow('injected read failure');
    port.failRead = undefined;
    expect(store.getActive('canvas', 'node', 'doc')).toEqual(row);
  });
});

describe('cloud entitlement store keeps deny policy authoritative', () => {
  it('persists rules and keeps deny decisions across reconstruction', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const store = new AppEntitlementStore(dataRoot, port);
    expect(store.resolve('doc', tenant)).toBe('allow');
    store.put({ scope: 'user:bob', appId: 'doc', effect: 'deny', updatedBy: 'admin' });
    store.put({ scope: 'team:team-a', appId: 'doc', effect: 'allow' });
    const slot = port.slots.get('app-entitlements') as { version: number; rules: unknown[] };
    expect(slot.version).toBe(1);
    expect(slot.rules).toHaveLength(2);
    const reopened = new AppEntitlementStore(dataRoot, port);
    expect(reopened.resolve('doc', tenant)).toBe('deny');
    expect(reopened.resolve('doc', { teamId: 'team-a', userId: 'carol' })).toBe('allow');
    expect(reopened.remove('user:bob', 'doc')).toBe(true);
    expect(new AppEntitlementStore(dataRoot, port).resolve('doc', tenant)).toBe('allow');
  });

  it('never converts storage errors or malformed policy into default-allow', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const store = new AppEntitlementStore(dataRoot, port);
    store.put({ scope: '*', appId: 'doc', effect: 'deny' });
    port.failRead = new Error('injected read failure');
    expect(() => store.resolve('doc', tenant)).toThrow('injected read failure');
    expect(() => store.list()).toThrow('injected read failure');
    port.failRead = undefined;
    for (const damaged of ['broken', [], { version: 1, rules: [{ scope: '*' }] }, { version: 1, rules: [{ id: 'r', scope: 'org:x', appId: 'doc', effect: 'deny', updatedAt: 'now' }] }]) {
      port.slots.set('app-entitlements', damaged);
      errorCode(() => store.resolve('doc', tenant), 'APP_ENTITLEMENTS_CORRUPT');
      errorCode(() => store.list(), 'APP_ENTITLEMENTS_CORRUPT');
      errorCode(() => store.put({ scope: '*', appId: 'doc', effect: 'allow' }), 'APP_ENTITLEMENTS_CORRUPT');
    }
    port.slots.delete('app-entitlements');
    expect(store.resolve('doc', tenant)).toBe('allow');
  });
});

describe('cloud audit log fails closed and never drops history', () => {
  const entry = { actor: tenant, action: 'entitlement.put', appId: 'doc', targetId: 'ent-1', status: 'succeeded' as const, summary: 'test' };
  it('records typed rows, filters, and recovers through reconstruction', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const audit = new AuditLog(dataRoot, port);
    audit.record(entry);
    audit.record({ actor: { teamId: 'other', userId: 'eve' }, action: 'binding.upsert', status: 'failed' });
    const slot = port.slots.get('audit') as { version: number; entries: { auditId: string; status: string }[] };
    expect(slot.version).toBe(1);
    expect(slot.entries).toHaveLength(2);
    const reopened = new AuditLog(dataRoot, port);
    expect(reopened.list({ teamId: 'team-a' })).toHaveLength(1);
    expect(reopened.list({ appId: 'doc' })[0]).toMatchObject({ action: 'entitlement.put', status: 'succeeded' });
    expect(reopened.list({ limit: 1 })).toHaveLength(1);
    expect(reopened.list()[0]!.auditId).toMatch(/^audit-/);
  });

  it('throws on record/list failures and on malformed history', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const audit = new AuditLog(dataRoot, port);
    audit.record(entry);
    port.failWrite = new Error('injected write failure');
    expect(() => audit.record(entry)).toThrow('injected write failure');
    port.failWrite = undefined;
    port.failRead = new Error('injected read failure');
    expect(() => audit.record(entry)).toThrow('injected read failure');
    expect(() => audit.list()).toThrow('injected read failure');
    port.failRead = undefined;
    port.slots.set('audit', { version: 1, entries: [{ auditId: 'audit-x' }] });
    errorCode(() => audit.list(), 'AUDIT_LOG_CORRUPT');
    errorCode(() => audit.record(entry), 'AUDIT_LOG_CORRUPT');
  });

  it('rejects an invalid row before it can poison the slot', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const audit = new AuditLog(dataRoot, port);
    audit.record(entry);
    const before = JSON.stringify(port.slots.get('audit'));
    errorCode(() => audit.record({ ...entry, status: 'bogus' as 'succeeded' }), 'AUDIT_LOG_INVALID', 400);
    errorCode(() => audit.record({ ...entry, actor: { teamId: '', userId: 'x' } }), 'AUDIT_LOG_INVALID', 400);
    expect(JSON.stringify(port.slots.get('audit'))).toBe(before);
  });

  it('reports the storage bound explicitly rather than dropping history', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const full = { version: 1, entries: Array.from({ length: 4096 }, (_, index) => ({
      auditId: `audit-${index}`, actor: tenant, action: 'canvas.create', status: 'succeeded', createdAt: new Date(0).toISOString(),
    })) };
    port.slots.set('audit', full);
    const audit = new AuditLog(dataRoot, port);
    errorCode(() => audit.record(entry), 'AUDIT_LOG_LIMIT');
    expect((port.slots.get('audit') as typeof full).entries).toHaveLength(4096);
    expect(audit.list({ limit: 1 })[0]!.auditId).toBe('audit-4095');
  });
});

describe('cloud document sync journal exact identity recovery', () => {
  const entry: DocumentSyncEntry = {
    projectId: 'project', nodeId: 'node', appId: 'doc', teamId: 'team-a', userId: 'bob',
    generation: 1, canvasRevision: 2, mirrorPath: 'sources/text/node.md', title: 'Doc', content: 'B', baseContent: 'A',
    status: 'pending', attempts: 1, nextAttemptAt: 0, updatedAt: 5, error: '', documentId: 'doc-1', documentRevision: 'rev', remoteContent: 'M',
  };
  const whitelist = new Set(['projectId', 'nodeId', 'appId', 'teamId', 'userId', 'generation', 'canvasRevision',
    'mirrorPath', 'title', 'content', 'baseContent', 'documentId', 'documentRevision', 'status', 'attempts',
    'nextAttemptAt', 'updatedAt', 'error', 'remoteContent']);

  it('recovers pending/blocked rows exactly and keeps enqueue/update semantics', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const journal = new DocumentSyncJournal(dataRoot, port);
    const input = { projectId: 'project', nodeId: 'node', appId: 'doc', teamId: 'team-a', userId: 'bob',
      canvasRevision: 2, mirrorPath: 'sources/text/node.md', content: 'B', baseContent: 'A' };
    const enqueued = journal.enqueue(input);
    expect(enqueued).toMatchObject({ generation: 1, status: 'pending', attempts: 0, nextAttemptAt: 0 });
    expect(journal.update(enqueued, { status: 'blocked', error: 'DOC_FORBIDDEN: denied', attempts: 1 })).toBe(true);
    // Reconstruction over the same port data is the reopen path.
    const reopened = new DocumentSyncJournal(dataRoot, port);
    const restored = reopened.get('project', 'node');
    expect(restored).toMatchObject({ status: 'blocked', content: 'B', baseContent: 'A', canvasRevision: 2, userId: 'bob', attempts: 1 });
    expect(reopened.list('project')).toEqual([restored]);
    expect(reopened.list('other')).toEqual([]);
    const second = reopened.enqueue({ ...input, content: 'C', canvasRevision: 3, baseContent: 'ignored' });
    expect(second).toMatchObject({ generation: 2, content: 'C', baseContent: 'A' });
    expect(new DocumentSyncJournal(dataRoot, port).list()[0]).toMatchObject({ generation: 2, status: 'pending' });
    const slot = port.slots.get('document-sync') as { version: number; entries: Record<string, unknown>[] };
    expect(slot.version).toBe(1);
    for (const row of slot.entries) expect(Object.keys(row).every(key => whitelist.has(key))).toBe(true);
  });

  it('fails closed on malformed slots, duplicate identities and ad-hoc keys — credentials never persist', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const journal = new DocumentSyncJournal(dataRoot, port);
    journal.put(entry);
    errorCode(() => journal.put({ ...entry, token: 'secret' } as DocumentSyncEntry), 'DOCUMENT_SYNC_INVALID_INPUT', 400);
    errorCode(() => journal.put({ ...entry, credentials: { password: 'x' } } as DocumentSyncEntry), 'DOCUMENT_SYNC_INVALID_INPUT', 400);
    const stored = port.slots.get('document-sync') as { entries: Record<string, unknown>[] };
    expect(stored.entries).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toMatch(/token|password|secret|credential/i);
    for (const damaged of ['text', null, [], {}, { version: 2, entries: [] }, { version: 1, entries: [{ ...entry, projectId: '' }] },
      { version: 1, entries: [entry, { ...entry, documentId: 'other' }] }, { version: 1, entries: [{ ...entry, token: 's' }] }]) {
      port.slots.set('document-sync', damaged);
      errorCode(() => journal.list(), 'DOCUMENT_SYNC_CORRUPT');
      errorCode(() => journal.get('project', 'node'), 'DOCUMENT_SYNC_CORRUPT');
      errorCode(() => journal.put(entry), 'DOCUMENT_SYNC_CORRUPT');
    }
  });

  it('propagates storage failures instead of an empty journal', () => {
    const { dataRoot } = cloudRoot();
    const port = new FakeStatePort();
    const journal = new DocumentSyncJournal(dataRoot, port);
    journal.put(entry);
    port.failWrite = new Error('injected write failure');
    expect(() => journal.put({ ...entry, content: 'new' })).toThrow('injected write failure');
    port.failWrite = undefined;
    port.failRead = new Error('injected read failure');
    expect(() => journal.get('project', 'node')).toThrow('injected read failure');
    expect(() => journal.list()).toThrow('injected read failure');
    port.failRead = undefined;
    expect(journal.get('project', 'node')).toEqual(entry);
  });
});
