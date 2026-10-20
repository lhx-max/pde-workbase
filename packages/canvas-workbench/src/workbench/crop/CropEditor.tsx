'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '@bezier/components';
import { Crop, RotateCcw, LockKeyhole, UnlockKeyhole, ChevronDown, Check, X } from 'lucide-react';
import { useCanvasLocale } from '../../platform/canvas-locale';
import { CanvasSelectionItem } from '../CanvasSelectionItem';
import { cropCopy } from './crop-copy';
import { fitCrop, resizeCrop, setCropDimension, toPixelCrop, type CropHandle, type CropRect } from './crop-geometry';
import { CropExportError, exportCrop } from './export-crop';
import { useCropPanelPosition } from './useCropPanelPosition';
import styles from './CropEditor.module.css';

export type CropEditorProps = {
  src: string; name: string;
  naturalWidth: number; naturalHeight: number; displayWidth: number; displayHeight: number;
  busy?: boolean;
  onCancel: () => void;
  onCommit: (file: File, meta: { width: number; height: number }) => boolean | void | Promise<boolean | void>;
};
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const ratios = [{ id: 'square', label: '1:1', ratio: 1 }, { id: 'landscape', label: '4:3', ratio: 4 / 3 },
  { id: 'portrait', label: '3:4', ratio: 3 / 4 }, { id: 'wide', label: '16:9', ratio: 16 / 9 }, { id: 'tall', label: '9:16', ratio: 9 / 16 }];
const valid = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : Number.isFinite(fallback) && fallback > 0 ? fallback : 1;

/** A source change starts a fresh editing transaction, never reusing an old crop or pending export. */
export default function CropEditor(props: CropEditorProps) {
  return <CropSession key={`${props.src}:${props.naturalWidth}:${props.naturalHeight}`} {...props} />;
}

function CropSession({ src, name, naturalWidth, naturalHeight, displayWidth, displayHeight, busy, onCancel, onCommit }: CropEditorProps) {
  const copy = cropCopy(useCanvasLocale());
  const [bounds, setBounds] = React.useState(() => ({ width: valid(naturalWidth, displayWidth), height: valid(naturalHeight, displayHeight) }));
  const frameWidth = valid(displayWidth, bounds.width), frameHeight = valid(displayHeight, bounds.height);
  const containScale = Math.min(frameWidth / bounds.width, frameHeight / bounds.height);
  const regionWidth = bounds.width * containScale / frameWidth * 100;
  const regionHeight = bounds.height * containScale / frameHeight * 100;
  const [rect, setRect] = React.useState(() => fitCrop(bounds, null));
  const [ratio, setRatio] = React.useState<number | null>(null);
  const [preset, setPreset] = React.useState('free');
  const [pending, setPending] = React.useState(false);
  const [sourceReady, setSourceReady] = React.useState(false);
  const [imageAttempt, setImageAttempt] = React.useState(0);
  const [error, setError] = React.useState('');
  const saving = Boolean(busy || pending);
  const locked = saving || !sourceReady;
  const root = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLElement>(null);
  const submitting = React.useRef(false);
  const controller = React.useRef(new AbortController());
  const gesture = React.useRef<{ handle: CropHandle; id: number; x: number; y: number; sx: number; sy: number; rect: CropRect } | null>(null);
  const position = useCropPanelPosition(root, panel);
  const hintId = React.useId();
  const pixels = toPixelCrop(rect, bounds);

  React.useEffect(() => {
    const session = new AbortController(); controller.current = session;
    const previous = document.activeElement as HTMLElement | null;
    const canvas = root.current?.closest<HTMLElement>('.xy-flow-host');
    panel.current?.focus({ preventScroll: true });
    return () => { session.abort(); if (previous?.isConnected && previous !== document.body && previous !== document.documentElement) previous.focus({ preventScroll: true }); else canvas?.focus({ preventScroll: true }); };
  }, []);

  function choose(id: string, next: number | null) {
    if (locked) return;
    setPreset(id); setRatio(next); setError('');
    if (next !== null) setRect(fitCrop(bounds, next));
  }
  function reset() { if (!locked) { choose('free', null); setRect(fitCrop(bounds, null)); } }
  function start(handle: CropHandle, event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    if (locked || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    const box = root.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    gesture.current = { handle, id: event.pointerId, x: event.clientX, y: event.clientY, sx: bounds.width / box.width, sy: bounds.height / box.height, rect };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event: React.PointerEvent) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId || locked) return;
    event.stopPropagation();
    setRect(resizeCrop(active.rect, bounds, active.handle, (event.clientX - active.x) * active.sx, (event.clientY - active.y) * active.sy, ratio));
  }
  function finish(event: React.PointerEvent, cancelled = false) {
    if (!gesture.current || gesture.current.id !== event.pointerId) return;
    event.stopPropagation();
    if (cancelled) setRect(gesture.current.rect);
    gesture.current = null;
  }
  function keyboard(handle: CropHandle, event: React.KeyboardEvent) {
    if (locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    setRect(current => resizeCrop(current, bounds, handle, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, ratio));
  }
  function keyDown(event: React.KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape' && !saving) { event.preventDefault(); onCancel(); }
  }
  async function save() {
    if (locked || submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    const signal = controller.current.signal;
    try {
      const output = await exportCrop(src, name, rect, bounds, signal);
      if (signal.aborted) return;
      if (await onCommit(output.file, output.meta) === false) throw new Error('Crop save rejected');
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof CropExportError && reason.stage === 'load' ? copy.loadFailed : copy.saveFailed);
    } finally {
      submitting.current = false;
      if (!signal.aborted) setPending(false);
    }
  }
  const platformGroups = [
    { title: copy.video, items: [
      { id: 'video-vertical', label: copy.cover916, text: '9:16', ratio: 9 / 16 },
      { id: 'video-single', label: copy.cover34Single, text: '3:4', ratio: 3 / 4 },
      { id: 'video-double', label: copy.cover34Double, text: '3:4', ratio: 3 / 4 },
      { id: 'video-landscape', label: copy.landscape, text: '16:9', ratio: 16 / 9 },
    ] },
    { title: copy.social, items: [
      { id: 'moments', label: copy.moments, text: '1:1', ratio: 1 },
      { id: 'wechat', label: copy.wechat, text: '2.35:1', ratio: 2.35 },
      { id: 'weibo', label: copy.weibo, text: '4:3', ratio: 4 / 3 },
      { id: 'story', label: copy.story, text: '9:16', ratio: 9 / 16 },
    ] },
  ];
  return <div data-crop-editor className={`${styles.surface} nodrag nopan nowheel`} onPointerDown={e => e.stopPropagation()}
    onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e)}
    onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onKeyDown={keyDown}>
    <div ref={root} data-crop-region className={styles.region} style={{ left: `${(100 - regionWidth) / 2}%`, top: `${(100 - regionHeight) / 2}%`, width: `${regionWidth}%`, height: `${regionHeight}%` }}>
    <img key={imageAttempt} className={styles.preview} src={src} alt="" draggable={false} onError={() => setError(copy.loadFailed)} onLoad={event => {
      const image = event.currentTarget;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        if (image.naturalWidth !== bounds.width || image.naturalHeight !== bounds.height) {
          const decoded = { width: image.naturalWidth, height: image.naturalHeight };
          setBounds(decoded); setRect(fitCrop(decoded, ratio));
        }
        setSourceReady(true); setError('');
      }
    }} />
    <svg className={styles.shade} viewBox={`0 0 ${bounds.width} ${bounds.height}`} preserveAspectRatio="none" aria-hidden="true">
      <path fillRule="evenodd" d={`M0 0H${bounds.width}V${bounds.height}H0Z M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}Z`} />
    </svg>
    <div className={styles.selection} style={{ left: `${rect.x / bounds.width * 100}%`, top: `${rect.y / bounds.height * 100}%`, width: `${rect.width / bounds.width * 100}%`, height: `${rect.height / bounds.height * 100}%` }}>
      <button type="button" className={styles.move} aria-label={copy.move} aria-describedby={hintId} disabled={locked} onPointerDown={e => start('move', e)} onKeyDown={e => keyboard('move', e)} />
      <span className={styles.grid} aria-hidden="true" />
      {handles.map(handle => <button type="button" key={handle} className={styles.handle} data-handle={handle} aria-label={copy[handle]} disabled={locked}
        onPointerDown={e => start(handle, e)} onKeyDown={e => keyboard(handle, e)} />)}
      <span className={styles.badge} aria-hidden="true">{pixels.width} × {pixels.height}</span>
    </div>
    </div>
    {typeof document !== 'undefined' && createPortal(<section ref={panel} role="dialog" aria-modal="false" aria-label={copy.crop} tabIndex={-1}
      className={`${styles.panel} nodrag nopan nowheel`} style={position} aria-busy={locked} onKeyDown={keyDown}>
      <header className={styles.header}><span><Crop size={16} aria-hidden="true" /><strong>{copy.crop}</strong></span>
        <div><Button variant="ghost" size="icon" className={styles.iconButton} aria-label={copy.reset} title={copy.reset} disabled={locked} onClick={reset}><RotateCcw size={15} /></Button>
          <Button variant="ghost" size="icon" className={styles.iconButton} aria-label={copy.cancel} disabled={saving} onClick={onCancel}><X size={16} /></Button></div>
      </header>
      <div className={styles.body}>
        <div className={styles.sectionLabel}><span>{copy.dimensions}</span><span>px</span></div>
        <div className={styles.dimensions}>
          <Dimension label={copy.width} prefix="W" value={pixels.width} disabled={locked} onChange={value => setRect(current => setCropDimension(current, bounds, 'width', value, ratio))} />
          <Button variant="ghost" size="icon" className={styles.lock} aria-pressed={ratio !== null} aria-label={ratio === null ? copy.lock : copy.unlock} title={ratio === null ? copy.lock : copy.unlock} disabled={locked}
            onClick={() => { setRatio(ratio === null ? rect.width / rect.height : null); setPreset(ratio === null ? 'custom' : 'free'); }}>{ratio === null ? <UnlockKeyhole size={15} /> : <LockKeyhole size={15} />}</Button>
          <Dimension label={copy.height} prefix="H" value={pixels.height} disabled={locked} onChange={value => setRect(current => setCropDimension(current, bounds, 'height', value, ratio))} />
        </div>
        <div className={styles.sectionLabel}>{copy.aspect}</div>
        <div className={styles.modes}>{[{ id: 'free', label: copy.free, ratio: null }, { id: 'original', label: copy.original, ratio: bounds.width / bounds.height }].map(item =>
          <CanvasSelectionItem key={item.id} className={styles.mode} selected={preset === item.id} disabled={locked} onClick={() => choose(item.id, item.ratio)}>{item.label}</CanvasSelectionItem>)}</div>
        <div className={styles.ratios}>{ratios.map(item => <CanvasSelectionItem key={item.id} className={styles.ratio} selected={preset === item.id} disabled={locked} onClick={() => choose(item.id, item.ratio)}>
          <span className={styles.ratioIcon} aria-hidden="true" style={{ width: item.ratio >= 1 ? 22 : 22 * item.ratio, height: item.ratio >= 1 ? 22 / item.ratio : 22 }} /><span>{item.label}</span>
        </CanvasSelectionItem>)}</div>
        <details className={styles.platforms}><summary>{copy.more}<ChevronDown size={14} aria-hidden="true" /></summary>
          <div className={styles.platformList}>{platformGroups.map(group => <div key={group.title}><h4>{group.title}</h4>{group.items.map(item => <CanvasSelectionItem
            key={item.id} className={styles.platform} aria-label={`${item.label} ${item.text}`} selected={preset === item.id} disabled={locked} onClick={() => choose(item.id, item.ratio)}>
            <span>{item.label}</span><span>{item.text}</span></CanvasSelectionItem>)}</div>)}</div>
        </details>
        <p id={hintId} className={styles.hint}>{copy.hint}</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!sourceReady && error && <Button variant="ghost" onClick={() => { setError(''); setImageAttempt(value => value + 1); }}>{copy.retry}</Button>}
      </div>
      <footer className={styles.footer}><Button variant="ghost" className={styles.cancel} disabled={saving} onClick={onCancel}>{copy.cancel}</Button>
        <Button variant="primary" className={styles.apply} disabled={locked} onClick={() => { void save(); }}>{!locked && <Check size={14} aria-hidden="true" />}{saving ? copy.processing : !sourceReady ? copy.loading : copy.done}</Button></footer>
    </section>, document.body)}
  </div>;
}

function Dimension({ value, label, prefix, disabled, onChange }: { value: number; label: string; prefix: string; disabled: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const next = Number(draft); if (Number.isFinite(next) && next > 0) onChange(next); setDraft(String(value)); };
  return <label className={styles.field}><span aria-hidden="true">{prefix}</span><Input aria-label={label} value={draft} inputMode="numeric" disabled={disabled}
    onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(value)); }
    }} /></label>;
}
