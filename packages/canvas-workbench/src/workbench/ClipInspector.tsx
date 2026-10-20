import React from 'react';
import { ci } from '../locales/clip-inspector';
import { Button, Input } from '@bezier/components';
import type { ClipEditorExportFormat } from '@bezier/contracts';
import { trimClip, type CanvasClipTimeline, type CanvasTimelineClip } from './clip-timeline';
import styles from './ClipDetailedEditor.styles';
import { ClipQuickControls, clipSpeedPatch } from './ClipQuickControls';
import { Icon } from '../ui/Icon';

export function NumberField({ label, value, min = 0, max, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className={styles.field}><span title={label}>{label}</span><Input key={value} aria-label={label} type="number" min={min} max={max} step="0.01" defaultValue={Number(value.toFixed(2))}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={event => {
      const next = event.currentTarget.valueAsNumber;
      if (Number.isFinite(next) && next >= min && (max === undefined || next <= max)) onChange(next);
      else event.currentTarget.value = String(Number(value.toFixed(2)));
    }} /></label>;
}

export const ClipInspector = React.memo(function ClipInspector({ timeline, onChange, actions, showQuickControls = true }: { timeline: CanvasClipTimeline; onChange: (timeline: CanvasClipTimeline) => void; actions?: React.ReactNode; showQuickControls?: boolean }) {
  const clip = timeline.clips.find(entry => entry.id === timeline.selectedClipId);
  const canvasWidth = timeline.width || 1280;
  const canvasHeight = timeline.height || 720;
  const ratioOptions = [{ label: ci().landscape, ratio: 16 / 9 }, { label: ci().portrait, ratio: 9 / 16 }, { label: ci().square, ratio: 1 }] as const;
  const currentRatio = canvasWidth / canvasHeight;
  const activeRatio = ratioOptions.reduce((closest, option) => Math.abs(option.ratio - currentRatio) < Math.abs(closest.ratio - currentRatio) ? option : closest);
  const resolution = activeRatio.ratio === 1 ? canvasWidth : Math.min(canvasWidth, canvasHeight);
  const setOutputSize = (ratio: number, nextResolution: number) => {
    const width = ratio >= 1 ? Math.round(nextResolution * ratio) : nextResolution;
    const height = ratio >= 1 ? nextResolution : Math.round(nextResolution / ratio);
    onChange({ ...timeline, width, height });
  };
  const [activeTool, setActiveTool] = React.useState(false);
  React.useEffect(()=>setActiveTool(false),[clip?.id]);
  const patch = (values: Partial<CanvasTimelineClip>) => clip && onChange({ ...timeline, clips: timeline.clips.map(entry => entry.id === clip.id ? { ...entry, ...values } : entry) });
  const patchAdjustments = (values: NonNullable<NonNullable<CanvasTimelineClip['visual']>['adjustments']>) => clip && patch({
    visual: { ...clip.visual, adjustments: { ...clip.visual?.adjustments, ...values } },
  });
  return <aside className={styles.inspector} aria-label={ci().clipParams}>
    <div className={styles.panelHeading}><strong>{clip ? ci().adjustThisClip : ci().videoSettings}</strong><span>{clip ? clip.kind === 'audio' ? ci().audio : clip.kind === 'image' ? ci().image : ci().video : ci().editableAnytime}</span></div>
    {clip && showQuickControls ? <ClipQuickControls key={clip.id} clip={clip} patch={patch} actions={actions} onToolChange={setActiveTool} onImageDuration={duration => onChange(trimClip(timeline,clip.id,'end',duration-clip.duration))} onPictureInPicture={() => patch({track:Math.min(7,Math.max(...timeline.clips.filter(c=>c.kind!=='audio').map(c=>c.track || 0),0)+1),visual:{...clip.visual,x:65,y:60,width:30,height:30}})} /> : null}
    <div className={styles.preciseSettings} hidden={showQuickControls && activeTool}>
    {!clip ? <section className={styles.outputSettings} aria-label={ci().videoSize}><strong>{ci().videoSize}</strong>
    <div className={styles.ratioChoices} role="group" aria-label={ci().commonSizes}>{ratioOptions.map(option => <Button key={option.label} variant="ghost" aria-pressed={option === activeRatio} onClick={() => setOutputSize(option.ratio, resolution)}><span aria-hidden style={{aspectRatio:String(option.ratio)}} />{option.label}</Button>)}</div>
    <label className={styles.field}><span>{ci().resolution}</span><select aria-label={ci().resolution} value={resolution} onChange={event => setOutputSize(activeRatio.ratio, Number(event.target.value))}><option value="720">720p</option><option value="1080">1080p</option><option value="1440">2K · 1440p</option></select></label>
    <label className={styles.field}><span>{ci().format}</span><select aria-label={ci().outputFormat} value={timeline.exportFormat || 'mp4'} onChange={event => onChange({ ...timeline, exportFormat: event.target.value as ClipEditorExportFormat })}><option value="mp4">{ci().videoMp4}</option><option value="png">{ci().framePng}</option><option value="webp">{ci().frameWebp}</option></select></label>
    </section> : null}
    {clip ? <>
      {clip.kind !== 'image' ? <>
        <details className={styles.propertyGroup} open={clip.kind === 'audio'}><summary>{ci().soundAndSpeed}</summary><div className={styles.fieldGrid}>
        <NumberField label={ci().sourceInSec} value={clip.sourceIn} max={clip.sourceDuration ? clip.loop ? Math.max(0, clip.sourceDuration - 0.01) : Math.max(0, clip.sourceDuration - clip.duration * (clip.playbackRate || 1)) : undefined} onChange={sourceIn => patch({ sourceIn })} />
        <NumberField label={ci().playbackSpeed} value={clip.playbackRate || 1} min={0.5} max={2} onChange={playbackRate => patch(clipSpeedPatch(clip, playbackRate))} />
        <NumberField label={ci().volumePct} value={(clip.volume ?? 1) * 100} max={100} onChange={volume => patch({ volume: volume / 100 })} />
        <NumberField label={ci().fadeInSec} value={clip.fadeIn || 0} max={clip.duration} onChange={fadeIn => patch({ fadeIn })} />
        <NumberField label={ci().fadeOutSec} value={clip.fadeOut || 0} max={clip.duration} onChange={fadeOut => patch({ fadeOut })} />
        </div>
        <Button variant="ghost" aria-pressed={Boolean(clip.muted)} onClick={() => patch({ muted: !clip.muted })}>{clip.muted ? ci().unmute : ci().muteClip}</Button>
        <Button variant="ghost" aria-pressed={Boolean(clip.loop)} onClick={() => patch({ loop: !clip.loop })}>{clip.loop ? ci().unloop : ci().loop}</Button>
        </details>
      </> : null}
      {clip.kind !== 'audio' ? <>
        <details className={styles.propertyGroup}><summary>{ci().frameAdjust}</summary><Button variant="ghost" size="icon" className={styles.groupReset} aria-label={ci().resetTransform} title={ci().resetTransform} onClick={() => patch({ visual: { ...clip.visual, adjustments: undefined } })}><Icon name="refresh" size={14} /></Button><div className={styles.fieldGrid}>
        <NumberField label={ci().brightness} value={clip.visual?.adjustments?.brightness || 0} min={-100} max={100} onChange={brightness => patchAdjustments({ brightness })} />
        <NumberField label={ci().contrast} value={clip.visual?.adjustments?.contrast ?? 100} max={200} onChange={contrast => patchAdjustments({ contrast })} />
        <NumberField label={ci().saturation} value={clip.visual?.adjustments?.saturation ?? 100} max={200} onChange={saturation => patchAdjustments({ saturation })} />
        <NumberField label={ci().blurPx} value={clip.visual?.adjustments?.blur || 0} max={20} onChange={blur => patchAdjustments({ blur })} />
        </div></details>
        <details className={styles.propertyGroup}><summary>{ci().positionSize}</summary>
        <p className={styles.hint}>{ci().dragPreviewHint}</p>
        <div className={styles.fieldGrid}>{(['x','y','width','height','rotation','opacity'] as const).map((key,index) => <NumberField key={key} label={[ci().posX,ci().posY,ci().widthPct,ci().heightPct,ci().rotationDeg,ci().opacityPct][index]!} value={key === 'opacity' ? (clip.visual?.opacity ?? 1)*100 : clip.visual?.[key] ?? (key==='width'||key==='height' ? 100 : 0)} min={key==='rotation' ? -180 : key==='x'||key==='y' ? -100 : key==='width'||key==='height' ? 1 : 0} max={key==='rotation' ? 180 : key==='width'||key==='height' ? 200 : 100} onChange={value => patch({ visual: { ...clip.visual, [key]: key==='opacity' ? value/100 : value } })} />)}</div></details>
        <details className={styles.propertyGroup}><summary>{ci().crop}</summary><div className={styles.fieldGrid}>{(['top','right','bottom','left'] as const).map((key,index)=><NumberField key={key} label={ci().cropSide([ci().top, ci().right, ci().bottom, ci().left][index]!)} value={clip.visual?.crop?.[key] || 0} max={45} onChange={value=>patch({ visual: { ...clip.visual, crop: { top:0,right:0,bottom:0,left:0,...clip.visual?.crop,[key]:value } } })} />)}</div></details>
        <details className={styles.propertyGroup}><summary>{ci().animTransition}</summary><Button variant="ghost" size="icon" className={styles.groupReset} aria-label={ci().resetEffects} title={ci().resetEffects} onClick={()=>patch({visual:undefined})}><Icon name="refresh" size={14} /></Button>
        <label className={styles.field}><span>{ci().inOutAnim}</span><select aria-label={ci().inOutAnim} value={clip.visual?.animation || 'none'} onChange={event=>patch({visual:{...clip.visual,animation:event.target.value as 'none'|'fade'|'slide'}})}><option value="none">{ci().noAnim}</option><option value="fade">{ci().fade}</option><option value="slide">{ci().slide}</option></select></label>
        <NumberField label={ci().animDuration} value={clip.visual?.animationDuration ?? 0.5} min={0.05} max={10} onChange={animationDuration=>patch({visual:{...clip.visual,animationDuration}})} />
        <Button variant="ghost" disabled={!timeline.clips.some(c=>c.kind !== 'audio' && c.id !== clip.id && (c.track||0)===(clip.track||0) && c.start<clip.start)} onClick={()=>{
          const previous=timeline.clips.filter(c=>c.kind !== 'audio' && c.id!==clip.id && (c.track||0)===(clip.track||0) && c.start<clip.start).sort((a,b)=>b.start-a.start)[0];
          if (!previous) return;
          const overlap=Math.min(clip.visual?.animationDuration ?? 0.5,clip.duration/2,previous.duration/2);
          patch({start:previous.start+previous.duration-overlap,visual:{...clip.visual,animation:'fade',animationDuration:overlap}});
        }}>{ci().crossfadePrev}</Button>
        <p className={styles.hint}>{ci().crossfadeHint}</p>
        </details>
      </> : null}
      <p className={styles.hint}>{clip.sourceDuration ? ci().sourceDuration(clip.sourceDuration.toFixed(2)) : clip.kind === 'image' ? ci().imageDurationFree : ci().readingDuration}<br />{ci().autoSave}</p>
    </> : null}
    </div>
  </aside>;
});
