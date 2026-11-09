import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasStateService } from '../src/canvas/state.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('saves the first image prompt map, merges different cards and rejects conflicting edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-empty-drafts-'));
  roots.push(root);
  const canvas = new CanvasStateService(() => root);
  await canvas.patch('p', { workbenchTaskDrafts: { a: { text: 'First image' } } }, { base: { workbenchTaskDrafts: {} } });
  const merged = await canvas.patch('p', { workbenchTaskDrafts: { b: { text: 'Second image' } } }, { base: { workbenchTaskDrafts: {} } });
  expect(merged.state.workbenchTaskDrafts).toEqual({ a: { text: 'First image' }, b: { text: 'Second image' } });
  await expect(canvas.patch('p', { workbenchTaskDrafts: { a: { text: 'Conflicting image' } } }, { base: { workbenchTaskDrafts: {} } })).rejects.toMatchObject({ status: 409 });
});
it('accepts an explicitly absent initial UI value and rejects overwriting a concurrent first write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-absent-ui-')); roots.push(root);
  const canvas = new CanvasStateService(() => root);
  const first = await canvas.patch('p', { viewport: { x: 0, y: 0, zoom: 0.7 } }, { base: { viewport: null } });
  expect(first.state.viewport).toEqual({ x: 0, y: 0, zoom: 0.7 });
  await expect(canvas.patch('p', { viewport: { x: 0, y: 0, zoom: 0.8 } }, { base: { viewport: null } })).rejects.toMatchObject({ status: 409 });
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
