import { describe, expect, it } from 'vitest';
import { buildDirectorPlaybackPlan, buildPlaybackPlan, gainAt, playbackDriftMs, resolvePlaybackDuration } from '../src/playback-plan';
import { emptyDramaAudioData } from '../src/edl';
import type { DramaAudioSegment } from '../src/types';

function segment(changes: Partial<DramaAudioSegment> = {}): DramaAudioSegment {
  return {
    id: 'line-1', label: '台词', startMs: 500, endMs: 3500, gapMs: 500,
    gain: 1, muted: false, videoStartMs: 2000, videoEndMs: 6000,
    audioRefOverride: 'voice/line-1.wav', ...changes,
  };
}

function data(segments = [segment()]) {
  return { ...emptyDramaAudioData(), masterGain: 1, audioRef: 'voice/main.wav', videoDurationMs: 10000, segments };
}

describe('播放时钟与媒体时长', () => {
  it('实测时长优先，未载入时使用已保存时长', () => {
    expect(resolvePlaybackDuration(10000, 12000)).toBe(12000);
    expect(resolvePlaybackDuration(173477, 173476.62099999998)).toBe(173477);
    expect(resolvePlaybackDuration(10000, 0)).toBe(10000);
    expect(resolvePlaybackDuration(NaN, NaN)).toBe(0);
  });

  it.each([0.5, 1, 1.5, 2])('按 %sx 视频倍率比对音频时钟', rate => {
    expect(playbackDriftMs(2000, 10, 2000 + 1000 * rate, 11, rate)).toBe(0);
    expect(playbackDriftMs(2000, 10, 2000 + 1000 * rate - 150, 11, rate)).toBe(-150);
    expect(playbackDriftMs(2000, 10, 2000 + 1000 * rate + 150, 11, rate)).toBe(150);
  });
});

describe('buildPlaybackPlan 视频主时钟', () => {
  it('未来片段按视频开始时刻延迟，偏移包含源截取起点', () => {
    expect(buildPlaybackPlan(data(), 1000)).toEqual([
      { segmentId: 'line-1', audioRef: 'voice/line-1.wav', delayMs: 1000, offsetMs: 500, durationMs: 3000, gain: 1 },
    ]);
  });

  it('跳转到句中只调度剩余音频，不从句首重新播放', () => {
    expect(buildPlaybackPlan(data(), 3250)[0]).toMatchObject({ delayMs: 0, offsetMs: 1750, durationMs: 1750 });
    expect(buildPlaybackPlan(data(), 5000)).toEqual([]);
  });

  it('跳回句前重新生成未来排程，纯函数不保留上次状态', () => {
    buildPlaybackPlan(data(), 4000);
    expect(buildPlaybackPlan(data(), 0)[0]).toMatchObject({ delayMs: 2000, offsetMs: 500, durationMs: 3000 });
  });

  it('gap 留在视频区间尾部，不推迟下一句也不播放尾部留白', () => {
    const input = data([
      segment({ endMs: 6500, gapMs: 1000 }),
      segment({ id: 'line-2', startMs: 0, endMs: 1000, videoStartMs: 6000, videoEndMs: 8000, gapMs: 0 }),
    ]);
    expect(buildPlaybackPlan(input, 0).map(item => [item.segmentId, item.delayMs, item.durationMs])).toEqual([
      ['line-1', 2000, 3000], ['line-2', 6000, 1000],
    ]);
    expect(buildPlaybackPlan(input, 5250)).toEqual([
      { segmentId: 'line-2', audioRef: 'voice/line-1.wav', delayMs: 750, offsetMs: 0, durationMs: 1000, gain: 1 },
    ]);
  });

  it('静音句跳过但后句仍保持原视频位置', () => {
    const input = data([
      segment({ muted: true }),
      segment({ id: 'line-2', videoStartMs: 7000, videoEndMs: 11000 }),
    ]);
    expect(buildPlaybackPlan(input, 1000).map(item => [item.segmentId, item.delayMs])).toEqual([['line-2', 6000]]);
  });

  it('gain 是总音量乘段音量，零音量不改变时间计划', () => {
    expect(buildPlaybackPlan({ ...data([segment({ gain: 1.5 })]), masterGain: 0.5 }, 0)[0]?.gain).toBe(0.75);
    expect(buildPlaybackPlan({ ...data([segment({ gain: 2 })]), masterGain: 2 }, 0)[0]?.gain).toBe(4);
    expect(buildPlaybackPlan(data([segment({ gain: 0 })]), 0)[0]).toMatchObject({ gain: 0, delayMs: 2000, durationMs: 3000 });
  });

  it('音频超时裁切到视频区间减 gap，跳转后继续按截断上限算', () => {
    const input = data([segment({ endMs: 10000, gapMs: 1000 })]);
    expect(buildPlaybackPlan(input, 0)[0]?.durationMs).toBe(3000);
    expect(buildPlaybackPlan(input, 4000)[0]).toMatchObject({ offsetMs: 2500, durationMs: 1000 });
    expect(buildPlaybackPlan(input, 5000)).toEqual([]);
  });

  it('gap 等于或大于视频窗口不播放，零 gap 正常播放', () => {
    expect(buildPlaybackPlan(data([segment({ gapMs: 4000 })]), 0)).toEqual([]);
    expect(buildPlaybackPlan(data([segment({ gapMs: 5000 })]), 0)).toEqual([]);
    expect(buildPlaybackPlan(data([segment({ gapMs: 0, endMs: 10000 })]), 0)[0]?.durationMs).toBe(4000);
  });

  it('未对齐或 null 主源且无 override 不播放，override 优先', () => {
    expect(buildPlaybackPlan(data([segment({ videoStartMs: null })]), 0)).toEqual([]);
    expect(buildPlaybackPlan(data([segment({ videoEndMs: null })]), 0)).toEqual([]);
    expect(buildPlaybackPlan({ ...data([segment({ audioRefOverride: null })]), audioRef: null }, 0)).toEqual([]);
    expect(buildPlaybackPlan(data([segment({ audioRefOverride: null })]), 0)[0]?.audioRef).toBe('voice/main.wav');
    expect(buildPlaybackPlan({ ...data(), audioRef: null }, 0)[0]?.audioRef).toBe('voice/line-1.wav');
  });

  it('按视频开始时间稳定排序，不按源 startMs 排列', () => {
    const input = data([segment({ id: 'later', startMs: 0, videoStartMs: 8000, videoEndMs: 12000 }), segment({ id: 'earlier' })]);
    expect(buildPlaybackPlan(input, 0).map(item => item.segmentId)).toEqual(['earlier', 'later']);
  });

  it.each([NaN, Infinity, -1, '0', null])('非法当前时间 %s 安全返回空计划', value => {
    expect(buildPlaybackPlan(data(), value as number)).toEqual([]);
  });

  it.each([
    { startMs: -1 }, { startMs: NaN }, { endMs: Infinity }, { endMs: 500 },
    { videoStartMs: -1 }, { videoEndMs: 2000 }, { videoEndMs: NaN },
    { gapMs: -1 }, { gapMs: Infinity }, { gain: 2.1 }, { gain: -1 }, { gain: NaN },
    { audioRefOverride: '' }, { audioRefOverride: '../escape.wav' }, { audioRefOverride: '/absolute.wav' },
    { audioRefOverride: 'voice\\bad.wav' }, { id: '' },
  ])('过滤非法片段 %j，不影响有效片段', changes => {
    const input = data([segment({ ...changes, id: changes.id ?? 'bad' }), segment({ id: 'good' })]);
    expect(buildPlaybackPlan(input, 0).map(item => item.segmentId)).toEqual(['good']);
  });

  it('处理非对象、非法数组元素、错误数值类型和非法全局音量', () => {
    for (const input of [null, undefined, 42, {}, { segments: [], masterGain: Infinity }, { ...data(), masterGain: -1 }]) {
      expect(buildPlaybackPlan(input, 0)).toEqual([]);
    }
    const input = { ...data(), segments: [null, 42, {}, { ...segment(), muted: 'false' }, { ...segment(), startMs: '500' }, segment({ id: 'good' })] };
    expect(buildPlaybackPlan(input, 0).map(item => item.segmentId)).toEqual(['good']);
  });

  it('不修改数据或原始片段顺序', () => {
    const input = data([segment({ id: 'b', videoStartMs: 7000, videoEndMs: 11000 }), segment({ id: 'a' })]);
    const before = JSON.stringify(input);
    buildPlaybackPlan(input, 3500);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('director audio layers', () => {
  it('solo plays a separately imported background asset on the video clock', () => {
    const data = { directorBackgroundRef: 'inputs/media/music.wav', directorBackgroundDurationMs: 8000, directorBackgroundGain: 0.7 };
    expect(buildDirectorPlaybackPlan(data, 2000, 6000, 'original')).toEqual([]);
    expect(buildDirectorPlaybackPlan(data, 2000, 6000, 'background')).toEqual([expect.objectContaining({
      track: 'background', offsetMs: 2000, delayMs: 0, durationMs: 4000, gain: 0.7,
    })]);
  });

  it('holds the selected gain and ramps back to the track level on both boundaries', () => {
    const regions = [{ startMs: 100, endMs: 1100, track: 'voice' as const, gain: 0.5, fadeMs: 200 }];
    expect([0, 100, 200, 500, 1000, 1100].map(ms => gainAt(regions, ms))).toEqual([1, 1, 0.75, 0.5, 0.75, 1]);
  });
});
