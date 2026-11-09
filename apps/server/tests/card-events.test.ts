import express from 'express';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publishCanvasCardChange } from '../src/canvas/card-events.js';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerAppCanvasRoutes } from '../src/routes/app-canvas.js';

let root: string, base: string, server: ReturnType<ReturnType<typeof express>['listen']>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'card-events-'));
  const registry = { create(input: { id?: string; name: string }) { return { id: input.id ?? 'generated' }; } };
  const service = new CanvasStateService(async id => { const dir = join(root, id); await mkdir(dir, { recursive: true }); return dir; });
  const app = express(); app.use(express.json());
  registerAppCanvasRoutes(app, { canvasState: service, registry });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('listener');
  base = `http://127.0.0.1:${address.port}/api/apps/canvas`;
});
afterEach(async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); });

function readEvents(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const next = async () => {
    while (!buf.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) throw Error('stream closed');
      buf += decoder.decode(chunk.value, { stream: true });
    }
    const raw = buf.slice(0, buf.indexOf('\n\n'));
    buf = buf.slice(buf.indexOf('\n\n') + 2);
    const event = raw.split('\n').find(line => line.startsWith('event: '))?.slice(7);
    const data = raw.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
    return { event, data: data ? JSON.parse(data) as Record<string, unknown> : {} };
  };
  return { next, close: () => reader.cancel() };
}

it('streams card create, update and delete, and replays after the cursor', async () => {
  const created = await fetch(`${base}/actions/canvas.create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { instanceId: 'live', name: 'live' } }) });
  expect(created.status).toBe(201);
  const stream = await fetch(`${base}/instances/live/events`);
  const live = readEvents(stream);
  const next = live.next;
  const ready = await next();
  expect(ready.event).toBe('ready');
  expect(ready.data.resync).toBe(false);

  const make = await fetch(`${base}/instances/live/actions/node.create`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'make' },
    body: JSON.stringify({ expectedRevision:Number(ready.data.cursor), input: { node: { id: 'card', kind: 'text', title: 'hello', text: 'hello', x: 0, y: 0 } } }),
  });
  expect(make.status, await make.clone().text()).toBe(200);
  const added = await next();
  expect(added.event).toBe('card.created');
  expect(added.data).toMatchObject({ instanceId: 'live', nodeId: 'card', kind: 'text', title: 'hello' });

  const moved = await fetch(`${base}/instances/live/actions/node.move`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'move' },
    body: JSON.stringify({ expectedRevision: Number(added.data.cursor), input: { nodeId: 'card', x: 20, y: 30 } }),
  });
  expect(moved.status, await moved.clone().text()).toBe(200);
  const updated = await next();
  expect(updated.event).toBe('card.updated');
  expect(updated.data.nodeId).toBe('card');

  const removed = await fetch(`${base}/instances/live/actions/node.delete`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'del' },
    body: JSON.stringify({ expectedRevision: Number(updated.data.cursor), input: { nodeId: 'card' } }),
  });
  expect(removed.status, await removed.clone().text()).toBe(200);
  const deleted = await next();
  expect(deleted.event).toBe('card.deleted');
  expect(deleted.data.nodeId).toBe('card');

  const replay = await fetch(`${base}/instances/live/events?after=${encodeURIComponent(String(added.data.cursor))}`);
  const replayedStream = readEvents(replay);
  const replayNext = replayedStream.next;
  const replayReady = await replayNext();
  expect(replayReady.data.resync).toBe(false);
  const replayed = await replayNext();
  expect(replayed.event).toBe('card.updated');
  expect((await replayNext()).event).toBe('card.deleted');
  await live.close();
  await replayedStream.close();
});

it('asks for a full re-read when the cursor fell out of the buffer', async () => {
  const created = await fetch(`${base}/actions/canvas.create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { instanceId: 'gap', name: 'gap' } }) });
  expect(created.status).toBe(201);
  for (let revision = 1; revision <= 201; revision += 1) {
    publishCanvasCardChange({ type: 'card.created', instanceId: 'gap', nodeId: `n${revision}`, kind: 'text', title: 't', revision, cursor: String(revision) });
  }
  const stream = await fetch(`${base}/instances/gap/events?after=0`);
  const opened = readEvents(stream);
  const ready = await opened.next();
  expect(ready.event).toBe('ready');
  expect(ready.data.resync).toBe(true);
  await opened.close();
});
