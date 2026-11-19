import type { TimeRange } from './director-edits';

export interface TimedRow {
  id: string;
  videoStartMs: number;
  videoEndMs: number;
  /** 让位时最多缩短到的长度（有配音时为配音时长）；缺省表示不能缩短，只能整体挪动。 */
  minMs?: number;
}

/** 估算一句台词的最短朗读时长（无配音时用作让位下限）。 */
export function minimumSpanOf(text: string, audioMs?: number): number {
  if (audioMs && audioMs > 0) return Math.round(audioMs);
  return Math.max(600, Array.from(text.replace(/\s/gu, '')).length * 230);
}

/**
 * 把某一句放到新区间时，让相邻句子让位，句子顺序不变：
 * 拖动方向上的邻句先缩短自己的区间（不短于 minMs），还不够再整体顺延，依次传递。
 * 超出视频首尾时整体回退到边界内；所有句子都缩到最短仍放不下时报错。
 * 返回需要变化的区间（含目标句），未变化的句子不返回。
 */
export function rippleWindows(rows: TimedRow[], id: string, target: TimeRange, durationMs: number): Record<string, TimeRange> {
  const sorted = [...rows].sort((a, b) => a.videoStartMs - b.videoStartMs);
  const index = sorted.findIndex(row => row.id === id);
  if (index < 0) throw new Error('找不到要调整的台词。');
  if (!(target.endMs > target.startMs)) throw new Error('区间无效。');
  const span = Math.round(target.endMs - target.startMs);
  const minOf = (row: TimedRow) => Math.min(row.videoEndMs - row.videoStartMs, Math.max(1, Math.round(row.minMs ?? Infinity)));
  const total = sorted.reduce((sum, row, at) => sum + (at === index ? span : minOf(row)), 0);
  if (total > durationMs) throw new Error('所有句子缩到最短仍超过视频时长，请先缩短台词或配音。');

  const place = (start: number) => {
    const result = new Map<string, TimeRange>([[id, { startMs: start, endMs: start + span }]]);
    let edge = start + span;
    for (const row of sorted.slice(index + 1)) {
      if (row.videoStartMs >= edge) break;
      if (row.videoEndMs - edge >= minOf(row)) { result.set(row.id, { startMs: edge, endMs: row.videoEndMs }); break; }
      const moved = { startMs: edge, endMs: edge + minOf(row) };
      result.set(row.id, moved);
      edge = moved.endMs;
    }
    const tail = edge;
    edge = start;
    for (const row of sorted.slice(0, index).reverse()) {
      if (row.videoEndMs <= edge) break;
      if (edge - row.videoStartMs >= minOf(row)) { result.set(row.id, { startMs: row.videoStartMs, endMs: edge }); break; }
      const moved = { startMs: edge - minOf(row), endMs: edge };
      result.set(row.id, moved);
      edge = moved.startMs;
    }
    return { result, head: edge, tail: Math.max(tail, start + span) };
  };

  let start = Math.round(target.startMs);
  let placed = place(start);
  // 顺延超出视频末尾或前移越过开头时，整体往回挪；挪动后另一侧可能产生新的让位，再算几次。
  for (let attempt = 0; attempt < 4 && (placed.tail > durationMs || placed.head < 0); attempt++) {
    start += placed.tail > durationMs ? durationMs - placed.tail : -placed.head;
    placed = place(start);
  }
  if (placed.tail > durationMs || placed.head < 0) throw new Error('前后句子没有足够空间让位，请先缩短相邻台词的区间。');
  const changed: Record<string, TimeRange> = {};
  for (const [rowId, window] of placed.result) {
    const row = sorted.find(item => item.id === rowId)!;
    if (window.startMs !== row.videoStartMs || window.endMs !== row.videoEndMs) changed[rowId] = window;
  }
  return changed;
}
