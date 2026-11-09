import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
// Explicit two-repository acceptance only; neither product imports the other.
// Node24: node --import tsx e2e/canvas-doc-runtime.ts run <canvas-repo> <doc-repo>
const [mode, canvasArg, docArg, rootArg, canvasArgOrigin, portArg] = process.argv.slice(2);
assert.ok(canvasArg && docArg, 'Pass explicit repositories');
const canvasRepo = resolve(canvasArg!), docRepo = resolve(docArg!);
async function worker() {
  let app: any, service: any;
  if (mode === 'canvas') {
    const { createCanvasServer } = await import(pathToFileURL(join(canvasRepo, 'apps/server/src/server.ts')).href);
    service = createCanvasServer({ dataRoot: rootArg }); await service.ready; app = service.app;
  } else {
    const { createApp } = await import(pathToFileURL(join(docRepo, 'apps/server/src/app.ts')).href);
    const { LocalDocStore } = await import(pathToFileURL(join(docRepo, 'apps/server/src/local-store.ts')).href);
    const { MirrorDeliveryQueue } = await import(pathToFileURL(join(docRepo, 'apps/server/src/mirror-delivery-queue.ts')).href);
    let offline = false;
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = ((url: any, options: any) => offline && String(url).startsWith(canvasArgOrigin!) ? Promise.reject(new Error('Synthetic mirror network outage')) : nativeFetch(url, options)) as typeof fetch;
    process.on('message', (message: any) => { if (message?.control === 'offline') { offline = message.value; process.send?.({ ack: message.id }); } });
    const store = new LocalDocStore(rootArg);
    service = new MirrorDeliveryQueue({ root: rootArg, store, canvasOrigin: canvasArgOrigin });
    app = createApp(store, { canvasOrigin: canvasArgOrigin, mirrorQueue: service });
    const express = createRequire(join(docRepo, 'apps/server/package.json'))('express');
    app.use(express.static(join(docRepo, 'apps/web/dist')));
    await service.start();
  }
  const listener = app.listen(Number(portArg ?? 0), '127.0.0.1'); await once(listener, 'listening');
  process.on('message', async message => { if (message === 'close') {
    listener.closeAllConnections(); await new Promise<void>(done => listener.close(() => done()));
    await service.close(); process.disconnect?.();
  } });
  process.send?.({ ready: true, origin: `http://127.0.0.1:${listener.address().port}` });
}
async function run() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const root = await mkdtemp(join(tmpdir(), 'canvas-doc-concurrency-'));
  const children: ChildProcess[] = []; const checks: string[] = [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(APPWRITE_|CANVAS_|DOC_)/.test(key)));
  async function start(kind: string, origin = '', port = 0) {
    const child = fork(resolve(process.argv[1]!), [kind, canvasRepo, docRepo, join(root, kind), origin, String(port)], { env,
      execArgv: ['--import', pathToFileURL(join(canvasRepo, 'node_modules/tsx/dist/loader.mjs')).href], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(child);
    const address = await new Promise<string>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('startup timeout')), 30000);
      child.once('error', fail); child.once('exit', code => { clearTimeout(timer); fail(new Error(`early exit ${code}`)); });
      child.on('message', (m: any) => { if (m.ready) { clearTimeout(timer); done(m.origin); } });
    });
    return { child, origin: address };
  }
  async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; const end = once(child, 'exit'); child.send('close'); await end; }
  async function check(name: string, run: () => Promise<void>) { await run(); checks.push(name); console.log('PASS', name); }
  const request = async (origin: string, path: string, method = 'GET', body?: any, expected = 200, team = 'alpha') => {
    const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', 'x-team-id': team, 'x-user-id': team === 'local' ? 'local' : 'alice' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
    const text = await response.text(); assert.equal(response.status, expected, `${method} ${path}: ${text}`); return JSON.parse(text);
  };
  try {
    let canvas = await start('canvas'), doc = await start('doc', canvas.origin);
    const base = '/api/apps/canvas/instances/p';
    const state = async () => (await request(canvas.origin, base + '/state')).data;
    const docAction = async (id: string | null, action: string, input: any, expected = 200) => (await request(doc.origin, `/api/apps/doc${id ? '/instances/' + id : ''}/actions/${action}`, 'POST', { input }, expected)).data?.result;
    const readDoc = (id: string) => docAction(id, 'doc.read', {});
    const action = async (name: string, input: any) => request(canvas.origin, base + '/actions/' + name, 'POST', { expectedRevision: (await state()).revision, input });
    const register = () => request(canvas.origin, '/api/apps/register', 'POST', { appId: 'doc', name: '隔离文档', endpoint: doc.origin + '/api/apps/doc', scope: 'platform' }, 201, 'local');
    const offline = async (value: boolean) => { const id = Math.random().toString(); await new Promise<void>(done => { const receive = (m: any) => { if (m.ack === id) { doc.child.off('message', receive); done(); } }; doc.child.on('message', receive); doc.child.send({ control: 'offline', value, id }); }); };
    await register();
    await request(canvas.origin, '/api/apps/canvas/actions/canvas.create', 'POST', { input: { instanceId: 'p', name: '并发验收' } }, 201);
    await action('node.create', { node: { id: 'n', kind: 'text', title: '正文', text: 'first middle last\n', x: 0, y: 0 } });
    const bindingRows = async () => (await request(canvas.origin, base + '/bindings')).data.bindings;
    const id = (await bindingRows())[0]?.appInstanceId; assert.ok(id, 'Birth binding');
    const assertConverged = async (expected: string) => {
      assert.equal((await readDoc(id)).content, expected);
      const current = await state(); const node = current.state.workbenchBasicNodes.find((n: any) => n.id === 'n'); assert.equal(node.text, expected);
      const file = await request(canvas.origin, base + '/files?path=' + encodeURIComponent(node.projectFilePath)); assert.equal(file.data.content, expected);
      assert.equal((await request(canvas.origin, base + '/document-sync')).data.entries.find((e: any) => e.nodeId === 'n').status, 'synced');
    };
    await check('birth binds one canonical document and confirms all mirrors', () => assertConverged('first middle last\n'));
    await check('overlapping two-entry edits merge independent changes without lost text', async () => {
      const original = await readDoc(id); await offline(true);
      const written = await docAction(id, 'doc.write', { content: 'FIRST middle last\n', baseContent: original.content, expectedRevision: original.revision });
      assert.notEqual(written.mirror.status, 'synced');
      await action('node.update', { nodeId: 'n', set: { text: 'first middle LAST\n' } });
      assert.equal((await readDoc(id)).content, 'FIRST middle LAST\n');
      await offline(false); await docAction(id, 'doc.retryMirror', {});
      await assertConverged('FIRST middle LAST\n');
    });
    await check('same-range conflict retains both sides and explicit resolution checks both versions', async () => {
      const original = await readDoc(id); await offline(true);
      await docAction(id, 'doc.write', { content: '文档端独立稿\n', baseContent: original.content, expectedRevision: original.revision });
      await action('node.update', { nodeId: 'n', set: { text: '画布端独立稿\n' } });
      await offline(false); await docAction(id, 'doc.retryMirror', {});
      const entry = (await request(canvas.origin, base + '/document-sync')).data.entries.find((e: any) => e.nodeId === 'n');
      assert.equal(entry.status, 'conflict'); assert.equal(entry.content, '画布端独立稿\n'); assert.equal(entry.remoteContent, '文档端独立稿\n');
      await request(canvas.origin, base + '/document-sync/resolve', 'POST', { nodeId: 'n', choice: 'document', expectedCanvasContent: entry.content, expectedDocumentRevision: 'stale' }, 409);
      assert.equal((await state()).state.workbenchBasicNodes.find((n: any) => n.id === 'n').text, entry.content);
      await request(canvas.origin, base + '/document-sync/resolve', 'POST', { nodeId: 'n', choice: 'document', expectedCanvasContent: entry.content, expectedDocumentRevision: entry.documentRevision });
      await docAction(id, 'doc.retryMirror', {}); await assertConverged('文档端独立稿\n');
    });
    await check('document queue survives restart and recovers the newest offline edit', async () => {
      const previous = await readDoc(id); await offline(true);
      await docAction(id, 'doc.write', { content: '离线一次\n', baseContent: previous.content, expectedRevision: previous.revision });
      const intermediate = await readDoc(id);
      await docAction(id, 'doc.write', { content: '离线最新版本\n', baseContent: intermediate.content, expectedRevision: intermediate.revision });
      await stop(doc.child); doc = await start('doc', canvas.origin); await register();
      await docAction(id, 'doc.retryMirror', {}); await assertConverged('离线最新版本\n');
    });
    await check('canvas queue survives restart before failed delivery and keeps original author baseline', async () => {
      await stop(doc.child);
      await action('node.update', { nodeId: 'n', set: { text: '画布离线待投递\n' } });
      const pending = (await request(canvas.origin, base + '/document-sync')).data.entries.find((e: any) => e.nodeId === 'n'); assert.equal(pending.status, 'pending');
      const port = Number(new URL(canvas.origin).port); await stop(canvas.child); canvas = await start('canvas', '', port);
      doc = await start('doc', canvas.origin); await register();
      await request(canvas.origin, base + '/document-sync/retry', 'POST', { nodeId: 'n' });
      await assertConverged('画布离线待投递\n');
    });
    await check('UI-style card duplication immediately separates file and document identity', async () => {
      const current = await state(); const original = current.state.workbenchBasicNodes.find((n: any) => n.id === 'n');
      await request(canvas.origin, '/api/projects/p/canvas/state', 'PATCH', { expectedRevision: current.revision, changes: { workbenchBasicNodes: [...current.state.workbenchBasicNodes, { ...original, id: 'copy-card', x: 200 }] } });
      const rows = await bindingRows(); const copyId = rows.find((row: any) => row.nodeId === 'copy-card').appInstanceId; assert.notEqual(copyId, id);
      const copy = await readDoc(copyId); const updated = await docAction(copyId, 'doc.write', { content: '只编辑复制卡\n', baseContent: copy.content, expectedRevision: copy.revision }); assert.equal(updated.mirror.status, 'synced');
      assert.equal((await readDoc(id)).content, '画布离线待投递\n');
      const latest = (await state()).state.workbenchBasicNodes; assert.notEqual(latest[0].projectFilePath, latest[1].projectFilePath);
    });
    await check('standalone asset copy has a new identity, no binding, independent revision and lifecycle', async () => {
      const copied = await docAction(id, 'doc.copy', { name: '独立资产副本' }); const copyId = copied.instanceId; assert.ok(copyId && copyId !== id);
      const copy = await readDoc(copyId); assert.equal(copy.meta.nodeId, undefined); assert.equal(copy.meta.mirrorCanvasId, undefined);
      await docAction(copyId, 'doc.write', { content: '独立副本私有修改\n', baseContent: copy.content, expectedRevision: copy.revision });
      assert.equal((await readDoc(id)).content, '画布离线待投递\n');
      await request(doc.origin, `/api/apps/doc/instances/${copyId}/state`, 'GET', undefined, 403, 'other-team');
      await request(canvas.origin, base + '/document-sync', 'GET', undefined, 403, 'other-team');
    });
    await check('archive/restore is explicit and delayed unbinding cannot archive a newer document', async () => {
      await docAction(id, 'doc.archive', {});
      await docAction(id, 'doc.restore', {});
      const restored = await readDoc(id); assert.equal(restored.meta.nodeId, undefined);
      const node = (await state()).state.workbenchBasicNodes.find((n: any) => n.id === 'n');
      const replacement = await docAction(null, 'doc.create', { nodeId: 'n', content: node.text, mirrorCanvasId: 'p', mirrorPath: node.projectFilePath, name: '新绑定身份' });
      assert.notEqual(replacement.instanceId, id);
      await request(canvas.origin, base + '/bindings?nodeId=n&appId=doc&appInstanceId=' + id, 'DELETE');
      assert.equal((await bindingRows()).find((row: any) => row.nodeId === 'n').appInstanceId, replacement.instanceId);
    });
    console.log(JSON.stringify({ passed: checks.length, checks, root }, null, 2));
  } finally {
    for (const child of children.reverse()) await stop(child);
    assert.equal(dirname(root), tmpdir()); assert.ok(basename(root).startsWith('canvas-doc-concurrency-'));
    await rm(root, { recursive: true, force: true }); console.log('CLEANED all isolated processes and temporary data');
  }
}
(mode === 'canvas' || mode === 'doc' ? worker() : run()).catch(error => { console.error(error); process.exitCode = 1; });
