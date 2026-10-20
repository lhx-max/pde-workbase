import express from 'express';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerAppCanvasRoutes } from '../src/routes/app-canvas.js';
let root: string, base: string, server: ReturnType<ReturnType<typeof express>['listen']>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'app-canvas-'));
  const registry = { created: [] as string[], create(input: { id?: string; name: string }) {
    const id = input.id ?? 'generated';
    this.created.push(id);
    return { id };
  } };
  const service = new CanvasStateService(async id => { const dir = join(root, id); await mkdir(dir, { recursive: true }); return dir; });
  const app = express(); app.use(express.json());
  registerAppCanvasRoutes(app, { canvasState: service, registry });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('listener');
  base = `http://127.0.0.1:${address.port}/api/apps/canvas`;
});
afterEach(async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); });

it('declares actions, creates an instance, applies and queries', async () => {
  const caps = await (await fetch(base)).json() as { data: { appId: string; actions: Array<{ actionId: string }> } };
  expect(caps.data.appId).toBe('canvas');
  const actionIds = caps.data.actions.map((a: { actionId: string }) => a.actionId);
  expect(actionIds).toContain('canvas.create');
  expect(actionIds).toContain('storyboard.shot.add');
  expect(actionIds).toContain('layout.arrange');

  const created = await fetch(`${base}/actions/canvas.create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { name: 'demo', instanceId: 'inst-1' } }) });
  expect(created.status).toBe(201);
  const instance = ((await created.json()) as {data:{result:{instanceId:string}}}).data.result;
  expect(instance.instanceId).toBe('inst-1');

  const empty = await fetch(`${base}/instances/inst-1/state`);
  const snapshot = ((await empty.json()) as {data:{revision:number;state:Record<string,unknown>}}).data;
  expect(snapshot.state).toMatchObject({});

  const applied = await fetch(`${base}/instances/inst-1/actions/node.create`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'op-1' },
    body: JSON.stringify({ input: { node: { id: 'n1', kind: 'text', title: 't', text: 'hi', x: 0, y: 0 } }, expectedRevision: snapshot.revision }),
  });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const appliedData = ((await applied.json()) as {data:{receiptId:string;status:string;result:{state:Record<string,unknown>}}}).data;
  expect(appliedData.receiptId).toBe('op-1');
  expect(appliedData.status).toBe('succeeded');
  expect((appliedData.result.state.workbenchBasicNodes as unknown[])).toHaveLength(1);

  const replayed = await fetch(`${base}/instances/inst-1/actions/node.create`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'op-1' },
    body: JSON.stringify({ input: { node: { id: 'n1', kind: 'text', title: 't', text: 'hi', x: 0, y: 0 } }, expectedRevision: snapshot.revision }),
  });
  expect(((await replayed.json()) as {data:{replayed:boolean}}).data.replayed).toBe(true);

  const receipt = await fetch(`${base}/instances/inst-1/action-receipts/op-1`);
  expect(((await receipt.json()) as {data:{status:string}}).data.status).toBe('succeeded');
});
