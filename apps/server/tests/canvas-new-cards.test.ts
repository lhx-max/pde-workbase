import type { CanvasOperationsResponse } from '@bezier/contracts';
import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerCanvasStateRoutes } from '../src/routes/canvas.js';
let root: string, base: string, server: ReturnType<ReturnType<typeof express>['listen']>;
let service: CanvasStateService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-new-cards-'));
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
async function readState() { return (await (await fetch(`${base}/state`)).json()) as { revision: number; state: Record<string, unknown> }; }

it('creates video and storyboard cards, configures video, manages shots', async () => {
  const seed = await apply('seed', 0, [
    { type: 'node.create', node: { id: 'v1', kind: 'video', title: 'brief', text: 'run 4s', x: 0, y: 0 } },
    { type: 'node.create', node: { id: 'sb1', kind: 'storyboard', title: 'board', x: 400, y: 0 } },
  ]);
  expect(seed.status, await seed.clone().text()).toBe(200);
  const seeded = await readState();
  const nodes = seeded.state.workbenchBasicNodes as Array<Record<string, unknown>>;
  expect(nodes.find(n => n.id === 'v1')?.kind).toBe('video');
  expect(nodes.find(n => n.id === 'sb1')?.kind).toBe('storyboard');

  const cfg = await apply('cfg', seeded.revision, [
    { type: 'video.configure', nodeId: 'v1', set: { videoMode: 't2v', videoLength: 8, videoAspect: '16:9' } },
    { type: 'storyboard.shot.add', nodeId: 'sb1', shotId: 's1', set: { description: 'wide' } },
    { type: 'storyboard.shot.add', nodeId: 'sb1', shotId: 's2', set: { description: 'close' } },
  ]);
  expect(cfg.status, await cfg.clone().text()).toBe(200);
  const after = (await cfg.json()) as CanvasOperationsResponse;
  const board = (after.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(n => n.id === 'sb1')!;
  expect((board.storyboard as { shots?: unknown[] }).shots).toHaveLength(3);

  const move = await apply('mv', after.revision, [
    { type: 'storyboard.shot.move', nodeId: 'sb1', shotId: 's2', index: 0 },
    { type: 'storyboard.shot.duplicate', nodeId: 'sb1', shotId: 's1', newShotId: 's3' },
  ]);
  expect(move.status, await move.clone().text()).toBe(200);
  const moved = (await move.json()) as CanvasOperationsResponse;
  const shots = ((moved.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(n => n.id === 'sb1')!.storyboard as { shots: Array<{ id: string }> }).shots;
  expect(shots.map(s => s.id)).toEqual(['s2', 'sb1-shot-0', 's1', 's3']);
});

it('groups cards, arranges layout, renames and resizes nodes', async () => {
  const seed = await apply('seed', 0, [create('a'), create('b'), create('c')]);
  expect(seed.status).toBe(200);
  const revision = (await seed.json()) as CanvasOperationsResponse;
  const grouped = await apply('group', revision.revision, [
    { type: 'group.create', groupId: 'g1', nodeIds: ['a', 'b'], name: 'pair' },
  ]);
  expect(grouped.status, await grouped.clone().text()).toBe(200);
  const g1 = (await grouped.json()) as CanvasOperationsResponse;
  const groups = g1.state.workbenchOrganizationGroups as Array<Record<string, unknown>>;
  expect(groups.find(g => g.id === 'g1')?.memberIds).toEqual(['a', 'b']);

  const more = await apply('ops', g1.revision, [
    { type: 'group.dissolve', groupId: 'g1' },
    { type: 'node.rename', nodeId: 'c', title: 'renamed' },
    { type: 'node.resize', nodeId: 'c', width: 400, height: 300 },
    { type: 'layout.arrange', nodeIds: ['a', 'b'], mode: 'row', gap: 24 },
  ]);
  expect(more.status, await more.clone().text()).toBe(200);
  const final = (await more.json()) as CanvasOperationsResponse;
  expect((final.state.workbenchOrganizationGroups as unknown[])).toHaveLength(0);
  const c = (final.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(n => n.id === 'c')!;
  expect(c.title).toBe('renamed');
  expect(c.width).toBe(400);
});

it('creates a sketch card and validates video attach', async () => {
  const seed = await apply('seed', 0, [
    { type: 'sketch.create', nodeId: 'sk1', x: 0, y: 0, title: 'napkin' },
  ]);
  expect(seed.status, await seed.clone().text()).toBe(200);
  const after = (await seed.json()) as CanvasOperationsResponse;
  const sketch = (after.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(n => n.id === 'sk1')!;
  expect(sketch.kind).toBe('sketch');
  expect(String(sketch.projectFilePath)).toMatch(/\.sketch\.json$/);

  const v = await apply('v', after.revision, [
    { type: 'node.create', node: { id: 'v1', kind: 'video', title: 'v', x: 0, y: 0 } },
  ]);
  expect(v.status).toBe(200);
  const vrev = (await v.json()) as CanvasOperationsResponse;
  await writeFile(join(root, 'clip.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]));
  const attach = await apply('attach', vrev.revision, [{ type: 'video.attach', nodeId: 'v1', path: 'clip.mp4' }]);
  expect(attach.status, await attach.clone().text()).toBe(200);
});
