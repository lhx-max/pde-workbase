'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from './button';
import styles from './canvas-view-toolbar.module.css';

export type CanvasBackgroundPattern = 'dots' | 'grid' | 'none';
export type CanvasBackgroundTone = 'default' | 'warm-gray' | 'cool-gray';

export interface CanvasTidyAction {
  id: string;
  label: string;
  description?: string;
  icon: 'connections' | 'category' | 'revert';
  disabled?: boolean;
  onSelect: () => void;
}

export interface CanvasViewToolbarProps {
  ariaLabel?: string;
  className?: string;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  zoomPresets?: readonly number[];
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomTo: (zoom: number) => void;
  onFitView: () => void;
  /** Omitted groups are not rendered (e.g. a drawing editor only needs zoom/history). */
  tidyActions?: readonly CanvasTidyAction[];
  background?: CanvasBackgroundPattern;
  tone?: string;
  onBackgroundChange?: (pattern: CanvasBackgroundPattern) => void;
  onToneChange?: (tone: CanvasBackgroundTone) => void;
  connectionsVisible?: boolean;
  onConnectionsVisibleChange?: (visible: boolean) => void;
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  disabled?: boolean;
  labels?: Partial<{
    zoomOut: string; zoomIn: string; zoomOptions: string; fitView: string;
    undo: string; redo: string; zoomValue: (percent: number) => string;
    tidy: string; displaySettings: string; canvasSettings: string; closeSettings: string;
    backgroundStyle: string; backgroundColor: string;
    dots: string; grid: string; none: string; defaultTone: string; warmGray: string; coolGray: string;
    hideConnections: string; showConnections: string;
  }>;
}

type ToolbarIconName = 'tidy' | 'minus' | 'plus' | 'chevron' | 'grid' | 'connections' | 'category' | 'revert' | 'check' | 'close' | 'undo' | 'redo';

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const path = {
    tidy: <><rect x="3" y="3" width="14" height="14" rx="1.2" /><path d="M9 12.5h2M7.5 10h5M8.5 7.5h3" /></>,
    minus: <path d="M4.2 10h11.6" />,
    plus: <path d="M10 4.2v11.6M4.2 10h11.6" />,
    chevron: <path d="m6.5 8 3.5 3.5L13.5 8" />,
    grid: <><rect x="3" y="3" width="5.5" height="5.5" rx=".7" /><rect x="11.5" y="3" width="5.5" height="5.5" rx=".7" /><rect x="3" y="11.5" width="5.5" height="5.5" rx=".7" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx=".7" /></>,
    connections: <><circle cx="5" cy="5" r="2" /><circle cx="15" cy="10" r="2" /><circle cx="5" cy="15" r="2" /><path d="m6.7 6.1 6.6 2.8M6.7 13.9l6.6-2.8" /></>,
    category: <path d="M4 4.5h12v11H4zM7 4.5v11m3-8h3" />,
    revert: <path d="M6.2 7.2H3.5V4.5m0 2.7A6.5 6.5 0 1 1 5.4 14" />,
    check: <path d="m5 10.1 3.1 3.1L15.2 6" />,
    close: <path d="m5 5 10 10M15 5 5 15" />,
    undo: <path d="m7 4-4 4 4 4M3 8h8a5 5 0 0 1 5 5v3" />,
    redo: <path d="m13 4 4 4-4 4m4-4H9a5 5 0 0 0-5 5v3" />,
  }[name];
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

const PATTERNS: ReadonlyArray<{ value: CanvasBackgroundPattern; label: 'dots' | 'grid' | 'none' }> = [
  { value: 'dots', label: 'dots' },
  { value: 'grid', label: 'grid' },
  { value: 'none', label: 'none' },
];
const TONES: ReadonlyArray<{ value: CanvasBackgroundTone; label: 'defaultTone' | 'warmGray' | 'coolGray' }> = [
  { value: 'default', label: 'defaultTone' },
  { value: 'warm-gray', label: 'warmGray' },
  { value: 'cool-gray', label: 'coolGray' },
];

function AppearancePreview({ pattern, tone }: { pattern: CanvasBackgroundPattern; tone: string }) {
  return <span className={styles.preview} data-pattern={pattern} data-tone={tone} aria-hidden="true" />;
}

export function CanvasViewToolbar({
  ariaLabel = 'Board view controls',
  className,
  zoom,
  minZoom,
  maxZoom,
  zoomPresets = [50, 100, 200, 300, 400],
  onZoomOut,
  onZoomIn,
  onZoomTo,
  onFitView,
  tidyActions,
  background = 'dots',
  tone = 'default',
  onBackgroundChange,
  onToneChange,
  connectionsVisible,
  onConnectionsVisibleChange,
  history,
  disabled = false,
  labels,
}: CanvasViewToolbarProps) {
  const copy = {
    zoomOut: 'Zoom out', zoomIn: 'Zoom in', zoomOptions: 'Zoom options', fitView: 'Fit to canvas',
    undo: 'Undo', redo: 'Redo', zoomValue: (percent: number) => `Zoom ${percent}%. Open zoom menu`,
    tidy: 'Tidy canvas', displaySettings: 'Canvas display', canvasSettings: 'Canvas settings', closeSettings: 'Close canvas settings',
    backgroundStyle: 'Background style', backgroundColor: 'Background color',
    dots: 'Dots', grid: 'Grid', none: 'None', defaultTone: 'Default', warmGray: 'Warm gray', coolGray: 'Cool gray',
    hideConnections: 'Hide connections', showConnections: 'Show connections', ...labels,
  };
  const [open, setOpen] = useState<'tidy' | 'zoom' | 'appearance' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as globalThis.Node)) setOpen(null);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const active = open;
      setOpen(null);
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-canvas-menu-trigger="${active}"]`)?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(null);
    action();
  };
  const scale = Math.round(zoom * 100);
  const toggle = (menu: 'tidy' | 'zoom' | 'appearance') => setOpen(current => current === menu ? null : menu);
  return <div ref={rootRef} className={`${styles.toolbar}${className ? ` ${className}` : ''}`} role="toolbar" aria-label={ariaLabel}>
    {Boolean(tidyActions?.length) && <><div className={styles.anchor}>
      <Button variant="ghost" size="icon" className={open === 'tidy' ? styles.active : ''} aria-label={copy.tidy} aria-haspopup="menu" aria-expanded={open === 'tidy'} data-canvas-menu-trigger="tidy" onClick={() => toggle('tidy')}><ToolbarIcon name="tidy" /></Button>
      {open === 'tidy' && <div className={`${styles.popover} ${styles.tidyMenu}`} role="menu" aria-label={copy.tidy}>
        {tidyActions?.map((action, index) => <div key={action.id}>
          {index > 0 && action.icon === 'revert' && <div className={styles.menuSeparator} role="separator" />}
          <Button variant="ghost" role="menuitem" className={styles.tidyAction} disabled={action.disabled} onClick={() => choose(action.onSelect)}><ToolbarIcon name={action.icon} /><span><b>{action.label}</b>{action.description && <small>{action.description}</small>}</span></Button>
        </div>)}
      </div>}
    </div>
    <span className={styles.divider} aria-hidden="true" /></>}
    <Button variant="ghost" size="icon" onClick={onZoomOut} disabled={disabled || zoom <= minZoom + .001} aria-label={copy.zoomOut} title={copy.zoomOut}><ToolbarIcon name="minus" /></Button>
    <div className={styles.anchor}>
      <Button variant="ghost" className={styles.zoomValue} disabled={disabled} aria-label={copy.zoomValue(scale)} aria-haspopup="menu" aria-expanded={open === 'zoom'} data-canvas-menu-trigger="zoom" onClick={() => toggle('zoom')}><span>{scale}%</span><ToolbarIcon name="chevron" /></Button>
      {open === 'zoom' && <div className={`${styles.popover} ${styles.zoomMenu}`} role="menu" aria-label={copy.zoomOptions}>
        <Button variant="ghost" role="menuitem" onClick={() => choose(onZoomOut)} disabled={disabled || zoom <= minZoom + .001}><ToolbarIcon name="minus" />{copy.zoomOut}</Button>
        <Button variant="ghost" role="menuitem" onClick={() => choose(onZoomIn)} disabled={disabled || zoom >= maxZoom - .001}><ToolbarIcon name="plus" />{copy.zoomIn}</Button>
        <div className={styles.menuSeparator} role="separator" />
        <Button variant="ghost" role="menuitem" disabled={disabled} onClick={() => choose(onFitView)}>{copy.fitView}</Button>
        <div className={styles.menuSeparator} role="separator" />
        {zoomPresets.map(value => <Button key={value} variant="ghost" role="menuitem" disabled={disabled || value / 100 < minZoom || value / 100 > maxZoom} onClick={() => choose(() => onZoomTo(value / 100))}>{value}%</Button>)}
      </div>}
    </div>
    <Button variant="ghost" size="icon" onClick={onZoomIn} disabled={disabled || zoom >= maxZoom - .001} aria-label={copy.zoomIn} title={copy.zoomIn}><ToolbarIcon name="plus" /></Button>
    {history && <>
      <span className={styles.divider} aria-hidden="true" />
      <Button variant="ghost" size="icon" disabled={disabled || !history.canUndo} onClick={history.onUndo} aria-label={copy.undo} title={copy.undo}><ToolbarIcon name="undo" /></Button>
      <Button variant="ghost" size="icon" disabled={disabled || !history.canRedo} onClick={history.onRedo} aria-label={copy.redo} title={copy.redo}><ToolbarIcon name="redo" /></Button>
    </>}
    {onBackgroundChange && onToneChange && <><span className={styles.divider} aria-hidden="true" />
    <div className={styles.anchor}>
      <Button variant="ghost" size="icon" className={open === 'appearance' ? styles.active : ''} aria-label={copy.displaySettings} aria-haspopup="dialog" aria-expanded={open === 'appearance'} data-canvas-menu-trigger="appearance" onClick={() => toggle('appearance')}><ToolbarIcon name="grid" /></Button>
      {open === 'appearance' && <div className={`${styles.popover} ${styles.appearanceMenu}`} role="dialog" aria-label={copy.displaySettings}>
        <header><strong>{copy.canvasSettings}</strong><Button variant="ghost" size="icon" onClick={() => setOpen(null)} aria-label={copy.closeSettings}><ToolbarIcon name="close" /></Button></header>
        <fieldset><legend>{copy.backgroundStyle}</legend><div className={styles.optionGrid}>{PATTERNS.map(item => <Button variant="ghost" key={item.value} className={`${styles.option}${background === item.value ? ` ${styles.selected}` : ''}`} aria-pressed={background === item.value} onClick={() => onBackgroundChange(item.value)}><AppearancePreview pattern={item.value} tone={tone} /><small>{copy[item.label]}</small>{background === item.value && <span className={styles.check}><ToolbarIcon name="check" /></span>}</Button>)}</div></fieldset>
        <fieldset><legend>{copy.backgroundColor}</legend><div className={styles.optionGrid}>{TONES.map(item => <Button variant="ghost" key={item.value} className={`${styles.option}${tone === item.value ? ` ${styles.selected}` : ''}`} aria-pressed={tone === item.value} onClick={() => onToneChange(item.value)}><AppearancePreview pattern="none" tone={item.value} /><small>{copy[item.label]}</small>{tone === item.value && <span className={styles.check}><ToolbarIcon name="check" /></span>}</Button>)}</div></fieldset>
      </div>}
    </div></>}
    {onConnectionsVisibleChange && <Button variant="ghost" size="icon" className={connectionsVisible ? styles.active : ''} onClick={() => onConnectionsVisibleChange(!connectionsVisible)} aria-label={connectionsVisible ? copy.hideConnections : copy.showConnections} aria-pressed={connectionsVisible} title={connectionsVisible ? copy.hideConnections : copy.showConnections}><ToolbarIcon name="connections" /></Button>}
  </div>;
}
