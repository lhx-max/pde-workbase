import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { CanvasStateService } from '../src/canvas/state.js';
import { AppwriteClient } from '../src/storage/appwrite-client.js';
import { AppwriteCanvasFileContent, AppwriteCanvasPersistence } from '../src/storage/canvas-appwrite-persistence.js';
import { appwriteCanvasEffects, AppwriteSketchStore, readLocalProjectFile } from '../src/storage/canvas-appwrite-effects.js';
import { AppwriteCanvasAssetStore } from '../src/storage/canvas-appwrite-assets.js';

/** Live closed-loop suite: every canvas operation domain against real Appwrite.
 * Skipped unless APPWRITE_SESSION_COOKIE is set. */
const cookie = process.env.APPWRITE_SESSION_COOKIE;
const configured = Boolean(cookie);
const config = {
  endpoint: process.env.APPWRITE_ENDPOINT ?? 'https://frontend-cloud.corp.kuaishou.com/v1',
  projectId: process.env.APPWRITE_PROJECT ?? 'grworkspace',
  databaseId: process.env.APPWRITE_DATABASE ?? 'canvas_app_dev',
  bucketId: process.env.APPWRITE_BUCKET ?? 'canvas_assets_v2',
  sessionCookie: cookie!,
};

type Apply = (ops: Record<string, unknown>[], opts?: { opId?: string; base?: number }) => Promise<{ state: Record<string, unknown>; revision: number; receipt: { status: string }; replayed?: boolean }>;

describe.skipIf(!configured)('CanvasStateService on Appwrite (live)', () => {
  it('runs every operation domain end-to-end', async () => {
    const client = new AppwriteClient(config);
    const canvasId = `full_${Date.now()}`;
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'canvas-appwrite-'));
    const service = new CanvasStateService(() => projectRoot, undefined, undefined, {
      persistence: new AppwriteCanvasPersistence(client, config.databaseId),
      content: new AppwriteCanvasFileContent(client, config.databaseId, config.bucketId, 'canvas_files', (pid, rel) => readLocalProjectFile(() => projectRoot, pid, rel)),
      effects: appwriteCanvasEffects(client, config.databaseId, config.bucketId, () => projectRoot),
    });
    let n = 0;
    let base = 0;
    const apply: Apply = async (ops, opts = {}) => {
      const result = await service.applyOperations(canvasId, { operationId: opts.opId ?? `op-${++n}`, baseRevision: opts.base ?? base, operations: ops });
      base = result.revision;
      return result;
    };

    // ── text + node.* ─────────────────────────────────────────
    await apply([{ type: 'node.create', node: { id: 't1', kind: 'text', title: 'T', text: 'hi', x: 0, y: 0 } }]);
    let snapshot = await service.read(canvasId);
    const textNode = (snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(x => x.id === 't1')!;
    const textPath = String(textNode.projectFilePath);
    expect(await new AppwriteCanvasFileContent(client, config.databaseId, config.bucketId).read(canvasId, textPath)).toBe('hi');

    await apply([
      { type: 'node.update', nodeId: 't1', set: { text: 'updated' } },
      { type: 'node.move', nodeId: 't1', x: 50, y: 60 },
      { type: 'node.rename', nodeId: 't1', title: 'Renamed' },
      { type: 'node.resize', nodeId: 't1', width: 500, height: 300 },
      { type: 'node.duplicate', nodeId: 't1', newNodeId: 't2', x: 900, y: 0 },
    ]);
    snapshot = await service.read(canvasId);
    const nodes = snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>>;
    expect(nodes.find(x => x.id === 't2')).toBeTruthy();

    // ── edge.* ────────────────────────────────────────────────
    await apply([{ type: 'edge.connect', edge: { id: 'e1', source: 't1', target: 't2' } }]);
    snapshot = await service.read(canvasId);
    expect((snapshot.state.workbenchEdges as unknown[]).length).toBe(1);
    await apply([{ type: 'edge.disconnect', edgeId: 'e1' }]);
    snapshot = await service.read(canvasId);
    expect((snapshot.state.workbenchEdges as unknown[]).length).toBe(0);

    // ── group.* + layout ──────────────────────────────────────
    await apply([
      { type: 'group.create', groupId: 'g1', nodeIds: ['t1', 't2'], name: 'G' },
      { type: 'group.rename', groupId: 'g1', name: 'G2' },
      { type: 'group.move', groupId: 'g1', x: 100, y: 100 },
    ]);
    await apply([
      { type: 'group.remove', groupId: 'g1', nodeIds: ['t2'] },
      { type: 'group.add', groupId: 'g1', nodeIds: ['t2'] },
      { type: 'group.dissolve', groupId: 'g1' },
    ]);
    await apply([{ type: 'layout.arrange', nodeIds: ['t1', 't2'], mode: 'row' }]);

    // ── image.* ───────────────────────────────────────────────
    // MVP path: a file that landed on project disk attaches transparently —
    // the Appwrite store mirrors it into the bucket + index on first read.
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    mkdirSync(path.join(projectRoot, 'uploads'), { recursive: true });
    writeFileSync(path.join(projectRoot, 'uploads/local.png'), png);
    const attached = await apply([{ type: 'image.attach', nodeId: 'img1', x: 10, y: 10, source: { path: 'uploads/local.png' } }]);
    const img = (attached.state.workbenchImages as Array<Record<string, unknown>>).find(x => x.id === 'img1')!;
    expect(img.naturalWidth).toBe(8);
    expect(String(img.src)).toContain(`/storage/buckets/${config.bucketId}/files/`);
    const stored = { path: String(img.path) };

    const transformed = await apply([{ type: 'image.transform', nodeId: 'img1', rotate: 45 }]);
    const imgT = (transformed.state.workbenchImages as Array<Record<string, unknown>>).find(x => x.id === 'img1')!;
    expect(Number(imgT.naturalWidth)).toBeGreaterThan(8); // 45° expands the frame

    const replaced = await apply([{ type: 'image.replace', nodeId: 'img1', source: { path: stored.path } }]);
    const imgR = (replaced.state.workbenchImages as Array<Record<string, unknown>>).find(x => x.id === 'img1')!;
    expect(imgR.path).toBe(stored.path);

    // ── document.* ────────────────────────────────────────────
    const docCreated = await apply([{ type: 'document.create', nodeId: 'doc1', format: 'html', x: 0, y: 400, title: 'P', source: { html: '<html><body>doc</body></html>' } }]);
    const doc = (docCreated.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(x => x.id === 'doc1')!;
    expect(typeof doc.projectFilePath).toBe('string');
    const docContent = await new AppwriteCanvasFileContent(client, config.databaseId, config.bucketId).read(canvasId, String(doc.projectFilePath));
    expect(docContent).toBeTruthy();
    await apply([
      { type: 'document.begin', nodeId: 'doc1', requestId: 'req-1', outputPath: 'pages/doc1-a.html' },
      { type: 'document.select', nodeId: 'doc1', path: String(doc.projectFilePath) },
    ]);

    // ── sketch.* ──────────────────────────────────────────────
    const sketchDoc = JSON.stringify({ version: 2, elements: [], appState: {}, files: {} });
    const skCreated = await apply([{ type: 'sketch.create', nodeId: 'sk1', x: 400, y: 400, source: { document: JSON.parse(sketchDoc) } }]);
    const sk = (skCreated.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(x => x.id === 'sk1')!;
    const skPath = String(sk.projectFilePath);
    expect(await new AppwriteSketchStore(client, config.databaseId, config.bucketId, canvasId).readSketch(skPath)).toBe(sketchDoc);
    await apply([{ type: 'sketch.update', nodeId: 'sk1', document: { version: 2, elements: [{ id: 'e1' }], appState: {}, files: {} }, expectedPath: skPath, expectedContent: sketchDoc }]);

    // ── storyboard.* ──────────────────────────────────────────
    await apply([{ type: 'node.create', node: { id: 'sb1', kind: 'storyboard', title: 'SB', x: 0, y: 800 } }]);
    await apply([
      { type: 'storyboard.shot.add', nodeId: 'sb1', shotId: 's1', set: { description: 'shot 1' } },
      { type: 'storyboard.shot.add', nodeId: 'sb1', shotId: 's2', set: { description: 'shot 2' } },
      { type: 'storyboard.shot.update', nodeId: 'sb1', shotId: 's1', set: { description: 'updated' } },
      { type: 'storyboard.shot.move', nodeId: 'sb1', shotId: 's2', index: 0 },
      { type: 'storyboard.shot.duplicate', nodeId: 'sb1', shotId: 's1', newShotId: 's3' },
      { type: 'storyboard.shot.references', nodeId: 'sb1', shotId: 's1', characters: [], scene: null },
      { type: 'storyboard.shot.delete', nodeId: 'sb1', shotId: 's3' },
    ]);
    snapshot = await service.read(canvasId);
    const sb = (snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(x => x.id === 'sb1')!;
    expect((sb.storyboard as { shots: unknown[] }).shots.length).toBeGreaterThanOrEqual(2);

    // ── video.* ───────────────────────────────────────────────
    // Upload a minimal MP4 (ftyp header) and index it as a video file.
    const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    await client.upload(config.bucketId, `vid-${canvasId.slice(-10)}`, 'clip.mp4', mp4, 'video/mp4');
    await client.call('POST', client.docsPath(config.databaseId, 'canvas_files'), {
      documentId: `f-${canvasId.slice(-10)}v`,
      data: { canvasId, path: 'videos/clip.mp4', fileId: `vid-${canvasId.slice(-10)}`, kind: 'video', mime: 'video/mp4', size: mp4.length, sha256: 'x', createdAt: new Date().toISOString() },
    });
    await apply([{ type: 'node.create', node: { id: 'v1', kind: 'video', title: 'V', x: 800, y: 800 } }]);
    await apply([{ type: 'video.attach', nodeId: 'v1', path: 'videos/clip.mp4' }]);
    snapshot = await service.read(canvasId);
    const vid = (snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>>).find(x => x.id === 'v1')!;
    expect((vid.videoResults as unknown[]).length).toBe(1);
    await apply([{ type: 'video.configure', nodeId: 'v1', set: { text: 'run 4s', videoAspect: '16:9' } }]);
    await apply([{ type: 'video.select', nodeId: 'v1', resultId: (vid.videoResults as Array<{ id: string }>)[0]!.id }]);

    // ── undo + idempotency + revision ─────────────────────────
    const undoBase = base;
    const temp = await apply([{ type: 'node.create', node: { id: 'tmp1', kind: 'text', text: 'undo me', x: 0, y: 0 } }], { opId: 'op-undo-target' });
    expect((temp.state.workbenchBasicNodes as Array<Record<string, unknown>>).some(x => x.id === 'tmp1')).toBe(true);
    const undone = await apply([{ type: 'operation.undo', operationId: 'op-undo-target' }]);
    expect(['applied', 'noop']).toContain(undone.receipt.status);
    const afterUndo = await service.read(canvasId);
    expect((afterUndo.state.workbenchBasicNodes as Array<Record<string, unknown>>).some(x => x.id === 'tmp1')).toBe(false);

    const replay = await service.applyOperations(canvasId, { operationId: 'op-undo-target', baseRevision: undoBase, operations: [{ type: 'node.create', node: { id: 'tmp1', kind: 'text', text: 'undo me', x: 0, y: 0 } }] });
    expect(replay.replayed).toBe(true);
    await expect(service.applyOperations(canvasId, { operationId: 'op-undo-target', baseRevision: 0, operations: [{ type: 'node.create', node: { id: 'different', kind: 'text', text: 'x', x: 0, y: 0 } }] }))
      .rejects.toMatchObject({ code: 'CANVAS_OPERATION_ID_CONFLICT' });

    await expect(service.applyOperations(canvasId, { operationId: 'op-stale', baseRevision: 0, operations: [{ type: 'node.create', node: { id: 'y', kind: 'text', text: 'x', x: 0, y: 0 } }] }))
      .rejects.toMatchObject({ code: 'CANVAS_REVISION_CONFLICT' });

    // ── receipts + journal survive reload ─────────────────────
    const reloaded = new CanvasStateService(() => projectRoot, undefined, undefined, {
      persistence: new AppwriteCanvasPersistence(client, config.databaseId),
      content: new AppwriteCanvasFileContent(client, config.databaseId, config.bucketId, 'canvas_files', (pid, rel) => readLocalProjectFile(() => projectRoot, pid, rel)),
      effects: appwriteCanvasEffects(client, config.databaseId, config.bucketId, () => projectRoot),
    });
    const receipt = await reloaded.operation(canvasId, 'op-2');
    expect(receipt.operationId).toBe('op-2');
    const final = await reloaded.read(canvasId);
    expect(final.revision).toBe(base);
  }, 120_000);
});
