import { describe, expect, it } from 'vitest';
import { buildPlaybackPlan } from '@bezier/canvas-pack-drama-audio';
import { splitClip, trimClip, copyClip, pasteClip, deleteClip } from '../app/session-apps/clip-edits';
import { importScript, importVoice, linesOf } from '../app/session-apps/director-media';

const script = importScript({}, '这是一句完整台词', 4000);
const data = { ...script, ...importVoice(script, 'voice.wav', 4000, 8000), masterGain: 1 };
const id = linesOf(data)[0]!.id;
describe('non-destructive clip edits', () => {
  it('splits an audio source without duplicating or losing samples, and invalidates interval confirmation', () => {
    const result = { ...data, ...splitClip({ ...data, confirmedLineIds: [id] }, id, 1500, 3, 'second', 8000) };
    expect(buildPlaybackPlan(result, 0).map(p => [p.offsetMs, p.delayMs, p.durationMs])).toEqual([[0, 0, 1500], [1500, 1500, 2500]]);
    expect(linesOf(result).map(line => line.text).join('')).toBe('这是一句完整台词');
    expect(result.confirmedLineIds).toEqual([]);
    expect(buildPlaybackPlan(result, 2100)).toEqual([expect.objectContaining({ offsetMs: 2100, durationMs: 1900, delayMs: 0 })]);
  });
  it('refuses splitting outside audible content or inside a locked area', () => {
    expect(() => splitClip(data, id, 0, 3, 'second', 8000)).toThrow();
    const silence = { ...data, segments: (data.segments as object[]).map(s => ({ ...s, endMs: 1000 })) };
    expect(() => splitClip(silence, id, 2000, 3, 'second', 8000)).toThrow(/声音/);
    expect(() => splitClip({ ...data, directorEdit: { locks: [{ startMs: 0, endMs: 1000 }] } }, id, 1500, 3, 'second', 8000)).toThrow(/锁定/);
  });
  it('trims the source offset as well as the window, and can recover trimmed samples', () => {
    const trimmed = { ...data, ...trimClip(data, id, { startMs: 1000, endMs: 3000 }, 8000) };
    expect(buildPlaybackPlan(trimmed, 0)).toEqual([expect.objectContaining({ offsetMs: 1000, delayMs: 1000, durationMs: 2000 })]);
    const restored = { ...trimmed, ...trimClip(trimmed, id, { startMs: 0, endMs: 4000 }, 8000) };
    expect(buildPlaybackPlan(restored, 0)).toEqual(buildPlaybackPlan(data, 0));
    expect(() => trimClip(data, id, { startMs: 0, endMs: 9000 }, 8000)).toThrow();
  });
  it('preserves the audio source on paste and rejects overlapping placement', () => {
    const clipboard = copyClip(data, id);
    const pasted = { ...data, ...pasteClip(data, clipboard, 4000, 'pasted', 8000) };
    expect(buildPlaybackPlan(pasted, 0)[1]).toEqual(expect.objectContaining({ audioRef: 'voice.wav', delayMs: 4000, offsetMs: 0, durationMs: 4000 }));
    expect(() => pasteClip(data, clipboard, 2000, 'pasted', 8000)).toThrow(/重叠/);
    expect(() => pasteClip(data, clipboard, 7000, 'pasted', 8000)).toThrow(/超出/);
    const removed = { ...pasted, ...deleteClip(pasted, id, 8000) };
    expect(buildPlaybackPlan(removed, 0)[0]?.delayMs).toBe(4000);
  });
});
