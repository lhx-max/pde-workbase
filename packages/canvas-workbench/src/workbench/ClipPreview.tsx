import React from 'react';
import { clipAudioGain, clipPlaybackRate, clipSourceTime, clipVisualFrame, compareClipPaintOrder } from '@bezier/contracts';
import { projectFileUrl } from '../platform/api-base';
import { timelineDuration, type CanvasClipTimeline, type CanvasTimelineClip } from './clip-timeline';
import { cr } from '../locales/canvas-remainder';

function PreviewMedia({ clip, time, playing, visual, onError }: { clip: CanvasTimelineClip; time: number; playing: boolean; visual?: boolean; onError: () => void }) {
  const ref = React.useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const synchronize = React.useCallback(() => {
    const media = ref.current;
    if (!media) return;
    const desired = clipSourceTime(clip, time);
    if (!playing || Math.abs(media.currentTime - desired) > 0.18) {
      if (Math.abs(media.currentTime - desired) > 0.015) media.currentTime = desired;
    }
    media.volume = Math.min(1, Math.max(0, clipAudioGain(clip, time)));
    media.muted = Boolean(clip.muted);
    media.playbackRate = clipPlaybackRate(clip);
    if (playing) void media.play().catch(onError);
    else media.pause();
  }, [clip, time, playing, onError]);
  React.useEffect(synchronize, [synchronize]);
  const props = { ref, src: projectFileUrl(clip.path), onLoadedData: synchronize, onError, preload: 'auto' as const };
  return visual ? <video {...props} playsInline style={{ objectFit: clip.fit || 'contain' }} aria-label={cr().clipPreview} /> : <audio {...props} />;
}

/** Uses native decoders only for clips intersecting the playhead; no hidden full-library players. */
export function ClipPreview({ timeline, playing, onError, interactive = false, onTransform, onSelect }: { timeline: CanvasClipTimeline; playing: boolean; onError: (message: string) => void; interactive?: boolean; onTransform?: (clipId: string, visual: NonNullable<CanvasTimelineClip['visual']>) => void; onSelect?: (clipId: string) => void }) {
  const [failed, setFailed] = React.useState<string | null>(null);
  const [transformDraft, setTransformDraft] = React.useState<{ clipId: string; visual: NonNullable<CanvasTimelineClip['visual']> } | null>(null);
  const total = timelineDuration(timeline);
  const time = Math.min(timeline.playhead, Math.max(0, total - 0.001));
  const trackEnabled = (clip: CanvasTimelineClip) => {
    const kind = clip.kind === 'audio' ? 'audio' : 'visual';
    const states = (timeline.trackStates || []).filter(track => track.kind === kind);
    const state = states.find(track => track.index === (clip.track || 0));
    return !state?.muted && (!states.some(track => track.solo) || Boolean(state?.solo));
  };
  const active = timeline.clips.filter(clip => trackEnabled(clip) && time >= clip.start && time < clip.start + clip.duration);
  const visuals = active.filter(clip => clip.kind !== 'audio').sort(compareClipPaintOrder);
  const visual = visuals.at(-1);
  const fail = React.useCallback(() => {
    setFailed(visual?.path || 'audio');
    onError(cr().mediaPreviewFail);
  }, [visual?.path, onError]);
  React.useEffect(() => setFailed(null), [visual?.path]);
  function beginTransform(event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>, clip: CanvasTimelineClip, mode: 'move' | 'resize') {
    if (!interactive || playing || clip.id !== timeline.selectedClipId || !onTransform) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget;
    const surface = target.closest<HTMLElement>('.clip-node-preview');
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const startX = event.clientX; const startY = event.clientY;
    const initial = { ...clip.visual, x: clip.visual?.x ?? 0, y: clip.visual?.y ?? 0, width: clip.visual?.width ?? 100, height: clip.visual?.height ?? 100 };
    let latest = initial;
    target.setPointerCapture(event.pointerId);
    const move: EventListener = nativeEvent => {
      const next = nativeEvent as PointerEvent;
      const dx = (next.clientX - startX) / bounds.width * 100;
      const dy = (next.clientY - startY) / bounds.height * 100;
      latest = mode === 'move' ? { ...initial, x: Math.max(-100, Math.min(100, initial.x + dx)), y: Math.max(-100, Math.min(100, initial.y + dy)) }
        : { ...initial, width: Math.max(1, Math.min(200, initial.width + dx)), height: Math.max(1, Math.min(200, initial.height + dy)) };
      setTransformDraft({ clipId: clip.id, visual: latest });
    };
    const cleanup = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', cancel); };
    const finish = () => { cleanup(); setTransformDraft(null); onTransform(clip.id, latest); };
    const cancel = () => { cleanup(); setTransformDraft(null); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', cancel);
  }
  return <>
    {!visuals.length ? <span className="clip-preview-placeholder">{active.length ? cr().audioPreview : timeline.clips.length ? cr().noFrameAtTime : cr().addMediaToEdit}</span> : null}
    {visuals.map(clip => {
      const effective = transformDraft?.clipId === clip.id ? { ...clip, visual: transformDraft.visual } : clip;
      const frame = clipVisualFrame(effective, time); const crop = effective.visual?.crop;
      const adjustments = clip.visual?.adjustments;
      const filter = adjustments ? `brightness(${100 + (adjustments.brightness || 0)}%) contrast(${adjustments.contrast ?? 100}%) saturate(${adjustments.saturation ?? 100}%) blur(${adjustments.blur || 0}px)` : undefined;
      return <div key={clip.id} data-preview-clip={clip.id} data-preview-selected={clip.id === timeline.selectedClipId || undefined} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? cr().previewElement(clip.name) : undefined} onFocus={() => onSelect?.(clip.id)} onPointerDown={event => { onSelect?.(clip.id); beginTransform(event,clip,'move'); }} onKeyDown={event => { if (event.key === 'Enter' || event.code === 'Space') { event.preventDefault(); event.stopPropagation(); onSelect?.(clip.id); } }} style={{ position: 'absolute', left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.width}%`, height: `${frame.height}%`, transform: `rotate(${frame.rotation}deg)`, opacity: frame.opacity, filter, cursor: interactive && clip.id === timeline.selectedClipId && !playing ? 'move' : undefined }}>
        <div style={{ width: '100%', height: '100%', background: 'black', clipPath: crop ? `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)` : undefined }}>
          {clip.kind === 'image' ? <img src={projectFileUrl(clip.path)} alt={clip.name} style={{ objectFit: clip.fit || 'contain' }} onError={fail} /> : <PreviewMedia clip={clip} time={time} playing={playing} visual onError={fail} />}
        </div>
        {interactive && clip.id === timeline.selectedClipId && !playing ? <button type="button" className="clip-preview-transform-handle" aria-label={cr().scaleFrame} onPointerDown={event=>beginTransform(event,clip,'resize')} /> : null}
      </div>;
    })}
    {active.filter(clip => clip.kind === 'audio').map(clip => <PreviewMedia key={clip.id} clip={clip} time={time} playing={playing} onError={fail} />)}
    {failed ? <span className="clip-preview-error" role="status">{cr().mediaPreviewFail}</span> : null}
  </>;
}
