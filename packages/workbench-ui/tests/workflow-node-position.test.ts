import { describe, expect, it } from 'vitest';
import { workflowNodePosition } from '../src/workflow-node-position';

describe('workflow snapshot coordinates', () => {
  it.each([undefined, null, {}, { x: '10', y: 20 }, { x: NaN, y: Infinity }])('repairs malformed coordinates %j', value => {
    const position = workflowNodePosition(value, 2);
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
  });
  it('keeps finite user coordinates including zero and negatives', () => {
    expect(workflowNodePosition({ x: 0, y: -100 }, 3)).toEqual({ x: 0, y: -100 });
  });
  it('repairs only the missing axis and assigns distinct stable fallback positions', () => {
    expect(workflowNodePosition({ x: 15 }, 1).x).toBe(15);
    expect(workflowNodePosition({ y: -20 }, 1).y).toBe(-20);
    const first = workflowNodePosition(undefined, 0);
    expect(workflowNodePosition(undefined, 0)).toEqual(first);
    expect(workflowNodePosition(undefined, 1).x).toBeGreaterThan(first.x);
  });
});
