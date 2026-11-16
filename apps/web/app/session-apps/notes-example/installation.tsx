'use client';

import { useEffect, useState } from 'react';
import { maApplicationManifestSchema } from '@bezier/contracts';
import { notesManifest } from './manifest';
import type { SessionAppComponentProps, SessionAppRegistryEntry } from '../types';

/** 便签板安装项（源自参考仓 ma-v/session-apps/notes-example/installation.tsx；
 * 适配点：动作走本仓 /api/ma-v 转发路由而非 daemon BFF；按钮为本仓样式，
 * 未引入 @ks-designai/ui）。Provider 未启动时显式提示，不回退假数据。 */

class ProviderUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderUnavailableError'; }
}

async function executeApplicationAction(instanceId: string, sessionId: string, actionId: string,
  input: Record<string, unknown>, expectedRevision?: number): Promise<{ result: { summary: string; revision: number; data: unknown } }> {
  const response = await fetch(`/api/ma-v/application-instances/${encodeURIComponent(instanceId)}/actions/${encodeURIComponent(actionId)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, input, ...(expectedRevision !== undefined ? { expectedRevision } : {}) }),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; error?: { code?: string; message?: string }; result?: { summary: string; revision: number; data: unknown } } | null;
  if (!response.ok || !body || body.ok === false || !body.result) {
    if (body?.error?.code === 'PROVIDER_UNAVAILABLE') throw new ProviderUnavailableError(body.error.message ?? '本机便签服务未启动');
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return { result: body.result };
}

const buttonStyle: React.CSSProperties = { padding: '6px 11px', border: '1px solid #1d4ed8', borderRadius: 6, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' };

function NotesApp({ context }: SessionAppComponentProps) {
  if (!context) return null;
  return <NotesBoard key={JSON.stringify([context.actor.userId, context.sessionId, context.applicationInstanceId])}
    instanceId={context.applicationInstanceId} sessionId={context.sessionId} />;
}

function NotesBoard({ instanceId, sessionId }: { instanceId: string; sessionId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState('读取中');
  useEffect(() => {
    let current = true;
    setStatus('读取中');
    void executeApplicationAction(instanceId, sessionId, 'notes.read', {})
      .then(({ result }) => {
        if (!current) return;
        const data = result.data as { notes?: unknown } | undefined;
        if (!Array.isArray(data?.notes) || data.notes.some(note => typeof note !== 'string')) throw new Error('便签格式有误');
        setNotes(data.notes);
        setStatus(data.notes.length ? '' : '暂无便签');
      })
      .catch((error: unknown) => {
        if (current) setStatus(error instanceof ProviderUnavailableError
          ? error.message : '读取失败，请检查本机便签服务。');
      });
    return () => { current = false; };
  }, [instanceId, sessionId, attempt]);
  return <section aria-label="便签板" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
    <h2>便签板</h2>
    {status && <p role="status">{status}</p>}
    <ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    <div><button type="button" style={buttonStyle} onClick={() => setAttempt(previous => previous + 1)}>刷新便签</button></div>
  </section>;
}

export const notesInstallation: SessionAppRegistryEntry = {
  manifest: maApplicationManifestSchema.parse(notesManifest),
  component: NotesApp,
};
