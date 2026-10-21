import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createCanvasServer } from '../src/server.js';
import { BindingStore } from '../src/storage/bindings.js';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';
import { DocumentSyncJournal } from '../src/storage/document-sync-journal.js';

async function live(root: string) {
  const service = createCanvasServer({ dataRoot: root }); await service.ready;
  const listener = service.app.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No temporary listener');
  let closed = false;
  return {
    async json<T = Record<string, unknown>>(method: string, route: string, input?: unknown, status = 200): Promise<T> {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method,
        headers: { 'content-type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(status); return body as T;
    },
    async close() { if (closed) return; closed = true; listener.closeAllConnections(); await new Promise<void>(done => listener.close(() => done())); await service.close(); },
  };
}

it('persists App tab descriptors across HTTP reload and server restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-tabs-http-'));
  let server = await live(root);
  try {
    await server.json('POST', '/api/apps/canvas/actions/canvas.create', { input: { instanceId: 'p', name: 'p' } }, 201);
    const appTab = { id: 'app:doc:d', appId: 'doc', label: '已保存的文档页签', target: 'd', view: 'editor', mirrorPath: 'sources/text/n.md', nodeId: 'n' };
    const saved = await server.json('PUT', '/api/projects/p/tabs', { tabs: ['canvas', appTab.id], active: appTab.id, appTabs: [appTab] });
    expect(saved.appTabs).toEqual([appTab]);
    expect((await server.json('GET', '/api/projects/p/tabs')).appTabs).toEqual([appTab]);
    await server.close(); server = await live(root);
    const reopened = await server.json('GET', '/api/projects/p/tabs');
    expect(reopened.appTabs).toEqual([appTab]); expect(reopened.active).toBe(appTab.id);
  } finally {
    await server.close();
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('canvas-tabs-http-')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

it('does not expose an old tenant’s cached conflict body through the new canvas owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doc-binding-route-'));
  const server = await live(root);
  try {
    await server.json('POST', '/api/apps/canvas/actions/canvas.create', { input: { instanceId: 'p', name: 'p' } }, 201);
    new DocumentSyncJournal(root).put({ projectId: 'p', nodeId: 'old-node', appId: 'doc', teamId: 'prior-team', userId: 'prior-user',
      generation: 1, canvasRevision: 0, mirrorPath: 'sources/text/old.md', title: '', content: 'prior draft', baseContent: '',
      remoteContent: 'private prior team document', status: 'conflict', attempts: 0, nextAttemptAt: 0, updatedAt: 0 });
    const result = await server.json<{ data: { entries: unknown[] } }>('GET', '/api/apps/canvas/instances/p/document-sync');
    expect(result.data.entries).toEqual([]);
  } finally {
    await server.close();
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('doc-binding-route-')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

it('verifies ownership without re-entering the document mirror queue; unbind is conditional', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-binding-http-'));
  const calls: string[] = [];
  let meta = { id: 'doc-old', teamId: 'local', nodeId: 'n', mirrorCanvasId: 'p' };
  const remote = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`); res.setHeader('content-type', 'application/json');
    // State can hold a mirror queue lock; verify through independent body-read.
    if (req.method !== 'POST' || !req.url?.endsWith('/actions/doc.read')) { res.statusCode = 503; res.end(JSON.stringify({ error: { code: 'QUEUE_LOCKED' } })); return; }
    res.end(JSON.stringify({ data: { result: { meta, content: '正文', revision: 'test' } } }));
  }).listen(0, '127.0.0.1'); await once(remote, 'listening');
  const server = await live(root);
  try {
    await server.json('POST', '/api/apps/canvas/actions/canvas.create', { input: { instanceId: 'p', name: 'p' } }, 201);
    const before = (await server.json<{ data: { revision: number } }>('GET', '/api/apps/canvas/instances/p/state')).data;
    await server.json('POST', '/api/apps/canvas/instances/p/actions/node.create', { expectedRevision: before.revision, input: { node: { id: 'n', kind: 'text', text: '正文', x: 0, y: 0 } } });
    const current = (await server.json<{ data: { state: { workbenchBasicNodes: { projectFilePath: string }[] } } }>('GET', '/api/apps/canvas/instances/p/state')).data;
    const mirrorPath = current.state.workbenchBasicNodes[0]!.projectFilePath;
    const address = remote.address(); if (!address || typeof address === 'string') throw new Error('No temporary listener');
    await server.json('POST', '/api/apps/register', { appId: 'doc', name: 'Doc', scope: 'platform', endpoint: `http://127.0.0.1:${address.port}/api/apps/doc` }, 201);
    const binding = { nodeId: 'n', kind: 'text', appId: 'doc', appInstanceId: 'doc-old', mirrorPath };
    await server.json('PUT', '/api/apps/canvas/instances/p/bindings', binding);
    expect(calls).toEqual(['POST /api/apps/doc/instances/doc-old/actions/doc.read']);
    meta = { ...meta, teamId: 'other-team' };
    await server.json('PUT', '/api/apps/canvas/instances/p/bindings', binding, 409);
    const store = new BindingStore(root);
    expect(store.getActive('p', 'n', 'doc')?.appInstanceId).toBe('doc-old');
    store.archive('p', 'n', 'asset_archived', { appId: 'doc', appInstanceId: 'doc-old' });
    meta = { ...meta, id: 'doc-new', teamId: 'local' };
    await server.json('PUT', '/api/apps/canvas/instances/p/bindings', { ...binding, appInstanceId: 'doc-new' });
    await server.json('DELETE', '/api/apps/canvas/instances/p/bindings?nodeId=n', undefined, 428);
    const delayed = await server.json<{ data: { archived: number } }>('DELETE', '/api/apps/canvas/instances/p/bindings?nodeId=n&appId=doc&appInstanceId=doc-old');
    expect(delayed.data.archived).toBe(0); expect(store.getActive('p', 'n', 'doc')?.appInstanceId).toBe('doc-new');
    // A caller who can read the canvas must not read a denied App's cached
    // remote conflict body, nor obtain it through the retry response.
    new AppEntitlementStore(root).put({ scope: 'user:local', appId: 'doc', effect: 'deny' });
    await server.json('GET', '/api/apps/canvas/instances/p/document-sync', undefined, 403);
    await server.json('POST', '/api/apps/canvas/instances/p/document-sync/retry', {}, 403);
    await server.json('POST', '/api/apps/canvas/instances/p/document-sync/resolve', {}, 403);
  } finally {
    await server.close(); await new Promise<void>(done => remote.close(() => done()));
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('canvas-binding-http-')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
