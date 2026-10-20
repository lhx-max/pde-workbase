import type { CanvasOperationsResponse } from '@bezier/contracts';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerCanvasStateRoutes } from '../src/routes/canvas.js';
let root: string, base: string, server: ReturnType<ReturnType<typeof express>['listen']>;
let service: CanvasStateService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-operations-'));
  service = new CanvasStateService(id => id === 'p' ? root : null);
  const app = express(); app.use(express.json());
  registerCanvasStateRoutes(app, { canvasState: service, authorizeProjectRequest: async (_req, res, id) => {
    if (id === 'forbidden') { res.status(403).json({ error: 'denied' }); return false; } return true;
  } });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('listener');
  base = `http://127.0.0.1:${address.port}/api/projects/p/canvas`;
});
afterEach(async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); });
const create = (id: string) => ({ type: 'node.create', node: { id, kind: 'text', title: id, text: 'hello', x: 0, y: 0 } });
async function apply(operationId: string, baseRevision: number, operations: unknown[]) {
  return fetch(`${base}/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId, baseRevision, operations }) });
}
it('commits a text graph once, rejects stale writes, and persists receipt with document', async () => {
  const response = await apply('create', 0, [create('a'), create('b'), { type: 'edge.connect', edge: { id: 'ab', source: 'a', target: 'b' } }]);
  expect(response.status, await response.clone().text()).toBe(200);
  const saved = await response.json() as CanvasOperationsResponse;
  expect(saved.receipt.nodeIds).toEqual(['a', 'b']);
  expect((await service.read('p')).state.workbenchEdges).toHaveLength(1);
  const nodes = saved.state.workbenchBasicNodes as Array<Record<string, unknown>>;
  expect(nodes.find(n => n.id === 'b')?.linkedAttachments).toMatchObject([{sourceNodeId:'a',content:'hello',path:nodes.find(n=>n.id==='a')?.projectFilePath}]);
  expect((await apply('create', 0, [create('a'), create('b'), { type: 'edge.connect', edge: { id: 'ab', source: 'a', target: 'b' } }])).status).toBe(200);
  const receiptResponse = await fetch(`${base}/operations/create`);
  expect(receiptResponse.status).toBe(200);
  expect(await receiptResponse.json()).toEqual({ receipt: saved.receipt });
  expect((await apply('create', 0, [create('c')])).status).toBe(409);
  expect((await apply('stale', 0, [{ type: 'node.move', nodeId: 'a', x: 9, y: 9 }])).status).toBe(409);
  const reopened = new CanvasStateService(() => root);
  expect(await reopened.operation('p', 'create')).toEqual(saved.receipt);
});
it('keeps unknown canvas state, stored receipts and revision across legacy patches', async () => {
  const created = await (await apply('seed', 0, [create('a')])).json() as CanvasOperationsResponse;
  const saved = await service.patch('p', { workbenchViewport: { x: 13 }, customFutureField: { marker: true } }, { expectedRevision: created.revision });
  expect(saved.revision).toBeGreaterThan(created.revision);
  expect(saved.state.customFutureField).toEqual({ marker: true });
  expect(await new CanvasStateService(() => root).operation('p', 'seed')).toEqual(created.receipt);
  const next = await (await apply('after-patch', saved.revision, [{ type: 'node.move', nodeId: 'a', x: 40, y: 30 }])).json() as CanvasOperationsResponse;
  expect(next.state.customFutureField).toEqual({ marker: true });
  expect((next.state.workbenchBasicNodes as Array<Record<string, unknown>>)[0]).toMatchObject({ x: 40, y: 30 });
  expect((await service.read('p')).revision).toBe(next.revision);
});

it('advertises only attached asset-version operations, not an unsupported library binding', async () => {
  const response = await fetch(`${base}/capabilities`);
  expect(response.status).toBe(200);
  const capabilities = await response.json() as { protocolVersion: number; requestSchema: object; image: { source: string[]; assetVersionSource: string } };
  expect(capabilities.protocolVersion).toBe(1);
  expect(capabilities.requestSchema).toBeTruthy();
  expect(capabilities.image.source).toEqual(['project-file']);
  expect(capabilities.image.assetVersionSource).toContain('unavailable');
  expect((await apply('asset-absent', 0, [{ type: 'image.attach', nodeId: 'asset', source: { assetId: 'missing' }, x: 0, y: 0 }])).status).toBe(503);
});

it('rejects invalid batches without partial mutations and preserves authorization', async () => {
  expect((await apply('bad', 0, [create('a'), { type: 'edge.connect', edge: { id: 'x', source: 'a', target: 'missing' } }])).status).toBe(404);
  expect((await service.read('p')).state.workbenchBasicNodes).toBeUndefined();
  expect((await fetch(base.replace('/p/', '/forbidden/') + '/capabilities')).status).toBe(403);
});

it('edits, duplicates, removes with edges, and undoes without changing the original document', async () => {
  let result = await (await apply('seed', 0, [create('a'), create('b')])).json() as CanvasOperationsResponse;
  result = await (await apply('edit', result.revision, [
    { type: 'node.update', nodeId: 'a', set: { text: 'edited', title: 'Title' } },
    { type: 'node.move', nodeId: 'a', x: 130, y: -20 },
    { type: 'node.duplicate', nodeId: 'a', newNodeId: 'copy', x: 180, y: 10 },
    { type: 'edge.connect', edge: { id: 'ab', source: 'a', target: 'b' } },
  ])).json() as CanvasOperationsResponse;
  const edited = result.state.workbenchBasicNodes as Array<Record<string, unknown>>;
  expect(edited.find(n => n.id === 'a')).toMatchObject({ text: 'edited', x: 130, y: -20 });
  expect(edited.find(n => n.id === 'copy')?.projectFilePath).not.toBe(edited.find(n => n.id === 'a')?.projectFilePath);
  const revision = result.revision;
  expect((await apply('cycle', revision, [{ type: 'edge.connect', edge: { id: 'ba', source: 'b', target: 'a' } }])).status).toBe(400);
  result = await (await apply('delete', revision, [{ type: 'node.delete', nodeId: 'a' }])).json() as CanvasOperationsResponse;
  expect(result.state.workbenchEdges).toEqual([]);
  expect((result.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(n=>n.id==='b')?.linkedAttachments).toEqual([]);
  result = await (await apply('undo', result.revision, [{ type: 'operation.undo', operationId: 'delete' }])).json() as CanvasOperationsResponse;
  expect(result.state.workbenchBasicNodes).toHaveLength(3);
  expect(result.state.workbenchEdges).toHaveLength(1);
  const restored = result.state.workbenchBasicNodes as Array<Record<string, unknown>>;
  expect(restored.find(n=>n.id==='b')?.linkedAttachments).toMatchObject([{sourceNodeId:'a',content:'edited',path:restored.find(n=>n.id==='a')?.projectFilePath}]);
  await service.patch('p', { workbenchViewport: { x: 1 } });
  expect(await new CanvasStateService(() => root).operation('p', 'edit')).toMatchObject({ operationId: 'edit' });
});

it('allows independent legacy edits, rejects same-field and delete/edit races', async () => {
  const seed = await (await apply('seed', 0, [create('a')])).json() as CanvasOperationsResponse;
  const before = seed.state.workbenchBasicNodes as Array<Record<string, unknown>>;
  await service.patch('p', { workbenchBasicNodes: before.map(n => ({ ...n, title: 'Remote' })) }, { expectedRevision: seed.revision, base: { workbenchBasicNodes: before } });
  const moved = await service.patch('p', { workbenchBasicNodes: before.map(n => ({ ...n, x: 20 })) }, { expectedRevision: seed.revision, base: { workbenchBasicNodes: before } });
  expect(moved.state.workbenchBasicNodes).toMatchObject([{ title: 'Remote', x: 20 }]);
  await expect(service.patch('p', { workbenchBasicNodes: before.map(n => ({ ...n, title: 'Local' })) }, { base: { workbenchBasicNodes: before } })).rejects.toMatchObject({ status: 409 });
  await expect(service.patch('p', { workbenchBasicNodes: [] }, { base: { workbenchBasicNodes: before } })).rejects.toMatchObject({ status: 409 });
  expect((await apply('undo-old', moved.revision, [{ type: 'operation.undo', operationId: 'seed' }])).status).toBe(409);
});

it('serializes competing requests, rejects invalid types and honors draft preconditions', async () => {
  const results = await Promise.all([apply('one', 0, [create('a')]), apply('two', 0, [create('b')])]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const state = await service.read('p');
  expect((await apply('bad-kind', state.revision, [{ type: 'node.create', node: { ...create('x').node, kind: 'not-a-kind' } }])).status).toBe(400);
  expect((await apply('__proto__', state.revision, [create('x')])).status).toBe(400);
  const response = await fetch(`${base}/operations`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ operationId: 'draft', baseRevision: state.revision, expectedState: { workbenchBasicNodes: [] }, operations: [create((state.state.workbenchBasicNodes as Array<{id:string}>)[0]!.id)] }) });
  expect(response.status).toBe(409);
  for (const collection of [[null], ['invalid'], [{id:'duplicate'},{id:'duplicate'}]]) {
    const invalid = await fetch(`${base}/operations`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:'invalid-base',baseRevision:state.revision,expectedState:{workbenchBasicNodes:collection},operations:[create('new')]})});
    expect(invalid.status).toBe(400);
  }
  expect((await fetch(`${base}/operations/unknown`)).status).toBe(404);
  expect((await fetch(base.replace('/p/', '/forbidden/') + '/operations', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({operationId:'denied',baseRevision:0,operations:[create('x')]})})).status).toBe(403);
});

it('disconnects reference edges and refuses unsupported or ambiguous targets', async () => {
  const saved = await (await apply('seed',0,[create('a'),create('b'),{type:'edge.connect',edge:{id:'ab',source:'a',target:'b'}}])).json() as CanvasOperationsResponse;
  expect((await apply('duplicate-edge',saved.revision,[{type:'edge.connect',edge:{id:'ab2',source:'a',target:'b'}}])).status).toBe(400);
  expect((await apply('self',saved.revision,[{type:'edge.connect',edge:{id:'self',source:'a',target:'a'}}])).status).toBe(400);
  expect((await apply('missing-edge',saved.revision,[{type:'edge.disconnect',edgeId:'missing'}])).status).toBe(404);
  const disconnected=await (await apply('disconnect',saved.revision,[{type:'edge.disconnect',edgeId:'ab'}])).json() as CanvasOperationsResponse;
  expect(disconnected.state.workbenchEdges).toEqual([]);
  await service.patch('p',{workbenchBasicNodes:[{id:'img',kind:'image'},{id:'text',kind:'text',text:'',x:0,y:0}],workbenchOrganizationGroups:[{id:'group',members:['text']}]});
  const current=await service.read('p');
  expect((await apply('unsupported',current.revision,[{type:'node.move',nodeId:'img',x:1,y:1}])).status).toBe(400);
  expect((await apply('grouped',current.revision,[{type:'node.move',nodeId:'text',x:1,y:1}])).status).toBe(400);
  expect((await apply('no-undo',current.revision,[{type:'operation.undo',operationId:'absent'}])).status).toBe(404);
});
