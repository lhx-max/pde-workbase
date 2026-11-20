import type { DramaAudioSegment } from '../types';
import type { RewriteLine } from '../rewrite';
import { directorOf, overlaps, rewriteWindows } from './director-edits';
import type { EditData, TimeRange } from './director-edits';

/**
 * 配音连贯排布：句子按顺序首尾相接，句间「衔接」为正数是空白、负数是重叠。
 * 锁定区间里的句子是锚点，不会移动；锚点之间各自独立排布并贴合可用时长。
 * 只调整视频区间与重叠量，不改变配音音频本身（不变速）。
 */
export const LAYOUT = {
  /** 自动衔接的最小空白。 */
  minGapMs: 80,
  /** 自动衔接的最大空白；更多的富余放到区间末尾。 */
  maxGapMs: 1500,
  /** 允许与上一句重叠的最大时长。 */
  maxOverlapMs: 500,
  /** 用户可设置的最大空白。 */
  maxJoinMs: 10_000,
  /** 尚未生成配音时按字数估算语音时长。 */
  msPerChar: 230,
  minLineMs: 600,
  /** 超出时被压缩的句子至少保留的窗口。 */
  minWindowMs: 200,
  /** 真实配音放不下时自动加速的上限（保持音调）。 */
  maxAutoSpeed: 1.15,
} as const;

export type FitOverflow = { id: string; index: number; excessMs: number; estimated: boolean };
export type FitReport = {
  videoMs: number;
  /** 所有句子的语音时长（已生成的按实际音频，未生成的按字数估算）。 */
  speechMs: number;
  /** 最后一句结束的位置。 */
  endMs: number;
  /** 自动分配到句间的空白合计。 */
  gapMs: number;
  overlaps: number;
  /** 仍放不下、会被截断的句子。 */
  overflow: FitOverflow[];
  estimated: number;
  /** 自动加速的句子数与最大倍率。 */
  spedUp: number;
  maxSpeed: number;
};

type Segment = DramaAudioSegment & { leadMs?: number; speed?: number; fitSpeed?: number };
/** audio 为按手动语速换算后的语音时长，tail 为句尾留白，span = audio + tail。 */
type Item = { id: string; index: number; audio: number; tail: number; span: number; fixed: boolean; window: TimeRange | null; join: number | undefined; estimated: boolean };

const PUNCTUATION = /[\s\p{P}\p{S}]/gu;

/** 按字数估算一句的语音时长（毫秒）。 */
export function estimateSpeechMs(text: string): number {
  const chars = text.replace(PUNCTUATION, '').length;
  return Math.max(LAYOUT.minLineMs, Math.round(chars * LAYOUT.msPerChar));
}

/** 读取用户为每句设置的「与上一句的衔接」（毫秒）。 */
export function joinsOf(data: EditData): Record<string, number> {
  const raw = data.lineJoins;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= -LAYOUT.maxOverlapMs && entry[1] <= LAYOUT.maxJoinMs));
}

/** 校验并写入一句的衔接；传 null 恢复自动。 */
export function setJoin(data: EditData, id: string, value: number | null): EditData {
  const joins = joinsOf(data);
  if (value === null) delete joins[id];
  else {
    if (!Number.isFinite(value)) throw new Error('请输入有效的毫秒数。');
    joins[id] = Math.round(Math.max(-LAYOUT.maxOverlapMs, Math.min(LAYOUT.maxJoinMs, value)));
  }
  return { lineJoins: joins };
}

function linesOf(data: EditData): RewriteLine[] {
  return (Array.isArray(data.rewriteLines) ? data.rewriteLines as RewriteLine[] : []).slice().sort((a, b) => a.videoStartMs - b.videoStartMs);
}

function segmentsOf(data: EditData): Segment[] {
  return Array.isArray(data.segments) ? data.segments as Segment[] : [];
}

/** 一句需要的时长：音频源区间按手动语速换算，加句尾留白；未生成时按字数估算。 */
function spanOf(line: RewriteLine, segment: Segment | undefined): { audio: number; tail: number; estimated: boolean } {
  if (segment && segment.endMs > segment.startMs) {
    const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
    return { audio: Math.round((segment.endMs - segment.startMs) / speed), tail: Math.max(0, segment.gapMs || 0), estimated: false };
  }
  return { audio: estimateSpeechMs(line.text), tail: 0, estimated: true };
}

type Placement = { id: string; start: number; end: number; lead: number; span: number; fitSpeed: number };

/** 在 [from, to] 内排一段连续的句子；返回位置、自动空白与溢出量。 */
function placeRun(run: Item[], from: number, to: number, leadIn: boolean): { placed: Placement[]; gap: number; overflow: number } {
  // 第一句：区间从视频开头算起时默认贴着开头，跟在锚点后面时按普通衔接处理。
  const joinable = run.map((_item, i) => i > 0 || !leadIn);
  const fixedJoin = run.reduce((sum, item, i) => sum + (joinable[i] && item.join !== undefined ? item.join : 0), 0);
  const autoCount = run.filter((item, i) => joinable[i] && item.join === undefined).length;
  // 估算的句子还没有音频，放不下时先按比例缩短它们，真实配音保持原长。
  const shortBy = run.reduce((sum, item) => sum + item.span, 0) + fixedJoin + autoCount * LAYOUT.minGapMs - (to - from);
  const shrinkable = run.reduce((sum, item) => sum + (item.estimated ? Math.max(0, item.span - LAYOUT.minWindowMs) : 0), 0);
  const ratio = shortBy > 0 && shrinkable > 0 ? Math.min(1, shortBy / shrinkable) : 0;
  let spans = run.map(item => item.estimated && ratio ? Math.round(item.span - (item.span - LAYOUT.minWindowMs) * ratio) : item.span);
  // 仍放不下时对真实配音统一加速（保持音调，最多 maxAutoSpeed 倍），剩余的再压缩末尾。
  const stillShort = spans.reduce((sum, span) => sum + span, 0) + fixedJoin + autoCount * LAYOUT.minGapMs - (to - from);
  const realAudio = run.reduce((sum, item) => sum + (item.estimated ? 0 : item.audio), 0);
  // 每句取整最多多出 1 ms，预留这部分余量，保证加速后确实放得下。
  const margin = stillShort > 0 ? stillShort + run.filter(item => !item.estimated).length + 1 : 0;
  const fitSpeed = stillShort > 0 && realAudio > 0
    ? Math.min(LAYOUT.maxAutoSpeed, realAudio > margin ? realAudio / (realAudio - margin) : LAYOUT.maxAutoSpeed) : 1;
  const speedOf = (item: Item) => !item.estimated && fitSpeed > 1.001 ? Math.min(LAYOUT.maxAutoSpeed, Math.ceil(fitSpeed * 1000) / 1000) : 1;
  if (fitSpeed > 1.001) spans = run.map((item, i) => item.estimated ? spans[i]! : Math.ceil(item.audio / speedOf(item)) + item.tail);
  const need = spans.reduce((sum, span) => sum + span, 0) + fixedJoin;
  const room = to - from - need;
  const auto = autoCount ? Math.max(LAYOUT.minGapMs, Math.min(LAYOUT.maxGapMs, room / autoCount)) : 0;
  const placed: Placement[] = [];
  let cursor = from;
  let gap = 0;
  run.forEach((item, i) => {
    const join = !joinable[i] ? (item.join ?? 0) : item.join ?? Math.floor(auto);
    if (item.join === undefined && joinable[i]) gap += Math.floor(auto);
    const audioStart = cursor + join;
    // 重叠只发生在声音层：窗口仍从上一句结束处开始，配音提前 lead 毫秒进入。
    const span = spans[i]!;
    const lead = i > 0 && join < 0 ? Math.min(-join, LAYOUT.maxOverlapMs, Math.max(0, span - 1)) : 0;
    const start = Math.max(from, lead ? cursor : audioStart);
    const end = start + span - lead;
    placed.push({ id: item.id, start, end, lead, span, fitSpeed: speedOf(item) });
    cursor = end;
  });
  const overflow = Math.max(0, cursor - to);
  if (overflow) {
    // 放不下时只压缩末尾，保证前面的句子完整；被压缩的句子在报告中列出。
    let limit = to;
    for (let i = placed.length - 1; i >= 0; i--) {
      const item = placed[i]!;
      item.end = Math.min(item.end, limit);
      item.start = Math.max(from, Math.min(item.start, item.end - LAYOUT.minWindowMs));
      limit = item.start;
    }
    for (let i = 1; i < placed.length; i++) {
      const previous = placed[i - 1]!;
      const item = placed[i]!;
      if (item.start < previous.end) item.start = previous.end;
      if (item.end <= item.start) item.end = item.start + 1;
    }
  }
  return { placed, gap, overflow };
}

/**
 * 贴合视频时长：按真实配音或估算时长连贯排布全部句子。
 * 返回要写回卡片的补丁（台词与配音窗口、重叠量）和结果报告。
 */
export function fitTimeline(data: EditData, durationMs: number): { changes: EditData; report: FitReport } {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error('请先导入视频，再贴合配音时长。');
  const lines = linesOf(data);
  if (!lines.length) throw new Error('还没有台词可以排布。');
  const segments = new Map(segmentsOf(data).map(segment => [segment.id, segment]));
  const locks = directorOf(data).locks ?? [];
  const joins = joinsOf(data);
  const items: Item[] = lines.map((line, index) => {
    const { audio, tail, estimated } = spanOf(line, segments.get(line.id));
    const window = { startMs: line.videoStartMs, endMs: line.videoEndMs };
    return { id: line.id, index, audio, tail, span: audio + tail, estimated, window, join: joins[line.id], fixed: locks.some(lock => overlaps(lock, window)) };
  });
  const placements = new Map<string, Placement>();
  let gapMs = 0;
  let run: Item[] = [];
  let from = 0;
  const flush = (to: number) => {
    if (!run.length) return;
    const result = placeRun(run, from, Math.max(from + 1, to), from === 0);
    result.placed.forEach(item => placements.set(item.id, item));
    gapMs += result.gap;
    run = [];
  };
  for (const item of items) {
    if (!item.fixed) { run.push(item); continue; }
    flush(item.window!.startMs);
    const kept = segments.get(item.id)?.fitSpeed;
    placements.set(item.id, { id: item.id, start: item.window!.startMs, end: item.window!.endMs, lead: 0, span: item.span, fitSpeed: typeof kept === 'number' && kept > 0 ? kept : 1 });
    from = item.window!.endMs;
  }
  flush(durationMs);

  const windows = Object.fromEntries([...placements.values()].map(item => [item.id, { startMs: Math.round(item.start), endMs: Math.round(item.end) }]));
  const changes = rewriteWindows(data, windows, durationMs);
  const leads = new Map([...placements.values()].map(item => [item.id, Math.round(item.lead)]));
  changes.segments = (changes.segments as Segment[]).map(segment => {
    const lead = leads.get(segment.id) ?? 0;
    const speed = placements.get(segment.id)?.fitSpeed ?? 1;
    const rest: Segment = { ...segment };
    delete rest.leadMs;
    delete rest.fitSpeed;
    return { ...rest, ...(lead > 0 ? { leadMs: lead } : {}), ...(speed > 1.001 ? { fitSpeed: speed } : {}) };
  });
  const overflow: FitOverflow[] = items.flatMap(item => {
    const placed = placements.get(item.id)!;
    // 估算的句子与原始估算比较（提示稿子偏长）；真实配音与加速后的时长比较（会被截断的部分）。
    const excessMs = Math.round((item.estimated ? item.span : placed.span) - (placed.end - placed.start + placed.lead));
    return !item.fixed && excessMs > 0 ? [{ id: item.id, index: item.index, excessMs, estimated: item.estimated }] : [];
  });
  const last = [...placements.values()].reduce((max, item) => Math.max(max, item.end), 0);
  return {
    changes,
    report: {
      videoMs: durationMs,
      speechMs: items.reduce((sum, item) => sum + item.span, 0),
      endMs: Math.round(last),
      gapMs: Math.round(gapMs),
      overlaps: [...leads.values()].filter(lead => lead > 0).length,
      overflow,
      estimated: items.filter(item => item.estimated).length,
      spedUp: [...placements.values()].filter(item => item.fitSpeed > 1.001 && !items.find(row => row.id === item.id)?.fixed).length,
      maxSpeed: Math.max(1, ...[...placements.values()].map(item => item.fitSpeed)),
    },
  };
}

/** 生成给用户看的一句话结果。 */
export function describeFit(report: FitReport): string {
  const time = (ms: number) => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };
  const parts = [`配音排到 ${time(report.endMs)} / 视频 ${time(report.videoMs)}`];
  if (report.overlaps) parts.push(`${report.overlaps} 处重叠`);
  if (report.spedUp) parts.push(`${report.spedUp} 句加速至 ${report.maxSpeed.toFixed(2)}×`);
  const real = report.overflow.filter(item => !item.estimated);
  const guessed = report.overflow.filter(item => item.estimated);
  const seconds = (items: FitOverflow[]) => (items.reduce((sum, item) => sum + item.excessMs, 0) / 1000).toFixed(1);
  if (guessed.length) parts.push(`${report.estimated} 句未配音，估算超出 ${seconds(guessed)} 秒`);
  else if (report.estimated) parts.push(`${report.estimated} 句按字数估算`);
  if (real.length) parts.push(`${real.length} 句配音超出 ${seconds(real)} 秒，建议改短台词`);
  return parts.join(' · ');
}

/** 导入台词时按字数比例安排初始区间（尚无配音）。 */
export function planScriptWindows(texts: { id: string; text: string }[], durationMs: number): RewriteLine[] {
  const spans = texts.map(item => estimateSpeechMs(item.text));
  const gaps = Math.max(0, texts.length - 1);
  const total = spans.reduce((sum, span) => sum + span, 0);
  const room = durationMs - total - gaps * LAYOUT.minGapMs;
  // 时长不够时按比例缩短每句，够用时把富余平均放进句间（有上限），其余留在结尾。
  const scale = room < 0 ? Math.max(0, (durationMs - gaps * LAYOUT.minGapMs)) / total : 1;
  const gap = room < 0 ? LAYOUT.minGapMs : gaps ? Math.min(LAYOUT.maxGapMs, LAYOUT.minGapMs + room / gaps) : 0;
  let cursor = 0;
  return texts.map((item, index) => {
    const start = Math.round(cursor);
    const end = Math.min(durationMs, Math.max(start + 1, Math.round(cursor + spans[index]! * scale)));
    cursor = end + gap;
    return { id: item.id, text: item.text, videoStartMs: Math.min(start, durationMs - 1), videoEndMs: end };
  });
}
