'use client';

/**
 * App surface mounting — the workspace "+" tab hosts an App's own TSX
 * component (its published `surface` package), never a URL iframe.
 *
 * Each App contributes:
 *  - `openTab(app)` → creates whatever the App needs for a new tab (doc: a new
 *    document) and returns the tab descriptor to persist.
 *  - `render(app, target)` → the mounted React surface for an existing tab.
 *
 * New Apps register one entry in `APP_SURFACES` after their surface package is
 * added as a dependency. `endpoint` is the App's protocol surface — the same
 * URL the App registered with — so the component talks the standard API.
 */
import React from 'react';
import { DocumentEditorPane, type DocDocumentApi, type DocMeta, type DocSnapshot, type DocWriteOptions, type DocWriteSnapshot } from '@doc/surface';
import '@doc/surface/styles.css';
import type { ProjectAppWorkspaceTab } from '@bezier/contracts';

/** Tenant context (spec §3.0) — dev mode headers; deployed mode the host
 * gateway injects verified identity instead. */
export function tenantHeaders(): Record<string, string> {
  return {
    'x-team-id': process.env.NEXT_PUBLIC_TEAM_ID ?? 'local',
    'x-user-id': process.env.NEXT_PUBLIC_USER_ID ?? 'local',
  };
}

export interface RegisteredAppEntry {
  appId: string;
  name: string;
  endpoint: string;
  webUrl?: string;
  status?: string;
}

/** doc-server-backed Api — the mounted editor edits the App's own document
 * through the unified /api/apps protocol actions (doc.read / doc.write).
 * `mirror` writes the same content to a canvas file so the card's preview
 * stays live — App storage is truth, the canvas file is a render mirror. */
export function httpDocApi(endpoint: string, docId: string, mirror?: { canvasId: string; path: string; onSaved?: (path: string, content: string) => void }, onSyncWarning?: (warning: string) => void): DocDocumentApi {
  const base = endpoint.replace(/\/+$/, '');
  let legacySnapshot: DocSnapshot | undefined;
  const call = async (action: string, input: Record<string, unknown>) => {
    const res = await fetch(`${base}/instances/${encodeURIComponent(docId)}/actions/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...tenantHeaders() }, body: JSON.stringify({ input }),
    });
    const body = await res.json() as { data?: { result?: Record<string, unknown> }; error?: { message?: string; code?: string; details?: unknown } };
    if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? `doc ${action} ${res.status}`), { code: body.error?.code, details: body.error?.details, status: res.status });
    if (!body.data?.result) throw new Error('文档服务未返回有效结果');
    return body.data.result;
  };
  const snapshot = (result: Record<string, unknown>): DocSnapshot => {
    if (typeof result.content !== 'string') throw new Error('文档服务未返回正文，已停止加载以防覆盖');
    if (typeof result.revision !== 'string' || !result.revision) throw new Error('文档服务未返回版本，已停止保存以防覆盖');
    return { content: result.content, revision: result.revision, ...(result.meta ? { meta: result.meta as DocMeta } : {}) };
  };
  const readSnapshot = async () => snapshot(await call('doc.read', {}));
  const writeSnapshot = async (content: string, options: DocWriteOptions): Promise<DocWriteSnapshot> => {
      if (typeof options.expectedRevision !== 'string') throw new Error('文档保存需要正文版本，不能使用画布版本');
      const result = await call('doc.write', { content, ...options });
      const canonical = snapshot(result);
      const status = result.mirror as { status?: string; path?: string } | undefined;
      if (status?.status === 'synced') {
        onSyncWarning?.('');
        if (mirror) mirror.onSaved?.(status.path ?? mirror.path, canonical.content);
      } else if (mirror || (status?.status && status.status !== 'unbound')) {
        onSyncWarning?.(status?.status === 'unbound'
          ? '文档已保存；关联卡片不存在或已解除，文档仍独立保留。'
          : '文档已保存，但画布副本尚未同步（' + (status?.status ?? '状态未确认') + '）。正文已保留，请勿用旧画布副本覆盖。');
      }
      const meta = result.meta as DocMeta | undefined;
      if (!meta?.id) throw new Error('文档保存响应缺少元数据，请检查服务状态');
      return { ...canonical, meta, merged: result.merged === true };
  };
  return {
    readSnapshot,
    writeSnapshot,
    async read() { legacySnapshot = await readSnapshot(); return legacySnapshot.content; },
    async write(content) {
      if (!legacySnapshot) throw new Error('请先读取文档版本再保存，以防覆盖其他入口的修改');
      const saved = await writeSnapshot(content, { expectedRevision: legacySnapshot.revision, baseContent: legacySnapshot.content });
      legacySnapshot = saved;
      return saved.meta;
    },
    async exportDocument(format, content, title) {
      const origin = base.replace(/\/api\/apps\/[^/]+$/, '');
      const res = await fetch(`${origin}/api/documents/export`, { method: 'POST', headers: { 'content-type': 'application/json', ...tenantHeaders() }, body: JSON.stringify({ format, markdown: content, title }) });
      return res.ok ? { ok: true } : { ok: false, error: `export ${res.status}` };
    },
  };
}

/** Fallback tab creation for Apps without host-side pairing logic. doc is
 * paired with a canvas card by FileWorkspace (the workbench's own creation
 * channel keeps revision + placement correct). */
export async function createAppTab(app: RegisteredAppEntry): Promise<ProjectAppWorkspaceTab> {
  if (app.appId === 'doc') {
    const res = await fetch(`${app.endpoint}/actions/doc.create`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...tenantHeaders() },
      body: JSON.stringify({ input: { name: '未命名文档' } }),
    });
    if (!res.ok) throw new Error(`doc create ${res.status}`);
    const result = (await res.json() as { data: { result: { instanceId: string; meta: DocMeta } } }).data.result;
    return createAppDocTab(app.appId, result.instanceId, result.meta.name || app.name);
  }
  // Apps without a dedicated surface handler still get a tab — the surface
  // render reports the missing mount honestly.
  return { id: `app:${app.appId}:${crypto.randomUUID()}`, appId: app.appId, label: app.name };
}

/** A tab bound to an App-owned document. `mirrorPath` marks the canvas file
 * that mirrors the document for card previews/realtime canvas rendering. */
export function createAppDocTab(appId: string, docId: string, label: string, mirrorPath?: string): ProjectAppWorkspaceTab {
  return { id: `app:${appId}:${docId}`, appId, target: docId, label, ...(mirrorPath ? { mirrorPath } : {}) };
}

/** The mounted surface for a persisted App tab. */
export function AppTabSurface({ tab, app, canvasId, onMirrorSaved, onDirtyChange, registerFlush }: { tab: ProjectAppWorkspaceTab; app?: RegisteredAppEntry; canvasId?: string; onMirrorSaved?: (path: string, content: string) => void; onDirtyChange?: (dirty: boolean) => void; registerFlush?: (flush: (() => Promise<boolean>) | null) => void }) {
  const [syncWarning, setSyncWarning] = React.useState('');
  const dirtyGeneration = React.useRef(0);
  const reportDirty = React.useCallback((dirty: boolean) => {
    dirtyGeneration.current += 1;
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);
  React.useEffect(() => () => { registerFlush?.(null); onDirtyChange?.(false); }, [registerFlush, onDirtyChange]);
  const trackedApi = React.useMemo(() => {
    if (!app || app.appId !== 'doc' || !tab.target) return null;
    const mirror = tab.mirrorPath && canvasId ? { canvasId, path: tab.mirrorPath, onSaved: onMirrorSaved } : undefined;
    const api = httpDocApi(app.endpoint, tab.target, mirror, setSyncWarning);
    return { ...api, async write(content: string) {
      const generation = dirtyGeneration.current;
      const saved = await api.write(content);
      // Do not mark a newer edit clean when an older in-flight save completes.
      if (generation === dirtyGeneration.current) reportDirty(false);
      return saved;
    } } satisfies DocDocumentApi;
  }, [app?.appId, app?.endpoint, tab.target, tab.mirrorPath, canvasId, onMirrorSaved, reportDirty]);
  if (!app) return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」未注册或已下线</div>;
  if (app.appId === 'doc' && tab.target && trackedApi) {
    // doc-surface styles are scoped to .doc-surface-root so its design tokens
    // never leak into the host page's global variables.
    return <div className="doc-surface-root" style={{ height: '100%', overflow: 'auto' }}>{syncWarning ? <div role="status">{syncWarning}</div> : null}<DocumentEditorPane
      api={trackedApi}
      onDirtyChange={reportDirty}
      registerFlush={registerFlush}
      document={{ id: tab.target, name: tab.label, path: tab.target, size: 0, updatedAt: '' }}
    /></div>;
  }
  return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」尚未提供可挂载的页面组件</div>;
}
