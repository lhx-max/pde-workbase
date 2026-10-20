import React from 'react';
import { Button } from '@bezier/components';
import { VIDEO_GENERATION_ASPECTS, VIDEO_GENERATION_RESOLUTIONS, videoGenerationLengths, type ArtifactVideoOptions } from '@bezier/contracts';
import { requireCanvasMenuRenderer, useCanvasUiHost } from '../platform/ui-host';
import { vn } from '../locales/video-node';
import { cr } from '../locales/canvas-remainder';
import { VideoCameraMoveControl } from './VideoCameraMoveControl';

export const VIDEO_GENERATION_MODES = [
  { id: 't2v', labelKey: 'textToVideo', cap: 't2v' },
  { id: 'i2v', labelKey: 'imageToVideo', cap: 'i2v' },
  { id: 'firstlast', labelKey: 'firstLast', cap: 'firstlast' },
] as const;
export function VideoGenerationOptionControls({ value, models, aspects = VIDEO_GENERATION_ASPECTS, lengths, disabled, showMode, showModel = true, onChange }: {
  value: ArtifactVideoOptions;
  models: readonly { id: string; label: string; caps: string[] }[];
  aspects?: readonly string[]; lengths?: readonly number[]; disabled?: boolean; showMode?: boolean;
  showModel?: boolean;
  onChange: (patch: Partial<ArtifactVideoOptions>) => void;
}) {
  const renderMenu = requireCanvasMenuRenderer(useCanvasUiHost());
  const copy = cr();
  const [open, setOpen] = React.useState('');
  const model = value.model || models.find(item => item.caps.includes(value.mode || 't2v'))?.id || 'wanqing-video';
  const choices = videoGenerationLengths(model, lengths);
  const mode = value.mode || 't2v';
  const menu = (id: string, label: string, selected: string, items: { value: string; label: string; disabled?: boolean }[], change: (value: string) => void, blocked = false) => renderMenu({
    open: open === id, onOpenChange: next => setOpen(next ? id : ''), ariaLabel: label, label, side: 'top', selectedValue: selected, onSelectedValueChange: change,
    trigger: <Button variant="ghost" className="minimax-image-chip" disabled={disabled || blocked}>{items.find(item => item.value === selected)?.label || copy.modelUnavailable(selected)}</Button>,
    items: items.map(item => ({ id: item.value, value: item.value, content: item.label, disabled: item.disabled })),
  });
  return <div className="minimax-image-toolbar-left video-node-toolbar-left">
    {showMode && menu('mode', vn().ui.genMode, mode, VIDEO_GENERATION_MODES.map(item => ({ value: item.id, label: vn().labels[item.labelKey], disabled: !models.some(model => model.caps.includes(item.cap)) })), mode => {
      const next = models.find(item => item.id === model && item.caps.includes(mode)) ?? models.find(item => item.caps.includes(mode));
      onChange({ mode: mode as ArtifactVideoOptions['mode'], ...(next ? { model: next.id } : {}) });
    })}
    {showModel && menu('model', vn().labels.videoModel, model, models.map(item => ({ value: item.id, label: item.label, disabled: !item.caps.includes(mode) })), model => onChange({ model, ...(model === 'wanqing-video' ? { duration: 5, resolution: '720p' } : {}) }))}
    <VideoCameraMoveControl value={value.cameraMove} disabled={disabled} onChange={cameraMove => onChange({ cameraMove })}/>
    <span className="minimax-image-divider" aria-hidden="true"/>
    {menu('ratio', vn().ui.aspect, value.ratio || '16:9', [...new Set([value.ratio || '16:9', ...aspects])].map(value => ({ value, label: value })), ratio => onChange({ ratio }), mode !== 't2v')}
    {menu('resolution', vn().ui.resolution, value.resolution || '720p', VIDEO_GENERATION_RESOLUTIONS.map(value => ({ value, label: value, disabled: value === '1080p' && model === 'wanqing-video' })), resolution => onChange({ resolution }))}
    {menu('duration', copy.videoDuration, String(value.duration ?? 5), choices.map(value => ({ value: String(value), label: copy.secondsCount(value) })), duration => onChange({ duration: Number(duration) }))}
  </div>;
}
