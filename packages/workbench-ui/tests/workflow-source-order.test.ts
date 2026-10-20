import { expect, it } from 'vitest';
import { workflowSourceOrder } from '../src/workflow-source-order';
const node = (id: string, cardNumber?: number) => ({ id, data: { kind: 'agent', cardNumber } });
it('uses creation numbers regardless of graph order and includes the start card', () => {
  expect([...workflowSourceOrder([node('start', 1), node('later', 3), node('earlier', 2)], [{ source: 'later', target: 'earlier' }])]).toEqual([['start', 1], ['later', 3], ['earlier', 2]]);
});
it('preserves gaps after deletion and assigns legacy cards distinct numbers', () => {
  expect([...workflowSourceOrder([node('a', 1), node('c', 3)], [])]).toEqual([['a', 1], ['c', 3]]);
  expect([...workflowSourceOrder([node('a'), node('b')], [])]).toEqual([['a', 1], ['b', 2]]);
});
