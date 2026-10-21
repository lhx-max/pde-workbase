import { canvasTextPath } from '@bezier/contracts';
import { createHash } from 'node:crypto';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { BindingStore } from '../storage/bindings.js';
import type { AuditLog } from '../storage/audit-log.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import { DocumentSyncJournal, type DocumentSyncEntry } from '../storage/document-sync-journal.js';
import { appVisibleToTenant, currentRequestTenant } from '../tenant.js';
import type { CanvasStateSnapshot } from './state.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
class SyncFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message); }
}
interface ActionResult { instanceId?: string; content?: string; revision?: string; meta?: { id?: string }; mirror?: { status?: string; path?: string; code?: string } }

/** Document-specific protocol stays in this adapter; canvas transactions only
 * publish text-change intents and never depend on an editor implementation. */
export function createDocSynchronizer(deps: {
  dataRoot: string; registry: AppRegistryStore; bindings: BindingStore; audit: AuditLog; entitlements: AppEntitlementStore;
  project: (id: string) => { teamId?: string; createdBy?: string; archivedAt?: number } | null | undefined;
  retryIntervalMs?: number;
}) {
  const journal = new DocumentSyncJournal(deps.dataRoot);
  let canvas: { read(id: string): Promise<CanvasStateSnapshot> } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const running = new Map<string, Promise<void>>();
  let stopped = false;
  const prepare = (projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string): DocumentSyncEntry | undefined => {
    if (typeof node.id !== 'string' || typeof node.text !== 'string') return;
    const owner = deps.project(projectId);
    if (!owner || owner.archivedAt) return;
    const caller = currentRequestTenant();
    const teamId = owner.teamId ?? 'local';
    if (caller && caller.teamId !== teamId) throw new Error('Document synchronization tenant mismatch');
    return journal.enqueue({ projectId, nodeId: node.id, appId: 'doc', teamId, userId: caller?.userId ?? owner.createdBy ?? 'local',
      canvasRevision: revision, mirrorPath: typeof node.projectFilePath === 'string' ? node.projectFilePath : canvasTextPath(node.id),
      ...(typeof node.title === 'string' ? { title: node.title } : {}), content: node.text,
      ...(baseContent !== undefined ? { baseContent } : {}) });
  };
  const call = async (endpoint: string, entry: DocumentSyncEntry, suffix: string, input: unknown): Promise<ActionResult> => {
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}${suffix}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-team-id': entry.teamId, 'x-user-id': entry.userId },
      body: JSON.stringify({ input }), signal: AbortSignal.timeout(10000),
    });
    const body = await response.json() as { data?: { result?: ActionResult }; error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    if (!response.ok) throw new SyncFailure(response.status, body.error?.code ?? `DOC_HTTP_${response.status}`, body.error?.message ?? `Doc HTTP ${response.status}`, body.error?.details);
    if (!body.data?.result) throw new SyncFailure(502, 'DOC_INVALID_RESPONSE', 'Document service returned no result');
    return body.data.result;
  };
  const deliver = async (entry: DocumentSyncEntry): Promise<void> => {
    const owner = deps.project(entry.projectId);
    if (!owner || owner.archivedAt || (owner.teamId ?? 'local') !== entry.teamId) {
      journal.update(entry, { status: 'detached', error: 'Canvas removed, archived or tenant changed' }); return;
    }
    let sourceRevision = entry.canvasRevision;
    if (canvas) {
      const snapshot = await canvas.read(entry.projectId);
      if (snapshot.revision < entry.canvasRevision) throw new SyncFailure(503, 'CANVAS_COMMIT_PENDING', 'Prepared canvas commit is not yet confirmed');
      const nodes = Array.isArray(snapshot.state.workbenchBasicNodes) ? snapshot.state.workbenchBasicNodes as Record<string, unknown>[] : [];
      const live = nodes.find(node => node.id === entry.nodeId && node.kind === 'text');
      if (!live) { journal.update(entry, { status: 'detached', error: 'Card removed; document retained' }); return; }
      if (live.text !== entry.content) throw new SyncFailure(409, 'CANVAS_SYNC_MOVED', 'Canvas changed after this intent; original draft retained');
      sourceRevision = snapshot.revision;
      if (typeof live.projectFilePath === 'string') entry = { ...entry, mirrorPath: live.projectFilePath };
    }
    const tenant = { teamId: entry.teamId, userId: entry.userId };
    const app = await deps.registry.get(entry.appId);
    if (!app || app.status !== 'active') throw new SyncFailure(503, 'DOC_UNAVAILABLE', 'Document App is not available; canvas content is retained');
    if (!appVisibleToTenant(app, tenant) || deps.entitlements.resolve(entry.appId, tenant) === 'deny') throw new SyncFailure(403, 'DOC_FORBIDDEN', 'Document App is unavailable to this caller');
    const created = await call(app.endpoint, entry, '/actions/doc.create', {
      nodeId: entry.nodeId, name: entry.title, content: entry.content, mirrorCanvasId: entry.projectId, mirrorPath: entry.mirrorPath,
    });
    const docId = created.instanceId;
    if (!docId) throw new SyncFailure(502, 'DOC_INVALID_RESPONSE', 'doc.create did not return an instanceId');
    const binding = { canvasInstanceId: entry.projectId, nodeId: entry.nodeId, kind: 'text', appId: entry.appId,
      appInstanceId: docId, mirrorPath: entry.mirrorPath, teamId: entry.teamId };
    deps.bindings.upsert(binding);
    journal.update(entry, { documentId: docId });
    // Unknown legacy baselines must never be inferred by declaring a fresh read
    // to be the base of an older draft. Only equality proves safe bootstrap.
    if (entry.baseContent === undefined) {
      const remote = await call(app.endpoint, entry, `/instances/${encodeURIComponent(docId)}/actions/doc.read`, {});
      if (remote.content !== entry.content) throw new SyncFailure(409, 'DOC_BASE_UNKNOWN', 'No known common baseline; preserve both documents', { currentContent: remote.content, currentRevision: remote.revision });
      entry = { ...entry, baseContent: entry.content };
    }
    const written = await call(app.endpoint, entry, `/instances/${encodeURIComponent(docId)}/actions/doc.write`, {
      content: entry.content, baseContent: entry.baseContent, expectedRevision: hash(entry.baseContent!),
      mirrorRevision: sourceRevision, mirrorBaseContent: entry.content,
    });
    if (typeof written.content !== 'string' || typeof written.revision !== 'string') throw new SyncFailure(502, 'DOC_INVALID_RESPONSE', 'Document write did not return its canonical snapshot');
    // If a newer local edit arrived while this request was in flight, its draft
    // is based on our submitted text, NOT on unseen remotely merged content.
    const newer = journal.get(entry.projectId, entry.nodeId);
    if (newer && newer.generation !== entry.generation) {
      journal.put({ ...newer, baseContent: entry.content, documentId: docId, updatedAt: Date.now() }); return;
    }
    if (written.mirror?.status !== 'synced') {
      journal.update(entry, { documentId: docId, documentRevision: written.revision, remoteContent: written.content,
        error: `Document saved; mirror ${written.mirror?.status ?? 'unconfirmed'}` });
      throw new SyncFailure(written.mirror?.status === 'conflict' ? 409 : 503, 'DOC_MIRROR_PENDING', 'Document saved; mirror still pending', { currentContent: written.content, currentRevision: written.revision });
    }
    journal.update(entry, { status: 'synced', content: written.content, baseContent: written.content, documentId: docId,
      documentRevision: written.revision, mirrorPath: written.mirror.path ?? entry.mirrorPath, attempts: 0, error: '', nextAttemptAt: 0 });
    deps.audit.record({ actor: tenant, action: 'doc.sync', appId: entry.appId, targetId: docId, status: 'succeeded' });
  };
  const attempt = (projectId: string, nodeId: string): Promise<void> => {
    const key = JSON.stringify([projectId, nodeId]);
    const prior = running.get(key);
    if (prior) return prior.then(() => attempt(projectId, nodeId), () => attempt(projectId, nodeId));
    const task = (async () => {
      const entry = journal.get(projectId, nodeId);
      if (!entry || entry.status === 'synced' || entry.status === 'detached') return;
      try { await deliver(entry); }
      catch (error) {
        const failure = error instanceof SyncFailure ? error : new SyncFailure(503, 'DOC_UNAVAILABLE', error instanceof Error ? error.message : String(error));
        const status = failure.status === 409 ? 'conflict' : failure.status < 500 || failure.code === 'DOC_CONCURRENCY_UNAVAILABLE' ? 'blocked' : 'pending';
        journal.update(entry, { status, attempts: entry.attempts + 1, error: `${failure.code}: ${failure.message}`,
          nextAttemptAt: Date.now() + Math.min(60000, 1000 * 2 ** Math.min(entry.attempts, 6)),
          ...(typeof failure.details?.currentContent === 'string' ? { remoteContent: failure.details.currentContent } : {}),
          ...(typeof failure.details?.currentRevision === 'string' ? { documentRevision: failure.details.currentRevision } : {}) });
        deps.audit.record({ actor: { teamId: entry.teamId, userId: entry.userId }, action: 'doc.sync', appId: entry.appId,
          targetId: entry.nodeId, status: 'failed', summary: `${failure.code}: ${failure.message}` });
        throw failure;
      }
    })();
    running.set(key, task);
    void task.finally(() => { if (running.get(key) === task) running.delete(key); }).catch(() => {});
    return task;
  };
  const sync = async (projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string) => {
    const entry = prepare(projectId, node, revision, baseContent);
    if (entry) await attempt(entry.projectId, entry.nodeId);
  };
  return Object.assign(sync, {
    prepare,
    attach(port: { read(id: string): Promise<CanvasStateSnapshot> }) { canvas = port; },
    status(projectId: string) { return journal.list(projectId); },
    confirmMirror(projectId: string, nodeId: string, documentId: string, documentRevision: string, content: string, mirrorPath: string, canvasRevision: number) {
      const entry = journal.get(projectId, nodeId);
      if (!entry || entry.canvasRevision > canvasRevision) return;
      journal.put({ ...entry, documentId, documentRevision, content, baseContent: content, mirrorPath, canvasRevision,
        status: 'synced', attempts: 0, nextAttemptAt: 0, error: '', updatedAt: Date.now() });
    },
    async retry(projectId?: string, nodeId?: string) {
      const entries = journal.list(projectId).filter(entry => (!nodeId || entry.nodeId === nodeId) && entry.status !== 'synced' && entry.status !== 'detached');
      await Promise.allSettled(entries.map(entry => attempt(entry.projectId, entry.nodeId)));
    },
    start() {
      if (timer) return;
      stopped = false;
      const tick = () => { if (!stopped) for (const entry of journal.list()) if (entry.status === 'pending' && entry.nextAttemptAt <= Date.now() && !running.has(JSON.stringify([entry.projectId, entry.nodeId]))) void attempt(entry.projectId, entry.nodeId).catch(() => {}); };
      timer = setInterval(tick, deps.retryIntervalMs ?? 5000); timer.unref(); tick();
    },
    async close() { stopped = true; if (timer) clearInterval(timer); timer = undefined; await Promise.allSettled([...running.values()]); },
  });
}
