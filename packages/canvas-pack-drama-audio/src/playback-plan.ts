import type { DramaAudioData } from './types';

export interface PlaybackPlanItem {
  segmentId: string;
  audioRef: string;
  delayMs: number;
  offsetMs: number;
  durationMs: number;
  gain: number;
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
    const elapsedMs = Math.max(0, currentVideoMs - videoStartMs);
    const playableMs = Math.min(endMs - startMs, Math.max(0, videoEndMs - videoStartMs - gapMs));
    const durationMs = playableMs - elapsedMs;
    const offsetMs = startMs + elapsedMs;
    const delayMs = Math.max(0, videoStartMs - currentVideoMs);
    if (durationMs <= 0 || ![durationMs, offsetMs, delayMs].every(Number.isFinite)) continue;
    result.push({ segmentId: id, audioRef, delayMs, offsetMs, durationMs, gain: raw.masterGain * gain });
  }
  return result.sort((a, b) => a.delayMs - b.delayMs || a.segmentId.localeCompare(b.segmentId));
}
