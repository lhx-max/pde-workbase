'use client';

import React from 'react';
import { tenantHeaders } from './index';

export interface CanvasDocumentSyncEntry {
  nodeId: string;
  title?: string;
  status: 'pending' | 'conflict' | 'blocked' | 'synced' | 'detached';
  content: string;
  remoteContent?: string;
  documentRevision?: string;
  error?: string;
}

const labels: Record<CanvasDocumentSyncEntry['status'], string> = {
  pending: '画布草稿待同步（不代表文档已保存）',
  conflict: '画布草稿与文档已保存版本冲突',
  blocked: '同步受阻，画布草稿已保留',
  synced: '画布与文档已同步',
  detached: '关联已解除，画布草稿与文档独立保留',
};

/** Standalone host notice: it never writes editor state or hides a failed sync. */
export function CanvasDocumentSyncNotice({ canvasId, enabled = true }: { canvasId: string; enabled?: boolean }) {
  const [entries, setEntries] = React.useState<CanvasDocumentSyncEntry[]>([]);
  const [pollError, setPollError] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [unavailable, setUnavailable] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const readingRef = React.useRef(false);
  const sequenceRef = React.useRef(0);
  const endpoint = `/api/apps/canvas/instances/${encodeURIComponent(canvasId)}/document-sync`;

  const request = React.useCallback(async (suffix = '', input?: Record<string, unknown>) => {
    const response = await fetch(`${endpoint}${suffix}`, {
      headers: { ...tenantHeaders(), ...(input ? { 'content-type': 'application/json' } : {}) },
      ...(input ? { method: 'POST', body: JSON.stringify(input) } : { cache: 'no-store' as const }),
    });
    const body = await response.json() as { data?: { entries?: CanvasDocumentSyncEntry[] }; error?: { code?: string; message?: string } };
    if (!response.ok) throw Object.assign(new Error(body.error?.message ?? `文档同步检查失败（HTTP ${response.status}）`), { status: response.status, code: body.error?.code });
    if (!Array.isArray(body.data?.entries) || body.data.entries.some(entry => !entry || typeof entry.nodeId !== 'string' || typeof entry.content !== 'string' || !Object.hasOwn(labels, entry.status))) {
      throw new Error('文档同步服务未返回有效状态；已保留上次结果');
    }
    return body.data.entries;
  }, [endpoint]);

  const refresh = React.useCallback(async () => {
    if (!enabled || !canvasId || readingRef.current || busyRef.current) return;
    readingRef.current = true;
    const sequence = ++sequenceRef.current;
    try {
      const next = await request();
      if (sequence !== sequenceRef.current) return;
      setEntries(next);
      setPollError('');
      setUnavailable(false);
    } catch (cause) {
      if (sequence !== sequenceRef.current) return;
      const error = cause as { status?: number; code?: string };
      const missing = error.code === 'APP_NOT_INSTALLED' || error.code === 'APP_NOT_CONFIGURED' || error.code === 'DOC_NOT_CONFIGURED' || error.status === 404;
      setUnavailable(missing);
      setPollError(missing ? '文档同步尚未配置或当前不可用' : `文档同步状态检查失败，已有草稿未被覆盖：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { readingRef.current = false; }
  }, [canvasId, enabled, request]);

  React.useEffect(() => {
    sequenceRef.current += 1;
    readingRef.current = false;
    busyRef.current = false;
    setEntries([]);
    setPollError('');
    setActionError('');
    setUnavailable(false);
    setBusy(false);
    if (!enabled || !canvasId) return;
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const timer = window.setInterval(visibleRefresh, 3000);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      sequenceRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [canvasId, enabled, refresh]);

  const act = async (suffix: '/retry' | '/resolve', input: Record<string, unknown>, confirmation: string) => {
    if (busyRef.current || !window.confirm(confirmation)) return;
    busyRef.current = true;
    setBusy(true);
    const sequence = ++sequenceRef.current;
    try {
      const next = await request(suffix, input);
      if (sequence !== sequenceRef.current) return;
      setEntries(next);
      setActionError('');
      setPollError('');
      setUnavailable(false);
    } catch (cause) {
      if (sequence !== sequenceRef.current) return;
      const conflict = (cause as { status?: number }).status === 409;
      setActionError(conflict
        ? '正文在确认后又发生变化，未应用您的选择。草稿已保留；请查看刷新后的双方内容并重新确认。'
        : `同步操作未完成，草稿已保留：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (sequence === sequenceRef.current) {
        busyRef.current = false;
        setBusy(false);
        // Re-read after success or 409; never replay the user's stale choice.
        void refresh();
      }
    }
  };

  if (!enabled || !canvasId) return null;
  const visible = entries.filter(entry => entry.status !== 'synced');
  if (!visible.length && !pollError && !actionError) return null;
  return <section className="canvas-document-sync-notice" aria-label="画布与文档同步状态" style={{ maxHeight: '40vh', overflow: 'auto', padding: '8px 12px', fontSize: 13 }}>
    {pollError ? <p role={unavailable ? 'status' : 'alert'}>{pollError}</p> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
    {visible.map(entry => {
      const canResolve = entry.status === 'conflict' && typeof entry.remoteContent === 'string' && typeof entry.documentRevision === 'string' && entry.documentRevision.length > 0;
      const resolve = (choice: 'canvas' | 'document') => act('/resolve', {
        nodeId: entry.nodeId, choice, expectedCanvasContent: entry.content, expectedDocumentRevision: entry.documentRevision,
      }, choice === 'canvas'
        ? '确认采用下方画布草稿替换文档已保存版本？请先保留需要的文档端修改。服务将再次校验双方版本。'
        : '确认采用下方文档已保存版本替换画布草稿？请先保留需要的画布修改。服务将再次校验双方版本。');
      return <div key={entry.nodeId} style={{ padding: '6px 0' }}>
        <strong>{entry.title || entry.nodeId}</strong>：<span role="status">{labels[entry.status]}</span>
        {entry.error ? <p>{entry.error}</p> : null}
        {entry.status === 'conflict' || entry.status === 'blocked' ? <details open={entry.status === 'conflict'}>
          <summary>查看双方内容（不会自动覆盖）</summary>
          <h4>画布本地草稿</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.content || '（空正文）'}</pre>
          {typeof entry.remoteContent === 'string' ? <><h4>文档端已保存版本</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.remoteContent || '（空正文）'}</pre></> : <p>尚未取得文档端版本，不能直接解决冲突。</p>}
        </details> : null}
        {entry.status !== 'detached' ? <button type="button" disabled={busy} onClick={() => void act('/retry', { nodeId: entry.nodeId }, '确认重新尝试同步这份画布草稿？冲突仍将保留，不会强制覆盖文档。')}>重试同步</button> : null}
        {canResolve ? <>
          <button type="button" disabled={busy} onClick={() => void resolve('canvas')}>采用画布草稿</button>
          <button type="button" disabled={busy} onClick={() => void resolve('document')}>采用文档已保存版本</button>
        </> : null}
      </div>;
    })}
  </section>;
}
