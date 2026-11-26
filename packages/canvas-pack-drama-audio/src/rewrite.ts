import { assertInteger, assertProjectRelativePath, DURATION_MS_MAX } from './schema';

export const DEFAULT_REWRITE_PROMPT = '请将原解说稿改写为第三人称的中文短剧剧情解说，像解说员向观众讲清这段故事，而不是替角色编写对白。以原稿为主线，保留人物关系、关键事件、因果和转折，结合采样帧观测核对画面；原稿已明确的剧情不因采样稀疏而删成零散字幕。语言口语化、紧凑、连贯，每句推进剧情，删掉重复、空泛评价和无关铺垫。不生成角色对白，不逐帧报幕，不拼接 OCR 字幕、水印或免责声明，不输出分析过程、写作建议、标题、开场套话或关注引导。不编造原稿和画面未提供的人物关系、事件或声音。按剧情节奏分段给出建议配音区间，不机械地每张采样帧对应一句；时间区间有序、不重叠，均需人工确认。';
export const REWRITE_BODY_MAX_BYTES = 1_200_000;
export const REWRITE_FRAME_MAX_BYTES = 100_000;

export interface RewriteLine {
  id: string;
  text: string;
  videoStartMs: number;
  videoEndMs: number;
}

export interface RewriteFrame {
  atMs: number;
  image: string;
}

export interface VideoRewriteInput {
  script: string | null;
  prompt: string;
  videoRef: string;
  videoDurationMs: number;
}

export interface VideoRewriteRequest extends VideoRewriteInput {
  frames: RewriteFrame[];
}

export function validateRewriteInput(value: Record<string, unknown>): VideoRewriteInput {
  if (value.script !== null && (typeof value.script !== 'string' || value.script.length > 20_000)) throw new Error('card.drama.audio: 原稿必须是最多 20000 字符的字符串或 null');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 20_000) throw new Error('card.drama.audio: 改写 prompt 必须为 1–20000 字符');
  return {
    script: value.script as string | null,
    prompt: value.prompt,
    videoRef: assertProjectRelativePath('videoRef', value.videoRef),
    videoDurationMs: assertInteger('videoDurationMs', value.videoDurationMs, 1, DURATION_MS_MAX),
  };
}

export function validateRewriteRequest(value: Record<string, unknown>): VideoRewriteRequest {
  const input = validateRewriteInput(value);
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > 12) throw new Error('card.drama.audio: 采样帧必须为 1–12 帧');
  let previous = -1;
  const frames = value.frames.map((frame: unknown): RewriteFrame => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('card.drama.audio: 采样帧结构非法');
    const item = frame as Record<string, unknown>;
    const atMs = assertInteger('frames.atMs', item.atMs, 0, input.videoDurationMs);
    if (atMs <= previous) throw new Error('card.drama.audio: 帧时间戳必须按顺序且不重复');
    previous = atMs;
    if (typeof item.image !== 'string' || item.image.length > 133_359 || !/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(item.image)) throw new Error('card.drama.audio: 帧必须是 JPEG data URL，单帧不超过 100KB');
    const encoded = item.image.slice('data:image/jpeg;base64,'.length);
    const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (bytes < 4 || bytes > REWRITE_FRAME_MAX_BYTES) throw new Error('card.drama.audio: JPEG 单帧超过 100KB 或为空');
    const decoded = atob(encoded);
    if (decoded.charCodeAt(0) !== 255 || decoded.charCodeAt(1) !== 216 || decoded.charCodeAt(2) !== 255 || decoded.charCodeAt(decoded.length - 2) !== 255 || decoded.charCodeAt(decoded.length - 1) !== 217) throw new Error('card.drama.audio: 非法 JPEG 帧');
    return { atMs, image: item.image };
  });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > REWRITE_BODY_MAX_BYTES) throw new Error('card.drama.audio: 改写请求总大小超过 1.2MB');
  return { ...input, frames };
}

export function validateRewriteLines(value: unknown, videoDurationMs: number): RewriteLine[] {
  assertInteger('videoDurationMs', videoDurationMs, 1, DURATION_MS_MAX);
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) throw new Error('card.drama.audio: 改写结果必须为 1–80 段');
  const ids = new Set<string>();
  let previousEnd = 0;
  const lines = value.map((line: unknown): RewriteLine => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw new Error('card.drama.audio: 台词结构非法');
    const item = line as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)) throw new Error('card.drama.audio: 台词 id 必须唯一、非空且不超过 64 字符');
    ids.add(item.id);
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2_000) throw new Error('card.drama.audio: 单段台词必须为 1–2000 字符');
    const videoStartMs = assertInteger('videoStartMs', item.videoStartMs, 0, videoDurationMs);
    const videoEndMs = assertInteger('videoEndMs', item.videoEndMs, 0, videoDurationMs);
    if (videoEndMs <= videoStartMs || videoStartMs < previousEnd) throw new Error('card.drama.audio: 台词区间必须 end > start、有序且不重叠');
    previousEnd = videoEndMs;
    return { id: item.id, text: item.text, videoStartMs, videoEndMs };
  });
  if (rewriteDocOf(lines).length > 20_000) throw new Error('card.drama.audio: 改写总稿超过 20000 字符');
  return lines;
}

export function insertRewriteLine(lines: RewriteLine[], targetId: string, position: 'before' | 'after', id: string, durationMs: number): RewriteLine[] {
  if (lines.length >= 80) throw new Error('最多支持 80 句');
  const index = lines.findIndex(line => line.id === targetId);
  const target = lines[index];
  if (!target || target.videoEndMs - target.videoStartMs < 2) throw new Error('当前区间太短，无法插入，请先调整区间');
  const middle = Math.floor((target.videoStartMs + target.videoEndMs) / 2);
  const added = { id, text: '请输入新增台词', videoStartMs: position === 'before' ? target.videoStartMs : middle, videoEndMs: position === 'before' ? middle : target.videoEndMs };
  const kept = { ...target, ...(position === 'before' ? { videoStartMs: middle } : { videoEndMs: middle }) };
  const next = lines.flatMap((line, at) => at === index ? position === 'before' ? [added, kept] : [kept, added] : [line]);
  return validateRewriteLines(next, durationMs);
}

export function changeRewriteWindow(line: RewriteLine, deltaMs: number, mode: 'move' | 'start' | 'end', durationMs: number): RewriteLine {
  if (![deltaMs, durationMs, line.videoStartMs, line.videoEndMs].every(Number.isFinite) || durationMs < 1) throw new Error('视频区间无效');
  const delta = Math.round(deltaMs);
  if (mode === 'start') return { ...line, videoStartMs: Math.max(0, Math.min(line.videoEndMs - 1, line.videoStartMs + delta)) };
  if (mode === 'end') return { ...line, videoEndMs: Math.min(durationMs, Math.max(line.videoStartMs + 1, line.videoEndMs + delta)) };
  const span = line.videoEndMs - line.videoStartMs;
  const start = Math.max(0, Math.min(durationMs - span, line.videoStartMs + delta));
  return { ...line, videoStartMs: start, videoEndMs: start + span };
}

export function rewriteDocOf(lines: RewriteLine[]): string {
  return lines.map(line => line.text).join('\n');
}
