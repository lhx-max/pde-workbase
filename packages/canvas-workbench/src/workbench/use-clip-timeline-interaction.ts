import React from 'react';
import { editClipGesture, timelineDuration, type CanvasClipTimeline, type ClipGestureMode } from './clip-timeline';

/** One transient gesture, one persisted change. Independent of the canvas host. */
export function useClipTimelineInteraction({ timeline, scaleDuration, onPreview, onCommit, onStart }: {
  timeline: CanvasClipTimeline;
  scaleDuration: number;
  onPreview: (timeline: CanvasClipTimeline | null) => void;
  onCommit: (timeline: CanvasClipTimeline) => void;
  onStart: () => void;
}) {
  const [gesture, setGesture] = React.useState<{ duration: number; mode: ClipGestureMode | 'scrub'; clipId?: string; snap?: number } | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);
  const callbacks = React.useRef({ onPreview, onCommit, onStart });
  callbacks.current = { onPreview, onCommit, onStart };
  React.useEffect(() => () => cleanupRef.current?.(), []);

  function begin(event: React.PointerEvent<HTMLElement>, mode: ClipGestureMode | 'scrub', clipId?: string) {
    if (event.button !== 0 || cleanupRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const surface = event.currentTarget.closest('[data-clip-track], [data-clip-ruler]');
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width) return;
    const target = event.currentTarget;
    (target.closest<HTMLElement>('button,[tabindex]') || target).focus({ preventScroll: true });
    target.setPointerCapture?.(event.pointerId);
    callbacks.current.onStart();
    const original = { ...timeline, ...(clipId ? { selectedClipId: clipId } : {}) };
    const duration = scaleDuration;
    const ratio = duration / rect.width;
    const originX = event.clientX;
    let latest = original;
    let frame = 0;
    const metadata = { duration, mode, clipId };
    const update = (clientX: number, shift: boolean, clientY?: number) => {
      let snap: number | undefined;
      if (mode === 'scrub') {
        latest = { ...original, playhead: Math.max(0, Math.min(timelineDuration(original), (clientX - rect.left) * ratio)) };
      } else if (clipId) {
        const edited = editClipGesture(original, clipId, mode, (clientX - originX) * ratio, shift ? 0 : 6 * ratio);
        latest = edited.timeline;
        snap = edited.snap;
        if (mode === 'move' && clientY !== undefined && document.elementFromPoint) {
          const track = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-track-index]');
          const clip = latest.clips.find(entry => entry.id === clipId)!;
          if (track && track.dataset.trackLocked !== 'true' && track.dataset.trackKind === (clip.kind === 'audio' ? 'audio' : 'visual')) {
            latest = { ...latest, clips: latest.clips.map(entry => entry.id === clipId ? { ...entry, track: Number(track.dataset.trackIndex) } : entry) };
          }
        }
        if (mode !== 'move') {
          const clip = latest.clips.find(entry => entry.id === clipId)!;
          latest = { ...latest, playhead: mode === 'trim-start' ? clip.start : Math.max(clip.start, clip.start + clip.duration - 0.01) };
        }
      }
      setGesture({ ...metadata, snap });
      callbacks.current.onPreview(latest);
    };
    update(event.clientX, event.shiftKey);
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
      cleanupRef.current = null;
    };
    const finish = (save: boolean) => {
      cleanup();
      setGesture(null);
      if (save) callbacks.current.onCommit(latest);
      callbacks.current.onPreview(null);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(e.clientX, e.shiftKey, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      update(e.clientX, e.shiftKey, e.clientY);
      finish(true);
    };
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
  }
  return { gesture, begin };
}
