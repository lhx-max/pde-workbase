/** EDL（编辑决策列表）纯函数核心：前后端共用，不依赖 React / 平台 API。
 * 撤销链只走决策补丁，导出时才把决策渲染成清单——这是卡内 data 恒小于
 * 256KB 限制的根基，也让 handler 全部可做确定性纯函数（幂等由平台数据层管）。
 * v2：双轨（配音 + 视频）时间轴、段级换源、对齐偏差计算；
 * v3：dense captions / 配音文档（生成链路产物，带 provider 来源标记）；
 * v1/v2 旧卡缺省字段读取时兜底，原样数据不做迁移。 */

import { DRAMA_AUDIO_DATA_VERSION, type DramaAudioData, type DramaAudioSegment } from './types';

/** 有效段：与裁剪窗口有交集的段，区间 clamp 到窗口，含对齐与换源决策。 */
export interface TimelineSegment {
  id: string;
  label: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  gapMs: number;
  gain: number;
  muted: boolean;
  videoStartMs: number | null;
  videoEndMs: number | null;
  /** 该段实际使用的配音源（override 优先于主源）。 */
  audioRef: string;
}

/** 未绑源时的空 data 骨架（渲染器与 handler 的共同兜底形状，v2 含视频字段）。 */
export function emptyDramaAudioData(): DramaAudioData {
  return {
    dataVersion: DRAMA_AUDIO_DATA_VERSION,
    audioRef: null,
    durationMs: 0,
    segments: [],
    masterGain: 1,
    trimStartMs: null,
    trimEndMs: null,
    script: null,
    exportedPath: null,
    exportedDigest: null,
    videoRef: null,
    videoDurationMs: 0,
    captions: [],
    captionProvider: null,
    dubbingDoc: null,
    dubbingProvider: null,
    voiceInstruction: null,
  };
}

/** 宽松读取：persisted 卡片 data 缺字段时按缺省补齐（v1 旧卡自动兼容；
 * persisted 字段全保留，不做物理迁移）。 */
export function readDramaAudioData(node: Record<string, unknown>): DramaAudioData {
  const base = emptyDramaAudioData();
  const raw = node.data;
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== 'object') throw new Error('card.drama.audio: data 必须是 JSON 对象');
  const source = raw as Record<string, unknown>;
  const segments = Array.isArray(source.segments) ? source.segments : [];
  const captions = Array.isArray(source.captions) ? source.captions.filter(item => item !== null && typeof item === 'object') : [];
  const data: DramaAudioData = {
    ...base,
    ...(source as Partial<DramaAudioData>),
    segments: segments.map(item => normalizeSegment(item)),
    captions: captions as DramaAudioData['captions'],
    voiceInstruction: typeof source.voiceInstruction === 'string' && source.voiceInstruction.trim() ? source.voiceInstruction : null,
  };
  data.dataVersion = DRAMA_AUDIO_DATA_VERSION;
  return data;
}

/** 段宽松归一化：v1 段缺 v2 字段时按缺省补齐。 */
function normalizeSegment(item: unknown): DramaAudioSegment {
  const raw = (item ?? {}) as Partial<DramaAudioSegment>;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    label: typeof raw.label === 'string' ? raw.label : '',
    startMs: typeof raw.startMs === 'number' ? raw.startMs : 0,
    endMs: typeof raw.endMs === 'number' ? raw.endMs : (typeof raw.startMs === 'number' ? raw.startMs + 1 : 1),
    gapMs: typeof raw.gapMs === 'number' ? raw.gapMs : 0,
    gain: typeof raw.gain === 'number' ? raw.gain : 1,
    muted: raw.muted === true,
    videoStartMs: raw.videoStartMs ?? null,
    videoEndMs: raw.videoEndMs ?? null,
    audioRefOverride: raw.audioRefOverride ?? null,
  };
}

/** 段有序化（按 startMs 升序，同起点按 id 稳定排序——保证决策可复现）。 */
export function sortSegments(segments: DramaAudioSegment[]): DramaAudioSegment[] {
  return [...segments].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

/** 视频窗口整体平移：保持时长，clamp 到 0..videoDurationMs；窗口非法或时长非法返回 null。 */
export function shiftSegmentWindow(
  segment: { videoStartMs: number | null; videoEndMs: number | null },
  deltaMs: number,
  videoDurationMs: number,
): { videoStartMs: number; videoEndMs: number } | null {
  const { videoStartMs, videoEndMs } = segment;
  if (videoStartMs === null || videoEndMs === null || !(videoEndMs > videoStartMs)) return null;
  if (!Number.isFinite(deltaMs) || !Number.isFinite(videoDurationMs) || videoDurationMs <= 0) return null;
  const span = videoEndMs - videoStartMs;
  const maxStart = Math.max(0, videoDurationMs - span);
  const start = Math.min(Math.max(0, Math.round(videoStartMs + deltaMs)), Math.round(maxStart));
  return { videoStartMs: start, videoEndMs: start + span };
}

/** 裁剪窗口：null 端用源边界兜底。 */
export function trimWindow(data: DramaAudioData): { startMs: number; endMs: number } {
  const duration = Math.max(0, data.durationMs);
  return {
    startMs: data.trimStartMs === null ? 0 : data.trimStartMs,
    endMs: data.trimEndMs === null ? duration : data.trimEndMs,
  };
}

/** 有效时间轴：与配音窗口有交集的段，区间 clamp 到窗口，按源顺序排列。
 * 段的有效配音源 = override ?? 主源（未绑源时空串）。 */
export function timelineOf(data: DramaAudioData): TimelineSegment[] {
  const { startMs, endMs } = trimWindow(data);
  const active: TimelineSegment[] = [];
  for (const segment of data.segments) {
    const from = Math.max(segment.startMs, startMs);
    const to = Math.min(segment.endMs, endMs);
    if (to - from <= 0) continue;
    active.push({
      id: segment.id,
      label: segment.label,
      sourceStartMs: from,
      sourceEndMs: to,
      durationMs: to - from,
      gapMs: segment.gapMs,
      gain: segment.gain,
      muted: segment.muted,
      videoStartMs: segment.videoStartMs,
      videoEndMs: segment.videoEndMs,
      audioRef: segment.audioRefOverride ?? data.audioRef ?? '',
    });
  }
  return [...active].sort((a, b) => a.sourceStartMs - b.sourceStartMs || a.id.localeCompare(b.id));
}

/** 导出估算时长：有效段时长 + 有效段间隔（gap），静音段不计入。 */
export function totalDurationMs(data: DramaAudioData): number {
  const active = timelineOf(data).filter(segment => !segment.muted);
  const played = active.reduce((sum, segment) => sum + segment.durationMs, 0);
  const gaps = active.reduce((sum, segment) => sum + segment.gapMs, 0);
  return played + gaps;
}

/** 对齐偏差：该段视频区间与配音区间（含段后停顿）的时长差（毫秒）。
 * null = 未对齐或区间非法；>0 = 台词（含停顿）长于画面，需压台词或拉画面。 */
export function alignShiftMs(segment: { durationMs: number; gapMs: number; videoStartMs: number | null; videoEndMs: number | null }): number | null {
  if (segment.videoStartMs === null || segment.videoEndMs === null) return null;
  const videoSpan = segment.videoEndMs - segment.videoStartMs;
  if (videoSpan <= 0) return null;
  return segment.durationMs + segment.gapMs - videoSpan;
}

/** FNV-1a 64 位摘要（hex，无依赖、跨运行时确定）。 */
export function digestOf(content: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= BigInt(content.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffff_ffff_ffff_ffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 导出清单：EDL 决策的确定性渲染（同 data → 同字节），v2 带视频与换源决策。 */
export function renderExportManifest(nodeId: string, data: DramaAudioData): { json: string; digest: string } {
  const timeline = timelineOf(data);
  const manifest = {
    format: 'drama-audio-edl/v3',
    nodeId,
    source: {
      audioRef: data.audioRef,
      durationMs: data.durationMs,
      videoRef: data.videoRef,
      videoDurationMs: data.videoRef === null ? 0 : data.videoDurationMs,
    },
    trim: { startMs: data.trimStartMs, endMs: data.trimEndMs },
    masterGain: data.masterGain,
    generation: {
      captionProvider: data.captionProvider,
      captionCount: data.captions.length,
      dubbingProvider: data.dubbingProvider,
      dubbingDoc: data.dubbingDoc,
    },
    segments: timeline.map(segment => ({
      id: segment.id,
      label: segment.label,
      audioRef: segment.audioRef,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      gapMs: segment.gapMs,
      gain: segment.gain,
      muted: segment.muted,
      videoStartMs: segment.videoStartMs,
      videoEndMs: segment.videoEndMs,
      alignShiftMs: alignShiftMs(segment),
    })),
    estimatedDurationMs: totalDurationMs(data),
  };
  const json = JSON.stringify(manifest, null, 2);
  return { json, digest: digestOf(json) };
}

/** 导出清单的工程相对路径（按卡 ID 派生，重复导出覆盖同一路径）。 */
export function exportPathFor(nodeId: string): string {
  return `card-assets/drama-audio/${nodeId}.edl.json`;
}
