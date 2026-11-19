import { planScriptWindows } from './layout';
import { makeSubtitles } from '../subtitles';
import { requireMedia, type MediaLookup } from './media';
import { buildDirectorPlaybackPlan, gainRegionsOf, originalGainOf, scheduleMixGain } from '../playback-plan';
import { dubbingCounts, effectiveLineVoice } from '../dubbing';
import { validateRewriteLines } from '../rewrite';
import type { DramaAudioSegment } from '../types';
import type { RewriteLine as TimedDubbingLine } from '../rewrite';

import type { ListenMode, TimeRange } from './director-edits';

type Data = Record<string, unknown>;

export function linesOf(data: Data): TimedDubbingLine[] {
  return Array.isArray(data.rewriteLines) ? data.rewriteLines : [];
}

function segmentsOf(data: Data): DramaAudioSegment[] {
  return Array.isArray(data.segments) ? data.segments : [];
}

export function importScript(data: Data, source: string, duration: number): Data {
  const texts = source.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (!texts.length || source.length > 20_000 || texts.length > 80 || texts.some(text => text.length > 2000)) {
    throw new Error('请使用 1–80 行 UTF-8 台词，每行不超过 2000 字，全文不超过 20000 字。');
  }
  if (duration < texts.length) throw new Error('请先绑定视频，才能为台词安排时间区间。');
  const previous = linesOf(data);
  const reuseWindows = texts.length === previous.length;
  // 句数不变时沿用原区间；否则按字数比例安排初始区间，生成配音后再按真实时长贴合。
  const rows = validateRewriteLines(reuseWindows
    ? texts.map((text, index) => ({ ...previous[index], text }))
    : planScriptWindows(texts.map(text => ({ id: `line-${crypto.randomUUID()}`, text })), duration), duration);
  const unchanged = new Set(rows.filter((line, index) => reuseWindows && line.text === previous[index]?.text).map(line => line.id));
  const kept = segmentsOf(data).filter(segment => unchanged.has(segment.id));
  return {
    script: rows.map(line => line.text).join('\n'), rewriteLines: rows, segments: kept,
    confirmedLineIds: (Array.isArray(data.confirmedLineIds) ? data.confirmedLineIds : []).filter(id => unchanged.has(id)),
    generatedLineTexts: Object.fromEntries(kept.map(segment => [segment.id, (data.generatedLineTexts as Data | undefined)?.[segment.id]]).filter(([, value]) => typeof value === 'string')),
    generatedLineVoices: Object.fromEntries(kept.map(segment => [segment.id, (data.generatedLineVoices as Data | undefined)?.[segment.id]]).filter(([, value]) => typeof value === 'string')),
  };
}

export async function videoDurationOf(file: File): Promise<number> {
  const video = document.createElement('video');
  const src = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('视频读取超时')), 12_000);
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        const duration = Math.round(video.duration * 1000);
        if (Number.isSafeInteger(duration) && duration > 0) resolve(duration);
        else reject(new Error('无法识别视频时长'));
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('当前浏览器无法读取此视频'));
      };
      video.src = src;
    });
  } finally {
    video.onloadedmetadata = video.onerror = null;
    video.removeAttribute('src');
    URL.revokeObjectURL(src);
  }
}

export async function audioDurationOf(file: File): Promise<number> {
  if (file.size > 64 * 1024 * 1024) throw new Error('本地演示支持导入不超过 64 MB 的音频');
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    return Math.max(1, Math.round(audio.duration * 1000));
  } catch {
    throw new Error('当前浏览器无法解码此音频');
  } finally { await context.close(); }
}

export function importVoice(data: Data, audioRef: string, audioMs: number, videoMs: number, lineId?: string): Data {
  const lines = linesOf(data);
  const current = segmentsOf(data);
  const targets = lineId ? lines.filter(line => line.id === lineId) : lines;
  if (lineId && !targets.length) throw new Error('请先选择有效台词');
  if (!videoMs) throw new Error('请先绑定视频');
  const generatedLineTexts = { ...(data.generatedLineTexts as Data | undefined) };
  const generatedLineVoices = { ...(data.generatedLineVoices as Data | undefined) };
  const takes: DramaAudioSegment[] = [];
  for (const line of targets) {
    const startMs = lineId ? 0 : line.videoStartMs;
    const endMs = lineId ? audioMs : Math.min(audioMs, line.videoEndMs);
    if (startMs >= endMs) continue;
    const previous = current.find(segment => segment.id === line.id);
    takes.push({
      id: line.id, label: line.text, startMs, endMs, gapMs: previous?.gapMs ?? 0,
      gain: previous?.gain ?? 1, muted: previous?.muted ?? false, videoStartMs: line.videoStartMs,
      videoEndMs: line.videoEndMs, audioRefOverride: audioRef,
    });
    generatedLineTexts[line.id] = line.text;
    generatedLineVoices[line.id] = effectiveLineVoice(data, line.id);
  }
  if (!targets.length) {
    takes.push({ id: 'imported-track', label: '导入的整轨配音', startMs: 0, endMs: audioMs, gapMs: 0,
      gain: 1, muted: false, videoStartMs: 0, videoEndMs: Math.min(videoMs, audioMs), audioRefOverride: audioRef });
  }
  if (!takes.length) throw new Error('音频未覆盖任何台词区间');
  return {
    audioRef: lineId ? data.audioRef ?? audioRef : audioRef, durationMs: Math.max(audioMs, Number(data.durationMs) || 0),
    segments: lineId ? [...current.filter(segment => segment.id !== lineId), ...takes] : takes,
    generatedLineTexts, generatedLineVoices,
  };
}

export function deliveryIssues(data: Data, videoMs: number): string[] {
  const counts = dubbingCounts(data);
  const issues: string[] = [];
  if (counts.missing) issues.push(`${counts.missing} 句缺配音`);
  if (counts.stale) issues.push(`${counts.stale} 句配音待更新`);
  if (counts.total > counts.confirmed) issues.push(`${counts.total - counts.confirmed} 句区间未确认`);
  const segments = segmentsOf(data);
  const truncated = segments.filter(segment => !segment.muted && segment.videoStartMs !== null && segment.videoEndMs !== null
    && segment.endMs - segment.startMs > segment.videoEndMs - segment.videoStartMs + (segment.leadMs ?? 0) - segment.gapMs).length;
  if (truncated) issues.push(`${truncated} 句音频会截断`);
  if (segments.some(segment => segment.videoEndMs !== null && segment.videoEndMs > videoMs)) issues.push('存在超出视频的片段');
  return issues;
}

const EXPORT_RATE = 44_100;

export async function renderMix(
  data: Data, mediaUrl: MediaLookup, range: TimeRange, mode: ListenMode, signal: AbortSignal,
): Promise<AudioBuffer> {
  const { startMs, endMs } = range;
  const durationMs = endMs - startMs;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 15 * 60_000) throw new Error('本地混音支持 15 分钟以内的视频');
  const plan = buildDirectorPlaybackPlan(data, startMs, endMs, mode).filter(item => item.delayMs < durationMs);
  const context = new OfflineAudioContext(2, Math.ceil(durationMs * EXPORT_RATE / 1000), EXPORT_RATE);
  async function read(ref: string) {
    const response = await fetch(requireMedia(mediaUrl, ref), { signal, redirect: 'error' });
    if (!response.ok) throw new Error(`音频读取失败 HTTP ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  }
  const buffers = new Map<string, AudioBuffer>();
  for (const ref of new Set(plan.map(item => item.audioRef))) {
    buffers.set(ref, await read(ref));
  }
  const regions = { voice: gainRegionsOf(data, 'voice'), background: gainRegionsOf(data, 'background') };
  for (const item of plan) {
    const buffer = buffers.get(item.audioRef)!;
    const duration = Math.min(item.durationMs / 1000, (durationMs - item.delayMs) / 1000, buffer.duration - item.offsetMs / 1000);
    if (duration <= 0) continue;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    const sceneStart = startMs + item.delayMs;
    scheduleMixGain(gain.gain, regions[item.track], item.gain, sceneStart, sceneStart + duration * 1000, item.delayMs / 1000);
    source.connect(gain).connect(context.destination);
    source.start(item.delayMs / 1000, item.offsetMs / 1000, duration);
  }
  if ((mode === 'mix' || mode === 'original') && typeof data.videoRef === 'string') {
    const source = context.createBufferSource();
    try { source.buffer = await read(data.videoRef); }
    catch {
      signal.throwIfAborted();
      throw new Error('浏览器无法解码视频原声。可选择配音后重新导出。');
    }
    const gain = context.createGain();
    scheduleMixGain(gain.gain, gainRegionsOf(data, 'original'), originalGainOf(data), startMs, endMs, 0);
    source.connect(gain).connect(context.destination);
    source.start(0, startMs / 1000);
  }
  signal.throwIfAborted();
  const audio = await context.startRendering();
  signal.throwIfAborted();
  return audio;
}

export async function exportWav(data: Data, mediaUrl: MediaLookup, durationMs: number, mode: ListenMode, signal: AbortSignal): Promise<Blob> {
  if (mode === 'voice' && !segmentsOf(data).length) throw new Error('尚无可导出的配音');
  return encodeWav(await renderMix(data, mediaUrl, { startMs: 0, endMs: durationMs }, mode, signal));
}

export function encodeWav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const samples = Array.from({ length: channels }, (_, index) => audio.getChannelData(index));
  const size = audio.length * channels * 2;
  const header = new DataView(new ArrayBuffer(44));
  function label(offset: number, value: string) {
    for (const [index, char] of Array.from(value).entries()) header.setUint8(offset + index, char.charCodeAt(0));
  }
  label(0, 'RIFF'); header.setUint32(4, size + 36, true);
  label(8, 'WAVE'); label(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true);
  header.setUint16(22, channels, true); header.setUint32(24, audio.sampleRate, true);
  header.setUint32(28, audio.sampleRate * channels * 2, true);
  header.setUint16(32, channels * 2, true); header.setUint16(34, 16, true);
  label(36, 'data'); header.setUint32(40, size, true);
  const pcm = new DataView(new ArrayBuffer(size));
  for (let i = 0; i < audio.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, samples[channel]![i] ?? 0));
      pcm.setInt16((i * channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([header.buffer, pcm.buffer], { type: 'audio/wav' });
}

export function exportSubtitles(data: Data, durationMs: number): Blob {
  return new Blob([makeSubtitles(data.rewriteLines, durationMs)], { type: 'text/plain;charset=utf-8' });
}

export function download(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
