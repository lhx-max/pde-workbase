import type { ClipEditorTimeline, ClipEditorTimelineClip } from './clip-editor.js';

/** Paint bottom to top: higher track wins, then later timeline start. Ties keep input order. */
export function compareClipPaintOrder(a: { track?: number; start: number }, b: { track?: number; start: number }): number {
  return (a.track ?? 0) - (b.track ?? 0) || a.start - b.start;
}

export function clipCompositionDuration(timeline: Pick<ClipEditorTimeline, 'clips'>): number {
  return Math.max(0, ...timeline.clips.map(c => c.start + c.duration));
}

/** Linear fades, matching native FFmpeg afade. Inspired by Luffy Create audioFade. */
export function clipAudioGain(clip: ClipEditorTimelineClip, time: number): number {
  const local = Math.max(0, Math.min(clip.duration, time - clip.start));
  const fadeIn = Math.min(clip.duration, clip.fadeIn || 0);
  const fadeOut = Math.min(clip.duration, clip.fadeOut || 0);
  return (clip.muted ? 0 : clip.volume ?? 1)
    * (fadeIn ? Math.min(1, local / fadeIn) : 1)
    * (fadeOut ? Math.min(1, (clip.duration - local) / fadeOut) : 1);
}

export function clipPlaybackRate(clip: Pick<ClipEditorTimelineClip, 'playbackRate'>): number {
  return Math.max(0.5, Math.min(2, clip.playbackRate || 1));
}

/** Resolve composition time to source time, including speed and source looping. */
export function clipSourceTime(
  clip: Pick<ClipEditorTimelineClip, 'start' | 'sourceIn' | 'duration' | 'sourceDuration' | 'playbackRate' | 'loop'>,
  time: number,
): number {
  const rate = clipPlaybackRate(clip);
  const local = Math.max(0, Math.min(clip.duration - 0.001, time - clip.start));
  const elapsed = local * rate;
  if (clip.loop && clip.sourceDuration) return (clip.sourceIn + elapsed) % clip.sourceDuration;
  const available = Math.max(0.001, (clip.sourceDuration || clip.sourceIn + clip.duration * rate) - clip.sourceIn);
  return clip.sourceIn + Math.min(elapsed, available - 0.001);
}

export function clipVisualFrame(clip: ClipEditorTimelineClip, time: number) {
  const v = clip.visual || {};
  const duration = Math.min(clip.duration / 2, v.animationDuration ?? 0.5);
  const local = time - clip.start;
  const enter = duration ? Math.max(0, Math.min(1, local / duration)) : 1;
  const leave = duration ? Math.max(0, Math.min(1, (clip.duration - local) / duration)) : 1;
  return { x: (v.x ?? 0) + (v.animation === 'slide' ? (1 - enter) * 10 - (1 - leave) * 10 : 0),
    y: v.y ?? 0, width: v.width ?? 100, height: v.height ?? 100,
    rotation: v.rotation ?? 0,
    opacity: (v.opacity ?? 1) * (v.animation && v.animation !== 'none' ? enter * leave : 1) };
}
