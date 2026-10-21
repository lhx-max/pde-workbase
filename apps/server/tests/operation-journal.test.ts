import { describe, expect, it } from 'vitest';
import { applyCanvasOperations } from '@bezier/canvas-core';
import { compactOperationDelta } from '../src/canvas/operation-journal.js';

const text = '正文'.repeat(1000);

it('keeps only the fields an operation changed', () => {
  const before = { workbenchBasicNodes: [{ id: 'card', kind: 'text', title: '手册', text, x: 0, y: 0 }] };
  const after = { workbenchBasicNodes: [{ id: 'card', kind: 'text', title: '手册', text, x: 12, y: 4 }] };
  const delta = compactOperationDelta(before, after);
  expect(JSON.stringify(delta)).not.toContain(text);
  expect(delta.before.workbenchBasicNodes).toEqual([{ id: 'card', x: 0, y: 0 }]);
  expect(delta.after.workbenchBasicNodes).toEqual([{ id: 'card', x: 12, y: 4 }]);
});

it('still undoes a move without the document body in the journal', async () => {
  const state = { workbenchBasicNodes: [{ id: 'card', kind: 'text', title: '手册', text, x: 0, y: 0 }] };
  const moved = await applyCanvasOperations(state, [{ type: 'node.move', nodeId: 'card', x: 12, y: 4 }], {});
  const delta = compactOperationDelta(
    { workbenchBasicNodes: state.workbenchBasicNodes },
    { workbenchBasicNodes: moved.state.workbenchBasicNodes },
  );
  const undone = await applyCanvasOperations(moved.state, [{ type: 'operation.undo', operationId: 'move' }], {
    move: { fingerprint: 'x', receipt: { operationId: 'move', status: 'applied', baseRevision: 0, revision: 1, nodeIds: ['card'], createdAt: '' }, ...delta },
  });
  expect(undone.state.workbenchBasicNodes).toEqual(state.workbenchBasicNodes);
});
