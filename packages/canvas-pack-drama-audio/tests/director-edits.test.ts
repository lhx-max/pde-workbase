import { describe, expect, it } from 'vitest';
import {
  assertUnlocked, directorOf, displayTime, intersecting, lineFingerprint, listenLabel, makeRange,
  moveRangeBoundary, overlaps, rangeOf, rewriteWindows, shiftFollowing,
} from '../src/director/director-edits';
import { importScript, importVoice, linesOf } from '../src/director/director-media';

const duration = 6000;
const captions = importScript({}, '甲\n乙\n丙', 4500);
type Data = Record<string, unknown>;
const data: Data = { ...captions, ...importVoice(captions, 'outputs/voice/take.wav', duration, duration), videoRef: 'inputs/media/clip.mp4' };
const rows = linesOf(data);

describe('导演时间轴区间工具', () => {
  it('听感模式有中文标签，未保存导演数据时返回空对象', () => {
    expect(listenLabel).toEqual({ mix: '混音', original: '原声', voice: '配音', background: '背景音乐' });
    expect(directorOf({})).toEqual({});
    expect(directorOf({ directorEdit: { locks: [{ startMs: 0, endMs: 1 }] } }).locks).toHaveLength(1);
  });

  it('反向拖选归一化并夹在视频内，空区间和非数值返回 null', () => {
    expect(makeRange(2000.4, -40, 1500)).toEqual({ startMs: 0, endMs: 1500 });
    expect(makeRange(100.6, 900.2, duration)).toEqual({ startMs: 101, endMs: 900 });
    expect(makeRange(302, 302, duration)).toBeNull();
    expect(makeRange(NaN, 100, duration)).toBeNull();
    expect(makeRange(5000, 7000, 4000)).toBeNull();
  });

  it('只移动一侧边界，不允许越过另一侧或超出视频', () => {
    const range = { startMs: 1000, endMs: 2000 };
    expect(moveRangeBoundary(range, 'startMs', 2200, duration)).toEqual({ startMs: 1999, endMs: 2000 });
    expect(moveRangeBoundary(range, 'startMs', -100, duration)).toEqual({ startMs: 0, endMs: 2000 });
    expect(moveRangeBoundary(range, 'startMs', 1500.6, duration)).toEqual({ startMs: 1501, endMs: 2000 });
    expect(moveRangeBoundary(range, 'endMs', 900, duration)).toEqual({ startMs: 1000, endMs: 1001 });
    expect(moveRangeBoundary(range, 'endMs', duration + 100, duration)).toEqual({ startMs: 1000, endMs: duration });
  });

  it('未对齐片段没有区间，相邻区间不算重叠', () => {
    expect(rangeOf({ id: 'a', videoStartMs: null, videoEndMs: 100 })).toBeNull();
    expect(rangeOf({ id: 'a', videoStartMs: 0, videoEndMs: null })).toBeNull();
    expect(rangeOf({ id: 'a', videoStartMs: 100, videoEndMs: 300 })).toEqual({ startMs: 100, endMs: 300 });
    expect(overlaps({ startMs: 0, endMs: 100 }, { startMs: 100, endMs: 200 })).toBe(false);
    expect(overlaps({ startMs: 0, endMs: 101 }, { startMs: 100, endMs: 200 })).toBe(true);
    const items = [
      { id: 'a', videoStartMs: 0, videoEndMs: 100 },
      { id: 'b', videoStartMs: 100, videoEndMs: 200 },
      { id: 'c', videoStartMs: null, videoEndMs: null },
    ];
    expect(intersecting(items, [{ startMs: 150, endMs: 160 }]).map(item => item.id)).toEqual(['b']);
    expect(intersecting(items, [])).toEqual([]);
  });

  it('毫秒按两位小数显示为秒', () => {
    expect(displayTime(1234)).toBe('1.23 秒');
    expect(displayTime(0)).toBe('0.00 秒');
  });
});

describe('区间改写与平移', () => {
  it('后移后续台词时音频对齐一起移动；单句平移撞上下一句时拒绝', () => {
    expect(() => shiftFollowing(data, rows, rows[1]!.id, 100, false, duration)).toThrow(/重叠/);
    const result = shiftFollowing(data, rows, rows[1]!.id, 100, true, duration);
    expect(linesOf(result).map(line => line.videoStartMs)).toEqual([0, 1600, 3100]);
    expect(result.segments).toEqual([
      expect.objectContaining({ videoStartMs: 0, startMs: 0 }),
      expect.objectContaining({ videoStartMs: 1600, startMs: 1500 }),
      expect.objectContaining({ videoStartMs: 3100, startMs: 3000 }),
    ]);
  });

  it('平移未知台词或非整数位移时报错，平移出视频时报错', () => {
    expect(() => shiftFollowing(data, rows, 'missing', 100, true, duration)).toThrow(/选择间隔后的台词/);
    expect(() => shiftFollowing(data, rows, rows[0]!.id, 1.5, true, duration)).toThrow(/选择间隔后的台词/);
    expect(() => shiftFollowing(data, rows, rows[2]!.id, 2000, false, duration)).toThrow(/超出视频/);
    expect(() => shiftFollowing(data, rows, rows[0]!.id, -1, false, duration)).toThrow(/超出视频/);
  });

  it('只撤销真正被改动区间的人工确认', () => {
    const confirmedData = { ...data, confirmedLineIds: rows.map(row => row.id) };
    const result = rewriteWindows(confirmedData, {
      [rows[0]!.id]: { startMs: 0, endMs: 1500 },
      [rows[2]!.id]: { startMs: 3200, endMs: 4500 },
    }, duration);
    expect(result.confirmedLineIds).toEqual([rows[0]!.id, rows[1]!.id]);
    expect(linesOf(result)[2]).toMatchObject({ videoStartMs: 3200, videoEndMs: 4500 });
    expect(rewriteWindows({ ...data, confirmedLineIds: 'bad' }, {}, duration).confirmedLineIds).toEqual([]);
  });

  it('方案引用已移除的台词或越界区间时拒绝', () => {
    expect(() => rewriteWindows(data, { gone: { startMs: 0, endMs: 10 } }, duration)).toThrow(/已移除/);
    expect(() => rewriteWindows(data, { [rows[0]!.id]: { startMs: -1, endMs: 10 } }, duration)).toThrow(/超出视频/);
    expect(() => rewriteWindows(data, { [rows[0]!.id]: { startMs: 0, endMs: duration + 1 } }, duration)).toThrow(/超出视频/);
    expect(() => rewriteWindows(data, { [rows[0]!.id]: { startMs: 100, endMs: 100 } }, duration)).toThrow(/超出视频/);
    // 原型链上的键不当作方案窗口。
    expect(() => rewriteWindows(data, Object.create({ [rows[0]!.id]: { startMs: 0, endMs: 1 } }), duration)).not.toThrow();
  });

  it('没有台词行的旧音频片段仍可调区间，并按视频时间检查重叠', () => {
    const legacy = { segments: data.segments as unknown[] };
    const result = rewriteWindows(legacy, { [rows[2]!.id]: { startMs: 3100, endMs: 4600 } }, duration);
    expect(result.rewriteLines).toEqual([]);
    expect(result.segments).toEqual(expect.arrayContaining([expect.objectContaining({ id: rows[2]!.id, videoStartMs: 3100, videoEndMs: 4600 })]));
    expect(() => rewriteWindows(legacy, { [rows[2]!.id]: { startMs: 1000, endMs: 4600 } }, duration)).toThrow(/重叠/);
  });
});

describe('锁定区间保护', () => {
  const locked = { ...data, directorEdit: { locks: [{ startMs: 1550, endMs: 2000 }] } };

  it('没有锁定区间时任何修改都放行', () => {
    expect(() => assertUnlocked(data, { videoRef: 'other.mp4', segments: [] })).not.toThrow();
  });

  it('有锁时替换主视频被拒绝', () => {
    expect(() => assertUnlocked(locked, { videoRef: 'inputs/media/other.mp4' })).toThrow(/替换主视频/);
  });

  it('阻止移入受保护区间、改动已锁片段、整轨替换和锁内音量调整', () => {
    expect(() => shiftFollowing(locked, rows, rows[1]!.id, 100, true, duration)).toThrow(/锁定/);
    const segments = (data.segments as Record<string, unknown>[]).map(segment => ({ ...segment, audioRefOverride: null }));
    expect(() => assertUnlocked({ ...locked, segments }, { audioRef: 'outputs/voice/replacement.wav' })).toThrow(/整轨替换/);
    expect(() => assertUnlocked(locked, { segments })).toThrow(/锁定/);
    expect(() => assertUnlocked({ ...data, directorEdit: { locks: [{ startMs: 4700, endMs: 5100 }] } }, {
      rewriteLines: [...rows.slice(0, 2), { ...rows[2], videoStartMs: 4700, videoEndMs: 5500 }],
    })).toThrow(/锁定/);
    expect(() => assertUnlocked(locked, { directorGainRegions: [{ startMs: 1500, endMs: 2000, track: 'voice', gain: 0.5, fadeMs: 100 }] })).toThrow(/音量调整/);
  });

  it('锁外修改、对象键顺序变化和全局参数调整不触发保护', () => {
    expect(() => assertUnlocked(locked, { directorEdit: { locks: [] }, masterGain: 0.8 })).not.toThrow();
    expect(() => assertUnlocked(locked, { directorGainRegions: [{ startMs: 3000, endMs: 3500, track: 'voice', gain: 0.5, fadeMs: 0 }] })).not.toThrow();
    const reordered = linesOf(data).map(({ id, text, videoStartMs, videoEndMs }) => ({ videoEndMs, videoStartMs, text, id }));
    expect(() => assertUnlocked(locked, { rewriteLines: reordered })).not.toThrow();
    const moved = linesOf(data).map((line, index) => index === 0 ? { ...line, videoEndMs: 1400 } : line);
    expect(() => assertUnlocked(locked, { rewriteLines: moved })).not.toThrow();
  });
});

describe('台词指纹', () => {
  it('字幕指纹与键顺序无关，只随台词本身变化', () => {
    const line = rows[0]!;
    const same = { videoEndMs: line.videoEndMs, videoStartMs: line.videoStartMs, text: line.text, id: line.id };
    expect(lineFingerprint(data, same, 'caption')).toBe(lineFingerprint(data, line, 'caption'));
    expect(lineFingerprint(data, { ...line, text: '改' }, 'caption')).not.toBe(lineFingerprint(data, line, 'caption'));
  });

  it('配音指纹包含片段和实际音源，主源变化会让未 override 的句子失效', () => {
    const line = rows[0]!;
    const plain = { ...data, segments: (data.segments as Record<string, unknown>[]).map(segment => ({ ...segment, audioRefOverride: null })) };
    const before = lineFingerprint(plain, line, 'voice');
    expect(lineFingerprint({ ...plain, audioRef: 'outputs/voice/new.wav' }, line, 'voice')).not.toBe(before);
    expect(lineFingerprint({ ...data, audioRef: 'outputs/voice/new.wav' }, line, 'voice')).toBe(lineFingerprint(data, line, 'voice'));
    expect(lineFingerprint({}, line, 'voice')).toContain(line.id);
  });
});
