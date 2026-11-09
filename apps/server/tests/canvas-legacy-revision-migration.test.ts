import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasStateService } from '../src/canvas/state.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'canvas-legacy-revision-')); roots.push(root);
  const file = join(root, '.bezierdesign', 'canvas-state.json');
  const service = new CanvasStateService(() => root);
  return { root, file, service };
}

it('first legacy PATCH migrates the mtime revision and consecutive same-millisecond writes increment strictly', async () => {
  const { file, service } = await fixture();
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, projectId: 'project', state: { futureState: { keep: true } }, updatedAt: 'legacy' }));
  const frozen = new Date('2023-01-01T00:00:00.000Z');
  await utimes(file, frozen, frozen);
  const legacy = Math.trunc((await stat(file)).mtimeMs);
  expect((await service.read('project')).revision).toBe(legacy);
  vi.spyOn(Date, 'now').mockReturnValue(legacy);
  const first = await service.patch('project', { workbenchViewport: { x: 1 } }, { expectedRevision: legacy });
  const second = await service.patch('project', { workbenchViewport: { x: 2 } }, { expectedRevision: first.revision });
  expect(first.revision).toBeGreaterThan(legacy);
  expect(second.revision).toBe(first.revision + 1);
  expect(second.state.futureState).toEqual({ keep: true });
  const saved = JSON.parse(await readFile(file, 'utf8')) as { revision?: number };
  expect(saved.revision).toBe(second.revision);
  expect((await new CanvasStateService(() => join(file, '..', '..')).read('project')).revision).toBe(second.revision);
  await expect(service.patch('project', { marker: 'stale' }, { expectedRevision: legacy })).rejects.toMatchObject({ status: 409 });
});

it('first legacy media delivery also migrates mtime without losing existing content', async () => {
  const { file, service } = await fixture();
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, projectId: 'project', state: { oldProperty: { preserved: true } } }));
  const frozen = new Date('2023-01-01T00:00:00.000Z');
  await utimes(file, frozen, frozen);
  const before = (await service.read('project')).revision;
  vi.spyOn(Date, 'now').mockReturnValue(before);
  const delivered = await service.updateMediaState('project', state => ({ ...state, delivered: true }));
  expect(delivered.revision).toBeGreaterThan(before);
  expect(delivered.state.oldProperty).toEqual({ preserved: true });
  expect((JSON.parse(await readFile(file, 'utf8')) as { revision: number }).revision).toBe(delivered.revision);
});

it('new canvases persist strictly increasing revision without operation journal; no-op retains revision', async () => {
  const { file, service } = await fixture();
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  const first = await service.patch('project', { one: 1 });
  const second = await service.updateMediaState('project', state => ({ ...state, two: 2 }));
  const third = await service.patch('project', { three: 3 });
  expect(second.revision).toBe(first.revision + 1);
  expect(third.revision).toBe(second.revision + 1);
  expect((await service.patch('project', { three: 3 })).revision).toBe(third.revision);
  expect((await service.read('project')).revision).toBe(third.revision);
  expect((JSON.parse(await readFile(file, 'utf8')) as { revision: number }).revision).toBe(third.revision);
});
