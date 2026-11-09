import { describe, expect, it } from 'vitest';
import {
  assertGain,
  assertInteger,
  assertProjectRelativePath,
  assertSegmentId,
  isProjectRelativePath,
} from '../src/schema';
import { alignShiftMs, digestOf, readDramaAudioData, sortSegments, timelineOf, totalDurationMs } from '../src/edl';

describe('schema: 工程相对路径', () => {
  it('接受常规 card-assets 路径', () => {
    expect(isProjectRelativePath('card-assets/drama-audio/a1.edl.json')).toBe(true);
    expect(assertProjectRelativePath('n', 'voice/dub.mp3')).toBe('voice/dub.mp3');
  });
  it.each([
    '', '/', '/abs/path', 'a/../b', '../escape', 'a//b', '.', 'a\\b', 'a/./b',
  ])('拒绝非法路径 %s', value => {
    expect(isProjectRelativePath(value)).toBe(false);
    expect(() => assertProjectRelativePath('n', value)).toThrow('card.drama.audio');
  });
  it('拒绝非字符串', () => {
    expect(isProjectRelativePath(123)).toBe(false);
    expect(isProjectRelativePath(null)).toBe(false);
  });
});

describe('schema: 数值与 ID', () => {
  it('gain 限定 0..2', () => {
    expect(assertGain('g', 1)).toBe(1);
    expect(() => assertGain('g', -0.1)).toThrow();
    expect(() => assertGain('g', 2.1)).toThrow();
    expect(() => assertGain('g', '1')).toThrow();
  });
  it('整数与区间校验', () => {
    expect(assertInteger('n', 100, 0, 1000)).toBe(100);
    expect(() => assertInteger('n', 1.5, 0, 10)).toThrow();
    expect(() => assertInteger('n', -1, 0, 10)).toThrow();
  });
  it('segmentId 形状校验', () => {
    expect(assertSegmentId('seg-0')).toBe('seg-0');
    expect(() => assertSegmentId('seg 0')).toThrow();
    expect(() => assertSegmentId('')).toThrow();
    expect(() => assertSegmentId('-lead')).toThrow();
  });
});

describe('edl: 读取兜底与排序', () => {
  it('data 缺失时返回空骨架', () => {
    const data = readDramaAudioData({ id: 'a1', kind: 'card.drama.audio' });
    expect(data.audioRef).toBeNull();
    expect(data.segments).toEqual([]);
    expect(data.dataVersion).toBe(3);
  });
  it('data 非对象抛错', () => {
    expect(() => readDramaAudioData({ id: 'a1', data: 42 })).toThrow('card.drama.audio');
  });
  it('保留既有字段并按 startMs 稳定排序', () => {
    const base = {
      dataVersion: 1, audioRef: 'v.mp3', durationMs: 10_000,
      segments: [
        { id: 'seg-b', label: 'B', startMs: 5_000, endMs: 8_000, gapMs: 0, gain: 1, muted: false },
        { id: 'seg-a', label: 'A', startMs: 0, endMs: 4_000, gapMs: 200, gain: 1, muted: false },
        { id: 'seg-c', label: 'C', startMs: 5_000, endMs: 6_000, gapMs: 0, gain: 1, muted: false },
      ],
      masterGain: 1, trimStartMs: null, trimEndMs: null, script: null, exportedPath: null, exportedDigest: null,
    };
    const data = readDramaAudioData({ id: 'a1', data: base });
    expect(sortSegments(data.segments).map(segment => segment.id)).toEqual(['seg-a', 'seg-b', 'seg-c']);
  });
  it('v1 旧卡（无 v2 字段）读取自动兜底', () => {
    const legacy = {
      dataVersion: 1, audioRef: 'v.mp3', durationMs: 8_000,
      segments: [{ id: 'seg-0', label: '整段', startMs: 0, endMs: 8_000, gapMs: 0, gain: 1, muted: false }],
      masterGain: 1, trimStartMs: null, trimEndMs: null, script: null, exportedPath: null, exportedDigest: null,
    };
    const data = readDramaAudioData({ id: 'a1', data: legacy });
    expect(data.videoRef).toBeNull();
    expect(data.videoDurationMs).toBe(0);
    expect(data.segments[0]).toMatchObject({ videoStartMs: null, videoEndMs: null, audioRefOverride: null });
    expect(timelineOf(data)[0].audioRef).toBe('v.mp3');
  });
});

describe('edl: 时间轴与裁剪', () => {
  const data = {
    dataVersion: 3 as const,
    audioRef: 'v.mp3',
    durationMs: 10_000,
    segments: [
      { id: 'seg-a', label: 'A', startMs: 0, endMs: 3_000, gapMs: 500, gain: 1, muted: false, videoStartMs: null, videoEndMs: null, audioRefOverride: null },
      { id: 'seg-b', label: 'B', startMs: 3_000, endMs: 6_000, gapMs: 0, gain: 1, muted: true, videoStartMs: null, videoEndMs: null, audioRefOverride: null },
      { id: 'seg-c', label: 'C', startMs: 8_000, endMs: 10_000, gapMs: 1_000, gain: 1, muted: false, videoStartMs: null, videoEndMs: null, audioRefOverride: null },
    ],
    masterGain: 1,
    trimStartMs: null as number | null,
    trimEndMs: null as number | null,
    script: null as string | null,
    exportedPath: null as string | null,
    exportedDigest: null as string | null,
    videoRef: null,
    videoDurationMs: 0,
    captions: [],
    captionProvider: null,
    dubbingDoc: null,
    dubbingProvider: null,
  };

  it('无裁剪时全部段有效', () => {
    expect(timelineOf(data).map(segment => segment.id)).toEqual(['seg-a', 'seg-b', 'seg-c']);
    // 播放 = A(3000) + gapA(500) + C(2000) + gapC(1000)；B 静音不计
    expect(totalDurationMs(data)).toBe(6_500);
  });

  it('裁剪窗口 clamp 段区间并过滤无交集段', () => {
    const trimmed = { ...data, trimStartMs: 1_000, trimEndMs: 9_000 };
    const active = timelineOf(trimmed);
    expect(active.map(segment => segment.id)).toEqual(['seg-a', 'seg-b', 'seg-c']);
    const segA = active.find(segment => segment.id === 'seg-a')!;
    expect(segA.sourceStartMs).toBe(1_000);
    expect(segA.durationMs).toBe(2_000);
    const segC = active.find(segment => segment.id === 'seg-c')!;
    expect(segC.durationMs).toBe(1_000);
    const windowed = { ...data, trimStartMs: 6_500, trimEndMs: 7_500 };
    expect(timelineOf(windowed)).toEqual([]);
  });

  it('digest 跨调用稳定且区分内容', () => {
    expect(digestOf('abc')).toBe(digestOf('abc'));
    expect(digestOf('abc')).not.toBe(digestOf('abd'));
    expect(digestOf('')).toHaveLength(16);
  });

  it('alignShiftMs：未对齐返回 null，偏差 = 台词时长（含停顿）− 画面时长', () => {
    const base = { durationMs: 3_000, gapMs: 500, videoStartMs: null, videoEndMs: null };
    expect(alignShiftMs(base)).toBeNull();
    expect(alignShiftMs({ ...base, videoStartMs: 1_000, videoEndMs: 4_000 })).toBe(500); // 3500 - 3000
    expect(alignShiftMs({ ...base, videoStartMs: 0, videoEndMs: 2_000 })).toBe(1_500); // 台词更长
    expect(alignShiftMs({ ...base, videoStartMs: 100, videoEndMs: 100 })).toBeNull(); // 区间非法
  });
});
