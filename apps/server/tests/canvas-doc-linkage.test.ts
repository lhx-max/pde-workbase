import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
const version = (text: string) => createHash('sha256').update(text).digest('hex');
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import { FileCanvasContent, FileCanvasPersistence } from '../src/canvas/persistence.js';
import { BindingStore } from '../src/storage/bindings.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-doc-linkage-'));
  roots.push(root);
  const bindings = new BindingStore(root);
  return { root, bindings, content: new FileCanvasContent(() => root) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    // Only remove the exact temporary root this test created.
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('canvas-doc-linkage-')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
const card = { id: 'text-1', kind: 'text', text: '正文', title: '卡片标题', x: 0, y: 0 };

describe('canvas / doc boundary', () => {
  it('publishes committed text without holding the canvas lock or echoing mirror writes', async () => {
    const { root } = await fixture();
    let canvas: CanvasStateService;
    const sync = vi.fn(async (id: string, node: Record<string, unknown>) => {
      const snapshot = await canvas.read(id);
      const live = (snapshot.state.workbenchBasicNodes as typeof card[]).find(n => n.id === node.id);
      expect(live?.text).toBe(node.text);
      // A synchronous doc -> canvas callback used to deadlock here.
      await canvas.writeTextMirror(id, String(node.projectFilePath ?? 'sources/text/text-1.md'), '来自文档', snapshot.revision,
         { nodeId: String(node.id), docId: 'doc-1', documentRevision: version('来自文档'), baseContent: String(node.text) });
    });
    canvas = new CanvasStateService(() => root, undefined, undefined, { textDocumentSynced: sync });
    await canvas.patch('p', { workbenchBasicNodes: [{ ...card, projectFilePath: 'sources/text/text-1.md' }] });
    expect(sync).toHaveBeenCalledTimes(1);
    expect((await canvas.read('p')).state.workbenchBasicNodes).toEqual([expect.objectContaining({ text: '来自文档' })]);
  });

  it('archives removed links for PATCH and operations, restores undo links, and keeps App archives archived', async () => {
    const { root, bindings } = await fixture();
    const canvas = new CanvasStateService(() => root, undefined, undefined, {
      documentNodesChanged: (id, nodes) => bindings.reconcileNodes(id, nodes),
    });
    const created = await canvas.patch('p', { workbenchBasicNodes: [card] });
    bindings.upsert({ canvasInstanceId: 'p', nodeId: card.id, appId: 'doc', appInstanceId: 'doc-1' });
    await canvas.patch('p', { workbenchBasicNodes: [] });
    expect(bindings.list()).toEqual([]);
    expect(bindings.list({ includeArchived: true })[0]?.archivedReason).toBe('card_removed');
    await canvas.patch('p', { workbenchBasicNodes: created.state.workbenchBasicNodes });
    expect(bindings.list()).toHaveLength(1);
    const current = await canvas.read('p');
    await canvas.applyOperations('p', { operationId: 'delete-card', baseRevision: current.revision,
      operations: [{ type: 'node.delete', nodeId: card.id }] });
    expect(bindings.list()).toEqual([]);
    bindings.archive('p', card.id, 'asset_archived');
    await canvas.patch('p', { workbenchBasicNodes: created.state.workbenchBasicNodes });
    expect(bindings.list()).toEqual([]);
    // Archiving a link never calls a document deletion API or removes content.
  });

  it('rejects stale mirror revisions before changing either file or card', async () => {
    const { root, content } = await fixture();
    const canvas = new CanvasStateService(() => root);
    const initial = await canvas.patch('p', { workbenchBasicNodes: [{ ...card, projectFilePath: 'sources/text/text-1.md' }] });
    const node = (initial.state.workbenchBasicNodes as { projectFilePath: string }[])[0]!;
    const original = await content.read('p', node.projectFilePath);
    await canvas.patch('p', { workbenchViewport: { x: 1, y: 1, zoom: 1 } });
    await expect(canvas.writeTextMirror('p', node.projectFilePath, '旧页面覆盖', initial.revision)).rejects.toMatchObject({ status: 409 });
    expect(await content.read('p', node.projectFilePath)).toBe(original);
    expect((await canvas.read('p')).state.workbenchBasicNodes).toEqual(initial.state.workbenchBasicNodes);
  });

  it('does not let a slow document callback overwrite a later canvas save', async () => {
    const { root } = await fixture();
    const persistence = new FileCanvasPersistence(() => root);
    let entered!: () => void, release!: () => void, committed!: () => void;
    const enteredA = new Promise<void>(resolve => { entered = resolve; });
    const releaseA = new Promise<void>(resolve => { release = resolve; });
    const committedB = new Promise<void>(resolve => { committed = resolve; });
    const commit = persistence.commit.bind(persistence);
    vi.spyOn(persistence, 'commit').mockImplementation(async (id, value) => {
      await commit(id, value);
      if ((value.state.workbenchBasicNodes as typeof card[])?.[0]?.text === 'B') committed();
    });
    let canvas: CanvasStateService;
    canvas = new CanvasStateService(() => root, undefined, undefined, { persistence,
      textDocumentSynced: async (id, node, revision) => {
        if (node.text === 'A') { entered(); await releaseA; }
        await canvas.writeTextMirror(id, String(node.projectFilePath), String(node.text), revision,
           { nodeId: String(node.id), docId: 'doc-1', documentRevision: version(String(node.text)), sourceRevision: revision });
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const a = canvas.patch('p', { workbenchBasicNodes: [{ ...card, text: 'A' }] });
      await enteredA;
      const b = canvas.patch('p', { workbenchBasicNodes: [{ ...card, text: 'B' }] });
      await committedB; release();
      expect((await a).syncWarnings?.[0]).toContain('synchronization failed');
      expect((await b).syncWarnings).toBeUndefined();
      expect((await canvas.read('p')).state.workbenchBasicNodes).toEqual([expect.objectContaining({ text: 'B' })]);
    } finally { release(); warn.mockRestore(); }
  });

  it('rejects a fresh-revision document callback when the canvas has independent edits', async () => {
    const { root, content } = await fixture();
    const canvas = new CanvasStateService(() => root);
    await canvas.patch('p', { workbenchBasicNodes: [{ ...card, text: '共同基线', projectFilePath: 'sources/text/text-1.md' }] });
    const newer = await canvas.patch('p', { workbenchBasicNodes: [{ ...card, text: '画布新草稿', projectFilePath: 'sources/text/text-1.md' }] });
    await expect(canvas.writeTextMirror('p', 'sources/text/text-1.md', '文档独立修改', newer.revision,
      { nodeId: card.id, docId: 'doc-1', documentRevision: version('文档独立修改'), baseContent: '共同基线' })).rejects.toMatchObject({ status: 409, code: 'CANVAS_CONTENT_CONFLICT' });
    expect(await content.read('p', 'sources/text/text-1.md')).toBe('画布新草稿');
    expect((await canvas.read('p')).state.workbenchBasicNodes).toEqual([expect.objectContaining({ text: '画布新草稿' })]);
  });

  it('forks a UI-created copy immediately so a document mirror cannot edit both cards', async () => {
    const { root, content } = await fixture();
    const canvas = new CanvasStateService(() => root);
    const original = { ...card, projectFilePath: 'sources/text/text-1.md' };
    await canvas.patch('p', { workbenchBasicNodes: [original] });
    const copied = await canvas.patch('p', { workbenchBasicNodes: [original, { ...original, id: 'copy' }] });
    const nodes = copied.state.workbenchBasicNodes as typeof original[];
    const copy = nodes.find(node => node.id === 'copy')!;
    expect(copy.projectFilePath).not.toBe(original.projectFilePath);
    await canvas.writeTextMirror('p', original.projectFilePath, '只更新原件', copied.revision,
      { nodeId: card.id, docId: 'doc-1', documentRevision: version('只更新原件'), baseContent: card.text });
    expect(await content.read('p', copy.projectFilePath)).toBe(card.text);
    expect((await canvas.read('p')).state.workbenchBasicNodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'copy', text: card.text })]));
  });

  it('does not re-alias a copied card when a stale UI patch restores its source path', async () => {
    const { root, content } = await fixture();
    const canvas = new CanvasStateService(() => root);
    const original = { ...card, projectFilePath: 'sources/text/text-1.md' };
    await canvas.patch('p', { workbenchBasicNodes: [original] });
    const copied = await canvas.patch('p', { workbenchBasicNodes: [original, { ...original, id: 'copy' }] });
    const copy = (copied.state.workbenchBasicNodes as typeof original[]).find(node => node.id === 'copy')!;
    const rewritten = await canvas.patch('p', { workbenchBasicNodes: [original, { ...copy, projectFilePath: original.projectFilePath, text: '副本独立修改' }] }, { expectedRevision: copied.revision, base: copied.state });
    expect((rewritten.state.workbenchBasicNodes as typeof original[]).find(node => node.id === 'copy')?.projectFilePath).toBe(copy.projectFilePath);
    expect(await content.read('p', original.projectFilePath)).toBe(card.text);
    expect(await content.read('p', copy.projectFilePath)).toBe('副本独立修改');
  });

  it('prepares durable text intent before commit and never delivers a rejected commit', async () => {
    const { root } = await fixture();
    const persistence = new FileCanvasPersistence(() => root);
    const order: string[] = [];
    vi.spyOn(persistence, 'commit').mockImplementation(async () => { order.push('commit'); throw new Error('disk full'); });
    const delivered = vi.fn();
    const canvas = new CanvasStateService(() => root, undefined, undefined, { persistence,
      textDocumentPrepared: () => { order.push('intent'); }, textDocumentSynced: delivered });
    await expect(canvas.patch('p', { workbenchBasicNodes: [card] })).rejects.toThrow('disk full');
    expect(order).toEqual(['intent', 'commit']);
    expect(delivered).not.toHaveBeenCalled();
  });

  it('does not push an unchanged card again on a viewport save', async () => {
    const { root } = await fixture();
    const sync = vi.fn(async () => {});
    const canvas = new CanvasStateService(() => root, undefined, undefined, { textDocumentSynced: sync });
    await canvas.patch('p', { workbenchBasicNodes: [card] });
    await canvas.patch('p', { workbenchViewport: { x: 1 } });
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
