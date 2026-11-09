import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { createDocSynchronizer } from '../src/canvas/doc-sync.js';
import type { CanvasStateSnapshot } from '../src/canvas/state.js';
import { AppRegistryStore } from '../src/storage/app-registry.js';
import { BindingStore } from '../src/storage/bindings.js';
import { AuditLog } from '../src/storage/audit-log.js';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';
import { runWithRequestTenant } from '../src/tenant.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const actor = { teamId: 'team-a', userId: 'editor-bob' };

/** In-memory JsonStatePort double; reads see enqueued writes immediately. */
class FakeStatePort implements JsonStatePort {
  readonly ready: Promise<void> = Promise.resolve();
  readonly slots = new Map<string, unknown>();
  flushes = 0;
  failFlush: Error | undefined;
  onFlush: (() => void) | undefined;
  read(key: string): unknown {
    const value = this.slots.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  write(key: string, value: unknown): void {
    this.slots.set(key, JSON.parse(JSON.stringify(value)));
  }
  async flush(): Promise<void> {
    this.flushes++;
    this.onFlush?.();
    if (this.failFlush) throw this.failFlush;
  }
}

const roots: string[] = [];
const synchronizers: ReturnType<typeof createDocSynchronizer>[] = [];
afterEach(async () => {
  await Promise.all(synchronizers.splice(0).map(sync => sync.close()));
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('cloud-doc-sync-')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
const ok = (result: unknown) => Response.json({ data: { result } });
const card = (text: string) => ({ id: 'node-1', kind: 'text', title: 'Document', text, projectFilePath: 'sources/text/n.md' });
interface Call { url: string; input: Record<string, unknown>; headers: Record<string, string> }
function remote(order?: string[]) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    order?.push('fetch');
    const call: Call = { url: String(url), input: JSON.parse(String(init?.body)).input, headers: init?.headers as Record<string, string> };
    calls.push(call);
    return ok(call.url.endsWith('doc.create') ? { instanceId: 'doc-1' } : { content: call.input.content, revision: hash(String(call.input.content)), mirror: { status: 'synced' } });
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher, writes: () => calls.filter(call => call.url.endsWith('doc.write')) };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloud-doc-sync-')); roots.push(root);
  const port = new FakeStatePort();
  const registry = new AppRegistryStore(undefined, undefined, path.join(root, 'registry.json'));
  await registry.register({ appId: 'doc', name: 'Document', endpoint: 'http://synthetic-doc.invalid/api/apps/doc', status: 'active', scope: 'platform' });
  // All four control stores share the port under their own keys; this dataRoot
  // must never be created on disk.
  const dataRoot = path.join(root, 'cloud-data');
  const bindings = new BindingStore(dataRoot, port), audit = new AuditLog(dataRoot, port), entitlements = new AppEntitlementStore(dataRoot, port);
  let owner: { teamId: string; createdBy: string; archivedAt?: number } | undefined = { teamId: 'team-a', createdBy: 'creator-alice' };
  let snapshot: CanvasStateSnapshot = { revision: 1, state: { workbenchBasicNodes: [card('A')] } };
  const make = (requireVerifiedAuthority=false) => {
    const sync = createDocSynchronizer({ dataRoot, registry, bindings, audit, entitlements, project: () => owner, state: port,requireVerifiedAuthority });
    synchronizers.push(sync); return sync;
  };
  const attach = (sync: ReturnType<typeof make>) => sync.attach({ read: async () => structuredClone(snapshot) });
  const slot = () => port.slots.get('document-sync') as { version: number; entries: Record<string, unknown>[] } | undefined;
  return { root, dataRoot, port, make, attach, bindings, audit, entitlements, slot,
    setCanvas(text: string, revision: number) { snapshot = { revision, state: { workbenchBasicNodes: [card(text)] } }; },
    setOwner(value: typeof owner) { owner = value; },
  };
}

describe('document synchronizer over an injected state port', () => {
  it('keeps prepare synchronous, flushes before every outbound call, and persists the synced entry', async () => {
    const f = await setup();
    const order: string[] = [];
    f.port.onFlush = () => order.push('flush');
    const network = remote(order);
    const sync = f.make(); f.attach(sync);
    f.setCanvas('B', 2);
    const prepared = runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    // prepare is a synchronous enqueue — no Promise, intent already readable.
    expect(prepared).toMatchObject({ status: 'pending', content: 'B', baseContent: 'A', userId: actor.userId });
    expect(sync.status('canvas-1')[0]).toMatchObject({ status: 'pending', content: 'B' });
    await runWithRequestTenant(actor, () => sync('canvas-1', card('B'), 2, 'A'));
    expect(order.filter(event => event === 'fetch').length).toBeGreaterThan(0);
    expect(order.indexOf('fetch')).toBeGreaterThan(order.indexOf('flush'));
    expect(f.slot()?.version).toBe(1);
    expect(f.slot()?.entries[0]).toMatchObject({ status: 'synced', content: 'B', baseContent: 'B', documentId: 'doc-1' });
    const audit = f.port.slots.get('audit') as { entries: Record<string, unknown>[] };
    expect(audit.entries[0]).toMatchObject({ action: 'doc.sync', status: 'succeeded' });
    expect(existsSync(f.dataRoot)).toBe(false);
  });

  it('exposes flush for the integrator and never claims storage success it does not have', async () => {
    const f = await setup();
    const network = remote();
    const sync = f.make(); f.attach(sync);
    f.setCanvas('B', 2);
    const baseline = f.port.flushes;
    await sync.flush();
    expect(f.port.flushes).toBe(baseline + 1);
    f.port.failFlush = new Error('injected flush failure');
    await expect(runWithRequestTenant(actor, () => sync('canvas-1', card('B'), 2, 'A'))).rejects.toThrow('injected flush failure');
    // The flush gate runs before any outbound document call.
    expect(network.fetcher).not.toHaveBeenCalled();
    // The durable intent stays pending — no synced claim, no empty journal.
    expect(sync.status('canvas-1')[0]).toMatchObject({ status: 'pending', content: 'B' });
    expect(f.slot()?.entries[0]?.status).toBe('pending');
    await expect(sync.close()).rejects.toThrow('injected flush failure');
    f.port.failFlush=undefined; // failure was asserted; allow the shared cleanup to close again
  });

  it('recovers pending intents across reconstruction and retries them', async () => {
    const f = await setup();
    const network = remote();
    const before = f.make();
    runWithRequestTenant(actor, () => before.prepare('canvas-1', card('B'), 2, 'A'));
    await before.close();
    const reopened = f.make(); f.attach(reopened);
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'pending', content: 'B', baseContent: 'A', canvasRevision: 2, userId: actor.userId, teamId: actor.teamId });
    await reopened.retry('canvas-1');
    // The committed canvas revision is still pending — intent retained, not dropped.
    expect(network.fetcher).not.toHaveBeenCalled();
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'pending', error: expect.stringContaining('CANVAS_COMMIT_PENDING') });
    f.setCanvas('B', 2);
    await reopened.retry('canvas-1');
    expect(network.writes()[0]!.input).toEqual({ content: 'B', baseContent: 'A', expectedRevision: hash('A'), mirrorRevision: 2, mirrorBaseContent: 'B' });
    expect(network.calls.every(call => call.headers['x-user-id'] === actor.userId && call.headers['x-team-id'] === actor.teamId)).toBe(true);
    expect(reopened.status('canvas-1')[0]).toMatchObject({ status: 'synced', baseContent: 'B' });
    expect(f.slot()?.entries).toHaveLength(1);
  });

  it('keeps a cloud deny policy blocking delivery through the synchronizer', async () => {
    const f = await setup();
    const network = remote();
    const sync = f.make(); f.attach(sync);
    f.entitlements.put({ scope: 'user:editor-bob', appId: 'doc', effect: 'deny' });
    f.setCanvas('B', 2);
    await expect(runWithRequestTenant(actor, () => sync('canvas-1', card('B'), 2, 'A'))).rejects.toMatchObject({ code: 'DOC_FORBIDDEN' });
    expect(network.fetcher).not.toHaveBeenCalled();
    expect(sync.status('canvas-1')[0]).toMatchObject({ status: 'blocked' });
    // Policy survives in the slot; a reconstructed store still denies.
    expect(f.entitlements.resolve('doc', actor)).toBe('deny');
  });

  it('detaches intents whose owner changed instead of replaying them', async () => {
    const f = await setup();
    const network = remote();
    const sync = f.make(); f.attach(sync);
    f.setCanvas('B', 2);
    runWithRequestTenant(actor, () => sync.prepare('canvas-1', card('B'), 2, 'A'));
    f.setOwner({ teamId: 'other-team', createdBy: 'creator' });
    await sync.retry('canvas-1');
    expect(network.fetcher).not.toHaveBeenCalled();
    expect(sync.status('canvas-1')[0]?.status).toBe('detached');
  });
});

describe('shared cloud delivery requires live request authority',()=>{
 it('does not send private content from a recovered intent without fresh MA credentials',async()=>{
  const f=await setup(),network=remote(),sync=f.make(true);f.setCanvas('B',2);f.attach(sync);
  await expect(sync('canvas-1',card('B'),2,'A')).rejects.toMatchObject({code:'DOC_AUTHORITY_REQUIRED'});
  sync.start();await Promise.resolve();await Promise.resolve();expect(network.calls).toHaveLength(0);
  const live={...actor,bizId:'biz-a',applicationId:'app-canvas',applicationInstanceId:'instance-a',providerInstanceId:'provider-a'};
  await runWithRequestTenant(live,()=>sync('canvas-1',card('B'),2,'A'),{'x-mav-sso-authorization':'Bearer fixture-live','x-mav-tenant':actor.teamId,'x-mav-application-instance-id':live.applicationInstanceId},['http://synthetic-doc.invalid']);
  expect(network.calls.length).toBeGreaterThan(0);
  expect(JSON.stringify(f.slot())).not.toContain('Bearer fixture-live');
 });
});
