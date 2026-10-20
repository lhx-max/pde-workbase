import express from 'express';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CanvasOperationsResponse } from '@bezier/contracts';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerCanvasStateRoutes } from '../src/routes/canvas.js';

let root: string;
let service: CanvasStateService;
let server: ReturnType<ReturnType<typeof express>['listen']>;
let url: string;
const request = { operationId: 'first', baseRevision: 0, operations: [{ type: 'node.create', node: { id: 'text', kind: 'text', text: 'original', x: 0, y: 0 } }] };
const post = (body: unknown) => fetch(`${url}/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stateFile = () => join(root, '.bezierdesign', 'canvas-state.json');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-journal-regression-'));
  service = new CanvasStateService(id => id === 'project' ? root : null);
  const app = express(); app.use(express.json()); registerCanvasStateRoutes(app, { canvasState: service });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('listener');
  url = `http://127.0.0.1:${address.port}/api/projects/project/canvas`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

async function committed() {
  const response = await post(request);
  expect(response.status).toBe(200);
  return response.json() as Promise<CanvasOperationsResponse>;
}
async function retained(receipt: CanvasOperationsResponse['receipt'], previousRevision: number) {
  const receiptResponse = await fetch(`${url}/operations/first`);
  expect(receiptResponse.status).toBe(200);
  expect(await receiptResponse.json()).toEqual({ receipt });
  const reopened = new CanvasStateService(() => root);
  const current = await reopened.read('project');
  expect(current.revision).toBeGreaterThan(previousRevision);
  expect((await reopened.revision('project'))).toBe(current.revision);
  const replay = await post(request);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ replayed: true, revision: current.revision, receipt });
  expect((await reopened.read('project')).revision).toBe(current.revision);
  expect((await post({ ...request, operations: [{ type: 'node.delete', nodeId: 'text' }] })).status).toBe(409);
  return current;
}

it('operations → legacy PATCH → receipt/replay keeps unknown keys and strictly increasing revision', async () => {
  const first = await committed();
  const patched = await fetch(`${url}/state`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: first.revision, changes: { workbenchViewport: { x: 3 }, futureExtension: { value: 1 } } }) });
  expect(patched.status).toBe(200);
  const patchResult = await patched.json() as { revision: number };
  expect(patchResult.revision).toBeGreaterThan(first.revision);
  const current = await retained(first.receipt, first.revision);
  expect(current.state).toMatchObject({ futureExtension: { value: 1 }, workbenchViewport: { x: 3 } });
  expect((await service.patch('project', { futureExtension: { value: 1 } })).revision).toBe(current.revision);
  await expect(service.patch('project', { futureExtension: { value: 2 } }, { expectedRevision: first.revision })).rejects.toMatchObject({ status: 409 });
});

it('operations → media state → receipt/replay, including a no-op media update', async () => {
  const first = await committed();
  const media = await service.updateMediaState('project', state => ({ ...state, mediaDelivery: { status: 'done' } }));
  expect(media.revision).toBeGreaterThan(first.revision);
  const current = await retained(first.receipt, first.revision);
  expect(current.state.mediaDelivery).toEqual({ status: 'done' });
  const noop = await service.updateMediaState('project', state => state);
  expect(noop.revision).toBe(current.revision);
});

it('operations → candidate and workflow delivery → durable receipt and monotonic revision', async () => {
  await service.patch('project', { workbenchBasicNodes: [{ id: 'candidate', kind: 'text', text: 'draft', generation: { requestId: 'generation' } }] });
  const start = await service.read('project');
  const operation = { ...request, baseRevision: start.revision };
  const firstResponse = await post(operation);
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json() as CanvasOperationsResponse;
  const candidate = await service.linkTextCandidate('project', { nodeId: 'candidate', requestId: 'generation', runId: 'run', content: 'answer' });
  expect(candidate.revision).toBeGreaterThan(first.revision);
  expect(await service.operation('project', 'first')).toEqual(first.receipt);
  const bumped = (await service.patch('project', { workbenchViewport: { x: 7, y: 7 } })).revision;
  expect(bumped).toBeGreaterThan(candidate.revision);
  expect((await service.read('project')).revision).toBe(bumped);
  expect(await new CanvasStateService(() => root).operation('project', 'first')).toEqual(first.receipt);
  const replay = await post(operation);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ replayed: true, revision: bumped });
});

it('a corrupt persisted document cannot be read or overwritten by PATCH, media, delivery or operations', async () => {
  await committed();
  const corrupt = '{"version":1,"state":';
  await writeFile(stateFile(), corrupt);
  await expect(service.read('project')).rejects.toMatchObject({ code: 'CANVAS_STORAGE_ERROR' });
  await expect(service.revision('project')).rejects.toMatchObject({ code: 'CANVAS_STORAGE_ERROR' });
  expect((await fetch(`${url}/state`)).status).toBe(500);
  expect((await post({ ...request, operationId: 'second' })).status).toBe(500);
  expect((await fetch(`${url}/state`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes: { workbenchViewport: { x: 1 } } }) })).status).toBe(500);
  await expect(service.updateMediaState('project', state => ({ ...state, marker: true }))).rejects.toMatchObject({ code: 'CANVAS_STORAGE_ERROR' });
  expect(await readFile(stateFile(), 'utf8')).toBe(corrupt);
});

it('preserves historical unknown top-level fields alongside operation receipts on every write', async () => {
  const first = await committed();
  const document = JSON.parse(await readFile(stateFile(), 'utf8')) as Record<string, unknown>;
  document.futureEnvelope = { writer: 'newer-client' };
  await writeFile(stateFile(), JSON.stringify(document));
  const updated = await service.updateMediaState('project', state => ({ ...state, media: 'updated' }));
  expect(updated.revision).toBeGreaterThan(first.revision);
  const saved = JSON.parse(await readFile(stateFile(), 'utf8')) as Record<string, unknown>;
  expect(saved.futureEnvelope).toEqual({ writer: 'newer-client' });
  expect(await service.operation('project', 'first')).toEqual(first.receipt);
});

it('a no-op operation receipt survives later writes without rewriting a real node', async () => {
  const created = await committed();
  const noopRequest = { operationId: 'noop', baseRevision: created.revision, operations: [{ type: 'node.move', nodeId: 'text', x: 0, y: 0 }] };
  const response = await post(noopRequest);
  expect(response.status).toBe(200);
  const noop = await response.json() as CanvasOperationsResponse;
  expect(noop.receipt.status).toBe('noop');
  const updated = await service.updateMediaState('project', state => ({ ...state, deliveryMarker: true }));
  expect(updated.revision).toBeGreaterThan(noop.revision);
  expect(await service.operation('project', 'noop')).toEqual(noop.receipt);
  expect(await (await post(noopRequest)).json()).toMatchObject({ replayed: true, revision: updated.revision, receipt: noop.receipt });
});

it('a structurally invalid canvas document is not treated as empty state', async () => {
  await mkdir(join(root, '.bezierdesign'), { recursive: true });
  const invalid = JSON.stringify({ version: 1, projectId: 'project', state: null });
  await writeFile(stateFile(), invalid);
  await expect(service.read('project')).rejects.toMatchObject({ code: 'CANVAS_STORAGE_ERROR' });
  await expect(service.patch('project', { marker: true })).rejects.toMatchObject({ code: 'CANVAS_STORAGE_ERROR' });
  expect(await readFile(stateFile(), 'utf8')).toBe(invalid);
});
