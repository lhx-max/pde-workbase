import { expect, it } from 'vitest';
import { workflowNodeDataSnapshot } from '../src/workflow-node-data';

it('retains card content across dragging, measurement and selection updates', () => {
  const node = { id: 'agent', data: { title: 'Write' }, position: { x: 0, y: 0 } };
  const snapshot = workflowNodeDataSnapshot([], [node]);
  expect(workflowNodeDataSnapshot(snapshot, [{ ...node, position: { x: 90, y: 40 }, selected: true, measured: { width: 440 } }])).toBe(snapshot);
  expect(snapshot[0]).toEqual({ id: 'agent', data: node.data });
});

it('invalidates when content, node identity, membership or order changes', () => {
  const nodes = [{ id: 'a', data: { title: 'A' } }, { id: 'b', data: { title: 'B' } }];
  const snapshot = workflowNodeDataSnapshot([], nodes);
  for (const changed of [
    [{ ...nodes[0], data: { title: 'Updated' } }, nodes[1]],
    [{ ...nodes[0], id: 'c' }, nodes[1]],
    nodes.slice(1), [...nodes].reverse(), [...nodes, { id: 'c', data: { title: 'C' } }],
  ]) expect(workflowNodeDataSnapshot(snapshot, changed)).not.toBe(snapshot);
});
