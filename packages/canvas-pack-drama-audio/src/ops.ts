/** 卡片专属动作 handler —— 全部确定性（同输入同输出）：幂等重放、
 * 凭据与 revision 冲突由平台数据层统一处理，这里不做自己的去重。
 * 错误抛 Error（message 带 card.drama.audio 前缀）＝动作失败回滚；
 * 平台 v1 将其转成错误信封返回（见 README「平台接缝」）。
 * 文件落点走 ctx.files（工程相对路径），渲染产物只存 EDL 决策与引用。
 * v2 新增：video（绑视频）/ align（段对齐视频）/ rebind（段换配音源）/ span（改段区间）。
 * v3 新增：analyze（视频→dense captions，外部模型）/ compose（台本+画面→配音文档）。
 * 生成类动作调外部 provider（providers.ts），结果全量落 data、来源显式标记；
 * 幂等重放由平台凭条机制保证（同 operationId 不重新执行 handler）。 */

import type { CardPackOpHandler } from '@bezier/canvas-card-sdk';
import {
  DURATION_MS_MAX,
  GAP_MS_MAX,
  assertGain,
  assertInteger,
  assertLabel,
  assertOptionalText,
  assertProjectRelativePath,
  assertSegmentId,
  readOptionalMs,
} from './schema';
import {
  exportPathFor,
  readDramaAudioData,
  renderExportManifest,
  sortSegments,
} from './edl';
import { DRAMA_AUDIO_DATA_VERSION, type DramaAudioData, type DramaAudioSegment } from './types';
import { generateCaptions, generateDubbing, generateVideoRewrite } from './providers';
import { validateRewriteRequest } from './rewrite';
import { currentRewriteInput, sameRewriteInput } from './rewrite-draft';
import { makeSubtitles } from './subtitles';

type Patch = { data?: Record<string, unknown> };

function assertSpeed(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 2) throw new Error(`card.drama.audio: ${name} 必须是 0.5–2 之间的倍率`);
  return Math.round(value * 1000) / 1000;
}

function paramsOf(node: Record<string, unknown>, params: Record<string, unknown>): { data: DramaAudioData; input: Record<string, unknown> } {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new Error('card.drama.audio: params 必须是 JSON 对象');
  return { data: readDramaAudioData(node), input: params };
}

/** 动作前置：data 必须已绑配音源（attach 之后才能做编辑类动作）。 */
function attachedData(node: Record<string, unknown>, params: Record<string, unknown>): { data: DramaAudioData; input: Record<string, unknown> } {
  const { data, input } = paramsOf(node, params);
  if (data.audioRef === null) throw new Error('card.drama.audio: 卡片尚未绑定配音源，请先执行 card.drama.audio.attach');
  return { data, input };
}

function fullPatch(data: DramaAudioData, node?: Record<string, unknown>): Patch {
  const existing = node?.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {};
  return { data: { ...existing, ...data, dataVersion: DRAMA_AUDIO_DATA_VERSION } as Record<string, unknown> };
}

const SEGMENT_FIELDS = ['id', 'label', 'startMs', 'endMs', 'gapMs', 'gain', 'muted', 'videoStartMs', 'videoEndMs', 'audioRefOverride', 'leadMs', 'speed', 'fitSpeed'];

function segmentOf(input: Record<string, unknown>, durationMs: number): DramaAudioSegment {
  const segment = input.segment;
  if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) throw new Error('card.drama.audio: params.segment 必须是 JSON 对象');
  const record = segment as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!SEGMENT_FIELDS.includes(key)) throw new Error(`card.drama.audio: params.segment 含未知字段 ${key}`);
  }
  const startMs = assertInteger('params.segment.startMs', record.startMs, 0, Number.MAX_SAFE_INTEGER);
  const endMs = assertInteger('params.segment.endMs', record.endMs, 1, Number.MAX_SAFE_INTEGER);
  if (endMs <= startMs) throw new Error(`card.drama.audio: params.segment.endMs 必须大于 startMs（${startMs}..${endMs}）`);
  const videoStartMs = readOptionalMs('params.segment.videoStartMs', record.videoStartMs, durationMs);
  const videoEndMs = readOptionalMs('params.segment.videoEndMs', record.videoEndMs, durationMs);
  if (videoStartMs !== null && videoEndMs !== null && videoEndMs <= videoStartMs) {
    throw new Error(`card.drama.audio: params.segment 视频对齐区间必须 videoStartMs < videoEndMs（${videoStartMs}..${videoEndMs}）`);
  }
  return {
    id: assertSegmentId(record.id),
    label: assertLabel('params.segment.label', record.label),
    startMs,
    endMs,
    gapMs: assertInteger('params.segment.gapMs', record.gapMs, 0, GAP_MS_MAX),
    gain: assertGain('params.segment.gain', record.gain),
    muted: record.muted === true,
    videoStartMs,
    videoEndMs,
    audioRefOverride: record.audioRefOverride === undefined || record.audioRefOverride === null
      ? null
      : assertProjectRelativePath('params.segment.audioRefOverride', record.audioRefOverride),
    ...(record.leadMs === undefined || record.leadMs === 0 ? {} : { leadMs: assertInteger('params.segment.leadMs', record.leadMs, 1, 500) }),
    ...(record.speed === undefined || record.speed === 1 ? {} : { speed: assertSpeed('params.segment.speed', record.speed) }),
    ...(record.fitSpeed === undefined || record.fitSpeed === 1 ? {} : { fitSpeed: assertSpeed('params.segment.fitSpeed', record.fitSpeed) }),
  };
}

function findSegment(data: DramaAudioData, segmentId: string): DramaAudioSegment {
  const segment = data.segments.find(item => item.id === segmentId);
  if (!segment) throw new Error(`card.drama.audio: 分段 ${segmentId} 不存在`);
  return segment;
}

function patchSegments(data: DramaAudioData, segmentId: string, patch: Partial<DramaAudioSegment>): DramaAudioSegment[] {
  return data.segments.map(item => (item.id === segmentId ? { ...item, ...patch } : item));
}

/** 绑定/替换配音源：全量初始化 data（segments 可选，缺省单段覆盖全时长）。
 * v2 可同步带视频源与时长（一键建双轨）。 */
export const attach: CardPackOpHandler = async (node, params) => {
  const { data: previous, input } = paramsOf(node, params);
  const audioRef = assertProjectRelativePath('params.audioRef', input.audioRef);
  const durationMs = assertInteger('params.durationMs', input.durationMs, 1, DURATION_MS_MAX);
  const videoRef = input.videoRef === undefined ? previous.videoRef : assertProjectRelativePath('params.videoRef', input.videoRef);
  const videoDurationMs = videoRef === null ? 0 : input.videoRef === undefined ? previous.videoDurationMs : assertInteger('params.videoDurationMs', input.videoDurationMs, 1, DURATION_MS_MAX);
  let segments: DramaAudioSegment[];
  if (input.segments === undefined) {
    segments = [{ id: 'seg-0', label: '整段', startMs: 0, endMs: durationMs, gapMs: 0, gain: 1, muted: false, videoStartMs: null, videoEndMs: null, audioRefOverride: null }];
  } else if (Array.isArray(input.segments)) {
    segments = input.segments.map(item => segmentOf({ segment: item }, videoDurationMs || durationMs));
  } else {
    throw new Error('card.drama.audio: params.segments 必须是数组');
  }
  const data: DramaAudioData = {
    dataVersion: DRAMA_AUDIO_DATA_VERSION,
    audioRef,
    durationMs,
    segments: sortSegments(segments),
    masterGain: 1,
    trimStartMs: null,
    trimEndMs: null,
    script: previous.script,
    exportedPath: null,
    exportedDigest: null,
    videoRef,
    videoDurationMs,
    captions: videoRef === previous.videoRef ? previous.captions : [],
    voiceInstruction: previous.voiceInstruction,
    captionProvider: videoRef === previous.videoRef ? previous.captionProvider : null,
    dubbingDoc: videoRef === previous.videoRef ? previous.dubbingDoc : null,
    dubbingProvider: videoRef === previous.videoRef ? previous.dubbingProvider : null,
  };
  return fullPatch(data, node);
};

/** 写台本文本（null 清除）。 */
export const script: CardPackOpHandler = async (node, params) => {
  const { data, input } = paramsOf(node, params);
  return fullPatch({ ...data, script: assertOptionalText('params.script', input.script) }, node);
};

/** 增/改单段（按 id 匹配替换或追加；段字段同 v2 完整形状）。 */
export const upsert: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const segment = segmentOf(input, data.videoDurationMs || data.durationMs);
  const exists = data.segments.some(item => item.id === segment.id);
  const segments = exists ? data.segments.map(item => (item.id === segment.id ? segment : item)) : [...data.segments, segment];
  return fullPatch({ ...data, segments: sortSegments(segments) });
};

/** 删段。 */
export const remove: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const segmentId = assertSegmentId(input.segmentId);
  findSegment(data, segmentId);
  return fullPatch({ ...data, segments: data.segments.filter(item => item.id !== segmentId) });
};

/** 调段后停顿（毫秒）。 */
export const gap: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const segmentId = assertSegmentId(input.segmentId);
  const gapMs = assertInteger('params.gapMs', input.gapMs, 0, GAP_MS_MAX);
  findSegment(data, segmentId);
  return fullPatch({ ...data, segments: patchSegments(data, segmentId, { gapMs }) });
};

/** 音量：带 segmentId 改段级，缺省改 masterGain。 */
export const gain: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const value = assertGain('params.gain', input.gain);
  if (input.segmentId === undefined) return fullPatch({ ...data, masterGain: value });
  const segmentId = assertSegmentId(input.segmentId);
  findSegment(data, segmentId);
  return fullPatch({ ...data, segments: patchSegments(data, segmentId, { gain: value }) });
};

/** 段静音开关。 */
export const mute: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const segmentId = assertSegmentId(input.segmentId);
  if (typeof input.muted !== 'boolean') throw new Error('card.drama.audio: params.muted 必须是布尔值');
  findSegment(data, segmentId);
  return fullPatch({ ...data, segments: patchSegments(data, segmentId, { muted: input.muted === true }) });
};

/** 配音源裁剪窗口；缺省参数清除该端（null）。startMs 必须小于 endMs。 */
export const trim: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const duration = Math.max(0, data.durationMs);
  const startMs = readOptionalMs('params.startMs', input.startMs, duration);
  const endMs = readOptionalMs('params.endMs', input.endMs, duration);
  if (startMs !== null && endMs !== null && startMs >= endMs) throw new Error(`card.drama.audio: 裁剪窗口必须 startMs < endMs（${startMs}..${endMs}）`);
  return fullPatch({ ...data, trimStartMs: startMs, trimEndMs: endMs });
};

/** v2：绑定/替换视频源（进入双轨模式）。 */
export const video: CardPackOpHandler = async (node, params) => {
  const { data, input } = paramsOf(node, params);
  const videoRef = assertProjectRelativePath('params.videoRef', input.videoRef);
  const videoDurationMs = assertInteger('params.videoDurationMs', input.videoDurationMs, 1, DURATION_MS_MAX);
  return fullPatch({ ...data, videoRef, videoDurationMs });
};

/** v2：设置段对应的视频画面区间（时间轴对齐）；缺省参数清除该段对齐。 */
export const align: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  if (data.videoRef === null) throw new Error('card.drama.audio: 卡片尚未绑定视频源，请先执行 card.drama.audio.video');
  const segmentId = assertSegmentId(input.segmentId);
  findSegment(data, segmentId);
  const videoStartMs = readOptionalMs('params.videoStartMs', input.videoStartMs, data.videoDurationMs);
  const videoEndMs = readOptionalMs('params.videoEndMs', input.videoEndMs, data.videoDurationMs);
  if (videoStartMs !== null && videoEndMs !== null && videoEndMs <= videoStartMs) {
    throw new Error(`card.drama.audio: 对齐区间必须 videoStartMs < videoEndMs（${videoStartMs}..${videoEndMs}）`);
  }
  const clearBoth = videoStartMs === null && videoEndMs === null;
  return fullPatch({ ...data, segments: patchSegments(data, segmentId, clearBoth ? { videoStartMs: null, videoEndMs: null } : { videoStartMs, videoEndMs }) });
};

/** v2：段级换配音源（换 take / 重录该段）；audioRef 传 null 恢复主源。 */
export const rebind: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const segmentId = assertSegmentId(input.segmentId);
  findSegment(data, segmentId);
  const audioRefOverride = input.audioRef === undefined || input.audioRef === null
    ? null
    : assertProjectRelativePath('params.audioRef', input.audioRef);
  return fullPatch({ ...data, segments: patchSegments(data, segmentId, { audioRefOverride }) });
};

/** v2：改段配音区间（时间轴拖拽的服务端/Agent 通道）；缺省参数保持该端不变。 */
export const span: CardPackOpHandler = async (node, params) => {
  const { data, input } = attachedData(node, params);
  const segmentId = assertSegmentId(input.segmentId);
  const target = findSegment(data, segmentId);
  const startMs = input.startMs === undefined ? target.startMs : assertInteger('params.startMs', input.startMs, 0, data.durationMs);
  const endMs = input.endMs === undefined ? target.endMs : assertInteger('params.endMs', input.endMs, 1, data.durationMs);
  if (endMs <= startMs) throw new Error(`card.drama.audio: 段区间必须 startMs < endMs（${startMs}..${endMs}）`);
  return fullPatch({ ...data, segments: sortSegments(patchSegments(data, segmentId, { startMs, endMs })) });
};

/** v3：视频 → dense captions（外部模型 provider；DRAMA_AUDIO_PROVIDER=mock 走显式本地演示）。
 * 结果全量落 data.captions 并记录生成来源；同 operationId 重放不重复调用 provider。 */
export const analyze: CardPackOpHandler = async (node, params) => {
  const { data } = paramsOf(node, params);
  if (data.videoRef === null) throw new Error('card.drama.audio: 卡片尚未绑定视频源，请先执行 card.drama.audio.attach 或 card.drama.audio.video');
  if (data.videoDurationMs <= 0) throw new Error('card.drama.audio: 请先读取并确认视频时长');
  const { provider, captions } = await generateCaptions({ videoRef: data.videoRef, videoDurationMs: data.videoDurationMs });
  return fullPatch({ ...data, captions, captionProvider: provider });
};

/** v3：台本 + 画面 captions → 配音文档（外部模型 provider）。
 * 文档存 data.dubbingDoc；应用为台本由用户在卡上一键完成（不自动覆盖 script）。 */
export const compose: CardPackOpHandler = async (node, params) => {
  const { data, input } = paramsOf(node, params);
  const script = input.script === undefined ? data.script : input.script === null ? null : assertOptionalText('params.script', input.script);
  const { provider, doc } = await generateDubbing({ script, captions: data.captions });
  return fullPatch({ ...data, dubbingDoc: doc, dubbingProvider: provider });
};

/** 渲染 EDL 决策为导出清单并写入工程文件口；记录路径与摘要。 */
export const exportEdl: CardPackOpHandler = async (node, params, ctx) => {
  const { data } = attachedData(node, params);
  if (!ctx || !ctx.files) throw new Error('card.drama.audio: 导出动作缺少文件通道（ctx.files）');
  const { json, digest } = renderExportManifest(node.id, data);
  const path = exportPathFor(node.id);
  await ctx.files.write(ctx.projectId, path, json);
  return fullPatch({ ...data, exportedPath: path, exportedDigest: digest });
};

export const exportSrt: CardPackOpHandler = async (node, params, ctx) => {
  if (Object.keys(params).length) throw new Error('card.drama.audio: 导出字幕无需参数');
  const data = node.data as Record<string, unknown> | undefined;
  const duration = assertInteger('videoDurationMs', data?.videoDurationMs, 1, DURATION_MS_MAX);
  const srt = makeSubtitles(data?.rewriteLines, duration);
  const path = exportPathFor(node.id).replace(/\.json$/u, '.srt');
  await ctx.files.write(ctx.projectId, path, srt);
  return { data: { subtitlePath: path } };
};

export const rewrite: CardPackOpHandler = async (node, params) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('card.drama.audio: params 必须是 JSON 对象');
  const input = validateRewriteRequest(params);
  if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) throw new Error('card.drama.audio: 目标不是改写卡');
  const data = node.data as Record<string, unknown>;
  const stage = data.stage;
  if (stage !== undefined && stage !== 'edit' && stage !== 'rewrite') throw new Error('card.drama.audio: 目标不是改写卡');
  const current = currentRewriteInput(data);
  if (!sameRewriteInput(input, current)) throw new Error('card.drama.audio: 原稿、prompt、视频或时长与已保存节点不一致，请先保存');
  const { provider, visionProvider, observations, lines, doc } = await generateVideoRewrite(input);
  const patch = stage === 'rewrite' ? {
    rewriteLines: lines,
    rewriteDoc: doc,
    rewriteProvider: provider,
    rewriteVisionProvider: visionProvider,
    rewriteObservations: observations,
    rewriteInput: current,
    rewriteConfirmed: false,
  } : { rewriteDraft: { input: current, provider, visionProvider, lines } };
  if (new TextEncoder().encode(JSON.stringify({ ...node, data: { ...data, ...patch } })).byteLength > 256 * 1024) {
    throw new Error('card.drama.audio: 原稿与改写建议超出卡片容量，请分段改写');
  }
  return { data: patch };
};

export const dramaAudioOps = {
  attach,
  script,
  upsert,
  remove,
  gap,
  gain,
  mute,
  trim,
  video,
  align,
  rebind,
  span,
  analyze,
  compose,
  rewrite,
  export: exportEdl,
  'export-srt': exportSrt,
} satisfies Record<string, CardPackOpHandler>;
