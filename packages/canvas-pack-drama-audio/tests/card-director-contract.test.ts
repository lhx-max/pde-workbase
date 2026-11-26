import { describe, expect, it, vi } from 'vitest';
import { exportSrt } from '../src/ops';
import { candidateMatches, adoptDubbingCandidate } from '../src/dubbing';

const line = { id: 'line-1', text: '本句台词', videoStartMs: 100, videoEndMs: 1200 };
const card = { id: 'drama-a', data: { videoDurationMs: 2000, videoRef: 'video/main.mp4', rewriteLines: [line] } };

describe('short drama card contract', () => {
  it('writes subtitle through the scoped file port and rejects overlapping legacy data', async () => {
    const write = vi.fn(async () => {});
    const ctx = { projectId: 'test', files: { read: async () => null, write } };
    const result = await exportSrt(card, {}, ctx);
    expect(result?.data?.subtitlePath).toMatch(/\.srt$/u);
    expect(write).toHaveBeenCalledWith('test', result?.data?.subtitlePath, '1\n00:00:00,100 --> 00:00:01,200\n本句台词\n');
    const overlapping = { ...card, data: { ...card.data, rewriteLines: [line, { ...line, id: 'line-2' }] } };
    await expect(exportSrt(overlapping, {}, ctx)).rejects.toThrow('不重叠');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('adopts a take into the same card and rejects a changed line, source or voice', () => {
    const take = { lineId: line.id, text: line.text, voice: '自然清晰的普通话解说', videoRef: card.data.videoRef, audioRef: 'voice/take.wav', durationMs: 750, previousSource: null };
    expect(adoptDubbingCandidate(card.data, take)).toMatchObject({ segments: [{ id: line.id, audioRefOverride: take.audioRef, endMs: 750, videoStartMs: 100 }] });
    expect(candidateMatches({ ...card.data, voiceInstruction: '不同音色' }, take)).toBe(false);
    expect(candidateMatches({ ...card.data, rewriteLines: [{ ...line, text: '新句' }] }, take)).toBe(false);
    expect(candidateMatches({ ...card.data, videoRef: 'video/other.mp4' }, take)).toBe(false);
  });
});
