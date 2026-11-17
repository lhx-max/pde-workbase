import { effectiveLineVoice, validateRewriteLines } from '@bezier/canvas-pack-drama-audio';
import type { DramaAudioSegment, TimedDubbingLine } from '@bezier/canvas-pack-drama-audio';
import { assertUnlocked } from './director-edits';
import type { EditData, TimeRange } from './director-edits';
import { linesOf } from './director-media';

const segmentsOf = (data: EditData): DramaAudioSegment[] => Array.isArray(data.segments) ? data.segments : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const confirmed = (data: EditData): string[] => Array.isArray(data.confirmedLineIds) ? data.confirmedLineIds : [];
function finish(data: EditData, rows: TimedDubbingLine[], segments: DramaAudioSegment[], extra: EditData, duration: number) {
  if (rows.length > 80) throw new Error('一个工程最多支持 80 句台词。');
  if (rows.length) validateRewriteLines(rows, duration);
  const patch = { rewriteLines: rows, script: rows.map(line => line.text).join('\n'), segments, ...extra };
  assertUnlocked(data, patch);
  return patch;
}

export function splitClip(data: EditData, id: string, atMs: number, textBoundary: number, newId: string, duration: number) {
  const rows = linesOf(data), segments = segmentsOf(data);
  const line = rows.find(row => row.id === id), segment = segments.find(row => row.id === id);
  if (!line || !segment) throw new Error('请先选择已绑定音频的台词。');
  const at = Math.round(atMs), offset = at - line.videoStartMs;
  const playable = Math.min(segment.endMs - segment.startMs, line.videoEndMs - line.videoStartMs - segment.gapMs);
  if (!(offset > 0 && offset < playable && at < line.videoEndMs)) throw new Error('请把播放头移到本句有效声音的中间，不能在静音尾部切开。');
  const chars = Array.from(line.text), left = chars.slice(0, textBoundary).join('').trim(), right = chars.slice(textBoundary).join('').trim();
  if (!left || !right) throw new Error('请为分割后的两句分别保留台词。');
  const first = { ...line, text: left, videoEndMs: at }, second = { ...line, id: newId, text: right, videoStartMs: at };
  const newRows = rows.flatMap(row => row.id === id ? [first, second] : [row]);
  const newSegments = segments.flatMap(item => item.id === id ? [
    { ...item, label: left, endMs: item.startMs + offset, videoEndMs: at, gapMs: 0 },
    { ...item, id: newId, label: right, startMs: item.startMs + offset, videoStartMs: at },
  ] : [item]);
  const maps: EditData = {};
  for (const key of ['lineVoiceInstructions', 'lineGains', 'generatedLineVoices']) {
    const values = record(data[key]); maps[key] = { ...values, ...(values[id] !== undefined ? { [newId]: values[id] } : {}) };
  }
  const texts = record(data.generatedLineTexts);
  maps.generatedLineTexts = { ...texts, ...(texts[id] === line.text ? { [id]: left, [newId]: right } : {}) };
  return finish(data, newRows, newSegments, { ...maps, confirmedLineIds: confirmed(data).filter(value => value !== id) }, duration);
}

/** Trim the source and its placement together. Store source bounds so an edge can be extended again. */
export function trimClip(data: EditData, id: string, window: TimeRange, duration: number) {
  const segments = segmentsOf(data), segment = segments.find(item => item.id === id);
  if (!segment || segment.videoStartMs === null || segment.videoEndMs === null) throw new Error('此片段尚未绑定音频。');
  const oldStart = segment.videoStartMs, oldEnd = segment.videoEndMs;
  const saved = record(data.directorTrimBounds), previous = record(saved[id]);
  const ref = segment.audioRefOverride ?? data.audioRef;
  const bounds = previous.ref === ref && typeof previous.startMs === 'number' && typeof previous.endMs === 'number'
    ? { startMs: previous.startMs, endMs: previous.endMs } : { startMs: segment.startMs, endMs: segment.endMs };
  const startMs = segment.startMs + window.startMs - oldStart;
  const previousAudibleEnd = Math.min(segment.endMs, segment.startMs + oldEnd - oldStart - segment.gapMs);
  const endMs = window.endMs === oldEnd ? segment.endMs : Math.min(window.endMs < oldEnd ? previousAudibleEnd : bounds.endMs, segment.startMs + window.endMs - oldStart);
  if (startMs < bounds.startMs || endMs > bounds.endMs || endMs <= startMs) throw new Error('裁剪已到达音频源边界；可撤销或向片段内拖动。');
  const gapMs = window.endMs === oldEnd ? segment.gapMs : Math.max(0, window.endMs - window.startMs - (endMs - startMs));
  if (gapMs > 60_000) throw new Error('句尾留白不能超过 60 秒。');
  const rows = linesOf(data).map(row => row.id === id ? { ...row, videoStartMs: window.startMs, videoEndMs: window.endMs } : row);
  return finish(data, rows, segments.map(item => item.id === id ? { ...item, startMs, endMs, gapMs, videoStartMs: window.startMs, videoEndMs: window.endMs } : item), {
    directorTrimBounds: { ...saved, [id]: { ...bounds, ref } }, confirmedLineIds: confirmed(data).filter(value => value !== id),
  }, duration);
}

export type ClipClipboard = { line: TimedDubbingLine; segment: DramaAudioSegment; voice: string; generatedText?: unknown; generatedVoice?: unknown };
export function copyClip(data: EditData, id: string): ClipClipboard {
  const line = linesOf(data).find(row => row.id === id), segment = segmentsOf(data).find(row => row.id === id);
  if (!line || !segment) throw new Error('请先选择已绑定音频的台词。');
  return structuredClone({ line, segment: { ...segment, audioRefOverride: segment.audioRefOverride ?? data.audioRef as string },
    voice: effectiveLineVoice(data, id), generatedText: record(data.generatedLineTexts)[id], generatedVoice: record(data.generatedLineVoices)[id] });
}
export function pasteClip(data: EditData, clipboard: ClipClipboard, atMs: number, id: string, duration: number) {
  const { line, segment } = clipboard;
  const start = Math.round(atMs), end = start + line.videoEndMs - line.videoStartMs;
  if (start < 0 || end > duration) throw new Error('粘贴位置超出视频，请把播放头放在足够长的空白区间。');
  const rows = [...linesOf(data), { ...line, id, videoStartMs: start, videoEndMs: end }].sort((a, b) => a.videoStartMs - b.videoStartMs);
  return finish(data, rows, [...segmentsOf(data), { ...segment, id, videoStartMs: start, videoEndMs: end }], {
    lineVoiceInstructions: { ...record(data.lineVoiceInstructions), [id]: clipboard.voice },
    lineGains: { ...record(data.lineGains), [id]: segment.gain },
    generatedLineTexts: { ...record(data.generatedLineTexts), [id]: clipboard.generatedText },
    generatedLineVoices: { ...record(data.generatedLineVoices), [id]: clipboard.generatedVoice },
  }, duration);
}
export function deleteClip(data: EditData, id: string, duration: number) {
  if (!linesOf(data).some(row => row.id === id)) throw new Error('请选择有效台词。');
  return finish(data, linesOf(data).filter(row => row.id !== id), segmentsOf(data).filter(row => row.id !== id), { confirmedLineIds: confirmed(data).filter(value => value !== id) }, duration);
}
