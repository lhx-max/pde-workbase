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

/** doc-server-backed Api — the mounted editor edits the App's own document
 * through the unified /api/apps protocol actions (doc.read / doc.write).
 * `mirror` writes the same content to a canvas file so the card's preview
 * stays live — App storage is truth, the canvas file is a render mirror. */
function httpDocApi(endpoint: string, docId: string, mirror?: { canvasId: string; path: string; onSaved?: (path: string, content: string) => void }): DocDocumentApi {
  const base = endpoint.replace(/\/+$/, '');
  const call = async (action: string, input: Record<string, unknown>) => {
    const res = await fetch(`${base}/instances/${encodeURIComponent(docId)}/actions/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }),
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
      if (mirror) {
        const res = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(mirror.canvasId)}/files?path=${encodeURIComponent(mirror.path)}`, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }),
        });
        if (res.ok) mirror.onSaved?.(mirror.path, content);
      }
      const meta = result.meta as DocMeta | undefined;
      return meta ?? { id: docId, name: '', path: '', size: content.length, updatedAt: new Date().toISOString() };
    },
    async exportDocument(format, content, title) {
      const origin = base.replace(/\/api\/apps\/[^/]+$/, '');
      const res = await fetch(`${origin}/api/documents/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, markdown: content, title }) });
      return res.ok ? { ok: true } : { ok: false, error: `export ${res.status}` };
    },
  };
}

/** Ask the App to create whatever a fresh tab needs; returns what to persist.
 * Tab ↔ card pairing: opening a doc detail creates a bound canvas card +
 * a bound doc document (nodeId), so the detail page and the card are the
 * same entity seen from two sides — card mirror keeps the preview live. */
export async function createAppTab(app: RegisteredAppEntry, canvasId: string): Promise<ProjectAppWorkspaceTab> {
  if (app.appId === 'doc') {
    const nodeId = `t-${crypto.randomUUID().slice(0, 8)}`;
    // 1. Create the paired card through the canonical operations write.
    const stateRes = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(canvasId)}/state`);
    if (!stateRes.ok) throw new Error(`canvas state ${stateRes.status}`);
    const state = (await stateRes.json()) as { data: { revision: number; state: { workbenchBasicNodes?: unknown[] } } };
    const offset = (state.data.state.workbenchBasicNodes?.length ?? 0) * 40;
    const opsRes = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(canvasId)}/operations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: `op-${crypto.randomUUID().slice(0, 8)}`, baseRevision: state.data.revision,
        operations: [{ type: 'node.create', node: { id: nodeId, kind: 'text', x: 240 + offset, y: 240 + offset, title: '未命名文档' } }],
      }),
    });
    if (!opsRes.ok) throw new Error(`card create ${opsRes.status}`);
    const mirrorPath = (((await opsRes.json()) as { data: { state?: { workbenchBasicNodes?: { id: string; projectFilePath?: string }[] } } }).data.state?.workbenchBasicNodes ?? [])
      .find(n => n.id === nodeId)?.projectFilePath;
    // 2. Bind the App-owned document to the card (truth lives in doc).
    const res = await fetch(`${app.endpoint}/actions/doc.create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { nodeId, name: '未命名文档', content: '' } }),
    });
    if (!res.ok) throw new Error(`doc create ${res.status}`);
    const result = (await res.json() as { data: { result: { instanceId: string; meta: DocMeta } } }).data.result;
    return createAppDocTab(app.appId, result.instanceId, '未命名文档', mirrorPath);
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
