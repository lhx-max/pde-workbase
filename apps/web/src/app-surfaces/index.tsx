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
import type { SketchDocumentApi, SketchMeta } from '@sketch/surface';
import dynamic from 'next/dynamic';
const SketchAppPane = dynamic(() => import('./SketchAppPane'), { ssr: false });
import { CollectorAppSurface } from '@ks-designai/browser-surface';
import '@ks-designai/browser-surface/styles.css';
import { browserAppTransport } from './browser-transport';
import {sketchPreviewChannel,sketchPreviewKey} from '../state/sketch-preview-channel';
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


/** sketch-server-backed Api. Saves go through sketch.write with the content hash. */
export function httpSketchApi(endpoint: string, sketchId: string, onSaved?:(path:string,content:string)=>void): SketchDocumentApi {
  const base = endpoint.replace(/\/+$/, '');
  const call = async (action: string, input: Record<string, unknown>) => {
    const res = await fetch(`${base}/instances/${encodeURIComponent(sketchId)}/actions/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...tenantHeaders() }, body: JSON.stringify({ input }),
    });
    const body = await res.json() as { data?: { result?: Record<string, unknown> }; error?: { message?: string } };
    if (!res.ok) throw new Error(body?.error?.message ?? `sketch ${action} ${res.status}`);
    if (!body.data?.result) throw new Error('草图服务未返回有效结果');
    return body.data.result;
  };
  return {
    async readSnapshot() {
      const result = await call('sketch.read', {});
      if (typeof result.content !== 'string' || typeof result.revision !== 'string' || !result.revision) throw new Error('草图服务未返回画面版本');
      return { content: result.content, revision: result.revision, ...(typeof result.draftScope==='string'?{draftScope:result.draftScope}:{}), ...(result.meta?{meta:result.meta as SketchMeta}:{}) };
    },
    async read() {
      return (await this.readSnapshot!()).content;
    },
    async write(content, version) {
      const result = await call('sketch.write', { content, ...(version ?? {}) });
      const meta = result.meta as SketchMeta | undefined;
      if (!meta?.id) throw new Error('草图保存响应缺少元数据');
      onSaved?.((meta as SketchMeta & {mirrorPath?:string}).mirrorPath??meta.path,content);
      return { ...meta, ...(typeof result.revision === 'string' ? { revision: result.revision } : {}) };
    },
    async rename(name) {
      const result = await call('sketch.rename', { name });
      return (result.meta as SketchMeta | undefined) ?? null;
    },
    async exportImage(fileName, base64) {
      const result = await call('sketch.export-image', { fileName, base64 });
      return { fileName: typeof result.fileName === 'string' ? result.fileName : fileName, url: typeof result.url === 'string' ? result.url : null };
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

/** Card double-click opens the sketch that already belongs to this card.
 * create is idempotent on (team, canvas, node): an existing binding comes
 * back unchanged, a new card gets its first sketch. */
export async function openBoundSketch(endpoint: string, input: { nodeId: string; mirrorCanvasId: string; mirrorPath: string; name?: string }, headers: Record<string, string>): Promise<{ instanceId: string; name: string }> {
  const response = await fetch(`${endpoint.replace(/\/+$/, '')}/actions/sketch.create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ input: { name: input.name ?? '未命名草图', nodeId: input.nodeId, mirrorCanvasId: input.mirrorCanvasId, mirrorPath: input.mirrorPath } }),
  });
  const body = await response.json().catch(() => null) as { data?: { result?: { instanceId?: string; meta?: { name?: string } } }; error?: { message?: string } } | null;
  const instanceId = body?.data?.result?.instanceId;
  if (!response.ok || !instanceId) throw new Error(body?.error?.message ?? `草图详情打开失败 (${response.status})`);
  return { instanceId, name: body?.data?.result?.meta?.name || input.name || '未命名草图' };
}

/** The mounted surface for a persisted App tab. */
export function AppTabSurface({ tab, app, canvasId, onMirrorSaved, onDirtyChange, registerFlush,previewScope='local' }: { tab: ProjectAppWorkspaceTab; app?: RegisteredAppEntry; canvasId?: string; previewScope?:string; onMirrorSaved?: (path: string, content: string) => void; onDirtyChange?: (dirty: boolean) => void; registerFlush?: (flush: (() => Promise<boolean>) | null) => void }) {
  const [syncWarning, setSyncWarning] = React.useState('');
  const onSavedRef=React.useRef(onMirrorSaved);onSavedRef.current=onMirrorSaved;
  const sketchApi=React.useMemo(()=>app?.appId==='sketch'&&tab.target?httpSketchApi(app.endpoint,tab.target,(path,content)=>{onSavedRef.current?.(path,content);}):null,[app?.appId,app?.endpoint,tab.target,tab.mirrorPath,canvasId,previewScope]);
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
  // Pending tab: the launcher opens the detail surface immediately while the
  // bound card+document are created in the background — never show a card
  // flash on canvas first.
  if (app.appId === 'doc' && !tab.target) return <div className="app-tab-missing" style={{ padding: 32 }}>正在准备文档…</div>;
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
  if (app.appId === 'browser' && !tab.target) return <div className="app-tab-missing" style={{ padding: 32 }}>正在准备浏览器…</div>;
  if (app.appId === 'browser' && tab.target) {
    return <div className="browser-surface-root" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}><CollectorAppSurface
      extensionDownloadUrl="/downloads/web-collector-extension-0.1.0.zip"
      instanceId={tab.target}
      transport={browserAppTransport}
    /></div>;
  }
  if (app.appId === 'sketch' && !tab.target) return <div className="app-tab-missing" style={{ padding: 32 }}>正在准备草图…</div>;
  if (app.appId === 'sketch' && tab.target) {
    const sketch: SketchMeta = { id: tab.target, name: tab.label, path: tab.mirrorPath || tab.target, size: 0, updatedAt: '' };
    // The host panel is a block box. `.sketch-editor { flex: 1 }` only fills
    // it when this wrapper is a column. Otherwise the board height is 0 and
    // the tab looks like a blank page.
    return <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}><SketchAppPane key={`${previewScope}:${tab.target}`}
      api={sketchApi!}
      onSceneSerialized={content=>{if(canvasId&&tab.mirrorPath)sketchPreviewChannel.publish(sketchPreviewKey(previewScope,canvasId,tab.mirrorPath),content);}}
      sketch={sketch}
      onRenamed={() => undefined}
      onDirtyChange={reportDirty}
      registerFlush={registerFlush ?? (() => undefined)}
    /></div>;
  }
  return <div className="app-tab-missing" style={{ padding: 32 }}>App「{tab.appId}」尚未提供可挂载的页面组件</div>;
}
