import { expect, it } from 'vitest';
import { compareClipPaintOrder } from '../src/api/clip-composition';

it('paints later starts last irrespective of insertion order, while preserving track priority', () => {
  const clips = [{ id: 'later', start: 2, track: 0 }, { id: 'earlier', start: 0, track: 0 }, { id: 'upper', start: 0, track: 1 }];
  expect(clips.slice().sort(compareClipPaintOrder).map(c => c.id)).toEqual(['earlier', 'later', 'upper']);
  expect(clips[0]!.id).toBe('later');
  clips[0]!.start = -1;
  expect(clips.slice().sort(compareClipPaintOrder).map(c => c.id)).toEqual(['later', 'earlier', 'upper']);
});

it('keeps equal starts stable', () => {
  expect(compareClipPaintOrder({ start: 0 }, { start: 0, track: 0 })).toBe(0);
});
