import { canvasTextPath } from '@bezier/contracts';
import { createHash } from 'node:crypto';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { BindingStore } from '../storage/bindings.js';
import type { AuditLog } from '../storage/audit-log.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import { DocumentSyncJournal, type DocumentSyncEntry } from '../storage/document-sync-journal.js';
import { appVisibleToTenant, currentRequestTenant, forwardedAuthorityHeaders } from '../tenant.js';
import type { CanvasStateSnapshot, CanvasStateService } from './state.js';
import { CanvasStateError } from './errors.js';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
type CanvasPort = { read(id: string): Promise<CanvasStateSnapshot>; writeTextMirror?: CanvasStateService['writeTextMirror'] };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
class SyncFailure extends CanvasStateError {}
interface ActionResult { instanceId?: string; content?: string; revision?: string; meta?: { id?: string }; mirror?: { status?: string; path?: string; code?: string } }

/** Document-specific protocol stays in this adapter; canvas transactions only
 * publish text-change intents and never depend on an editor implementation. */
export function createDocSynchronizer(deps: {
  dataRoot: string; registry: AppRegistryStore; bindings: BindingStore; audit: AuditLog; entitlements: AppEntitlementStore;
  project: (id: string) => { teamId?: string; createdBy?: string; archivedAt?: number } | null | undefined;
  retryIntervalMs?: number; state?: JsonStatePort; requireVerifiedAuthority?: boolean;
}) {
  const journal = new DocumentSyncJournal(deps.dataRoot, deps.state);
  let canvas: CanvasPort | undefined;
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
    // Durable intents and journal mutations must reach storage before any
    // outbound document call can act on them.
    await deps.state?.flush();
    const authority=forwardedAuthorityHeaders(endpoint);
    if(deps.requireVerifiedAuthority){
      const caller=currentRequestTenant();
      if(!caller?.applicationInstanceId||caller.teamId!==entry.teamId||authority['x-mav-tenant']!==entry.teamId||authority['x-mav-application-instance-id']!==caller.applicationInstanceId||typeof authority['x-mav-sso-authorization']!=='string')throw new SyncFailure(503,'DOC_AUTHORITY_REQUIRED','Document delivery requires a fresh verified caller; retry explicitly after authentication');
    }
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}${suffix}`, {
      method: 'POST', redirect:'error', headers: { 'content-type': 'application/json', 'x-team-id': entry.teamId, 'x-user-id': entry.userId, ...authority },
      body: JSON.stringify({ input }), signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    let body: { data?: { result?: ActionResult }; error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    try { body = JSON.parse(text); }
    catch { throw new SyncFailure(response.ok ? 502 : response.status, `DOC_HTTP_${response.status}`, `Document service returned HTTP ${response.status} without a valid response`); }
    if (!response.ok) {const code=typeof body.error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,99}$/.test(body.error.code)?body.error.code:`DOC_HTTP_${response.status}`;throw new SyncFailure(response.status,code,`Document service refused synchronization (${code})`,body.error?.details);}
    if (!body.data?.result) throw new SyncFailure(502, 'DOC_INVALID_RESPONSE', 'Document service returned no result');
    return body.data.result;
  };
  const deliver = async (entry: DocumentSyncEntry): Promise<void> => {
    const owner = deps.project(entry.projectId);
    if (!owner || owner.archivedAt || (owner.teamId ?? 'local') !== entry.teamId) {
      journal.update(entry, { status: 'detached', error: 'Canvas removed, archived or tenant changed' }); return;
    }
    if (!canvas) throw new SyncFailure(503, 'CANVAS_STATE_UNAVAILABLE', 'Committed canvas state must be attached before delivery');
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
    if (entry.documentId && entry.documentId !== docId) {
      // A replacement binding is a different document, not another revision of
      // the old identity. Persist that loss of baseline before any retry, so a
      // second attempt cannot accidentally resurrect the old document's base.
      const { baseContent: _base, documentRevision: _revision, remoteContent: _remote, ...withoutOldDocument } = entry;
      entry = { ...withoutOldDocument, documentId: docId };
      const current = journal.get(entry.projectId, entry.nodeId);
      if (current?.generation === entry.generation) journal.put(entry);
    } else journal.update(entry, { documentId: docId });
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
        // The recorded failure must be durable before it propagates.
        await deps.state?.flush();
        throw failure;
      }
      // A resolved attempt leaves no journal mutation unflushed.
      await deps.state?.flush();
    })();
    running.set(key, task);
    void task.finally(() => { if (running.get(key) === task) running.delete(key); }).catch(() => {});
    return task;
  };
  const sync = async (projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string) => {
    const entry = prepare(projectId, node, revision, baseContent);
    if (entry) {
      try { await attempt(entry.projectId, entry.nodeId); }
      catch (error) {
        // An uninstalled optional App is not a failed canvas save. Its durable
        // intent remains pending for a later installation; no doc success is claimed.
        if (error instanceof SyncFailure && error.code === 'DOC_UNAVAILABLE' && !await deps.registry.get(entry.appId)) return;
        throw error;
      }
    }
  };
  return Object.assign(sync, {
    prepare,
    attach(port: CanvasPort) { canvas = port; },
    status(projectId: string) { return journal.list(projectId); },
    confirmMirror(projectId: string, nodeId: string, documentId: string, documentRevision: string, content: string, mirrorPath: string, canvasRevision: number) {
      const entry = journal.get(projectId, nodeId);
      if (!entry || entry.canvasRevision > canvasRevision) return;
      journal.put({ ...entry, documentId, documentRevision, content, baseContent: content, mirrorPath, canvasRevision,
        status: 'synced', attempts: 0, nextAttemptAt: 0, error: '', updatedAt: Date.now() });
    },
    async retry(projectId?: string, nodeId?: string) {
      const entries = journal.list(projectId).filter(entry => (!nodeId || entry.nodeId === nodeId) && entry.status !== 'synced' && entry.status !== 'detached');
      const caller = currentRequestTenant();
      for (const entry of entries) if (caller) {
        if (caller.teamId !== entry.teamId) throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'Cannot retry another team’s document');
        journal.put({ ...entry, userId: caller.userId, updatedAt: Date.now() });
      }
      const settled = await Promise.allSettled(entries.map(entry => attempt(entry.projectId, entry.nodeId)));
      await deps.state?.flush();
      // Delivery failures stay journaled for later attempts; storage failures
      // must propagate instead of reporting the retry as settled.
      const storage = settled.find(result => result.status === 'rejected' && !(result.reason instanceof SyncFailure));
      if (storage?.status === 'rejected') throw storage.reason;
    },
    async resolve(projectId: string, nodeId: string, choice: 'canvas' | 'document', expectedCanvasContent: string, expectedDocumentRevision: string) {
      const entry = journal.get(projectId, nodeId);
      const caller = currentRequestTenant();
      if (!entry || !entry.documentId) throw new CanvasStateError(404, 'DOCUMENT_SYNC_NOT_FOUND', 'No document synchronization entry');
      const owner = deps.project(projectId);
      if (!owner || owner.archivedAt) throw new CanvasStateError(409, 'CANVAS_ARCHIVED', 'Conflict resolution cannot modify a missing or archived canvas');
      if ((owner.teamId ?? 'local') !== entry.teamId) throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'Canvas ownership changed');
      if (!caller || caller.teamId !== entry.teamId) throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'Conflict resolution requires the owning team');
      if (!canvas?.writeTextMirror) throw new CanvasStateError(503, 'DOCUMENT_SYNC_UNAVAILABLE', 'Canvas write adapter unavailable');
      const app = await deps.registry.get(entry.appId);
      if (!app || app.status !== 'active' || !appVisibleToTenant(app, caller) || deps.entitlements.resolve(entry.appId, caller) === 'deny') throw new CanvasStateError(403, 'DOC_FORBIDDEN', 'Document App is unavailable to caller');
      const snapshot = await canvas.read(projectId);
      const nodes = Array.isArray(snapshot.state.workbenchBasicNodes) ? snapshot.state.workbenchBasicNodes as Record<string, unknown>[] : [];
      const node = nodes.find(item => item.id === nodeId && item.kind === 'text');
      if (!node || node.text !== expectedCanvasContent) throw new CanvasStateError(409, 'CANVAS_CONTENT_CONFLICT', 'Canvas changed; inspect the latest versions before resolving');
      const authorizedEntry = { ...entry, userId: caller.userId };
      const remote = await call(app.endpoint, authorizedEntry, `/instances/${encodeURIComponent(entry.documentId)}/actions/doc.read`, {});
      if (typeof remote.content !== 'string' || remote.revision !== expectedDocumentRevision) throw new CanvasStateError(409, 'DOC_CONFLICT', 'Document changed; inspect the latest versions before resolving');
      const mirrorPath = typeof node.projectFilePath === 'string' ? node.projectFilePath : canvasTextPath(nodeId);
      if (choice === 'document') {
        await canvas.writeTextMirror(projectId, mirrorPath, remote.content, snapshot.revision,
          { nodeId, docId: entry.documentId, documentRevision: remote.revision, baseContent: expectedCanvasContent });
      } else {
        journal.put({ ...authorizedEntry, generation: entry.generation + 1, canvasRevision: snapshot.revision, mirrorPath,
          content: expectedCanvasContent, baseContent: remote.content, documentRevision: remote.revision, status: 'pending', attempts: 0, nextAttemptAt: 0, updatedAt: Date.now() });
        await attempt(projectId, nodeId);
      }
      deps.audit.record({ actor: caller, action: 'doc.sync.resolve', appId: entry.appId, targetId: entry.documentId, status: 'succeeded', summary: `Explicit ${choice} resolution` });
      await deps.state?.flush();
    },
    start() {
      if (timer) return;
      stopped = false;
      const report = (error: unknown) => console.warn('[document-sync] background storage failure', error);
      const tick = () => {
        if (stopped) return;
        // Push enqueued mutations (e.g. confirmMirror) and surface flush failures.
        void Promise.resolve(deps.state?.flush()).catch(report);
        // Background delivery cannot borrow an old user's MA identity. Keep
        // cloud intent durable and wait for an explicit authenticated retry.
        if(deps.requireVerifiedAuthority)return;
        try {
          for (const entry of journal.list()) {
            if (entry.status === 'pending' && entry.nextAttemptAt <= Date.now() && !running.has(JSON.stringify([entry.projectId, entry.nodeId]))) {
              // Delivery failures are journaled and audited by attempt(); only
              // non-delivery storage failures need reporting here.
              void attempt(entry.projectId, entry.nodeId).catch(error => { if (!(error instanceof SyncFailure)) report(error); });
            }
          }
        } catch (error) { report(error); }
      };
      timer = setInterval(tick, deps.retryIntervalMs ?? 5000); timer.unref(); tick();
    },
    async close() { stopped = true; if (timer) clearInterval(timer); timer = undefined; await Promise.allSettled([...running.values()]); await deps.state?.flush(); },
    async flush() { await deps.state?.flush(); },
  });
}
