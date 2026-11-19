import { describe, expect, it } from 'vitest';
import { gainAt, gainRegionsOf, originalGainOf, scheduleMixGain } from '../src/playback-plan';
import { adoptDubbingCandidate, dubbingCounts } from '../src/dubbing';

function recorder() {
  const calls: [string, number, number][] = [];
  const param = {
    setValueAtTime: (value: number, time: number) => { calls.push(['set', value, +time.toFixed(6)]); return param; },
    linearRampToValueAtTime: (value: number, time: number) => { calls.push(['ramp', value, +time.toFixed(6)]); return param; },
  };
  return { param: param as unknown as AudioParam, calls };
}

describe('音量区域', () => {
  it('只保留本轨合法区域并按开始时间排序；原声增益不超过 1', () => {
    const data = {
      directorGainRegions: [
        { startMs: 500, endMs: 900, track: 'voice', gain: 1.5, fadeMs: 0 },
        { startMs: 100, endMs: 300, track: 'voice', gain: 0.5, fadeMs: 50 },
        { startMs: 0, endMs: 100, track: 'background', gain: 0.5, fadeMs: 0 },
        { startMs: 300, endMs: 300, track: 'voice', gain: 0.5, fadeMs: 0 },
        { startMs: -1, endMs: 300, track: 'voice', gain: 0.5, fadeMs: 0 },
        { startMs: 0, endMs: 300, track: 'voice', gain: 2.5, fadeMs: 0 },
        { startMs: 0, endMs: 300, track: 'voice', gain: 1, fadeMs: NaN },
        { startMs: 0, endMs: 300, track: 'original', gain: 1.2, fadeMs: 0 },
        { startMs: 0, endMs: 300, track: 'original', gain: 0.2, fadeMs: 0 },
        null,
      ],
    };
    expect(gainRegionsOf(data, 'voice').map(region => region.startMs)).toEqual([100, 500]);
    expect(gainRegionsOf(data, 'original')).toEqual([{ startMs: 0, endMs: 300, track: 'original', gain: 0.2, fadeMs: 0 }]);
    expect(gainRegionsOf(data, 'background')).toHaveLength(1);
    expect(gainRegionsOf({ directorGainRegions: 'bad' }, 'voice')).toEqual([]);
    expect(gainRegionsOf({}, 'voice')).toEqual([]);
  });

  it('原声总音量默认 1，限制在 0–1', () => {
    expect(originalGainOf({})).toBe(1);
    expect(originalGainOf({ directorOriginalGain: 0.3 })).toBe(0.3);
    expect(originalGainOf({ directorOriginalGain: 0 })).toBe(0);
    expect(originalGainOf({ directorOriginalGain: 1.8 })).toBe(1);
    expect(originalGainOf({ directorOriginalGain: -1 })).toBe(1);
    expect(originalGainOf({ directorOriginalGain: '0.5' })).toBe(1);
  });

  it('无渐变区域立即生效，区域外为 1', () => {
    const regions = [{ startMs: 0, endMs: 1000, track: 'voice' as const, gain: 0, fadeMs: 0 }];
    expect(gainAt(regions, 0)).toBe(0);
    expect(gainAt(regions, 999)).toBe(0);
    expect(gainAt(regions, 1000)).toBe(1);
    expect(gainAt([], 10)).toBe(1);
  });
});

describe('混音增益排程', () => {
  const faded = [{ startMs: 100, endMs: 1100, track: 'voice' as const, gain: 0.5, fadeMs: 200 }];

  it('没有区域时只设置基础音量', () => {
    const { param, calls } = recorder();
    scheduleMixGain(param, [], 0.8, 0, 1000, 3);
    expect(calls).toEqual([['set', 0.8, 3]]);
  });

  it('渐变区域：入点保持基础音量，线性过渡到目标再回到基础音量', () => {
    const { param, calls } = recorder();
    scheduleMixGain(param, faded, 2, 0, 2000, 10);
    expect(calls).toEqual([
      ['set', 2, 10], ['set', 2, 10.1], ['ramp', 1, 10.3], ['ramp', 1, 10.9], ['ramp', 2, 11.1],
    ]);
  });

  it('渲染范围在区域内结束时补一个到当前增益的过渡点', () => {
    const { param, calls } = recorder();
    scheduleMixGain(param, faded, 2, 0, 500, 10);
    expect(calls).toEqual([['set', 2, 10], ['set', 2, 10.1], ['ramp', 1, 10.3], ['ramp', 1, 10.5]]);
  });

  it('渐变超过区域一半时入出点合并，不重复排程', () => {
    const { param, calls } = recorder();
    scheduleMixGain(param, [{ startMs: 0, endMs: 400, track: 'voice', gain: 0, fadeMs: 1000 }], 1, -100, 1000, 0);
    expect(calls).toEqual([['set', 1, 0], ['set', 1, 0.1], ['ramp', 0, 0.3], ['ramp', 1, 0.5]]);
  });

  it('无渐变区域按倍速换算时间；起点在区域内时初值已含区域增益', () => {
    const { param, calls } = recorder();
    scheduleMixGain(param, [{ startMs: 0, endMs: 1000, track: 'original', gain: 0, fadeMs: 0 }], 1, 500, 2000, 0, 2);
    expect(calls).toEqual([['set', 0, 0], ['set', 1, 0.25]]);
  });

  it('完全在范围外的区域不产生排程', () => {
    const { param, calls } = recorder();
    scheduleMixGain(param, [{ startMs: 5000, endMs: 6000, track: 'voice', gain: 0.5, fadeMs: 0 }, { startMs: 5000, endMs: 6000, track: 'voice', gain: 0.5, fadeMs: 100 }], 1, 0, 1000, 0);
    expect(calls).toEqual([['set', 1, 0]]);
  });
});

describe('配音进度统计与采用候选', () => {
  const lines = [
    { id: 'a', text: '第一句', videoStartMs: 0, videoEndMs: 1000 },
    { id: 'b', text: '第二句', videoStartMs: 1000, videoEndMs: 2000 },
    { id: 'c', text: '第三句', videoStartMs: 2000, videoEndMs: 3000 },
  ];
  const segment = (id: string, audioRefOverride: string | null) => ({
    id, label: id, startMs: 0, endMs: 900, gapMs: 100, gain: 0.6, muted: true, videoStartMs: 0, videoEndMs: 1000, audioRefOverride,
  });

  it('区分最新、待更新、缺配音和已确认的句数', () => {
    const data = {
      rewriteLines: lines, audioRef: 'main.wav', segments: [segment('a', 'a.wav'), segment('b', null)],
      generatedLineTexts: { a: '第一句', b: '旧' }, generatedLineVoices: { a: '自然清晰的普通话解说', b: '自然清晰的普通话解说' },
      confirmedLineIds: ['a', 'ghost'],
    };
    expect(dubbingCounts(data)).toEqual({ total: 3, current: 1, missing: 1, stale: 1, confirmed: 1 });
    expect(dubbingCounts({ ...data, audioRef: null }).missing).toBe(2);
    expect(dubbingCounts({ rewriteLines: 'bad', segments: 'bad' })).toEqual({ total: 0, current: 0, missing: 0, stale: 0, confirmed: 0 });
    expect(dubbingCounts({ ...data, confirmedLineIds: 'a' }).confirmed).toBe(0);
  });

  it('替换已有片段时保留留白、音量与静音状态，并取较长的音源时长', () => {
    const data = { rewriteLines: lines, videoRef: 'v.mp4', audioRef: 'main.wav', durationMs: 5000, segments: [segment('a', null), segment('b', 'b.wav')] };
    const take = { lineId: 'b', text: '第二句', voice: '自然清晰的普通话解说', videoRef: 'v.mp4', audioRef: 'new.wav', durationMs: 800, previousSource: 'b.wav' };
    const result = adoptDubbingCandidate(data, take);
    expect(result).toMatchObject({ audioRef: 'main.wav', durationMs: 5000 });
    expect(result.segments).toEqual([
      segment('a', null),
      { id: 'b', label: '第二句', startMs: 0, endMs: 800, gapMs: 100, gain: 0.6, muted: true, videoStartMs: 1000, videoEndMs: 2000, audioRefOverride: 'new.wav' },
    ]);
    expect(result.generatedLineVoices).toEqual({ b: '自然清晰的普通话解说' });
  });

  it('新句使用逐句音量，主源为空时以候选作为主源', () => {
    const data = { rewriteLines: lines, videoRef: 'v.mp4', lineGains: { c: 1.4 } };
    const take = { lineId: 'c', text: '第三句', voice: '自然清晰的普通话解说', videoRef: 'v.mp4', audioRef: 'c.wav', durationMs: 700 };
    const result = adoptDubbingCandidate(data, take);
    expect(result).toMatchObject({ audioRef: 'c.wav', durationMs: 700, generatedLineTexts: { c: '第三句' } });
    expect(result.segments).toEqual([expect.objectContaining({ id: 'c', gain: 1.4, gapMs: 0, muted: false, videoStartMs: 2000 })]);
    expect(() => adoptDubbingCandidate({ ...data, videoRef: 'other.mp4' }, take)).toThrow(/已变化/);
    expect(() => adoptDubbingCandidate({ ...data, segments: [segment('c', 'x.wav')] }, { ...take, previousSource: null })).toThrow(/已变化/);
  });
});
