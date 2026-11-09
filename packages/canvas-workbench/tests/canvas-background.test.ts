import { describe, expect, it } from 'vitest';
import { canvasBackgroundMetrics } from '../src/workbench/canvas-background';

describe('adaptive canvas background', () => {
  it.each([0.02, 0.05, 0.1, 0.25, 0.37, 0.5, 0.88, 1, 2, 4])(
    'keeps density and glyph sizes readable at zoom %s', zoom => {
      const metrics = canvasBackgroundMetrics(zoom);
      const [fine, coarse] = metrics.layers;
      expect(fine!.gap * zoom).toBeGreaterThanOrEqual(12 - 1e-9);
      expect(fine!.gap * zoom).toBeLessThanOrEqual(24 + 1e-9);
      expect(coarse!.gap * zoom).toBeGreaterThanOrEqual(24 - 1e-9);
      expect(coarse!.gap * zoom).toBeLessThanOrEqual(48 + 1e-9);
      expect(coarse!.gap).toBe(fine!.gap * 2);
      expect(fine!.opacity + coarse!.opacity).toBeCloseTo(1);
      expect(metrics.dotSize * zoom).toBeCloseTo(1.5);
      expect(metrics.lineWidth).toBe(0.75);
    },
  );

  it('fades dense detail at the reported 37% zoom instead of drawing a 7.4px grid', () => {
    const { layers: [fine, coarse] } = canvasBackgroundMetrics(0.37);
    expect(coarse!.gap * 0.37).toBeCloseTo(29.6);
    expect(coarse!.opacity).toBeGreaterThan(0.8);
    expect(fine!.opacity).toBeLessThan(0.2);
  });

  it.each([0.0375, 0.075, 0.15, 0.3, 0.6, 1.2, 2.4])(
    'retains the same visible world grid across the level boundary %s', zoom => {
      const before = canvasBackgroundMetrics(zoom * (1 - 1e-7));
      const after = canvasBackgroundMetrics(zoom * (1 + 1e-7));
      const dominant = (value: typeof before) => [...value.layers].sort((a, b) => b.opacity - a.opacity)[0]!;
      expect(dominant(before).gap).toBe(dominant(after).gap);
      expect(dominant(before).opacity).toBeCloseTo(1, 6);
      expect(dominant(after).opacity).toBeCloseTo(1, 6);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('handles invalid zoom %s', zoom => {
    const metrics = canvasBackgroundMetrics(zoom);
    expect(metrics.zoom).toBe(1);
    expect(metrics.layers.every(layer => Number.isFinite(layer.gap) && layer.opacity >= 0 && layer.opacity <= 1)).toBe(true);
  });
});
