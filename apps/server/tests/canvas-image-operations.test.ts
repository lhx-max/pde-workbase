import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CanvasOperation } from '@bezier/contracts';
import { CanvasStateService } from '../src/canvas/state.js';
import { createLocalAssetLibrary, type AssetLibraryAdapter } from '../src/asset-library/service.js';

let root: string, dataRoot: string, canvas: CanvasStateService, assets: AssetLibraryAdapter;
let serial = 0;
const nodes = (state: Record<string, unknown>) => state.workbenchImages as Array<Record<string, any>>;
const apply = async (operations: CanvasOperation[]) => canvas.applyOperations('p', { operationId: `image-${serial++}`, baseRevision: (await canvas.read('p')).revision, operations });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-image-'));
  dataRoot = await mkdtemp(join(tmpdir(), 'canvas-image-library-'));
  assets = createLocalAssetLibrary(dataRoot);
  canvas = new CanvasStateService(() => root, undefined, assets);
  const pixels = Buffer.from(Array.from({ length: 24 }, (_, i) => i % 6 < 3 ? [255, 0, 0] : [0, 0, 255]).flat());
  await sharp(pixels, { raw: { width: 6, height: 4, channels: 3 } }).png().toFile(join(root, 'input.png'));
});
afterEach(async () => { await assets.close?.(); await rm(root, { recursive: true, force: true }); await rm(dataRoot, { recursive: true, force: true }); });

it('imports a local asset version, crops/rotates pixels and retains immutable image history', async () => {
  const original = await readFile(join(root, 'input.png'));
  const asset = await assets.create({ name: 'two colors', kind: 'image' }, { bytes: original, filename: 'input.png', mime: 'image/png' });
  const initial = await apply([{ type: 'image.attach', nodeId: 'image', source: { assetId: asset.id, versionId: asset.versions[0]!.id }, x: 10, y: 20 },
    { type: 'node.create', node: { id: 'text', kind: 'text', x: 500, y: 0, text: 'caption' } },
    { type: 'edge.connect', edge: { id: 'ref', source: 'image', target: 'text' } }]);
  const first = nodes(initial.state)[0]!;
  expect(first.sourceAsset).toEqual({ assetId: asset.id, versionId: asset.versions[0]!.id });
  expect(await assets.uses(asset.id)).toEqual(expect.arrayContaining([expect.objectContaining({ projectId: 'p', filename: first.path, versionId: asset.versions[0]!.id })]));
  const edited = await apply([{ type: 'image.transform', nodeId: 'image', expectedPath: first.path, crop: { x: 3, y: 0, width: 3, height: 4 }, rotate: 90 }]);
  const image = nodes(edited.state)[0]!;
  expect(image).toMatchObject({ naturalWidth: 4, naturalHeight: 3 });
  expect([...await sharp(await readFile(join(root, image.path))).removeAlpha().raw().toBuffer()]).toEqual(Array.from({ length: 12 }, () => [0, 0, 255]).flat());
  expect(await readFile(join(root, 'input.png'))).toEqual(original);
  expect((edited.state.workbenchBasicNodes as any[])[0].linkedAttachments).toMatchObject([{ path: image.path, sourceNodeId: 'image', naturalWidth: 4, naturalHeight: 3 }]);
  const selected = await apply([{ type: 'image.select', nodeId: 'image', path: first.path }]);
  expect(nodes(selected.state)[0]!.path).toBe(first.path);
  const undone = await apply([{ type: 'operation.undo', operationId: selected.receipt.operationId }]);
  expect(nodes(undone.state)[0]!.path).toBe(image.path);
  expect(await new CanvasStateService(() => root).operation('p', edited.receipt.operationId)).toEqual(edited.receipt);
});

it('rejects traversal, symlinks, invalid pixels, out-of-bounds crops and stale image targets', async () => {
  await writeFile(join(root, 'not.png'), 'not an image');
  await symlink(join(root, 'input.png'), join(root, 'link.png'));
  for (const filename of ['../input.png', '/tmp/input.png', 'link.png', 'not.png'])
    await expect(apply([{ type: 'image.attach', nodeId: 'bad', source: { path: filename }, x: 0, y: 0 }])).rejects.toMatchObject({ status: 400 });
  const initial = await apply([{ type: 'image.attach', nodeId: 'image', source: { path: 'input.png' }, x: 0, y: 0 }]);
  expect(nodes(initial.state)[0]!.sourceProjectFilePath).toBe('input.png');
  await expect(apply([{ type: 'node.create', node: { id: 'never', kind: 'text', x: 0, y: 0 } },
    { type: 'image.transform', nodeId: 'image', crop: { x: 5, y: 0, width: 3, height: 4 } }])).rejects.toMatchObject({ status: 400 });
  expect(await canvas.read('p')).toEqual({ state: initial.state, revision: initial.revision });
  await expect(apply([{ type: 'image.transform', nodeId: 'image', expectedPath: 'stale.png', rotate: 90 }])).rejects.toMatchObject({ status: 409 });
});

it('replays a transform once and deletes image edges with their source', async () => {
  const initial = await apply([{ type: 'image.attach', nodeId: 'image', source: { path: 'input.png' }, x: 0, y: 0 }]);
  const request = { operationId: 'rotate-once', baseRevision: initial.revision, operations: [{ type: 'image.transform' as const, nodeId: 'image', rotate: 90 as const }] };
  const first = await canvas.applyOperations('p', request), replay = await canvas.applyOperations('p', request);
  expect(replay.replayed).toBe(true);
  expect(replay.state).toEqual(first.state);
  await apply([{ type: 'node.duplicate', nodeId: 'image', newNodeId: 'copy', x: 50, y: 60 }, { type: 'edge.connect', edge: { id: 'ref', source: 'image', target: 'copy' } }]);
  const deleted = await apply([{ type: 'node.delete', nodeId: 'image' }]);
  expect(nodes(deleted.state)).toHaveLength(1);
  expect(deleted.state.workbenchEdges).toEqual([]);
});
