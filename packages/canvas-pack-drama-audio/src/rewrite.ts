import { assertInteger, assertProjectRelativePath, DURATION_MS_MAX } from './schema';

export const DEFAULT_REWRITE_PROMPT = '请根据原稿和带时间戳的视频采样帧，将台词改写为自然、清晰、可朗读的中文短剧配音稿。保留原稿含义，只使用原稿或已观测画面提供的信息，不编造未观测的剧情、动作、声音或人物关系。按视频时间顺序输出不重叠的台词区间，所有内容均需人工确认。';
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

export function rewriteDocOf(lines: RewriteLine[]): string {
  return lines.map(line => line.text).join('\n');
}
