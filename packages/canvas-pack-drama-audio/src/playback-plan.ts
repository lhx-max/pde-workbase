import type { DramaAudioData } from './types';

export interface PlaybackPlanItem {
  segmentId: string;
  audioRef: string;
  delayMs: number;
  offsetMs: number;
  durationMs: number;
  gain: number;
  /** 播放倍率（保持音调变速），1 为原速；offsetMs 是音源内的毫秒，durationMs 是时间轴上的毫秒。 */
  rate: number;
}

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;

/** 片段的实际播放倍率：手动语速 speed 乘以贴合视频时的自动加速 fitSpeed。 */
export function segmentRate(segment: { speed?: unknown; fitSpeed?: unknown }): number {
  const factor = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
  const rate = factor(segment.speed) * factor(segment.fitSpeed);
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, rate)) * 1000) / 1000;
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validGain(value: unknown): value is number {
  return nonnegative(value) && value <= 2;
}

function audioPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.startsWith('/')
    && !value.includes('\\') && !/[\u0000-\u001f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function resolvePlaybackDuration(savedMs: number, measuredMs: number): number {
  if (nonnegative(measuredMs) && measuredMs > 0) return Math.round(measuredMs);
  return nonnegative(savedMs) ? Math.round(savedMs) : 0;
}

export function playbackDriftMs(anchorVideoMs: number, anchorAudioSeconds: number, videoMs: number, audioSeconds: number, rate: number): number {
  return videoMs - (anchorVideoMs + (audioSeconds - anchorAudioSeconds) * 1000 * rate);
}

export function buildPlaybackPlan(data: Pick<DramaAudioData, 'segments' | 'audioRef' | 'masterGain'> | unknown, currentVideoMs: number): PlaybackPlanItem[] {
  if (!nonnegative(currentVideoMs) || !data || typeof data !== 'object') return [];
  const raw = data as Record<string, unknown>;
  if (!validGain(raw.masterGain) || !Array.isArray(raw.segments)) return [];
  const result: PlaybackPlanItem[] = [];
  for (const entry of raw.segments) {
    if (!entry || typeof entry !== 'object') continue;
    const segment = entry as Record<string, unknown>;
    const { id, startMs, endMs, videoStartMs, videoEndMs, gapMs, gain, muted } = segment;
    if (typeof id !== 'string' || !id.trim() || muted !== false || !validGain(gain)) continue;
    if (!nonnegative(startMs) || !nonnegative(endMs) || endMs <= startMs
      || !nonnegative(videoStartMs) || !nonnegative(videoEndMs) || videoEndMs <= videoStartMs
      || !nonnegative(gapMs)) continue;
    const audioRef = segment.audioRefOverride ?? raw.audioRef;
    if (!audioPath(audioRef)) continue;
    // leadMs：配音提前进入、与上一句重叠的毫秒数（声音层），字幕窗口仍从 videoStartMs 开始。
    const leadMs = nonnegative(segment.leadMs) ? Math.min(segment.leadMs, videoStartMs) : 0;
    const rate = segmentRate(segment);
    const audioStartMs = videoStartMs - leadMs;
    const elapsedMs = Math.max(0, currentVideoMs - audioStartMs);
    const playableMs = Math.min((endMs - startMs) / rate, Math.max(0, videoEndMs - videoStartMs + leadMs - gapMs));
    const durationMs = playableMs - elapsedMs;
    const offsetMs = startMs + elapsedMs * rate;
    const delayMs = Math.max(0, audioStartMs - currentVideoMs);
    if (durationMs <= 0 || ![durationMs, offsetMs, delayMs].every(Number.isFinite)) continue;
    result.push({ segmentId: id, audioRef, delayMs, offsetMs, durationMs, gain: raw.masterGain * gain, rate });
  }
  return result.sort((a, b) => a.delayMs - b.delayMs || a.segmentId.localeCompare(b.segmentId));
}

export type AudioLayer = 'original' | 'voice' | 'background';
export type AudioListenMode = 'mix' | AudioLayer;

export function buildDirectorPlaybackPlan(
  data: Record<string, unknown>, startMs: number, durationMs: number, mode: AudioListenMode,
): (PlaybackPlanItem & { track: 'voice' | 'background' })[] {
  const voice = mode === 'voice' || mode === 'mix' ? buildPlaybackPlan(data, startMs).map(item => ({ ...item, track: 'voice' as const })) : [];
  const endMs = nonnegative(data.directorBackgroundDurationMs) ? Math.min(durationMs, data.directorBackgroundDurationMs) : 0;
  if ((mode !== 'background' && mode !== 'mix') || !audioPath(data.directorBackgroundRef) || !(endMs > startMs)) return voice;
  return [...voice, {
    track: 'background', segmentId: 'director-background', audioRef: data.directorBackgroundRef,
    delayMs: 0, offsetMs: startMs, durationMs: endMs - startMs, rate: 1,
    gain: validGain(data.directorBackgroundGain) ? data.directorBackgroundGain : 1,
  }];
}
export type GainRegion = { startMs: number; endMs: number; track: AudioLayer; gain: number; fadeMs: number };

export function gainRegionsOf(data: Record<string, unknown>, track: AudioLayer): GainRegion[] {
  if (!Array.isArray(data.directorGainRegions)) return [];
  return data.directorGainRegions.filter((value): value is GainRegion => value && value.track === track
    && nonnegative(value.startMs) && nonnegative(value.endMs) && value.endMs > value.startMs
    && validGain(value.gain) && (track !== 'original' || value.gain <= 1) && nonnegative(value.fadeMs))
    .sort((a, b) => a.startMs - b.startMs);
}

export function originalGainOf(data: Record<string, unknown>): number {
  return nonnegative(data.directorOriginalGain) ? Math.min(1, data.directorOriginalGain) : 1;
}

export function gainAt(regions: GainRegion[], ms: number): number {
  const region = regions.find(item => item.startMs <= ms && ms < item.endMs);
  if (!region) return 1;
  const fade = Math.min(region.fadeMs, (region.endMs - region.startMs) / 2);
  const weight = fade ? Math.min(1, (ms - region.startMs) / fade, (region.endMs - ms) / fade) : 1;
  return 1 + (region.gain - 1) * weight;
}

export function scheduleMixGain(
  param: AudioParam, regions: GainRegion[], base: number, startMs: number, endMs: number, when: number, rate = 1,
) {
  param.setValueAtTime(base * gainAt(regions, startMs), when);
  for (const region of regions) {
    const fade = Math.min(region.fadeMs, (region.endMs - region.startMs) / 2);
    const time = (ms: number) => when + (ms - startMs) / 1000 / rate;
    const inside = (ms: number) => ms > startMs && ms <= endMs;
    if (!fade) {
      if (inside(region.startMs)) param.setValueAtTime(base * region.gain, time(region.startMs));
      if (inside(region.endMs)) param.setValueAtTime(base, time(region.endMs));
      continue;
    }
    if (inside(region.startMs)) param.setValueAtTime(base, time(region.startMs));
    for (const ms of new Set([region.startMs + fade, region.endMs - fade, region.endMs])) {
      if (inside(ms)) param.linearRampToValueAtTime(base * (ms === region.endMs ? 1 : region.gain), time(ms));
    }
    if (endMs > startMs && endMs > region.startMs && endMs < region.endMs) {
      param.linearRampToValueAtTime(base * gainAt(regions, endMs), time(endMs));
    }
  }
}
