import { describe, expect, it } from 'vitest';
import { evenScript } from './fixtures';
import { buildPlaybackPlan } from '../src/playback-plan';
import { copyClip, deleteClip, pasteClip, splitClip, trimClip } from '../src/director/clip-edits';
import { importScript, importVoice, linesOf } from '../src/director/director-media';

const script = evenScript('这是一句完整台词', 4000);
type Data = Record<string, unknown>;
const data: Data = { ...script, ...importVoice(script, 'voice.wav', 4000, 8000), masterGain: 1 };
const id = linesOf(data)[0]!.id;
const segmentsOf = (value: Record<string, unknown>) => value.segments as Record<string, unknown>[];

describe('分割片段', () => {
  it('分割音源时不重复也不丢样本，并撤销区间确认', () => {
    const result: Data = { ...data, ...splitClip({ ...data, confirmedLineIds: [id, 'other'] }, id, 1500, 3, 'second', 8000) };
    expect(buildPlaybackPlan(result, 0).map(p => [p.offsetMs, p.delayMs, p.durationMs])).toEqual([[0, 0, 1500], [1500, 1500, 2500]]);
    expect(linesOf(result).map(line => line.text)).toEqual(['这是一', '句完整台词']);
    expect(result.script).toBe('这是一\n句完整台词');
    expect(result.confirmedLineIds).toEqual(['other']);
    expect(segmentsOf(result)[0]).toMatchObject({ gapMs: 0, label: '这是一', endMs: 1500 });
    expect(buildPlaybackPlan(result, 2100)).toEqual([expect.objectContaining({ offsetMs: 2100, durationMs: 1900, delayMs: 0 })]);
  });

  it('逐句音色、音量和生成记录复制给新句；生成文本匹配时一并拆分', () => {
    const input = {
      ...data,
      lineVoiceInstructions: { [id]: '沉稳男声' }, lineGains: { [id]: 0.5 },
      generatedLineVoices: { [id]: '沉稳男声' }, generatedLineTexts: { [id]: '这是一句完整台词' },
    };
    const result: Data = splitClip(input, id, 1500, 3, 'second', 8000);
    expect(result.lineVoiceInstructions).toEqual({ [id]: '沉稳男声', second: '沉稳男声' });
    expect(result.lineGains).toEqual({ [id]: 0.5, second: 0.5 });
    expect(result.generatedLineVoices).toEqual({ [id]: '沉稳男声', second: '沉稳男声' });
    expect(result.generatedLineTexts).toEqual({ [id]: '这是一', second: '句完整台词' });
    const stale: Data = splitClip({ ...input, generatedLineTexts: { [id]: '旧文本' }, lineGains: [] }, id, 1500, 3, 'second', 8000);
    expect(stale.generatedLineTexts).toEqual({ [id]: '旧文本' });
    expect(stale.lineGains).toEqual({});
  });

  it('拒绝在有效声音之外、无音频台词或锁定区间内分割', () => {
    expect(() => splitClip(data, id, 0, 3, 'second', 8000)).toThrow(/声音/);
    expect(() => splitClip(data, 'missing', 1500, 3, 'second', 8000)).toThrow(/已绑定音频/);
    expect(() => splitClip({ ...data, segments: [] }, id, 1500, 3, 'second', 8000)).toThrow(/已绑定音频/);
    const silence = { ...data, segments: segmentsOf(data).map(s => ({ ...s, endMs: 1000 })) };
    expect(() => splitClip(silence, id, 2000, 3, 'second', 8000)).toThrow(/声音/);
    expect(() => splitClip({ ...data, directorEdit: { locks: [{ startMs: 0, endMs: 1000 }] } }, id, 1500, 3, 'second', 8000)).toThrow(/锁定/);
  });

  it('两侧任一侧台词为空时拒绝', () => {
    expect(() => splitClip(data, id, 1500, 0, 'second', 8000)).toThrow(/保留台词/);
    expect(() => splitClip(data, id, 1500, 99, 'second', 8000)).toThrow(/保留台词/);
  });
});

describe('裁剪片段', () => {
  it('同时裁剪源偏移和视频窗口，并可恢复被裁掉的样本', () => {
    const trimmed: Data = { ...data, ...trimClip({ ...data, confirmedLineIds: [id] }, id, { startMs: 1000, endMs: 3000 }, 8000) };
    expect(buildPlaybackPlan(trimmed, 0)).toEqual([expect.objectContaining({ offsetMs: 1000, delayMs: 1000, durationMs: 2000 })]);
    expect(trimmed.directorTrimBounds).toEqual({ [id]: { startMs: 0, endMs: 4000, ref: 'voice.wav' } });
    expect(trimmed.confirmedLineIds).toEqual([]);
    expect(linesOf(trimmed)[0]).toMatchObject({ videoStartMs: 1000, videoEndMs: 3000 });
    const restored = { ...trimmed, ...trimClip(trimmed, id, { startMs: 0, endMs: 4000 }, 8000) };
    expect(buildPlaybackPlan(restored, 0)).toEqual(buildPlaybackPlan(data, 0));
  });

  it('越过音源边界或视频尾部时拒绝', () => {
    expect(() => trimClip(data, id, { startMs: 0, endMs: 9000 }, 8000)).toThrow(/超出范围/);
    expect(() => trimClip(data, id, { startMs: -100, endMs: 4000 }, 8000)).toThrow(/音频源边界/);
    const trimmed = { ...data, ...trimClip(data, id, { startMs: 1000, endMs: 3000 }, 8000) };
    // 换了音源后，旧的裁剪边界不再适用。
    const swapped = { ...trimmed, segments: segmentsOf(trimmed).map(s => ({ ...s, audioRefOverride: 'other.wav' })) };
    expect(() => trimClip(swapped, id, { startMs: 0, endMs: 3000 }, 8000)).toThrow(/音频源边界/);
  });

  it('只拉长窗口时延长句尾留白，留白不超过 60 秒', () => {
    const result = trimClip(data, id, { startMs: 0, endMs: 6000 }, 8000);
    expect(segmentsOf(result)[0]).toMatchObject({ startMs: 0, endMs: 4000, gapMs: 2000, videoEndMs: 6000 });
    const long = trimClip(data, id, { startMs: 0, endMs: 3000 }, 80_000);
    expect(segmentsOf(long)[0]).toMatchObject({ endMs: 3000, gapMs: 0 });
    expect(() => trimClip(data, id, { startMs: 0, endMs: 70_000 }, 80_000)).toThrow(/60 秒/);
  });

  it('保持右边界时保留原留白', () => {
    const gapped = { ...data, segments: segmentsOf(data).map(s => ({ ...s, gapMs: 300 })) };
    expect(segmentsOf(trimClip(gapped, id, { startMs: 500, endMs: 4000 }, 8000))[0]).toMatchObject({ startMs: 500, endMs: 4000, gapMs: 300 });
  });

  it('未绑定或未对齐的片段不能裁剪', () => {
    expect(() => trimClip(data, 'missing', { startMs: 0, endMs: 100 }, 8000)).toThrow(/尚未绑定/);
    const unaligned = { ...data, segments: segmentsOf(data).map(s => ({ ...s, videoStartMs: null })) };
    expect(() => trimClip(unaligned, id, { startMs: 0, endMs: 100 }, 8000)).toThrow(/尚未绑定/);
  });
});

describe('复制、粘贴与删除', () => {
  it('复制时固化实际音源并深拷贝，不受原数据后续修改影响', () => {
    const plain = { ...structuredClone(data), segments: segmentsOf(data).map(s => ({ ...s, audioRefOverride: null })), audioRef: 'main.wav', lineVoiceInstructions: { [id]: '温柔女声' }, generatedLineTexts: { [id]: '这是一句完整台词' } };
    const clipboard = copyClip(plain, id);
    expect(clipboard.segment.audioRefOverride).toBe('main.wav');
    expect(clipboard.voice).toBe('温柔女声');
    expect(clipboard.generatedText).toBe('这是一句完整台词');
    expect(clipboard.generatedVoice).toBe('自然清晰的普通话解说');
    linesOf(plain)[0]!.text = '改动';
    expect(clipboard.line.text).toBe('这是一句完整台词');
    expect(() => copyClip(data, 'missing')).toThrow(/已绑定音频/);
  });

  it('粘贴保留音源，拒绝重叠或超出视频的位置', () => {
    const clipboard = copyClip(data, id);
    const pasted: Data = { ...data, ...pasteClip(data, clipboard, 4000, 'pasted', 8000) };
    expect(buildPlaybackPlan(pasted, 0)[1]).toEqual(expect.objectContaining({ audioRef: 'voice.wav', delayMs: 4000, offsetMs: 0, durationMs: 4000 }));
    expect(pasted.lineVoiceInstructions).toEqual({ pasted: '自然清晰的普通话解说' });
    expect(pasted.lineGains).toEqual({ pasted: 1 });
    expect(pasted.script).toBe('这是一句完整台词\n这是一句完整台词');
    expect(() => pasteClip(data, clipboard, 2000, 'pasted', 8000)).toThrow(/重叠/);
    expect(() => pasteClip(data, clipboard, 7000, 'pasted', 8000)).toThrow(/超出/);
    expect(() => pasteClip(data, clipboard, -1, 'pasted', 8000)).toThrow(/超出/);
  });

  it('粘贴到句前时按视频时间重新排序', () => {
    const later = { ...data, ...trimClip(data, id, { startMs: 0, endMs: 4000 }, 12000) };
    const moved = { ...later, rewriteLines: linesOf(later).map(l => ({ ...l, videoStartMs: 6000, videoEndMs: 10000 })), segments: segmentsOf(later).map(s => ({ ...s, videoStartMs: 6000, videoEndMs: 10000 })) };
    const result = pasteClip(moved, copyClip(moved, id), 0, 'early', 12000);
    expect(result.rewriteLines.map(line => line.id)).toEqual(['early', id]);
  });

  it('一个工程最多 80 句', () => {
    const many = evenScript(Array.from({ length: 80 }, (_, i) => `第${i}句`).join('\n'), 160_000);
    const full = { ...many, ...importVoice(many, 'voice.wav', 160_000, 160_000) };
    const first = linesOf(full)[0]!.id;
    expect(() => pasteClip(full, copyClip(full, first), 159_000, 'extra', 170_000)).toThrow(/80 句/);
  });

  it('删除台词同时移除片段和确认，最后一句也可删除', () => {
    const clipboard = copyClip(data, id);
    const pasted = { ...data, ...pasteClip(data, clipboard, 4000, 'pasted', 8000), confirmedLineIds: [id, 'pasted'] };
    const removed = { ...pasted, ...deleteClip(pasted, id, 8000) };
    expect(buildPlaybackPlan(removed, 0)[0]?.delayMs).toBe(4000);
    expect(removed.confirmedLineIds).toEqual(['pasted']);
    const empty = deleteClip(data, id, 8000);
    expect(empty).toMatchObject({ rewriteLines: [], segments: [], script: '' });
    expect(() => deleteClip(data, 'missing', 8000)).toThrow(/有效台词/);
  });
});
