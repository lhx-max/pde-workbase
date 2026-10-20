import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasStateService } from '../src/canvas/state.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('accepts the first legacy node insertion when the stored collection is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-empty-base-'));
  roots.push(root);
  const canvas = new CanvasStateService(() => root);
  const clip = { id: 'clip_1', kind: 'clip', x: 0, y: 0, title: 'Clip' };
  const saved = await canvas.patch('project_1', { workbenchBasicNodes: [clip] }, {
    expectedRevision: 0,
    base: { workbenchBasicNodes: [] },
  });
  expect(saved.state.workbenchBasicNodes).toEqual([clip]);
  expect((await canvas.read('project_1')).state.workbenchBasicNodes).toEqual([clip]);
});
