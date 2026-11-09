import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocSynchronizer } from '../src/canvas/doc-sync.js';
import type { CanvasStateService, CanvasStateSnapshot } from '../src/canvas/state.js';
import { AppRegistryStore } from '../src/storage/app-registry.js';
import { BindingStore } from '../src/storage/bindings.js';
import { AuditLog } from '../src/storage/audit-log.js';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';
import { runWithRequestTenant } from '../src/tenant.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const actor = { teamId: 'team-a', userId: 'editor-bob' };
const roots: string[] = [];
const synchronizers: ReturnType<typeof createDocSynchronizer>[] = [];
afterEach(async () => {
  await Promise.all(synchronizers.splice(0).map(sync => sync.close()));
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    const resolved = await realpath(root);
    if (path.dirname(resolved) !== await realpath(os.tmpdir()) || !path.basename(resolved).startsWith('doc-sync-recovery-')) throw new Error('Unsafe cleanup');
    await rm(resolved, { recursive: true, force: true });
  }
});
const ok = (result: unknown) => Response.json({ data: { result } });
const card = (text: string) => ({ id: 'node-1', kind: 'text', title: 'Document', text, projectFilePath: 'sources/text/n.md' });
interface Call { url: string; input: Record<string, unknown>; headers: Record<string, string> }
function remote(handler?: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), input: JSON.parse(String(init?.body)).input, headers: init?.headers as Record<string, string> };
    calls.push(call);
    if (handler) return handler(call);
    return ok(call.url.endsWith('doc.create') ? { instanceId: 'doc-1' } : { content: call.input.content, revision: hash(String(call.input.content)), mirror: { status: 'synced' } });
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher, writes: () => calls.filter(call => call.url.endsWith('doc.write')) };
}
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doc-sync-recovery-')); roots.push(root);
  const registry = new AppRegistryStore(undefined, undefined, path.join(root, 'registry.json'));
  await registry.register({ appId: 'doc', name: 'Document', endpoint: 'http://synthetic-doc.invalid/api/apps/doc', status: 'active', scope: 'platform' });
  const bindings = new BindingStore(root), audit = new AuditLog(root), entitlements = new AppEntitlementStore(root);
  let owner: { teamId: string; createdBy: string; archivedAt?: number } | undefined = { teamId: 'team-a', createdBy: 'creator-alice' };
  let snapshot: CanvasStateSnapshot = { revision: 1, state: { workbenchBasicNodes: [card('A')] } };
  const make = () => {
    const sync = createDocSynchronizer({ dataRoot: root, registry, bindings, audit, entitlements, project: () => owner });
    synchronizers.push(sync); return sync;
  };
  const attach = (sync: ReturnType<typeof make>, writeTextMirror?: CanvasStateService['writeTextMirror']) => sync.attach({ read: async () => structuredClone(snapshot), ...(writeTextMirror ? { writeTextMirror } : {}) });
  return { root, make, attach, bindings, audit,
    setCanvas(text: string, revision: number) { snapshot = { revision, state: { workbenchBasicNodes: [card(text)] } }; },
    removeCard() { snapshot = { ...snapshot, revision: snapshot.revision + 1, state: { workbenchBasicNodes: [] } }; },
    setOwner(value: typeof owner) { owner = value; },
    snapshot: () => structuredClone(snapshot),
  };
}

async function conflictFixture() {
  const f = await setup(); const sync = f.make(); f.setCanvas('canvas draft', 2);
  let remoteContent = 'document edit';
  let rejectWrites = true;
  const network = remote(call => {
    if (call.url.endsWith('doc.create')) return ok({ instanceId: 'doc-1' });
    if (call.url.endsWith('doc.read')) return ok({ content: remoteContent, revision: hash(remoteContent) });
    if (rejectWrites) return Response.json({ error: { code: 'DOC_CONFLICT', message: 'Synthetic overlapping edit', details: { currentContent: remoteContent, currentRevision: hash(remoteContent), baseContent: 'A', draftContent: call.input.content } } }, { status: 409 });
    remoteContent = String(call.input.content);
    return ok({ content: remoteContent, revision: hash(remoteContent), mirror: { status: 'synced' } });
  });
  const mirrorWrite = vi.fn<CanvasStateService['writeTextMirror']>(async (projectId, mirrorPath, content, expectedRevision, options) => {
    expect(expectedRevision).toBe(f.snapshot().revision);
    const nodes = f.snapshot().state.workbenchBasicNodes as Record<string, unknown>[];
    expect(options?.baseContent).toBe(nodes[0]?.text);
    f.setCanvas(content, expectedRevision! + 1);
    sync.confirmMirror(projectId, 'node-1', 'doc-1', hash(content), content, mirrorPath, expectedRevision! + 1);
    return f.snapshot();
  });
  f.attach(sync, mirrorWrite);
  runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('canvas draft'), 2, 'A'));
  await sync.retry('canvas-1');
  return { ...f, sync, network, mirrorWrite, setRemote(content: string) { remoteContent = content; }, allowWrites() { rejectWrites = false; } };
}

describe('durable canvas/document synchronization recovery', () => {
  it('reopens prepared intents, waits for committed canvas revision, and restores exact payload/actor/base', async () => {
    const f = await setup(), network = remote();
    const before = f.make();
    runWithRequestTenant(actor, () => before.prepare('canvas-1', card('B'), 2, 'A'));
    await before.close();
    const reopened = f.make(); f.attach(reopened);
    expect(reopened.status('canvas-1')[0]).toMatchObject({ content: 'B', baseContent: 'A', canvasRevision: 2, userId: actor.userId, teamId: actor.teamId });
    await reopened.retry('canvas-1');
    expect(network.calls).toHaveLength(0);
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'pending', error: expect.stringContaining('CANVAS_COMMIT_PENDING') });
    f.setCanvas('B', 2);
    await reopened.retry('canvas-1');
    expect(network.writes()[0]!.input).toEqual({ content: 'B', baseContent: 'A', expectedRevision: hash('A'), mirrorRevision: 2, mirrorBaseContent: 'B' });
    expect(network.calls.every(call => call.headers['x-user-id'] === actor.userId && call.headers['x-team-id'] === actor.teamId)).toBe(true);
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'synced', baseContent: 'B', documentRevision: hash('B') });
  });

  it('never delivers prepared intents before a canvas confirmation adapter is attached', async () => {
    const f = await setup(), sync = f.make(), network = remote();
    runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    await sync.retry();
    expect(network.calls).toHaveLength(0);
    expect(sync.status('canvas-1')[0]).toMatchObject({ status: 'pending', content: 'B', baseContent: 'A', error: expect.stringContaining('CANVAS_STATE_UNAVAILABLE') });
    f.setCanvas('B', 2); f.attach(sync); await sync.retry();
    expect(network.writes()[0]!.input).toMatchObject({ content: 'B', baseContent: 'A' });
  });

  it('coalesces offline A→B→C without changing the common baseline A', async () => {
    const f = await setup(), sync = f.make(); f.attach(sync); let offline = true;
    const network = remote(call => offline ? new Response('{}', { status: 503 }) : ok(call.url.endsWith('doc.create') ? { instanceId: 'doc-1' } : { content: call.input.content, revision: hash(String(call.input.content)), mirror: { status: 'synced' } }));
    f.setCanvas('B', 2); runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A')); await sync.retry();
    f.setCanvas('C', 3); runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('C'), 3, 'B'));
    expect(sync.status('canvas-1')[0]).toMatchObject({ content: 'C', baseContent: 'A' });
    offline = false; await sync.retry();
    expect(network.writes()[0]!.input).toMatchObject({ content: 'C', baseContent: 'A', expectedRevision: hash('A') });
    expect(sync.status('canvas-1')[0]?.status).toBe('synced');
  });

  it('rebases newer C on submitted B, not unseen merged M, when B completes in flight', async () => {
    const f = await setup(), sync = f.make(); f.attach(sync);
    let resolveB!: (response: Response) => void, entered!: () => void;
    const inFlight = new Promise<void>(resolve => { entered = resolve; });
    const network = remote(call => {
      if (call.url.endsWith('doc.create')) return ok({ instanceId: 'doc-1' });
      if (call.input.content === 'B') { entered(); return new Promise<Response>(resolve => { resolveB = resolve; }); }
      return ok({ content: call.input.content, revision: hash(String(call.input.content)), mirror: { status: 'synced' } });
    });
    f.setCanvas('B', 2); runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    const pending = sync.retry(); await inFlight;
    f.setCanvas('C', 3); runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('C'), 3, 'B'));
    resolveB(ok({ content: 'merged M', revision: hash('merged M'), mirror: { status: 'synced' } })); await pending;
    expect(sync.status('canvas-1')[0]).toMatchObject({ content: 'C', baseContent: 'B', status: 'pending' });
    await sync.retry();
    expect(network.writes()[1]!.input).toMatchObject({ content: 'C', baseContent: 'B', expectedRevision: hash('B') });
  });

  it('does not let a delayed old post-commit callback replace a newer prepared canvas intent', async () => {
    const f = await setup(), sync = f.make(), network = remote(); f.attach(sync);
    runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    // New C is journaled before its commit; an older B callback can arrive later.
    runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('C'), 3, 'B'));
    f.setCanvas('C', 3);
    await Promise.allSettled([runWithRequestTenant(actor, () => sync('canvas-1', card('B'), 2, 'A'))]);
    expect(sync.status('canvas-1')[0]).toMatchObject({ content: 'C', canvasRevision: 3 });
    expect(network.writes().some(call => call.input.content === 'B')).toBe(false);
    await sync.retry();
    expect(sync.status('canvas-1')[0]).toMatchObject({ content: 'C', status: 'synced' });
  });

  it('persists both conflict bodies and remote revision across reopen without discarding the canvas draft', async () => {
    const f = await conflictFixture();
    const expected = { status: 'conflict', content: 'canvas draft', baseContent: 'A', remoteContent: 'document edit', documentRevision: hash('document edit'), documentId: 'doc-1' };
    expect(f.sync.status('canvas-1')[0]).toMatchObject(expected);
    await f.sync.close(); expect(f.make().status('canvas-1')[0]).toMatchObject(expected);
    expect((f.snapshot().state.workbenchBasicNodes as Record<string, unknown>[])[0]!.text).toBe('canvas draft');
  });

  it('requires the same tenant and unchanged canvas/document versions for explicit resolution', async () => {
    const f = await conflictFixture();
    const resolve = () => f.sync.resolve('canvas-1', 'node-1', 'document', 'canvas draft', hash('document edit'));
    await expect(runWithRequestTenant({ teamId: 'other', userId: 'intruder' }, resolve)).rejects.toMatchObject({ status: 403 });
    f.setCanvas('new local edit', 3);
    await expect(runWithRequestTenant(actor, resolve)).rejects.toMatchObject({ status: 409, code: 'CANVAS_CONTENT_CONFLICT' });
    f.setCanvas('canvas draft', 4); f.setRemote('new remote edit');
    await expect(runWithRequestTenant(actor, resolve)).rejects.toMatchObject({ status: 409, code: 'DOC_CONFLICT' });
    expect(f.mirrorWrite).not.toHaveBeenCalled();
    expect(f.sync.status('canvas-1')[0]?.content).toBe('canvas draft');
  });

  it.each(['project archived', 'team changed'] as const)('rejects explicit document resolution after %s', async mode => {
    const f = await conflictFixture();
    f.setOwner({ teamId: mode === 'team changed' ? 'new-owner-team' : 'team-a', createdBy: 'creator', ...(mode === 'project archived' ? { archivedAt: Date.now() } : {}) });
    await expect(runWithRequestTenant(actor, () => f.sync.resolve('canvas-1', 'node-1', 'document', 'canvas draft', hash('document edit')))).rejects.toBeDefined();
    expect(f.mirrorWrite).not.toHaveBeenCalled();
    expect(f.sync.status('canvas-1')[0]?.content).toBe('canvas draft');
  });

  it('explicitly takes document content through the canvas mirror adapter and confirms the journal', async () => {
    const f = await conflictFixture();
    await runWithRequestTenant(actor, () => f.sync.resolve('canvas-1', 'node-1', 'document', 'canvas draft', hash('document edit')));
    expect(f.mirrorWrite).toHaveBeenCalledOnce();
    expect(f.sync.status('canvas-1')[0]).toMatchObject({ status: 'synced', content: 'document edit', baseContent: 'document edit', documentRevision: hash('document edit') });
    expect(f.network.writes()).toHaveLength(1); // original conflicting request only
  });

  it('explicitly keeps canvas content using the confirmed remote body as the new base', async () => {
    const f = await conflictFixture(); f.allowWrites();
    await runWithRequestTenant(actor, () => f.sync.resolve('canvas-1', 'node-1', 'canvas', 'canvas draft', hash('document edit')));
    expect(f.network.writes().at(-1)!.input).toMatchObject({ content: 'canvas draft', baseContent: 'document edit', expectedRevision: hash('document edit') });
    expect(f.sync.status('canvas-1')[0]).toMatchObject({ status: 'synced', content: 'canvas draft', documentRevision: hash('canvas draft') });
    expect(f.mirrorWrite).not.toHaveBeenCalled();
  });

  it.each(['node removed', 'project archived', 'team changed'] as const)('does not replay an intent after %s', async mode => {
    const f = await setup(), sync = f.make(), network = remote(); f.attach(sync);
    f.setCanvas('B', 2); runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    if (mode === 'node removed') f.removeCard();
    else f.setOwner({ teamId: mode === 'team changed' ? 'other-team' : 'team-a', createdBy: 'creator', ...(mode === 'project archived' ? { archivedAt: Date.now() } : {}) });
    await sync.retry();
    expect(network.calls).toHaveLength(0); expect(sync.status('canvas-1')[0]?.status).toBe('detached');
  });

  it('invalidates the old common baseline when a replacement binding has a different document identity', async () => {
    const f = await setup(), sync = f.make(); f.attach(sync);
    let replacement = false;
    const network = remote(call => {
      if (call.url.endsWith('doc.create')) return ok({ instanceId: replacement ? 'doc-2' : 'doc-1' });
      if (call.url.endsWith('doc.read')) return ok({ content: 'replacement content', revision: hash('replacement content') });
      return ok({ content: call.input.content, revision: hash(String(call.input.content)), mirror: { status: 'synced' } });
    });
    await runWithRequestTenant(actor, () => sync('canvas-1', card('A'), 1, ''));
    f.bindings.archive('canvas-1', 'node-1', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-1' });
    replacement = true; f.setCanvas('new local draft', 2);
    await expect(runWithRequestTenant(actor, () => sync('canvas-1', card('new local draft'), 2, 'A'))).rejects.toMatchObject({ code: 'DOC_BASE_UNKNOWN' });
    expect(sync.status('canvas-1')[0]).toMatchObject({ documentId: 'doc-2', status: 'conflict', remoteContent: 'replacement content' });
    expect(sync.status('canvas-1')[0]?.baseContent).toBeUndefined();
    // Restart/retry must not resurrect the old doc-1 baseline against doc-2.
    const reopened = f.make(); f.attach(reopened);
    await runWithRequestTenant(actor, () => reopened.retry('canvas-1', 'node-1'));
    expect(reopened.status('canvas-1')[0]?.status).toBe('conflict');
    expect(network.writes()).toHaveLength(1);
  });

  it('accepts doc-origin mirror confirmation and prevents older confirmation from replacing a newer intent', async () => {
    const f = await setup(), sync = f.make(), network = remote(); f.attach(sync);
    runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    sync.confirmMirror('canvas-1', 'node-1', 'doc-1', hash('M'), 'M', 'sources/text/repointed.md', 3);
    const reopened = f.make();
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'synced', content: 'M', baseContent: 'M', documentId: 'doc-1', documentRevision: hash('M'), canvasRevision: 3 });
    runWithRequestTenant(actor, () => reopened.prepare('canvas-1', card('newer draft'), 5, 'M'));
    reopened.confirmMirror('canvas-1', 'node-1', 'doc-1', hash('old'), 'old', 'old.md', 4);
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'pending', content: 'newer draft', canvasRevision: 5 });
    expect(network.calls).toHaveLength(0);
  });
});
