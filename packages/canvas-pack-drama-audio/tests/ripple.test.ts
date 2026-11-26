import { describe, expect, it } from 'vitest';
import { minimumSpanOf, rippleWindows } from '../src/director/ripple';

/** 导入台词后的典型情况：三句首尾紧挨。 */
const rows = [
  { id: 'a', videoStartMs: 0, videoEndMs: 2000 },
  { id: 'b', videoStartMs: 2000, videoEndMs: 4000 },
  { id: 'c', videoStartMs: 4000, videoEndMs: 6000 },
];

describe('相邻句子让位', () => {
  it('往后拖时后面的句子整体顺延，时长不变', () => {
    expect(rippleWindows(rows, 'a', { startMs: 500, endMs: 2500 }, 10_000)).toEqual({
      a: { startMs: 500, endMs: 2500 },
      b: { startMs: 2500, endMs: 4500 },
      c: { startMs: 4500, endMs: 6500 },
    });
  });

  it('往前拖时前面的句子整体前移，没重叠的句子不动', () => {
    const later = rows.map(row => ({ ...row, videoStartMs: row.videoStartMs + 1000, videoEndMs: row.videoEndMs + 1000 }));
    expect(rippleWindows(later, 'c', { startMs: 4500, endMs: 6500 }, 10_000)).toEqual({
      c: { startMs: 4500, endMs: 6500 },
      b: { startMs: 2500, endMs: 4500 },
      a: { startMs: 500, endMs: 2500 },
    });
    expect(rippleWindows([{ id: 'x', videoStartMs: 0, videoEndMs: 1000 }, { id: 'y', videoStartMs: 5000, videoEndMs: 6000 }], 'y', { startMs: 3000, endMs: 4000 }, 10_000))
      .toEqual({ y: { startMs: 3000, endMs: 4000 } });
  });

  it('顺延会超出视频末尾时整体回退到边界', () => {
    expect(rippleWindows(rows, 'a', { startMs: 1000, endMs: 3000 }, 6500)).toEqual({
      a: { startMs: 500, endMs: 2500 },
      b: { startMs: 2500, endMs: 4500 },
      c: { startMs: 4500, endMs: 6500 },
    });
  });

  it('前移会越过开头时整体回退，已经贴着开头就不动', () => {
    expect(rippleWindows(rows, 'b', { startMs: 1000, endMs: 3000 }, 6000)).toEqual({});
  });

  it('延长句尾时后面的句子顺延', () => {
    expect(rippleWindows(rows, 'a', { startMs: 0, endMs: 2600 }, 10_000)).toEqual({
      a: { startMs: 0, endMs: 2600 },
      b: { startMs: 2600, endMs: 4600 },
      c: { startMs: 4600, endMs: 6600 },
    });
  });

  it('邻句先缩短自己的区间，不够再顺延', () => {
    const flexible = rows.map(row => ({ ...row, minMs: 1500 }));
    expect(rippleWindows(flexible, 'a', { startMs: 300, endMs: 2300 }, 6000)).toEqual({
      a: { startMs: 300, endMs: 2300 },
      b: { startMs: 2300, endMs: 4000 },
    });
    expect(rippleWindows(flexible, 'a', { startMs: 800, endMs: 2800 }, 6000)).toEqual({
      a: { startMs: 800, endMs: 2800 },
      b: { startMs: 2800, endMs: 4300 },
      c: { startMs: 4300, endMs: 6000 },
    });
    expect(rippleWindows(flexible, 'c', { startMs: 3700, endMs: 5700 }, 6000)).toEqual({
      c: { startMs: 3700, endMs: 5700 },
      b: { startMs: 2000, endMs: 3700 },
    });
  });

  it('整片首尾相接、没有空隙时也能拖动', () => {
    const full = Array.from({ length: 59 }, (_, i) => ({ id: `l${i + 1}`, videoStartMs: Math.round(i * 2940.3), videoEndMs: Math.round((i + 1) * 2940.3), minMs: 2300 }));
    const result = rippleWindows(full, 'l2', { startMs: 3440, endMs: 6381 }, 173_477);
    expect(result.l2).toEqual({ startMs: 3440, endMs: 6381 });
    expect(result.l3).toEqual({ startMs: 6381, endMs: 8821 });
    expect(Object.keys(result)).toEqual(['l2', 'l3']);
  });

  it('最短时长：有配音按配音，没有配音按字数估算，至少 0.6 秒', () => {
    expect(minimumSpanOf('任意', 1800)).toBe(1800);
    expect(minimumSpanOf('十个字十个字十个字十')).toBe(2300);
    expect(minimumSpanOf('好')).toBe(600);
  });

  it('放不下或参数无效时报错', () => {
    expect(() => rippleWindows(rows, 'a', { startMs: 0, endMs: 3000 }, 6500)).toThrow('仍超过视频时长');
    expect(() => rippleWindows(rows, 'z', { startMs: 0, endMs: 1 }, 6000)).toThrow('找不到');
    expect(() => rippleWindows(rows, 'a', { startMs: 10, endMs: 10 }, 6000)).toThrow('区间无效');
  });
});
