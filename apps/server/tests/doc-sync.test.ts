import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createDocSynchronizer } from '../src/canvas/doc-sync.js';
import { AppRegistryStore } from '../src/storage/app-registry.js';
import { BindingStore } from '../src/storage/bindings.js';
import { AuditLog } from '../src/storage/audit-log.js';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';
import { runWithRequestTenant } from '../src/tenant.js';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('canvas-doc-sync-')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
async function setup(scope: 'platform' | 'team' = 'platform') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-doc-sync-')); roots.push(root);
  const registry = new AppRegistryStore(undefined, undefined, path.join(root, 'registry.json'));
  await registry.register({ appId: 'doc', name: '文档', endpoint: 'http://doc/api/apps/doc', status: 'active', scope, ...(scope === 'team' ? { teamId: 'other' } : {}) });
  const bindings = new BindingStore(root), audit = new AuditLog(root), entitlements = new AppEntitlementStore(root);
  return { bindings, audit, entitlements, sync: createDocSynchronizer({ registry, bindings, audit, entitlements,
    project: () => ({ teamId: 'team-a', createdBy: 'alice' }) }) };
}
const ok = (result: unknown) => new Response(JSON.stringify({ data: { result } }), { status: 200 });

it('refreshes scoped binding pointers on every save and pins the originating revision', async () => {
  const { sync, bindings, audit } = await setup();
  const calls: { url: string; input: Record<string, unknown>; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)).input;
    calls.push({ url, input, headers: init.headers as Record<string, string> });
    return ok(url.endsWith('doc.create') ? { instanceId: `doc-${input.mirrorCanvasId}` } : { mirror: { status: 'synced' } });
  }));
  await sync('canvas-a', { id: 'same', kind: 'text', text: 'A', projectFilePath: 'sources/text/a.md' }, 10);
  await sync('canvas-b', { id: 'same', kind: 'text', text: 'B', projectFilePath: 'sources/text/b.md' }, 20);
  await sync('canvas-a', { id: 'same', kind: 'text', text: 'A2', projectFilePath: 'sources/text/a-new.md' }, 30);
  expect(calls).toHaveLength(6);
  expect(calls[5]!.input).toEqual({ content: 'A2', mirrorRevision: 30 });
  expect(calls[4]!.input.mirrorPath).toBe('sources/text/a-new.md');
  expect(calls.every(call => call.headers['x-team-id'] === 'team-a')).toBe(true);
  expect(bindings.list({ canvasInstanceId: 'canvas-a' })[0]).toMatchObject({ appInstanceId: 'doc-canvas-a', mirrorPath: 'sources/text/a-new.md' });
  expect(bindings.list({ canvasInstanceId: 'canvas-b' })[0]?.appInstanceId).toBe('doc-canvas-b');
  expect(audit.list().map(row => row.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
});

it('rejects failed doc writes and records a failure rather than claiming synchronization', async () => {
  const { sync, audit } = await setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ instanceId: 'archived' }))
    .mockResolvedValueOnce(new Response('DOC_ARCHIVED', { status: 409 })));
  await expect(sync('canvas-a', { id: 'n', text: '保留画布' }, 5)).rejects.toThrow('409');
  expect(audit.list()[0]).toMatchObject({ status: 'failed', action: 'doc.sync' });
});

it('uses the actual editor for user entitlements and audit, not the project creator', async () => {
  const { sync, entitlements, audit } = await setup();
  entitlements.put({ scope: 'user:bob', appId: 'doc', effect: 'deny' });
  const fetcher = vi.fn(async (url: string) => ok(url.endsWith('doc.create') ? { instanceId: 'd' } : { mirror: { status: 'synced' } }));
  vi.stubGlobal('fetch', fetcher);
  await runWithRequestTenant({ teamId: 'team-a', userId: 'bob' }, () => sync('canvas-a', { id: 'n', text: 'blocked' }, 1));
  expect(fetcher).not.toHaveBeenCalled();
  entitlements.remove('user:bob', 'doc');
  await runWithRequestTenant({ teamId: 'team-a', userId: 'bob' }, () => sync('canvas-a', { id: 'n', text: 'allowed' }, 2));
  expect(fetcher.mock.calls).toHaveLength(2);
  expect(audit.list()[0]?.actor.userId).toBe('bob');
});

it('does not send data to another team’s registered doc service', async () => {
  const { sync } = await setup('team');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await sync('canvas-a', { id: 'n', text: 'private' }, 1);
  expect(fetcher).not.toHaveBeenCalled();
});
