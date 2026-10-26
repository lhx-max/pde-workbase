import { describe, expect, it } from 'vitest';
import { overviewLayout, overviewRect } from '../src/workbench/canvas-overview-geometry';
describe('overview geometry', () => {
  it('includes offscreen resources and viewport without distorting aspect ratio', () => {
    const layout = overviewLayout([[1000, -800, 1400, -400]], [0, 0, 800, 600]);
    expect(layout.bounds).toEqual([0, -800, 1400, 600]);
    const rect = overviewRect([1000, -800, 1400, -400], layout);
    expect(rect.width).toBeCloseTo(rect.height);
    expect(rect.x + rect.width).toBeLessThanOrEqual(206);
    expect(rect.y).toBeGreaterThanOrEqual(10);
  });
  it('keeps empty and degenerate scenes finite', () => {
    const layout = overviewLayout([], [0, 0, 0, 0]);
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(overviewRect([0, 0, 0, 0], layout).width).toBe(3);
  });
});
