import { gainRegionsOf, validateRewriteLines } from '@bezier/canvas-pack-drama-audio';
import type { AudioListenMode, DramaAudioSegment, TimedDubbingLine } from '@bezier/canvas-pack-drama-audio';
import { linesOf } from './director-media';

export type EditData = Record<string, unknown>;
export type TimeRange = { startMs: number; endMs: number };
export type ListenMode = AudioListenMode;
export const listenLabel: Record<ListenMode, string> = { mix: '混音', original: '原声', voice: '配音', background: '背景音乐' };
export type Marker = { id: string; ms: number; label: string };
export type ReviewNote = { id: string; range: TimeRange; text: string; resolved: boolean; audioRefs: string[] };
type Timing = { id: string; videoStartMs: number | null; videoEndMs: number | null };
type Arrangement = { label: string; windows: Record<string, TimeRange> };
export type DirectorData = {
  markers?: Marker[];
  locks?: TimeRange[];
  arrangements?: Partial<Record<'A' | 'B', Arrangement>>;
  review?: Record<string, string>;
  notes?: ReviewNote[];
};

export function directorOf(data: EditData): DirectorData {
  return (data.directorEdit ?? {}) as DirectorData;
}

export function makeRange(a: number, b: number, duration: number): TimeRange | null {
  const startMs = Math.round(Math.max(0, Math.min(a, b)));
  const endMs = Math.round(Math.min(duration, Math.max(a, b)));
  return Number.isFinite(endMs - startMs) && endMs > startMs ? { startMs, endMs } : null;
}

export function moveRangeBoundary(range: TimeRange, edge: keyof TimeRange, ms: number, duration: number): TimeRange {
  const value = Math.round(ms);
  return edge === 'startMs'
    ? { ...range, startMs: Math.max(0, Math.min(value, range.endMs - 1)) }
    : { ...range, endMs: Math.max(range.startMs + 1, Math.min(value, duration)) };
}

export function rangeOf(line: Timing): TimeRange | null {
  return line.videoStartMs !== null && line.videoEndMs !== null
    ? makeRange(line.videoStartMs, line.videoEndMs, line.videoEndMs) : null;
}

export function overlaps(a: TimeRange, b: TimeRange) {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function intersecting<T extends Timing>(items: T[], ranges: TimeRange[]): T[] {
  return items.filter(item => {
    const window = rangeOf(item);
    return window && ranges.some(range => overlaps(range, window));
  });
}

function segmentsOf(data: EditData): DramaAudioSegment[] {
  return Array.isArray(data.segments) ? data.segments : [];
}

function stable(value: unknown): string | undefined {
  return JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export function assertUnlocked(before: EditData, changes: EditData) {
  const locks = directorOf(before).locks ?? [];
  if (!locks.length) return;
  const after = { ...before, ...changes };
  if (before.videoRef !== after.videoRef) throw new Error('请先解锁区间，再替换主视频。');
  for (const getItems of [linesOf, segmentsOf]) {
    const current = getItems(before);
    const next = getItems(after);
    const protectedItems = [...intersecting<Timing>(current, locks), ...intersecting<Timing>(next, locks)];
    for (const { id } of protectedItems) {
      const old = current.find(item => item.id === id);
      const updated = next.find(item => item.id === id);
      if (stable(old) !== stable(updated)) throw new Error('操作会改变已锁定区间，请先解锁。');
      if (old && 'audioRefOverride' in old && !old.audioRefOverride && before.audioRef !== after.audioRef) {
        throw new Error('整轨替换会改变已锁定区间，请先解锁。');
      }
    }
  }
  for (const track of ['voice', 'original', 'background'] as const) {
    const affected = (data: EditData) => gainRegionsOf(data, track).filter(region => locks.some(lock => overlaps(lock, region)));
    if (stable(affected(before)) !== stable(affected(after))) throw new Error('音量调整会改变已锁定区间，请先解锁。');
  }
}

export function rewriteWindows(data: EditData, windows: Record<string, TimeRange>, duration: number): EditData {
  const change = <T extends Timing>(line: T) => {
    const window = Object.hasOwn(windows, line.id) ? windows[line.id] : undefined;
    return window ? { ...line, videoStartMs: window.startMs, videoEndMs: window.endMs } : line;
  };
  const rows = linesOf(data);
  const segments = segmentsOf(data);
  const known = new Set([...rows, ...segments].map(line => line.id));
  if (Object.keys(windows).some(id => !known.has(id))) throw new Error('方案中的台词已移除，请重新保存方案。');
  for (const window of Object.values(windows)) {
    if (window.startMs < 0 || window.endMs > duration || window.endMs <= window.startMs) throw new Error('调整后的区间超出视频。');
  }
  const rewriteLines = rows.length ? validateRewriteLines(rows.map(change), duration) : [];
  if (!rewriteLines.length) {
    const timed = segments.map(change).filter(segment => rangeOf(segment)).sort((a, b) => a.videoStartMs! - b.videoStartMs!);
    validateRewriteLines(timed.map(segment => ({
      id: segment.id, text: segment.label || segment.id, videoStartMs: segment.videoStartMs!, videoEndMs: segment.videoEndMs!,
    })), duration);
  }
  const changed = new Set([...rows, ...segments].filter(line => {
    const proposed = Object.hasOwn(windows, line.id) ? windows[line.id] : undefined;
    return proposed && (proposed.startMs !== line.videoStartMs || proposed.endMs !== line.videoEndMs);
  }).map(line => line.id));
  const patch = {
    rewriteLines, segments: segments.map(change),
    confirmedLineIds: (Array.isArray(data.confirmedLineIds) ? data.confirmedLineIds : []).filter(id => !changed.has(id)),
  };
  assertUnlocked(data, patch);
  return patch;
}

export function shiftFollowing(data: EditData, rows: TimedDubbingLine[], id: string, delta: number, following: boolean, duration: number) {
  const sorted = [...rows].sort((a, b) => a.videoStartMs - b.videoStartMs);
  const index = sorted.findIndex(line => line.id === id);
  if (index < 0 || !Number.isSafeInteger(delta)) throw new Error('请先选择间隔后的台词。');
  const moved = sorted.slice(index, following ? undefined : index + 1);
  return rewriteWindows(data, Object.fromEntries(moved.map(line => [line.id, {
    startMs: line.videoStartMs + delta, endMs: line.videoEndMs + delta,
  }])), duration);
}

export function lineFingerprint(data: EditData, line: TimedDubbingLine, kind: 'voice' | 'caption') {
  if (kind === 'caption') return stable(line) ?? '';
  const segment = segmentsOf(data).find(item => item.id === line.id);
  return stable([line, segment, segment?.audioRefOverride ?? data.audioRef]) ?? '';
}

export function displayTime(ms: number) {
  return (ms / 1000).toFixed(2) + ' 秒';
}
