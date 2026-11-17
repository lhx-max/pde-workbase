import { describe, expect, it } from 'vitest';
import { extractPeaks, waveformPath } from '../app/session-apps/waveform';
describe('waveform signal mapping', () => {
  it('keeps impulses and both channels without normalizing silence', () => {
    const result = extractPeaks([new Float32Array([0, .5, 0, 0]), new Float32Array([0, 0, -.8, 0])], 4, 2);
    expect(result.durationMs).toBe(1000);
    expect([...result.max]).toEqual([.5, 0]);
    expect(result.min[1]).toBeCloseTo(-.8);
    expect([...extractPeaks([new Float32Array(10)], 10).max]).toEqual(Array(10).fill(0));
  });
  it('maps source offsets and omits the silent tail or data beyond the file', () => {
    const peaks = extractPeaks([new Float32Array([1, 0, .5, 0])], 4, 4);
    expect(waveformPath(peaks, 500, 500, 250, 1, 2)).toBe('M0.0,27.0V50.0');
    expect(waveformPath(peaks, 1100, 500, 500)).toBe('');
    expect(waveformPath(peaks, 0, 0, 0)).toBe('');
  });
});
