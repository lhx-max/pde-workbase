import { describe, expect, it } from 'vitest';
import { assertUnlocked, makeRange, moveRangeBoundary, rewriteWindows, shiftFollowing } from '../app/session-apps/director-edits';
import { importScript, importVoice, linesOf } from '../app/session-apps/director-media';

const duration = 6000;
const captions = importScript({}, '甲\n乙\n丙', 4500);
const data = { ...captions, ...importVoice(captions, 'outputs/voice/take.wav', duration, duration), videoRef: 'inputs/media/clip.mp4' };
const rows = linesOf(data);

describe('director timeline', () => {
  it('normalizes reverse drag and clamps to the video', () => {
    expect(makeRange(2000.4, -40, 1500)).toEqual({ startMs: 0, endMs: 1500 });
    expect(makeRange(302, 302, duration)).toBeNull();
  });

  it('adjusts one selection boundary and prevents crossing or leaving the video', () => {
    const range = { startMs: 1000, endMs: 2000 };
    expect(moveRangeBoundary(range, 'startMs', 2200, duration)).toEqual({ startMs: 1999, endMs: 2000 });
    expect(moveRangeBoundary(range, 'startMs', -100, duration)).toEqual({ startMs: 0, endMs: 2000 });
    expect(moveRangeBoundary(range, 'endMs', 900, duration)).toEqual({ startMs: 1000, endMs: 1001 });
    expect(moveRangeBoundary(range, 'endMs', duration + 100, duration)).toEqual({ startMs: 1000, endMs: duration });
  });

  it('shifts subsequent clips and audio alignment together; refuses a colliding single shift', () => {
    expect(() => shiftFollowing(data, rows, rows[1]!.id, 100, false, duration)).toThrow(/重叠/);
    const result = shiftFollowing(data, rows, rows[1]!.id, 100, true, duration);
    expect(linesOf(result).map(line => line.videoStartMs)).toEqual([0, 1600, 3100]);
    expect(result.segments).toEqual([
      expect.objectContaining({ videoStartMs: 0, startMs: 0 }),
      expect.objectContaining({ videoStartMs: 1600, startMs: 1500 }),
      expect.objectContaining({ videoStartMs: 3100, startMs: 3000 }),
    ]);
  });

  it('keeps a legacy audio segment editable when it has no rewrite rows', () => {
    const result = rewriteWindows({ segments: data.segments as unknown[] }, {
      [rows[2]!.id]: { startMs: 3100, endMs: 4600 },
    }, duration);
    expect(result.segments).toEqual(expect.arrayContaining([expect.objectContaining({ id: rows[2]!.id, videoStartMs: 3100 })]));
  });

  it('blocks moving into protected space and changing an existing protected take', () => {
    const locked = { ...data, directorEdit: { locks: [{ startMs: 1550, endMs: 2000 }] } };
    expect(() => shiftFollowing(locked, rows, rows[1]!.id, 100, true, duration)).toThrow(/锁定/);
    const segments = (data.segments as Record<string, unknown>[]).map(segment => ({ ...segment, audioRefOverride: null }));
    expect(() => assertUnlocked({ ...locked, segments }, { audioRef: 'outputs/voice/replacement.wav' })).toThrow(/锁定/);
    expect(() => assertUnlocked(locked, { segments })).toThrow(/锁定/);
    expect(() => assertUnlocked({ ...data, directorEdit: { locks: [{ startMs: 4700, endMs: 5100 }] } }, {
      rewriteLines: [...rows.slice(0, 2), { ...rows[2], videoStartMs: 4700, videoEndMs: 5500 }],
    })).toThrow(/锁定/);
    expect(() => assertUnlocked(locked, { directorGainRegions: [{ startMs: 1500, endMs: 2000, track: 'voice', gain: 0.5, fadeMs: 100 }] })).toThrow(/锁定/);
    expect(() => assertUnlocked(locked, { directorEdit: { locks: [] }, masterGain: 0.8 })).not.toThrow();
  });
});
