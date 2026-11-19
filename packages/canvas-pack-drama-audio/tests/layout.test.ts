import { describe, expect, it } from 'vitest';
import { describeFit, estimateSpeechMs, fitTimeline, joinsOf, LAYOUT, planScriptWindows, setJoin } from '../src/director/layout';
import { buildPlaybackPlan } from '../src/playback-plan';
import { validateRewriteLines } from '../src/rewrite';

type Line = { id: string; text: string; videoStartMs: number; videoEndMs: number };
const segment = (id: string, audioMs: number, window: [number, number], extra: Record<string, unknown> = {}) => ({
  id, label: id, startMs: 0, endMs: audioMs, gapMs: 0, gain: 1, muted: false,
  videoStartMs: window[0], videoEndMs: window[1], audioRefOverride: `voice/${id}.wav`, ...extra,
});
const line = (id: string, window: [number, number], text = '一二三四五'): Line => ({ id, text, videoStartMs: window[0], videoEndMs: window[1] });
const windowsOf = (changes: Record<string, unknown>) => (changes.rewriteLines as Line[]).map(item => [item.videoStartMs, item.videoEndMs]);

describe('估算与衔接', () => {
  it('按字数估算语音时长，忽略标点并有下限', () => {
    expect(estimateSpeechMs('你好，世界！')).toBe(Math.max(LAYOUT.minLineMs, 4 * LAYOUT.msPerChar));
    expect(estimateSpeechMs('一二三四五六七八九十')).toBe(10 * LAYOUT.msPerChar);
    expect(estimateSpeechMs('……')).toBe(LAYOUT.minLineMs);
  });

  it('衔接值限制在允许范围，可恢复自动', () => {
    expect(setJoin({}, 'a', 300)).toEqual({ lineJoins: { a: 300 } });
    expect(setJoin({}, 'a', -9999)).toEqual({ lineJoins: { a: -LAYOUT.maxOverlapMs } });
    expect(setJoin({ lineJoins: { a: 300, b: 10 } }, 'a', null)).toEqual({ lineJoins: { b: 10 } });
    expect(() => setJoin({}, 'a', Number.NaN)).toThrow('有效的毫秒数');
    expect(joinsOf({ lineJoins: { a: 1, b: 'x', c: -900, d: 20_000 } })).toEqual({ a: 1 });
    expect(joinsOf({ lineJoins: [1] })).toEqual({});
  });
});

describe('贴合视频时长', () => {
  const data = {
    rewriteLines: [line('a', [0, 1000]), line('b', [3000, 4000]), line('c', [5000, 5500])],
    segments: [segment('a', 1500, [0, 1000]), segment('b', 1000, [3000, 4000]), segment('c', 800, [5000, 5500])],
    confirmedLineIds: ['a', 'b', 'c'],
  };

  it('按真实配音首尾相接，富余均分到句间，配音不再被截断', () => {
    const { changes, report } = fitTimeline(data, 6000);
    const gap = Math.min(LAYOUT.maxGapMs, (6000 - 3300) / 2);
    expect(windowsOf(changes)).toEqual([[0, 1500], [1500 + gap, 2500 + gap], [2500 + 2 * gap, 3300 + 2 * gap]]);
    expect((changes.segments as { videoStartMs: number; videoEndMs: number }[]).map(item => [item.videoStartMs, item.videoEndMs])).toEqual(windowsOf(changes));
    expect(report).toMatchObject({ videoMs: 6000, speechMs: 3300, endMs: 3300 + 2 * gap, overlaps: 0, overflow: [], estimated: 0 });
    expect(changes.confirmedLineIds).toEqual([]);
    validateRewriteLines(changes.rewriteLines, 6000);
  });

  it('空白有上限，剩余时间留在末尾', () => {
    const { changes, report } = fitTimeline(data, 60_000);
    expect(windowsOf(changes)[1]![0]).toBe(1500 + LAYOUT.maxGapMs);
    expect(report.endMs).toBe(3300 + 2 * LAYOUT.maxGapMs);
  });

  it('用户设置的空白与重叠被保留，重叠只在声音层', () => {
    const { changes, report } = fitTimeline({ ...data, lineJoins: { b: 400, c: -300 } }, 6000);
    const windows = windowsOf(changes);
    expect(windows[1]).toEqual([1900, 2900]);
    expect(windows[2]).toEqual([2900, 3400]);
    const c = (changes.segments as { id: string; leadMs?: number }[]).find(item => item.id === 'c');
    expect(c?.leadMs).toBe(300);
    expect(report.overlaps).toBe(1);
    validateRewriteLines(changes.rewriteLines, 6000);
    const plan = buildPlaybackPlan({ ...data, ...changes, audioRef: null, masterGain: 1 }, 0);
    expect(plan.find(item => item.segmentId === 'c')).toMatchObject({ delayMs: 2600, durationMs: 800 });
  });

  it('重新贴合时清除不再需要的重叠量', () => {
    const overlapped = fitTimeline({ ...data, lineJoins: { c: -300 } }, 6000).changes;
    const { changes } = fitTimeline({ ...data, ...overlapped, lineJoins: {} }, 6000);
    expect((changes.segments as { leadMs?: number }[]).every(item => item.leadMs === undefined)).toBe(true);
  });

  it('配音总长超过视频时压缩末尾并报告被截断的句子', () => {
    const { changes, report } = fitTimeline(data, 2800);
    const windows = windowsOf(changes);
    expect(windows[0]).toEqual([0, Math.ceil(1500 / LAYOUT.maxAutoSpeed)]);
    expect((changes.segments as { fitSpeed?: number }[]).every(item => item.fitSpeed === LAYOUT.maxAutoSpeed)).toBe(true);
    expect(report).toMatchObject({ spedUp: 3, maxSpeed: LAYOUT.maxAutoSpeed });
    expect(describeFit(report)).toContain(`3 句加速至 ${LAYOUT.maxAutoSpeed.toFixed(2)}×`);
    expect(windows.at(-1)![1]).toBe(2800);
    validateRewriteLines(changes.rewriteLines, 2800);
    expect(report.overflow.map(item => item.id)).toContain('c');
    expect(report.overflow.reduce((sum, item) => sum + item.excessMs, 0)).toBeGreaterThan(0);
    expect(describeFit(report)).toMatch(/句配音仍超出 .* 秒，建议改短台词/u);
    expect(report.overflow.every(item => !item.estimated)).toBe(true);
  });

  it('略微超出时只加速到刚好放下，富余时间够用后清除加速', () => {
    const { changes, report } = fitTimeline(data, 3300);
    const speed = (changes.segments as { fitSpeed?: number }[])[0]!.fitSpeed!;
    expect(speed).toBeGreaterThan(1);
    expect(speed).toBeLessThan(LAYOUT.maxAutoSpeed);
    expect(report.overflow).toEqual([]);
    expect(windowsOf(changes).at(-1)![1]).toBeLessThanOrEqual(3300);
    const relaxed = fitTimeline({ ...data, ...changes }, 6000).changes;
    expect((relaxed.segments as { fitSpeed?: number }[]).every(item => item.fitSpeed === undefined)).toBe(true);
  });

  it('手动语速参与排布', () => {
    const slowed = { ...data, segments: [segment('a', 1500, [0, 1000], { speed: 0.75 }), ...data.segments.slice(1)] };
    expect(windowsOf(fitTimeline(slowed, 60_000).changes)[0]).toEqual([0, 2000]);
  });

  it('锁定区间里的句子作为锚点不移动，两侧各自排布', () => {
    const locked = { ...data, directorEdit: { locks: [{ startMs: 3000, endMs: 4000 }] } };
    const { changes } = fitTimeline(locked, 6000);
    const windows = windowsOf(changes);
    expect(windows[1]).toEqual([3000, 4000]);
    expect(windows[0]).toEqual([0, 1500]);
    expect(windows[2]![0]).toBeGreaterThanOrEqual(4000 + LAYOUT.minGapMs);
    expect(changes.confirmedLineIds).toEqual(['b']);
  });

  it('未生成配音的句子按字数估算', () => {
    const { report, changes } = fitTimeline({ rewriteLines: [line('a', [0, 100], '一二三四五六七八九十'), line('b', [200, 300], '短句')] }, 10_000);
    expect(report.estimated).toBe(2);
    expect(windowsOf(changes)[0]).toEqual([0, 10 * LAYOUT.msPerChar]);
    expect(describeFit(report)).toContain('2 句按字数估算');
  });

  it('估算的句子放不下时按比例缩短，不压在末尾，提示生成后再贴合', () => {
    const rows = Array.from({ length: 6 }, (_, index) => line(`l${index}`, [index * 100, index * 100 + 50], '这是一句十个字的台词'));
    const { changes, report } = fitTimeline({ rewriteLines: rows }, 6000);
    const spans = windowsOf(changes).map(([start, end]) => end! - start!);
    validateRewriteLines(changes.rewriteLines, 6000);
    expect(Math.max(...spans) - Math.min(...spans)).toBeLessThanOrEqual(1);
    expect(report.overflow.every(item => item.estimated)).toBe(true);
    expect(describeFit(report)).toContain('按字数估算约超出');
    expect(describeFit(report)).not.toContain('建议改短台词');
  });

  it('没有视频或台词时给出提示', () => {
    expect(() => fitTimeline(data, 0)).toThrow('请先导入视频');
    expect(() => fitTimeline({}, 6000)).toThrow('还没有台词');
  });
});

describe('导入台词的初始区间', () => {
  it('按字数比例分配，长句窗口更长', () => {
    const rows = planScriptWindows([{ id: 'a', text: '短句' }, { id: 'b', text: '这是一句明显更长的台词内容' }], 20_000);
    validateRewriteLines(rows, 20_000);
    expect(rows[1]!.videoEndMs - rows[1]!.videoStartMs).toBeGreaterThan(rows[0]!.videoEndMs - rows[0]!.videoStartMs);
    expect(rows[0]!.videoStartMs).toBe(0);
  });

  it('视频不够长时按比例缩短，仍在视频内且不重叠', () => {
    const texts = Array.from({ length: 10 }, (_, index) => ({ id: `l${index}`, text: '这是一句十个字的台词' }));
    const rows = planScriptWindows(texts, 5000);
    validateRewriteLines(rows, 5000);
    expect(rows.at(-1)!.videoEndMs).toBeLessThanOrEqual(5000);
  });
});
