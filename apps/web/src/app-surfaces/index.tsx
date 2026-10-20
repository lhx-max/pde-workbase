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

export interface RegisteredAppEntry {
  appId: string;
  name: string;
  endpoint: string;
  webUrl?: string;
  status?: string;
}

/** doc-server-backed Api — the embedded tab edits the App's own documents
 * through its standard REST surface (`/api/documents/:id`). */
function httpDocApi(endpoint: string, docId: string): DocDocumentApi {
  const base = `${endpoint.replace(/\/+$/, '')}/api/documents/${encodeURIComponent(docId)}`;
  return {
    async read() {
      const res = await fetch(`${base}/file`);
      if (!res.ok) throw new Error(`doc read ${res.status}`);
      return res.text();
    },
    async write(content) {
      const res = await fetch(`${base}/file`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: content });
      if (!res.ok) throw new Error(`doc write ${res.status}`);
      const body = await res.json() as { data?: DocMeta };
      return body.data ?? { id: docId, name: '', path: '', size: content.length, updatedAt: new Date().toISOString() };
    },
    async exportDocument(format, content, title) {
      const res = await fetch(`${endpoint}/api/documents/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, markdown: content, title }) });
      return res.ok ? { ok: true } : { ok: false, error: `export ${res.status}` };
    },
  };
}

/** Ask the App to create whatever a fresh tab needs; returns what to persist. */
export async function createAppTab(app: RegisteredAppEntry): Promise<ProjectAppWorkspaceTab> {
  if (app.appId === 'doc') {
    const res = await fetch(`${app.endpoint}/api/documents`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '未命名文档' }),
    });
    if (!res.ok) throw new Error(`doc create ${res.status}`);
    const meta = (await res.json() as { data: DocMeta }).data;
    return { id: `app:doc:${meta.id}`, appId: app.appId, target: meta.id, label: meta.name || app.name };
  }
  // Apps without a dedicated surface handler still get a tab — the surface
  // render reports the missing mount honestly.
  return { id: `app:${app.appId}:${crypto.randomUUID()}`, appId: app.appId, label: app.name };
}

/** The mounted surface for a persisted App tab. */
export function AppTabSurface({ tab, app }: { tab: ProjectAppWorkspaceTab; app?: RegisteredAppEntry }) {
  if (!app) return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」未注册或已下线</div>;
  if (app.appId === 'doc' && tab.target) {
    return <DocumentEditorPane
      api={httpDocApi(app.endpoint, tab.target)}
      document={{ id: tab.target, name: tab.label, path: tab.target, size: 0, updatedAt: '' }}
    />;
  }
  return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」尚未提供可挂载的页面组件</div>;
}
