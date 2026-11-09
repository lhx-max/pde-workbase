import { describe, expect, it } from 'vitest';
import {
  fitCrop,
  resizeCrop,
  setCropDimension,
  toPixelCrop,
  type CropHandle,
  type CropRect,
  type CropSize,
} from '../src/workbench/crop/crop-geometry';

const bounds: CropSize = { width: 200, height: 160 };
const rect: CropRect = { x: 50, y: 40, width: 80, height: 40 };
const handles: CropHandle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

function expectRect(actual: CropRect, expected: CropRect) {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(actual[key], key).toBeCloseTo(expected[key], 9);
  }
}

function expectInside(actual: CropRect, size: CropSize, ratio: number | null = null) {
  for (const value of Object.values(actual)) expect(Number.isFinite(value)).toBe(true);
  expect(actual.x).toBeGreaterThanOrEqual(0);
  expect(actual.y).toBeGreaterThanOrEqual(0);
  expect(actual.width).toBeGreaterThanOrEqual(0);
  expect(actual.height).toBeGreaterThanOrEqual(0);
  expect(actual.x + actual.width).toBeLessThanOrEqual(size.width + 1e-9);
  expect(actual.y + actual.height).toBeLessThanOrEqual(size.height + 1e-9);
  if (ratio !== null) expect(actual.width / actual.height).toBeCloseTo(ratio, 9);
}

describe('fitCrop', () => {
  it('returns the full image without a ratio', () => {
    expect(fitCrop(bounds, null)).toEqual({ x: 0, y: 0, ...bounds });
  });

  it.each([
    [2, { x: 0, y: 30, width: 200, height: 100 }],
    [0.5, { x: 60, y: 0, width: 80, height: 160 }],
  ] as const)('centers the largest crop at ratio %s', (ratio, expected) => {
    expectRect(fitCrop(bounds, ratio), expected);
  });

  it.each([0, -1, NaN, Infinity])('treats invalid ratio %s as unlocked', (ratio) => {
    expect(fitCrop(bounds, ratio)).toEqual(fitCrop(bounds, null));
  });

  it('keeps tiny images inside bounds rather than independently forcing 1px sides', () => {
    expectRect(fitCrop({ width: 1, height: 1 }, 2), { x: 0, y: 0.25, width: 1, height: 0.5 });
    expectInside(fitCrop({ width: 0.2, height: 0.1 }, 3), { width: 0.2, height: 0.1 }, 3);
  });
});

describe('resizeCrop', () => {
  it.each([
    ['n', { x: 50, y: 50, width: 80, height: 30 }],
    ['s', { x: 50, y: 40, width: 80, height: 50 }],
    ['e', { x: 50, y: 40, width: 100, height: 40 }],
    ['w', { x: 70, y: 40, width: 60, height: 40 }],
    ['nw', { x: 70, y: 50, width: 60, height: 30 }],
    ['ne', { x: 50, y: 50, width: 100, height: 30 }],
    ['sw', { x: 70, y: 40, width: 60, height: 50 }],
    ['se', { x: 50, y: 40, width: 100, height: 50 }],
  ] as const)('uses the appropriate axes for unlocked %s', (handle, expected) => {
    expectRect(resizeCrop(rect, bounds, handle, 20, 10, null), expected);
  });

  it.each([
    ['n', 999, -10, { x: 40, y: 30, width: 100, height: 50 }],
    ['s', 999, 10, { x: 40, y: 40, width: 100, height: 50 }],
    ['e', 20, 999, { x: 50, y: 35, width: 100, height: 50 }],
    ['w', -20, 999, { x: 30, y: 35, width: 100, height: 50 }],
    ['nw', -20, -10, { x: 30, y: 30, width: 100, height: 50 }],
    ['ne', 20, -10, { x: 50, y: 30, width: 100, height: 50 }],
    ['sw', -20, 10, { x: 30, y: 40, width: 100, height: 50 }],
    ['se', 20, 10, { x: 50, y: 40, width: 100, height: 50 }],
  ] as const)('preserves locked %s anchors and responds to its drag axis', (handle, dx, dy, expected) => {
    expectRect(resizeCrop(rect, bounds, handle, dx, dy, 2), expected);
  });

  it('lets vertical-only corner motion change a locked crop', () => {
    expectRect(resizeCrop(rect, bounds, 'se', 0, 10, 2), { x: 50, y: 40, width: 100, height: 50 });
  });

  it.each(handles)('clamps %s across both image bounds and the opposite anchor', (handle) => {
    for (const ratio of [null, 2, 0.5]) {
      const initial = ratio === 0.5 ? { ...rect, width: 20 } : rect;
      for (const delta of [-10_000, 10_000]) {
        const actual = resizeCrop(initial, bounds, handle, delta, delta, ratio);
        expectInside(actual, bounds, ratio);
        expect(actual.width).toBeGreaterThanOrEqual(1);
        expect(actual.height).toBeGreaterThanOrEqual(1);
        if (handle.includes('w')) expect(actual.x + actual.width).toBeCloseTo(initial.x + initial.width);
        if (handle.includes('e')) expect(actual.x).toBeCloseTo(initial.x);
        if (handle.includes('n')) expect(actual.y + actual.height).toBeCloseTo(initial.y + initial.height);
        if (handle.includes('s')) expect(actual.y).toBeCloseTo(initial.y);
      }
    }
  });

  it('shifts the perpendicular center only when needed at an image boundary', () => {
    const nearTop = { x: 50, y: 0, width: 80, height: 40 };
    expectRect(resizeCrop(nearTop, bounds, 'e', 40, 0, 2), { x: 50, y: 0, width: 120, height: 60 });
    expectRect(resizeCrop(rect, bounds, 's', 0, 10_000, 2), { x: 0, y: 40, width: 200, height: 100 });
  });

  it('moves without resizing, including a mismatched lock, and clamps all directions', () => {
    expectRect(resizeCrop(rect, bounds, 'move', 10_000, -10_000, 1), { ...rect, x: 120, y: 0 });
    expectRect(resizeCrop(rect, bounds, 'move', -10_000, 10_000, null), { ...rect, x: 0, y: 120 });
  });

  it('moves valid subpixel locked crops without inflating their shorter side', () => {
    const thin = { x: 10, y: 10, width: 20, height: 0.5 };
    expectRect(resizeCrop(thin, bounds, 'move', 5, 5, 40), { ...thin, x: 15, y: 15 });
    expectRect(resizeCrop(thin, bounds, 'move', 999, 999, 40), { ...thin, x: 180, y: 159.5 });
  });

  it.each(handles)('supports tiny-image %s resizing without breaking the ratio', (handle) => {
    const size = { width: 1, height: 1 };
    expectInside(resizeCrop(fitCrop(size, 2), size, handle, 99, -99, 2), size, 2);
  });
});

describe('setCropDimension', () => {
  it('edits either free dimension and preserves origin while it fits', () => {
    expectRect(setCropDimension(rect, bounds, 'width', 100.25, null), { ...rect, width: 100.25 });
    expectRect(setCropDimension(rect, bounds, 'height', 60, null), { ...rect, height: 60 });
  });

  it('uses the edited axis to derive the locked companion dimension', () => {
    expectRect(setCropDimension(rect, bounds, 'width', 120, 2), { ...rect, width: 120, height: 60 });
    expectRect(setCropDimension(rect, bounds, 'height', 60, 2), { ...rect, width: 120, height: 60 });
  });

  it('shifts origin and caps both dimensions together at the image limits', () => {
    expectRect(setCropDimension(rect, bounds, 'height', 999, 2), { x: 0, y: 40, width: 200, height: 100 });
    expectRect(setCropDimension(rect, bounds, 'width', 999, 0.5), { x: 50, y: 0, width: 80, height: 160 });
  });

  it('clamps negative edits to a sensible ratio-preserving minimum', () => {
    expectRect(setCropDimension(rect, bounds, 'width', -5, 2), { ...rect, width: 2, height: 1 });
    expectRect(setCropDimension(rect, bounds, 'height', 0, null), { ...rect, height: 1 });
  });

  it('supports changed bounds and changed ratios without stale dimensions', () => {
    const smaller = { width: 30, height: 20 };
    expectRect(setCropDimension(rect, smaller, 'width', 25, 1), { x: 10, y: 0, width: 20, height: 20 });
    expectInside(resizeCrop(rect, smaller, 'se', 20, 20, 2), smaller, 2);
  });
});

describe('toPixelCrop', () => {
  it('rounds edges rather than independently rounding dimensions', () => {
    expect(toPixelCrop({ x: 10.4, y: 20.6, width: 10.4, height: 9.8 }, bounds))
      .toEqual({ x: 10, y: 21, width: 11, height: 9 });
  });

  it('keeps at least one export pixel and does not cross the last pixel', () => {
    expect(toPixelCrop({ x: 199.9, y: 159.9, width: 0.1, height: 0.1 }, bounds))
      .toEqual({ x: 199, y: 159, width: 1, height: 1 });
    expect(toPixelCrop(fitCrop({ width: 1, height: 1 }, 2), { width: 1, height: 1 }))
      .toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('clamps out-of-image edges and floors fractional bounds', () => {
    expect(toPixelCrop({ x: -20, y: -30, width: 300, height: 200 }, { width: 20.8, height: 10.9 }))
      .toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(toPixelCrop(rect, { width: 0.5, height: 1 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('invalid inputs and purity', () => {
  it.each([
    { width: 0, height: 20 },
    { width: -1, height: 20 },
    { width: NaN, height: 20 },
    { width: 20, height: Infinity },
  ])('returns an empty crop for invalid bounds %j', (size) => {
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    expect(fitCrop(size, 2)).toEqual(empty);
    expect(resizeCrop(rect, size, 'se', 10, 10, 2)).toEqual(empty);
    expect(setCropDimension(rect, size, 'width', 20, 2)).toEqual(empty);
    expect(toPixelCrop(rect, size)).toEqual(empty);
  });

  it('ignores nonfinite edits and deltas and repairs invalid rectangles', () => {
    expectRect(resizeCrop(rect, bounds, 'se', NaN, Infinity, 2), rect);
    expectRect(setCropDimension(rect, bounds, 'height', NaN, 2), rect);
    const invalid = { x: NaN, y: Infinity, width: -3, height: NaN };
    expectInside(resizeCrop(invalid, bounds, 'move', NaN, Infinity, null), bounds);
    expectInside(setCropDimension(invalid, bounds, 'height', Infinity, 2), bounds, 2);
    expectInside(toPixelCrop(invalid, bounds), bounds);
    for (const ratio of [Number.MIN_VALUE, Number.MAX_VALUE]) {
      expectInside(fitCrop(bounds, ratio), bounds);
      expectInside(resizeCrop(rect, bounds, 'se', Number.MAX_VALUE, Number.MAX_VALUE, ratio), bounds);
    }
  });

  it('does not mutate input objects', () => {
    const frozenRect = Object.freeze({ ...rect });
    const frozenBounds = Object.freeze({ ...bounds });
    fitCrop(frozenBounds, 2);
    resizeCrop(frozenRect, frozenBounds, 'nw', 5, 10, 2);
    setCropDimension(frozenRect, frozenBounds, 'height', 25, 2);
    toPixelCrop(frozenRect, frozenBounds);
    expect(frozenRect).toEqual(rect);
    expect(frozenBounds).toEqual(bounds);
  });
});
