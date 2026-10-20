import React from 'react';
import type { ClipEditorExportJobStatusResponse, ClipEditorExportOptions } from '@bezier/contracts';
import { apiErrorMessage, getCanvasHostContext, projectFetch } from '../platform/api-base';
import { clipCompositionKey, clipSessionKey } from './clip-editor-session';
import type { CanvasClipTimeline } from './clip-timeline';
import { cr } from '../locales/canvas-remainder';

type ExportRecord = { job: ClipEditorExportJobStatusResponse; compositionKey: string; options: ClipEditorExportOptions };
const memory = new Map<string, ExportRecord>();
function read(key: string): ExportRecord | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as ExportRecord | null;
    return value?.job?.jobId && value.options && typeof value.compositionKey === 'string' ? value : null;
  } catch { return null; }
}

/** One node-owned export lifecycle for compact and detailed surfaces. Closing the
 * panel never cancels rendering; remounting restores the durable job receipt. */
export function useClipExport(nodeId: string) {
  const context = getCanvasHostContext();
  const key = `da:clip-export:${clipSessionKey(context, nodeId)}`;
  const [record, setRecord] = React.useState<ExportRecord | null>(() => read(key));
  const [error, setError] = React.useState('');
  const [starting, setStarting] = React.useState(false);
  const startingRef = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = React.useCallback((next: ExportRecord) => {
    memory.set(key, next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Node stays usable when browser storage is unavailable. */ }
    if (alive.current) setRecord(next);
  }, [key]);
  const running = record?.job.status === 'queued' || record?.job.status === 'running';

  React.useEffect(() => {
    if (!running || !record) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const receipt = record;
    const poll = async () => {
      try {
        const response = await projectFetch(`/media/edit/export-jobs/${receipt.job.jobId}`, {}, context);
        const payload = await response.json();
        if (!active) return;
        if (!response.ok) {
          if (response.status === 404) {
            save({ ...receipt, job: { ...receipt.job, status: 'failed', error: cr().exportJobGone } });
            return;
          }
          throw new Error(apiErrorMessage(payload?.error, cr().exportProgressRetry));
        }
        setError('');
        save({ ...receipt, job: payload });
        if (payload.status !== 'queued' && payload.status !== 'running') return;
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : cr().exportConnRetry);
      }
      if (active) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [key, record?.job.jobId, running, save]);

  async function start(timeline: CanvasClipTimeline, title: string, options: ClipEditorExportOptions) {
    if (startingRef.current || running) return;
    startingRef.current = true; setStarting(true); setError('');
    try {
      const response = await projectFetch('/media/edit/export-jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline, title, options }),
      }, context);
      const payload = await response.json();
      if (!response.ok || !payload?.jobId) throw new Error(apiErrorMessage(payload?.error, cr().exportStartFail));
      save({ job: { ok: true, jobId: payload.jobId, status: 'queued', progress: 0 }, compositionKey: clipCompositionKey(timeline), options });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : cr().exportStartFail); }
    finally { startingRef.current = false; if (alive.current) setStarting(false); }
  }

  async function cancel() {
    if (!record || !running) return;
    try {
      const response = await projectFetch(`/media/edit/export-jobs/${record.job.jobId}`, { method: 'DELETE' }, context);
      const payload = await response.json();
      if (!response.ok || !payload?.status) throw new Error(apiErrorMessage(payload?.error, cr().cancelFailRetry));
      save({ ...record, job: payload });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : cr().cancelFail); }
  }
  return { record, error, starting, running, start, cancel };
}
