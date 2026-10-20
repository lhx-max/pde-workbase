import React from 'react';
import { Button } from '@bezier/components';
import type { ClipEditorExportFormat, ClipEditorExportQuality } from '@bezier/contracts';
import { projectFileUrl } from '../platform/api-base';
import type { CanvasClipTimeline } from './clip-timeline';
import type { useClipExport } from './use-clip-export';
import { clipCompositionKey } from './clip-editor-session';
import styles from './ClipDetailedEditor.styles';
import { useCanvasUiHost } from '../platform/ui-host';
import { cep } from '../locales/clip-export-panel';

export function ClipExportPanel({ timeline, title, controller, onClose }: { timeline: CanvasClipTimeline; title: string; controller: ReturnType<typeof useClipExport>; onClose: () => void }) {
  const uiHost = useCanvasUiHost();
  const [downloadError, setDownloadError] = React.useState('');
  const [format, setFormat] = React.useState<ClipEditorExportFormat>(timeline.exportFormat || controller.record?.options.format || 'mp4');
  const [quality, setQuality] = React.useState<ClipEditorExportQuality>(controller.record?.options.quality || 'standard');
  const [fps, setFps] = React.useState<24 | 30 | 60>(controller.record?.options.fps || 30);
  const { record, error, running, starting } = controller;
  const job = record?.job;
  const busy = running || starting;
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [onClose]);
  return <div className={styles.exportBackdrop} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.exportPanel} role="dialog" aria-modal="true" aria-label={cep().exportClip}>
      <header><div><strong>{cep().exportClip}</strong><span>{timeline.width || 1280} × {timeline.height || 720}</span></div><Button variant="ghost" size="icon" aria-label={cep().closeExport} onClick={onClose}>×</Button></header>
      <div className={styles.exportFields}>
        <label><span>{cep().format}</span><select value={format} disabled={busy} onChange={event => setFormat(event.target.value as ClipEditorExportFormat)}><option value="mp4">{cep().videoMp4}</option><option value="png">{cep().framePng}</option><option value="webp">{cep().frameWebp}</option></select></label>
        <label><span>{cep().quality}</span><select value={quality} disabled={busy} onChange={event => setQuality(event.target.value as ClipEditorExportQuality)}><option value="draft">{cep().draft}</option><option value="standard">{cep().standard}</option><option value="high">{cep().high}</option></select></label>
        <label><span>{cep().fps}</span><select value={fps} disabled={busy || format !== 'mp4'} onChange={event => setFps(Number(event.target.value) as 24 | 30 | 60)}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label>
      </div>
      {format !== 'mp4' ? <p className={styles.hint}>{cep().stillHint(timeline.playhead.toFixed(2))}</p> : null}
      {job ? <div className={styles.exportProgress} role="status"><div><span>{job.status === 'complete' ? cep().complete : job.status === 'failed' ? cep().failed : job.status === 'cancelled' ? cep().cancelled : cep().exporting}</span><span>{Math.round(job.progress * 100)}%</span></div><progress max={1} value={job.progress} />{job.error ? <p>{job.error}</p> : null}</div> : null}
      {busy ? <p className={styles.hint}>{cep().backgroundHint}</p> : null}
      {record && record.compositionKey !== clipCompositionKey(timeline) ? <p className={styles.hint}>{cep().staleHint}</p> : null}
      {error ? <p className={styles.exportError} role="alert">{error}</p> : null}
      {downloadError ? <p role="alert">{downloadError}</p> : null}
      <footer>{job?.status === 'complete' && job.file?.path ? <a href={projectFileUrl(job.file.path)} download={job.file.name} onClick={event => {
        if (!uiHost?.downloadResource || !job.file?.path) return;
        event.preventDefault(); setDownloadError('');
        void uiHost.downloadResource({ url: projectFileUrl(job.file.path), fileName: job.file.path }).catch(error => setDownloadError(error instanceof Error ? error.message : cep().downloadFailed));
      }}>{cep().downloadFile}</a> : null}{running ? <Button variant="ghost" onClick={() => void controller.cancel()}>{cep().cancelExport}</Button> : <Button variant="primary" disabled={starting} onClick={() => void controller.start(timeline, title, { format, quality, fps, stillTime: timeline.playhead })}>{starting ? cep().starting : job?.status === 'complete' ? cep().exportAgain : cep().startExport}</Button>}</footer>
    </section>
  </div>;
}
