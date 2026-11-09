import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStateError } from '@bezier/canvas-core';
import { CARD_CAPABILITY_MATRIX } from '../src/canvas/card-capability-matrix.js';
import { CanvasStateService } from '../src/canvas/state.js';

const KINDS = ['text', 'image', 'sketch', 'storyboard', 'video', 'page', 'presentation'] as const;
type Kind = (typeof KINDS)[number];
type Cell = 'supported' | 'not-applicable' | 'gap';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.alloc(16);
MP4.writeUInt32BE(16, 0);
MP4.write('ftyp', 4, 'ascii');
MP4.write('isom', 8, 'ascii');
const HTML = '<section>capability</section>';

let root: string;
let service: CanvasStateService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'card-matrix-'));
  service = new CanvasStateService(async (id) => join(root, id));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function findNode(state: Record<string, unknown>, id: string): Record<string, unknown> | undefined {
  for (const list of [state.workbenchBasicNodes, state.workbenchImages]) {
    if (!Array.isArray(list)) continue;
    const found = list.find(item => item && typeof item === 'object' && (item as { id?: string }).id === id);
    if (found && typeof found === 'object') return found as Record<string, unknown>;
  }
  return undefined;
}

function cellOf(error: unknown): Cell {
  if (error instanceof CanvasStateError && error.code === 'CANVAS_OPERATION_UNSUPPORTED') return 'not-applicable';
  return 'gap';
}

function projectId(kind: Kind, action: string): string {
  return `${kind}-${action}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

async function project(kind: Kind, action: string) {
  const id = projectId(kind, action);
  const dir = join(root, id);
  await mkdir(join(dir, 'images'), { recursive: true });
  await mkdir(join(dir, 'videos'), { recursive: true });
  await writeFile(join(dir, 'images/seed.png'), PNG);
  await writeFile(join(dir, 'images/other.png'), PNG);
  await writeFile(join(dir, 'videos/seed.mp4'), MP4);
  let seq = 0;
  const apply = async (operations: Record<string, unknown>[]) => {
    const operationId = `op${++seq}`;
    const revision = (await service.read(id)).revision;
    try {
      const result = await service.applyOperations(id, { operationId, baseRevision: revision, operations });
      const saved = await service.read(id);
      if (saved.revision !== result.revision) throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'read-back revision drifted');
      return { ok: true as const, state: result.state, operationId };
    } catch (error) {
      return { ok: false as const, error, operationId };
    }
  };
  return { apply, dir, id };
}

function seedOps(kind: Kind): Record<string, unknown>[] {
  const peers = [
    { type: 'node.create', node: { id: 'peer', kind: 'text', title: 'peer', text: 'peer', x: 400, y: 0 } },
    { type: 'node.create', node: { id: 'third', kind: 'text', title: 'third', text: 'third', x: 800, y: 0 } },
  ];
  if (kind === 'text') return [{ type: 'node.create', node: { id: 'card', kind: 'text', title: 'card', text: 'hello', x: 0, y: 0 } }, ...peers];
  if (kind === 'storyboard') return [{ type: 'node.create', node: { id: 'card', kind: 'storyboard', x: 0, y: 0 } }, ...peers];
  if (kind === 'video') return [{ type: 'node.create', node: { id: 'card', kind: 'video', x: 0, y: 0 } }, ...peers];
  if (kind === 'image') return [{ type: 'image.attach', nodeId: 'card', source: { path: 'images/seed.png' }, x: 0, y: 0, name: 'seed.png' }, ...peers];
  if (kind === 'sketch') return [{ type: 'sketch.create', nodeId: 'card', x: 0, y: 0, title: '草图' }, ...peers];
  return [{ type: 'document.create', nodeId: 'card', format: kind === 'presentation' ? 'presentation' : 'html', x: 0, y: 0, title: kind, source: { html: HTML } }, ...peers];
}

async function seed(kind: Kind, action: string) {
  const ctx = await project(kind, action);
  const created = await ctx.apply(seedOps(kind));
  if (!created.ok) return { ...ctx, created };
  const node = findNode(created.state, 'card');
  if (!node) return { ...ctx, created: { ok: false as const, error: new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'seed card missing'), operationId: created.operationId } };
  return { ...ctx, created, node };
}

const ACTIONS = [
  'node.update', 'node.rename', 'node.resize', 'node.move', 'node.duplicate', 'node.delete', 'operation.undo',
  'image.replace', 'image.transform', 'image.select',
  'sketch.update',
  'document.begin', 'document.select',
  'storyboard.shot.add', 'storyboard.shot.update', 'storyboard.shot.references', 'storyboard.shot.move', 'storyboard.shot.delete', 'storyboard.shot.duplicate',
  'video.configure', 'video.attach', 'video.select',
  'edge.connect', 'edge.disconnect',
  'group.create', 'group.rename', 'group.add', 'group.remove', 'group.dissolve', 'group.move', 'layout.arrange',
] as const;
type Action = (typeof ACTIONS)[number];

function finish(result: { ok: true } | { ok: false; error: unknown }): Cell {
  return result.ok ? 'supported' : cellOf(result.error);
}

async function measure(kind: Kind, action: Action): Promise<Cell> {
  const ready = await seed(kind, action);
  if (!ready.created.ok || !('node' in ready)) return cellOf(ready.created.error);
  const node = ready.node;
  const apply = ready.apply;
  const filePath = typeof node.projectFilePath === 'string' ? node.projectFilePath : '';
  const imagePath = typeof node.path === 'string' ? node.path : '';

  if (action === 'operation.undo') {
    const moved = await apply([{ type: 'node.move', nodeId: 'card', x: 12, y: 18 }]);
    if (!moved.ok) return cellOf(moved.error);
    return finish(await apply([{ type: 'operation.undo', operationId: moved.operationId }]));
  }
  if (action === 'node.update') return finish(await apply([{ type: 'node.update', nodeId: 'card', set: { text: 'edited' } }]));
  if (action === 'node.rename') return finish(await apply([{ type: 'node.rename', nodeId: 'card', title: 'renamed' }]));
  if (action === 'node.resize') return finish(await apply([{ type: 'node.resize', nodeId: 'card', width: 200, height: 160 }]));
  if (action === 'node.move') return finish(await apply([{ type: 'node.move', nodeId: 'card', x: 24, y: 32 }]));
  if (action === 'node.duplicate') return finish(await apply([{ type: 'node.duplicate', nodeId: 'card', newNodeId: 'copy', x: 48, y: 48 }]));
  if (action === 'node.delete') return finish(await apply([{ type: 'node.delete', nodeId: 'card' }]));
  if (action === 'image.replace') return finish(await apply([{ type: 'image.replace', nodeId: 'card', source: { path: 'images/other.png' }, ...(imagePath ? { expectedPath: imagePath } : {}) }]));
  if (action === 'image.transform') return finish(await apply([{ type: 'image.transform', nodeId: 'card', rotate: 90, ...(imagePath ? { expectedPath: imagePath } : {}) }]));
  if (action === 'image.select') return finish(await apply([{ type: 'image.select', nodeId: 'card', path: imagePath || 'missing.png', ...(imagePath ? { expectedPath: imagePath } : {}) }]));
  if (action === 'sketch.update') {
    if (!filePath) return finish(await apply([{ type: 'sketch.update', nodeId: 'card', document: { version: 2, elements: [] }, expectedPath: 'missing.sketch.json', expectedContent: '' }]));
    const expectedContent = await readFile(join(ready.dir, filePath), 'utf8');
    return finish(await apply([{ type: 'sketch.update', nodeId: 'card', document: { version: 2, elements: [{ id: 'mark' }], appState: {}, files: {} }, expectedPath: filePath, expectedContent }]));
  }
  if (action === 'document.begin') return finish(await apply([{ type: 'document.begin', nodeId: 'card', requestId: 'req1', outputPath: 'generated.html', ...(filePath ? { expectedPath: filePath } : {}) }]));
  if (action === 'document.select') return finish(await apply([{ type: 'document.select', nodeId: 'card', path: filePath || 'missing.html', ...(filePath ? { expectedPath: filePath } : {}) }]));
  if (action === 'storyboard.shot.add') return finish(await apply([{ type: 'storyboard.shot.add', nodeId: 'card', shotId: 'extra', set: { description: '加一镜' } }]));
  if (action === 'storyboard.shot.update') return finish(await apply([{ type: 'storyboard.shot.update', nodeId: 'card', shotId: 'card-shot-0', set: { description: '改一镜' } }]));
  if (action === 'storyboard.shot.move') return finish(await apply([{ type: 'storyboard.shot.move', nodeId: 'card', shotId: 'card-shot-0', index: 0 }]));
  if (action === 'storyboard.shot.duplicate') return finish(await apply([{ type: 'storyboard.shot.duplicate', nodeId: 'card', shotId: 'card-shot-0', newShotId: 'dupshot' }]));
  if (action === 'storyboard.shot.delete') {
    const added = await apply([{ type: 'storyboard.shot.add', nodeId: 'card', shotId: 'extra' }]);
    if (!added.ok) return cellOf(added.error);
    return finish(await apply([{ type: 'storyboard.shot.delete', nodeId: 'card', shotId: 'extra' }]));
  }
  if (action === 'storyboard.shot.references') {
    const current = await service.read(ready.id);
    await service.patch(ready.id, {
      workbenchStoryboardAssets: [{ id: 'hero', kind: 'character' }, { id: 'room', kind: 'scene' }],
    }, { expectedRevision: current.revision });
    return finish(await apply([{ type: 'storyboard.shot.references', nodeId: 'card', shotId: 'card-shot-0', characters: [{ assetId: 'hero' }], scene: { assetId: 'room' } }]));
  }
  if (action === 'video.configure') return finish(await apply([{ type: 'video.configure', nodeId: 'card', set: { videoLength: 6 } }]));
  if (action === 'video.attach') return finish(await apply([{ type: 'video.attach', nodeId: 'card', path: 'videos/seed.mp4' }]));
  if (action === 'video.select') {
    const attached = await apply([{ type: 'video.attach', nodeId: 'card', path: 'videos/seed.mp4' }]);
    if (!attached.ok) return cellOf(attached.error);
    const video = findNode(attached.state, 'card');
    const resultId = typeof video?.activeVideoResultId === 'string' ? video.activeVideoResultId : '';
    const expectedPath = typeof video?.projectFilePath === 'string' ? video.projectFilePath : undefined;
    return finish(await apply([{ type: 'video.select', nodeId: 'card', resultId, ...(expectedPath ? { expectedPath } : {}) }]));
  }
  if (action === 'edge.connect') return finish(await apply([{ type: 'edge.connect', edge: { id: 'link', source: 'card', target: 'peer' } }]));
  if (action === 'edge.disconnect') {
    const linked = await apply([{ type: 'edge.connect', edge: { id: 'link', source: 'card', target: 'peer' } }]);
    if (!linked.ok) return cellOf(linked.error);
    return finish(await apply([{ type: 'edge.disconnect', edgeId: 'link' }]));
  }
  if (action === 'layout.arrange') return finish(await apply([{ type: 'layout.arrange', nodeIds: ['card', 'peer'], mode: 'row', gap: 24 }]));
  if (action === 'group.create') return finish(await apply([{ type: 'group.create', groupId: 'grp', nodeIds: ['card', 'peer'], name: '一组' }]));
  const grouped = await apply([{ type: 'group.create', groupId: 'grp', nodeIds: ['card', 'peer'], name: '一组' }]);
  if (!grouped.ok) return cellOf(grouped.error);
  if (action === 'group.rename') return finish(await apply([{ type: 'group.rename', groupId: 'grp', name: '改名' }]));
  if (action === 'group.move') return finish(await apply([{ type: 'group.move', groupId: 'grp', x: 16, y: 16 }]));
  if (action === 'group.add') return finish(await apply([{ type: 'group.add', groupId: 'grp', nodeIds: ['third'] }]));
  if (action === 'group.remove') {
    const added = await apply([{ type: 'group.add', groupId: 'grp', nodeIds: ['third'] }]);
    if (!added.ok) return cellOf(added.error);
    return finish(await apply([{ type: 'group.remove', groupId: 'grp', nodeIds: ['third'] }]));
  }
  if (action === 'group.dissolve') return finish(await apply([{ type: 'group.dissolve', groupId: 'grp' }]));
  return 'gap';
}

async function measureCreate(kind: Kind): Promise<Cell> {
  const ctx = await project(kind, 'create');
  const created = await ctx.apply(seedOps(kind).filter(op => {
    const node = op.node as { id?: string } | undefined;
    return node?.id === 'card' || op.nodeId === 'card';
  }));
  if (!created.ok) return created.error instanceof CanvasStateError && created.error.code === 'CANVAS_INVALID_INPUT' ? 'not-applicable' : cellOf(created.error);
  const node = findNode(created.state, 'card');
  if (!node) return 'gap';
  if (kind === 'text' && node.kind !== 'text') return 'gap';
  if (kind === 'storyboard' && node.kind !== 'storyboard') return 'gap';
  if (kind === 'video' && node.kind !== 'video') return 'gap';
  if (kind === 'sketch' && node.kind !== 'sketch') return 'gap';
  if (kind === 'page' && (node.kind !== 'page' || node.artifactFormat !== 'html')) return 'gap';
  if (kind === 'presentation' && (node.kind !== 'page' || node.artifactFormat !== 'presentation')) return 'gap';
  if (kind === 'image' && !Array.isArray(created.state.workbenchImages)) return 'gap';
  const saved = await service.read(ctx.id);
  return findNode(saved.state, 'card') ? 'supported' : 'gap';
}

it('measures how each core card accepts each action', async () => {
  const creates: Record<string, Cell> = {};
  for (const kind of KINDS) creates[kind] = await measureCreate(kind);
  const matrix: Record<string, Record<string, Cell>> = {};
  for (const kind of KINDS) {
    matrix[kind] = {};
    for (const action of ACTIONS) matrix[kind][action] = await measure(kind, action);
  }
  expect(creates).toEqual({
    text: 'supported', image: 'supported', sketch: 'supported', storyboard: 'supported', video: 'supported', page: 'supported', presentation: 'supported',
  });
  expect(matrix).toEqual(CARD_CAPABILITY_MATRIX);
}, 180_000);
