import { describe, expect, it } from 'vitest';
import { canvasOperationBatch, rebaseCanvasDraft } from '../src/platform/canvas-operation-batch';

const text = (id: string, value = 'hello') => ({ id, kind: 'text', x: 10, y: 20, text: value });

describe('public canvas operation mapping', () => {
  it('maps text edits and keeps non-mappable editor changes on PATCH', () => {
    const previous = [text('a')];
    expect(canvasOperationBatch({ workbenchBasicNodes: previous }, { workbenchBasicNodes: [text('a', 'updated')] }))
      .toEqual([{ type: 'node.update', nodeId: 'a', set: { text: 'updated' } }]);
    expect(canvasOperationBatch({ workbenchBasicNodes: previous }, { workbenchBasicNodes: [{ ...text('a'), generation: { status: 'running' } }] })).toBeNull();
    expect(canvasOperationBatch({ workbenchBasicNodes: previous }, { workbenchBasicNodes: [{ ...text('a'), linkedAttachments: ['asset'] }] })).toBeNull();
    expect(canvasOperationBatch({}, { workbenchBackground: 'red' })).toBeNull();
  });

  it('maps image attachment and edge reconnect as atomic operations', () => {
    const base = { workbenchBasicNodes: [text('a'), text('b')], workbenchImages: [], workbenchEdges: [{ id: 'edge', source: 'a', target: 'b' }] };
    const changes = { workbenchImages: [{ id: 'image', path: 'images/pic.png', x: 3, y: 4 }], workbenchEdges: [{ id: 'edge2', source: 'a', target: 'image' }] };
    const result = canvasOperationBatch(base, changes, base);
    expect(result).toEqual([
      { type: 'edge.disconnect', edgeId: 'edge' },
      { type: 'image.attach', nodeId: 'image', source: { path: 'images/pic.png' }, x: 3, y: 4 },
      { type: 'edge.connect', edge: changes.workbenchEdges[0] },
    ]);
  });

  it('rejects invalid public payloads, nested nodes and unsupported image modifications without truncation', () => {
    expect(canvasOperationBatch({}, { workbenchBasicNodes: [text('not valid!')] })).toBeNull();
    const before = [{ ...text('a'), groupId: 'group' }];
    expect(canvasOperationBatch({ workbenchBasicNodes: before }, { workbenchBasicNodes: [{ ...before[0], x: 30 }] })).toBeNull();
    const oldImage = { id: 'image', path: 'images/a.png', x: 1, y: 1 };
    expect(canvasOperationBatch({ workbenchImages: [oldImage] }, { workbenchImages: [{ ...oldImage, crop: { x: 5 } }] })).toBeNull();
  });

  it('rebases in-flight local text edits onto an authoritative path and refuses conflicting edits', () => {
    const base = [text('a')];
    const local = [text('a', 'second edit')];
    const remote = [{ ...text('a'), projectFilePath: 'docs/a.md' }];
    expect(rebaseCanvasDraft(base, local, remote)).toEqual([{ ...remote[0], text: 'second edit' }]);
    expect(() => rebaseCanvasDraft(base, local, [text('a', 'remote edit')])).toThrow(/已变化/);
  });
});
