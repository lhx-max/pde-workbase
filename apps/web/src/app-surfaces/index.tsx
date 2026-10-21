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
import { DocumentEditorPane, type DocDocumentApi, type DocMeta } from '@doc/surface';
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
function httpDocApi(endpoint: string, docId: string, mirror?: { canvasId: string; path: string; onSaved?: (path: string, content: string) => void }): DocDocumentApi {
  const base = endpoint.replace(/\/+$/, '');
  const call = async (action: string, input: Record<string, unknown>) => {
    const res = await fetch(`${base}/instances/${encodeURIComponent(docId)}/actions/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...tenantHeaders() }, body: JSON.stringify({ input }),
    });
    const body = await res.json() as { data?: { result?: Record<string, unknown> }; error?: { message?: string } };
    if (!res.ok) throw new Error(body?.error?.message ?? `doc ${action} ${res.status}`);
    return body.data?.result ?? {};
  };
  return {
    async read() {
      const result = await call('doc.read', {});
      return typeof result.content === 'string' ? result.content : '';
    },
    async write(content) {
      const result = await call('doc.write', { content });
      // doc writes through to the canvas mirror file itself; notify the host
      // so the card preview refreshes without a second write.
      if (mirror) mirror.onSaved?.(mirror.path, content);
      const meta = result.meta as DocMeta | undefined;
      return meta ?? { id: docId, name: '', path: '', size: content.length, updatedAt: new Date().toISOString() };
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
export function AppTabSurface({ tab, app, canvasId, onMirrorSaved }: { tab: ProjectAppWorkspaceTab; app?: RegisteredAppEntry; canvasId?: string; onMirrorSaved?: (path: string, content: string) => void }) {
  if (!app) return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」未注册或已下线</div>;
  if (app.appId === 'doc' && tab.target) {
    const mirror = tab.mirrorPath && canvasId ? { canvasId, path: tab.mirrorPath, onSaved: onMirrorSaved } : undefined;
    // doc-surface styles are scoped to .doc-surface-root so its design tokens
    // never leak into the host page's global variables.
    return <div className="doc-surface-root" style={{ height: '100%', overflow: 'auto' }}><DocumentEditorPane
      api={httpDocApi(app.endpoint, tab.target, mirror)}
      document={{ id: tab.target, name: tab.label, path: tab.target, size: 0, updatedAt: '' }}
    /></div>;
  }
  return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」尚未提供可挂载的页面组件</div>;
}
