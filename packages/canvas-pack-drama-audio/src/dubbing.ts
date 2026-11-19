import type { RewriteLine } from './rewrite';
import type { DramaAudioSegment } from './types';

export const DEFAULT_VOICE_INSTRUCTION = '自然清晰的普通话解说';

export function effectiveLineVoice(data: Record<string, unknown>, lineId: string): string {
  const overrides = data.lineVoiceInstructions as Record<string, unknown> | undefined;
  const override = overrides?.[lineId];
  if (typeof override === 'string' && override.trim() && override.length <= 200) return override.trim();
  return voiceInstructionOf(data)?.trim() ?? DEFAULT_VOICE_INSTRUCTION;
}

export function lineGenerationCurrent(data: Record<string, unknown>, lineId: string, text: string): boolean {
  const texts = data.generatedLineTexts as Record<string, unknown> | undefined;
  const voices = data.generatedLineVoices as Record<string, unknown> | undefined;
  return texts?.[lineId] === text && voices?.[lineId] === effectiveLineVoice(data, lineId);
}

export function dubbingCounts(data: Record<string, unknown>) {
  const lines = (Array.isArray(data.rewriteLines) ? data.rewriteLines : []) as RewriteLine[];
  const segments = (Array.isArray(data.segments) ? data.segments : []) as DramaAudioSegment[];
  const withAudio = lines.filter(line => segments.some(segment => segment.id === line.id && (segment.audioRefOverride || data.audioRef)));
  const current = withAudio.filter(line => lineGenerationCurrent(data, line.id, line.text)).length;
  return { total: lines.length, current, missing: lines.length - withAudio.length, stale: withAudio.length - current,
    confirmed: lines.filter(line => Array.isArray(data.confirmedLineIds) && data.confirmedLineIds.includes(line.id)).length };
}

export type DubbingCandidate = {
  lineId: string; text: string; voice: string; videoRef: unknown; audioRef: string; durationMs: number; previousSource?: string | null;
};

export function lineAudioSource(data: Record<string, unknown>, lineId: string) {
  const segment = (Array.isArray(data.segments) ? data.segments as DramaAudioSegment[] : []).find(item => item.id === lineId);
  return segment ? segment.audioRefOverride ?? (typeof data.audioRef === 'string' ? data.audioRef : null) : null;
}

export function candidateMatches(data: Record<string, unknown>, candidate: DubbingCandidate) {
  return candidate.videoRef === data.videoRef && effectiveLineVoice(data, candidate.lineId) === candidate.voice
    && (candidate.previousSource === undefined || candidate.previousSource === lineAudioSource(data, candidate.lineId))
    && Array.isArray(data.rewriteLines) && data.rewriteLines.some(line => line.id === candidate.lineId && line.text === candidate.text);
}

export function adoptDubbingCandidate(data: Record<string, unknown>, candidate: DubbingCandidate): Record<string, unknown> {
  if (!candidateMatches(data, candidate)) throw new Error('这句台词、音色或视频已变化，请重新生成配音。');
  const line = (data.rewriteLines as RewriteLine[]).find(item => item.id === candidate.lineId)!;
  const segments = (Array.isArray(data.segments) ? data.segments : []) as DramaAudioSegment[];
  const old = segments.find(segment => segment.id === line.id);
  const take: DramaAudioSegment = { id: line.id, label: line.text, startMs: 0, endMs: candidate.durationMs,
    gapMs: old?.gapMs ?? 0, gain: old?.gain ?? (data.lineGains as Record<string, number> | undefined)?.[line.id] ?? 1,
    muted: old?.muted ?? false, videoStartMs: line.videoStartMs, videoEndMs: line.videoEndMs,
    audioRefOverride: candidate.audioRef };
  return {
    audioRef: data.audioRef ?? candidate.audioRef,
    durationMs: Math.max(Number(data.durationMs ?? 0), candidate.durationMs),
    segments: old ? segments.map(segment => segment.id === line.id ? take : segment) : [...segments, take],
    generatedLineTexts: { ...(data.generatedLineTexts as Record<string, string> | undefined), [line.id]: line.text },
    generatedLineVoices: { ...(data.generatedLineVoices as Record<string, string> | undefined), [line.id]: candidate.voice },
  };
}

export function voiceInstructionOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>).voiceInstruction;
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value : null;
}
