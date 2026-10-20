import { clipCompositionDuration, type ClipEditorExportFormat, type ClipEditorVisual } from '@bezier/contracts';
import { cr } from '../locales/canvas-remainder';
export type CanvasClipMediaKind = 'image' | 'video' | 'audio';

export type CanvasTimelineClip = {
  id: string;
  kind: CanvasClipMediaKind;
  name: string;
  path: string;
  mimeType: string;
  sourceNodeId?: string;
  /** Position on the composition timeline, in seconds. */
  start: number;
  /** In-point inside the source media, in seconds. Images always use zero. */
  sourceIn: number;
  /** Visible/audible length on the composition timeline, in seconds. */
  duration: number;
  /** Full source length when metadata is available. */
  sourceDuration?: number;
  volume?: number;
  muted?: boolean;
  fit?: 'contain' | 'cover';
  track?: number;
  visual?: ClipEditorVisual;
  fadeIn?: number;
  fadeOut?: number;
  playbackRate?: number;
  loop?: boolean;
};

export type CanvasClipTimeline = {
  version: 1;
  clips: CanvasTimelineClip[];
  selectedClipId?: string;
  playhead: number;
  width?: number;
  height?: number;
  /** Preferred output format; the export panel uses this as its initial value. */
  exportFormat?: ClipEditorExportFormat;
  videoTracks?: number;
  audioTracks?: number;
  markers?: { id: string; time: number; label: string }[];
  trackStates?: { kind: 'visual' | 'audio'; index: number; locked?: boolean; muted?: boolean; solo?: boolean }[];
};

export const CLIP_MIN_DURATION = 0.25;
export const CLIP_DEFAULT_IMAGE_DURATION = 3;
export const CLIP_DEFAULT_MEDIA_DURATION = 5;

export function createEmptyClipTimeline(): CanvasClipTimeline {
  return { version: 1, clips: [], playhead: 0 };
}

export function clipTrack(kind: CanvasClipMediaKind): 'visual' | 'audio' {
  return kind === 'audio' ? 'audio' : 'visual';
}

/** The detailed editor only renders real tracks. A virtual drop row is the sole empty row. */
export function populatedTimelineTrackCount(timeline: CanvasClipTimeline, kind: 'visual' | 'audio'): number {
  return timeline.clips.reduce((count, clip) => (
    clipTrack(clip.kind) === kind ? Math.max(count, (clip.track || 0) + 1) : count
  ), 0);
}

/**
 * Legacy timelines could retain their old track capacity after a clip was removed.
 * Keep gaps below a populated track intact, but discard only empty trailing tracks
 * and controls that belonged to them.
 */
export function pruneEmptyTimelineTracks(timeline: CanvasClipTimeline): CanvasClipTimeline {
  const videoTracks = populatedTimelineTrackCount(timeline, 'visual');
  const audioTracks = populatedTimelineTrackCount(timeline, 'audio');
  const trackStates = timeline.trackStates?.filter(state => (
    state.index >= 0 && state.index < (state.kind === 'visual' ? videoTracks : audioTracks)
  ));
  const changed = (timeline.videoTracks !== undefined && timeline.videoTracks !== videoTracks)
    || (timeline.audioTracks !== undefined && timeline.audioTracks !== audioTracks)
    || (timeline.trackStates !== undefined && trackStates!.length !== timeline.trackStates.length);
  if (!changed) return timeline;
  return {
    ...timeline,
    ...(timeline.videoTracks === undefined ? {} : { videoTracks }),
    ...(timeline.audioTracks === undefined ? {} : { audioTracks }),
    ...(timeline.trackStates === undefined ? {} : { trackStates }),
  };
}

export function timelineDuration(timeline: CanvasClipTimeline): number {
  return clipCompositionDuration(timeline);
}

export function appendClip(timeline: CanvasClipTimeline, input: Omit<CanvasTimelineClip, 'start' | 'sourceIn'>): CanvasClipTimeline {
  const track = clipTrack(input.kind);
  const start = timeline.clips
    .filter(clip => clipTrack(clip.kind) === track && (clip.track || 0) === (input.track || 0))
    .reduce((maximum, clip) => Math.max(maximum, clip.start + clip.duration), 0);
  const clip: CanvasTimelineClip = { ...input, start, sourceIn: 0 };
  return { ...timeline, clips: [...timeline.clips, clip], selectedClipId: clip.id };
}

export function moveClip(timeline: CanvasClipTimeline, clipId: string, start: number): CanvasClipTimeline {
  return {
    ...timeline,
    clips: timeline.clips.map(clip => clip.id === clipId ? { ...clip, start: Math.max(0, start) } : clip),
    selectedClipId: clipId,
  };
}

export function trimClip(
  timeline: CanvasClipTimeline,
  clipId: string,
  edge: 'start' | 'end',
  delta: number,
): CanvasClipTimeline {
  return {
    ...timeline,
    clips: timeline.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      if (edge === 'start') {
        const maximum = clip.duration - CLIP_MIN_DURATION;
        const bounded = Math.max(-clip.start, Math.min(maximum, delta));
        const rate = clip.playbackRate || 1;
        const sourceBounded = clip.kind === 'image' ? bounded : Math.max(-clip.sourceIn / rate, bounded);
        const sourceIn = clip.kind === 'image' ? 0 : clip.sourceIn + sourceBounded * rate;
        return {
          ...clip,
          start: clip.start + sourceBounded,
          sourceIn: clip.loop && clip.sourceDuration ? sourceIn % clip.sourceDuration : sourceIn,
          duration: clip.duration - sourceBounded,
        };
      }
      const sourceRemaining = clip.kind === 'image' || clip.sourceDuration === undefined
        ? Number.POSITIVE_INFINITY
        : clip.loop ? Number.POSITIVE_INFINITY
        : (clip.sourceDuration - clip.sourceIn) / (clip.playbackRate || 1) - clip.duration;
      const bounded = Math.max(-(clip.duration - CLIP_MIN_DURATION), Math.min(sourceRemaining, delta));
      return { ...clip, duration: clip.duration + bounded };
    }),
    selectedClipId: clipId,
  };
}

export function splitClip(timeline: CanvasClipTimeline, clipId: string, at: number, nextId: string): CanvasClipTimeline {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip || at <= clip.start + CLIP_MIN_DURATION || at >= clip.start + clip.duration - CLIP_MIN_DURATION) return timeline;
  const leftDuration = at - clip.start;
  const right: CanvasTimelineClip = {
    ...clip,
    id: nextId,
    start: at,
    sourceIn: clip.kind === 'image' ? 0 : clip.loop && clip.sourceDuration
      ? (clip.sourceIn + leftDuration * (clip.playbackRate || 1)) % clip.sourceDuration
      : clip.sourceIn + leftDuration * (clip.playbackRate || 1),
    duration: clip.duration - leftDuration,
  };
  return {
    ...timeline,
    clips: timeline.clips.flatMap(item => item.id === clipId ? [{ ...item, duration: leftDuration }, right] : [item]),
    selectedClipId: right.id,
  };
}

export function duplicateClip(timeline: CanvasClipTimeline, clipId: string, nextId: string): CanvasClipTimeline {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) return timeline;
  const copy = { ...clip, id: nextId, start: clip.start + clip.duration, name: cr().clipCopy(clip.name) };
  return { ...timeline, clips: [...timeline.clips, copy], selectedClipId: copy.id };
}

export function removeClip(timeline: CanvasClipTimeline, clipId: string): CanvasClipTimeline {
  return pruneEmptyTimelineTracks({
    ...timeline,
    clips: timeline.clips.filter(clip => clip.id !== clipId),
    selectedClipId: timeline.selectedClipId === clipId ? undefined : timeline.selectedClipId,
  });
}

/** Remove one clip and close the exact gap for material starting after it. */
export function rippleRemoveClip(timeline: CanvasClipTimeline, clipId: string): CanvasClipTimeline {
  const removed = timeline.clips.find(clip => clip.id === clipId);
  if (!removed) return timeline;
  const end = removed.start + removed.duration;
  return pruneEmptyTimelineTracks({
    ...timeline,
    clips: timeline.clips
      .filter(clip => clip.id !== clipId)
      .map(clip => clip.start >= end ? { ...clip, start: Math.max(0, clip.start - removed.duration) } : clip),
    markers: (timeline.markers || []).map(marker => marker.time >= end ? { ...marker, time: Math.max(0, marker.time - removed.duration) } : marker),
    selectedClipId: undefined,
  });
}

/** Centisecond display, rounded before carrying into minutes. */
export function formatClipTime(seconds: number, precise = true): string {
  const ticks = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 100);
  const minutes = Math.floor(ticks / 6000);
  const whole = Math.floor(ticks / 100) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}${precise ? `.${String(ticks % 100).padStart(2, '0')}` : ''}`;
}

export function clipRuler(duration: number) {
  const extent = Math.max(10, duration * 1.15);
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(value => extent / value <= 8) || Math.ceil(extent / 480) * 60;
  const end = Math.ceil(extent / step) * step;
  return { duration: end, step, marks: Array.from({ length: Math.round(end / step) + 1 }, (_, i) => i * step) };
}

export type ClipGestureMode = 'move' | 'trim-start' | 'trim-end';

/** Snap screen-distance-near boundaries; always apply source/minimum bounds afterwards. */
export function editClipGesture(timeline: CanvasClipTimeline, clipId: string, mode: ClipGestureMode, delta: number, threshold = 0): { timeline: CanvasClipTimeline; snap?: number } {
  const clip = timeline.clips.find(entry => entry.id === clipId);
  if (!clip) return { timeline };
  const targets = [0, timeline.playhead, ...timeline.clips.filter(entry => entry.id !== clipId).flatMap(entry => [entry.start, entry.start + entry.duration])];
  const edges = mode === 'move' ? [clip.start + delta, clip.start + clip.duration + delta]
    : [mode === 'trim-start' ? clip.start + delta : clip.start + clip.duration + delta];
  let adjustment = threshold;
  let snap: number | undefined;
  for (const target of targets) for (const edge of edges) {
    if (Math.abs(target - edge) < Math.abs(adjustment)) { adjustment = target - edge; snap = target; }
  }
  const adjusted = delta + (snap === undefined ? 0 : adjustment);
  const next = mode === 'move' ? moveClip(timeline, clipId, clip.start + adjusted)
    : trimClip(timeline, clipId, mode === 'trim-start' ? 'start' : 'end', adjusted);
  const edited = next.clips.find(entry => entry.id === clipId)!;
  if (snap !== undefined && Math.abs(edited.start - snap) > 0.001 && Math.abs(edited.start + edited.duration - snap) > 0.001) snap = undefined;
  return { timeline: next, snap };
}
