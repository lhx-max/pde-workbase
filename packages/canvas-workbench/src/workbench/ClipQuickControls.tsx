import React from 'react';
import { cq } from '../locales/clip-quick-controls';
import { Button } from '@bezier/components';
import { CLIP_MIN_DURATION, type CanvasTimelineClip } from './clip-timeline';
import styles from './ClipDetailedEditor.styles';

/** Keep the selected source interval, rather than changing which footage is used. */
export function clipSpeedPatch(clip: CanvasTimelineClip, playbackRate: number): Partial<CanvasTimelineClip> {
  if (!Number.isFinite(playbackRate) || playbackRate < 0.5 || playbackRate > 2) return {};
  const duration = clip.duration * (clip.playbackRate || 1) / playbackRate;
  if (duration < CLIP_MIN_DURATION) return {};
  return { playbackRate, duration, fadeIn: Math.min(clip.fadeIn || 0, duration), fadeOut: Math.min(clip.fadeOut || 0, duration) };
}

/** Draft locally while dragging; one write/undo entry on release, including keyboard use. */
export function ClipAdjustmentSlider({ label, value, min, max, step = 1, unit = '', onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const submitted = React.useRef(value);
  React.useEffect(() => { setDraft(value); submitted.current = value; }, [value]);
  const finish = () => { if (draft !== submitted.current) { submitted.current = draft; onCommit(draft); } };
  return <label className={styles.adjustmentSlider}>
    <span>{label}<output>{Number(draft.toFixed(2))}{unit}</output></span>
    <input type="range" aria-label={label} aria-valuetext={`${Number(draft.toFixed(2))}${unit}`} min={min} max={max} step={step} value={draft}
      onChange={event => setDraft(Number(event.target.value))}
      onPointerDown={event => event.currentTarget.setPointerCapture?.(event.pointerId)}
      onPointerUp={finish} onBlur={finish}
      onPointerCancel={() => setDraft(value)}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setDraft(value); }}
      onKeyUp={event => { event.stopPropagation(); if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) finish(); }} />
  </label>;
}

export function ClipQuickControls({ clip, patch, onImageDuration, onPictureInPicture, actions, onToolChange }: {
  clip: CanvasTimelineClip; patch: (values: Partial<CanvasTimelineClip>) => void;
  onImageDuration: (duration: number) => void; onPictureInPicture: () => void;
  actions?: React.ReactNode; onToolChange?: (active: boolean) => void;
}) {
  const [tool, setTool] = React.useState('');
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const choose = (value: string) => { setTool(value); onToolChange?.(Boolean(value)); };
  const back = () => { choose(''); requestAnimationFrame(() => trigger.current?.focus()); };
  const tools = [
    ...(clip.kind !== 'audio' ? [{ id: 'picture', label: cq().picture }] : []),
    ...(clip.kind !== 'image' ? [{ id: 'speed', label: cq().speed }, { id: 'sound', label: cq().sound }] : []),
    ...(clip.kind !== 'audio' ? [{ id: 'motion', label: cq().animation }] : []),
  ];
  const rate = clip.playbackRate || 1;
  const maximumSpeed = Math.min(2, clip.duration * rate / CLIP_MIN_DURATION);
  return <section className={styles.quickControls} data-active={Boolean(tool) || undefined} aria-label={cq().commonTools} onKeyDownCapture={event => { if(event.key==='Escape' && tool) {event.preventDefault();event.stopPropagation();back();} }}>
    {tool ? <div className={styles.toolHeading}><Button variant="ghost" onClick={back}>{cq().backToTools}</Button><strong>{tools.find(item=>item.id===tool)?.label}</strong><Button variant="subtle" onClick={back}>{cq().done}</Button></div> : <p className={styles.selectedMedia} title={clip.name}>{clip.name}<span>{Number(clip.duration.toFixed(2))} {cq().pickTool}</span></p>}
    <div className={styles.mobileTools} role="group" aria-label={cq().clipTools} hidden={Boolean(tool)}>{actions}{tools.map(item => <Button key={item.id} variant="ghost" onClick={event => {trigger.current=event.currentTarget;choose(item.id);}}><svg aria-hidden viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={item.id==='speed'?'M4 17a9 9 0 1 1 16 0M12 13l5-6M7 17h10':item.id==='sound'?'M4 9h4l5-4v14l-5-4H4zM17 8q5 4 0 8':item.id==='motion'?'M7 5l12 7-12 7zM3 8v8':'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7h10v10H7z'} /></svg>{item.label}</Button>)}</div>
    <div className={styles.toolBody} hidden={!tool}>
    {tool === 'picture' ? <>
      <h3>{cq().howShow}</h3>
      <div className={styles.visualChoices}>{(['contain','cover'] as const).map(fit => <Button key={fit} variant="ghost" aria-pressed={(clip.fit || 'contain') === fit} onClick={() => patch({fit})}><svg aria-hidden viewBox="0 0 64 40"><rect x="2" y="2" width="60" height="36" rx="3" fill="none" stroke="currentColor" /><rect x={fit === 'contain' ? 19 : 5} y="5" width={fit === 'contain' ? 26 : 54} height="30" rx="2" fill="currentColor" opacity=".25" /></svg>{fit === 'contain' ? cq().fitContain : cq().fitCover}</Button>)}</div>
      <p className={styles.hint}>{clip.fit === 'cover' ? cq().coverCrops : cq().containLetterbox}</p>
      <Button variant="subtle" onClick={onPictureInPicture}>{cq().pipCorner}</Button>
      <p className={styles.hint}>{cq().dragPreview}</p>
      {clip.kind === 'image' ? <><h3>{cq().howLong}</h3><div className={styles.quickPresets}>{[3,5,10].map(duration => <Button key={duration} variant="ghost" aria-pressed={clip.duration === duration} onClick={() => onImageDuration(duration)}>{duration} {cq().seconds}</Button>)}</div><ClipAdjustmentSlider label={cq().displayDuration} value={clip.duration} min={CLIP_MIN_DURATION} max={Math.max(30, clip.duration)} step={0.1} unit={cq().secondsSpaced} onCommit={onImageDuration} /></> : null}
    </> : null}
    {tool === 'speed' ? <>
      <h3>{cq().slowerOrFaster}</h3>
      <div className={styles.quickPresets}>{[0.5,0.75,1,1.5,2].map(speed => <Button key={speed} variant="ghost" disabled={speed > maximumSpeed} aria-pressed={rate === speed} onClick={() => patch(clipSpeedPatch(clip, speed))}>{speed}×</Button>)}</div>
      <ClipAdjustmentSlider label={cq().playbackSpeed} value={rate} min={0.5} max={maximumSpeed} step={0.05} unit="×" onCommit={speed => patch(clipSpeedPatch(clip, speed))} />
      <div className={styles.sliderEnds}><span>{cq().slowMo}</span><span>{cq().fastForward}</span></div>
      <p className={styles.speedResult}>{cq().current} {rate}{cq().timesPlay} {Number(clip.duration.toFixed(2))} {cq().seconds}</p>
      <p className={styles.hint}>{cq().speedNote}</p>
      <Button variant="ghost" disabled={rate === 1} onClick={() => patch(clipSpeedPatch(clip, 1))}>{cq().resetSpeed}</Button>
    </> : null}
    {tool === 'sound' ? <>
      <h3>{cq().volumeLevel}</h3>
      <ClipAdjustmentSlider label={cq().volume} value={(clip.volume ?? 1) * 100} min={0} max={100} unit="%" onCommit={volume => patch({volume:volume / 100})} />
      <Button variant="subtle" aria-pressed={Boolean(clip.muted)} onClick={() => patch({muted:!clip.muted})}>{clip.muted ? cq().unmute : cq().mute}</Button>
      <h3>{cq().naturalFade}</h3>
      <div className={styles.quickPresets}>{[{name:cq().noFade,duration:0},{name:cq().soft,duration:0.5},{name:cq().gentle,duration:1.5}].map(item => {const fade=Math.min(item.duration,clip.duration / 2); return <Button key={item.name} variant="ghost" aria-pressed={(clip.fadeIn || 0) === fade && (clip.fadeOut || 0) === fade} onClick={() => patch({fadeIn:fade,fadeOut:fade})}>{item.name}</Button>;})}</div>
      <p className={styles.hint}>{cq().fadeHint}</p>
    </> : null}
    {tool === 'motion' ? <>
      <h3>{cq().howAppear}</h3>
      <div className={styles.quickPresets}>{([{id:'none',name:cq().noAnim},{id:'fade',name:cq().fade},{id:'slide',name:cq().slide}] as const).map(item => <Button key={item.id} variant="ghost" aria-pressed={(clip.visual?.animation || 'none') === item.id} onClick={() => patch({visual:{...clip.visual,animation:item.id}})}>{item.name}</Button>)}</div>
      {clip.visual?.animation && clip.visual.animation !== 'none' ? <ClipAdjustmentSlider label={cq().animDuration} value={clip.visual.animationDuration ?? 0.5} min={0.05} max={Math.max(2,clip.visual.animationDuration || 0.5)} step={0.05} unit={cq().secondsSpaced} onCommit={animationDuration => patch({visual:{...clip.visual,animationDuration}})} /> : null}
      <p className={styles.hint}>{cq().previewHint}</p>
    </> : null}
    </div>
  </section>;
}
