import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createCanvasServer } from '../src/server.js';
import { BindingStore } from '../src/storage/bindings.js';
import { DocumentSyncJournal } from '../src/storage/document-sync-journal.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const mirrorPath = 'notes/current.md', original = 'Authoritative document body';
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'legacy-doc-file-write-'));
  const api = createCanvasServer({ dataRoot: root }); await api.ready;
  const listener = api.app.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
  const url = `http://127.0.0.1:${address.port}`;
  const project = api.registry.create({ name: 'Doc mirror' });
  const node = { id: 'text-node', kind: 'text', x: 0, y: 0, text: original, projectFilePath: mirrorPath };
  const initial = await api.canvas.patch(project.id, { workbenchBasicNodes: [node] });
  const bindings = new BindingStore(root);
  bindings.upsert({ canvasInstanceId: project.id, nodeId: node.id, appId: 'doc', appInstanceId: 'doc-one', mirrorPath: 'notes/stale.md' });
  const journal = new DocumentSyncJournal(root), pending = journal.get(project.id, node.id)!;
  journal.put({ ...pending, status: 'synced', documentId: 'doc-one', documentRevision: digest(original), nextAttemptAt: 0 });
  const doc = { content: original, calls: [] as string[] };
  const remote = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}').input ?? {};
    doc.calls.push(req.url ?? '');
    if (req.url?.endsWith('/actions/doc.write')) doc.content = input.content;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { result: { instanceId: 'doc-one', content: doc.content, revision: digest(doc.content), mirror: { status: 'synced', path: mirrorPath } } } }));
  }).listen(0, '127.0.0.1'); await once(remote, 'listening');
  const remoteAddress = remote.address(); if (!remoteAddress || typeof remoteAddress === 'string') throw new Error('Missing Doc test port');
  const registration = await fetch(url + '/api/apps/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: 'doc', name: 'Test Doc', endpoint: `http://127.0.0.1:${remoteAddress.port}/api/apps/doc` }) });
  expect(registration.status).toBe(201);
  cleanups.push(async () => {
    listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve()));
    await api.close(); remote.closeAllConnections(); await new Promise<void>(resolve => remote.close(() => resolve()));
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('legacy-doc-file-write-')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  });
  const files = `${url}/api/projects/${project.id}/files`;
  const post = (name: string, content: string, extra: Record<string, unknown> = {}) => fetch(files, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, content, ...extra }),
  });
  const physical = (name: string) => path.join(api.registry.resolveProjectRoot(project.id), name);
  const unchanged = async () => {
    expect(await readFile(physical(mirrorPath), 'utf8')).toBe(original);
    expect(await api.canvas.read(project.id)).toMatchObject({ state: initial.state, revision: initial.revision });
    expect(doc.content).toBe(original); expect(doc.calls).toEqual([]);
  };
  return { root, api, url, project, node, doc, bindings, files, post, physical, unchanged };
}

it.each(['json', 'base64', 'multipart'])('rejects legacy %s overwrites of a bound current node path with 428, even with a stale binding path', async mode => {
  const f = await fixture();
  let response: Response;
  if (mode === 'multipart') {
    const form = new FormData(); form.set('name', 'notes\\current.md');
    form.set('file', new Blob(['binary replacement'], { type: 'image/png' }), 'image.png');
    response = await fetch(f.files, { method: 'POST', body: form });
  } else {
    response = await f.post('notes//current.md', mode === 'base64' ? Buffer.from('binary replacement').toString('base64') : 'stale viewer body',
      mode === 'base64' ? { encoding: 'base64' } : {});
  }
  expect(response.status).toBe(428);
  expect(await response.json()).toMatchObject({ error: { code: 'DOC_WRITE_CHANNEL_REQUIRED' } });
  await f.unchanged();
});

it('allows new uploads and unbound old mirror paths without treating stale binding.mirrorPath as authority', async () => {
  const f = await fixture();
  for (const name of ['notes/stale.md', 'ordinary.md']) {
    expect((await f.post(name, 'first')).status).toBe(200);
    expect((await f.post(name, 'second')).status).toBe(200);
    expect(await readFile(f.physical(name), 'utf8')).toBe('second');
  }
  const form = new FormData(); form.set('name', 'new-upload.md'); form.set('file', new Blob(['new upload']), 'upload.md');
  expect((await fetch(f.files, { method: 'POST', body: form })).status).toBe(200);
  await f.unchanged();
});

it('retains /upload create-only collision renaming instead of overwriting the document mirror', async () => {
  const f = await fixture();
  const form = new FormData(); form.set('dir', 'notes'); form.set('files', new Blob(['independent copy']), 'current.md');
  const response = await fetch(`${f.url}/api/projects/${f.project.id}/upload`, { method: 'POST', body: form });
  expect(response.status).toBe(200);
  const body = await response.json() as { files: Array<{ name: string }> };
  expect(body.files[0]!.name).not.toBe(mirrorPath);
  expect(await readFile(f.physical(body.files[0]!.name), 'utf8')).toBe('independent copy');
  await f.unchanged();
});

it('does not block files whose only binding is archived or whose card has disappeared', async () => {
  const f = await fixture();
  f.bindings.archive(f.project.id, f.node.id, 'asset_archived');
  expect((await f.post(mirrorPath, 'unbound file edit')).status).toBe(200);
  f.bindings.upsert({ canvasInstanceId: f.project.id, nodeId: 'absent-node', appId: 'doc', appInstanceId: 'missing-doc', mirrorPath: 'ghost.md' });
  await writeFile(f.physical('ghost.md'), 'ghost');
  expect((await f.post('ghost.md', 'ordinary file')).status).toBe(200);
  expect(await readFile(f.physical('ghost.md'), 'utf8')).toBe('ordinary file');
});

it('does not extend the write guard to generic file deletion or archive the authoritative Doc', async () => {
  const f = await fixture();
  const response = await fetch(`${f.url}/api/projects/${f.project.id}/raw/${mirrorPath}`, { method: 'DELETE' });
  expect(response.status).toBe(200);
  await expect(readFile(f.physical(mirrorPath), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(f.doc.content).toBe(original); expect(f.doc.calls).toEqual([]);
  expect(f.bindings.getActive(f.project.id, f.node.id, 'doc')?.appInstanceId).toBe('doc-one');
});

it('keeps versioned Doc-origin App files writes and internal canvas edits on their existing channels', async () => {
  const f = await fixture();
  const endpoint = `${f.url}/api/apps/canvas/instances/${f.project.id}/files?path=${encodeURIComponent(mirrorPath)}`;
  const read = await (await fetch(endpoint)).json() as { data: { revision: number; content: string } };
  f.doc.content = 'saved in Doc';
  const saved = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    content: f.doc.content, baseContent: read.data.content, expectedRevision: read.data.revision,
    nodeId: f.node.id, docId: 'doc-one', documentRevision: digest(f.doc.content),
  }) });
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect(await readFile(f.physical(mirrorPath), 'utf8')).toBe('saved in Doc');
  expect(f.doc.calls).toEqual([]);
  // Canvas's internal synchronization does not invoke the legacy-upload guard.
  const changed = await f.api.canvas.patch(f.project.id, { workbenchBasicNodes: [{ ...f.node, text: 'edited on card' }] });
  expect(changed.state.workbenchBasicNodes).toMatchObject([{ text: 'edited on card' }]);
  expect(await readFile(f.physical(mirrorPath), 'utf8')).toBe('edited on card');
  expect(f.doc.content).toBe('edited on card');
});
