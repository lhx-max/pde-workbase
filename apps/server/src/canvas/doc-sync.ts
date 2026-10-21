import { canvasTextPath } from '@bezier/contracts';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { BindingStore } from '../storage/bindings.js';
import type { AuditLog } from '../storage/audit-log.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import { appVisibleToTenant } from '../tenant.js';

/** No process-local nodeId cache: binding identity belongs to a tenant AND
 * canvas. Every save refreshes the App's pointer after canvas copy-on-write. */
export function createDocSynchronizer(deps: {
  registry: AppRegistryStore;
  bindings: BindingStore;
  audit: AuditLog;
  entitlements: AppEntitlementStore;
  project: (id: string) => { teamId?: string; createdBy?: string } | null | undefined;
}) {
  return async (projectId: string, node: Record<string, unknown>): Promise<void> => {
    if (typeof node.id !== 'string' || typeof node.text !== 'string') return;
    const owner = deps.project(projectId);
    if (!owner) return;
    const tenant = { teamId: owner.teamId ?? 'local', userId: owner.createdBy ?? 'local' };
    const app = await deps.registry.get('doc');
    // A standalone canvas remains usable when doc is not installed.
    if (!app || app.status !== 'active' || !appVisibleToTenant(app, tenant)
      || deps.entitlements.resolve('doc', tenant) === 'deny') return;
    const mirrorPath = typeof node.projectFilePath === 'string' ? node.projectFilePath : canvasTextPath(node.id);
    const headers = { 'content-type': 'application/json', 'x-team-id': tenant.teamId, 'x-user-id': tenant.userId };
    const action = async (suffix: string, input: unknown) => {
      const response = await fetch(`${app.endpoint.replace(/\/+$/, '')}${suffix}`, {
        method: 'POST', headers, body: JSON.stringify({ input }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`doc synchronization ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return await response.json() as { data?: { result?: { instanceId?: string; mirror?: { status?: string } } } };
    };
    try {
      const created = await action('/actions/doc.create', {
        nodeId: node.id, name: node.title, content: node.text, mirrorCanvasId: projectId, mirrorPath,
      });
      const docId = created.data?.result?.instanceId;
      if (!docId) throw new Error('doc.create did not return an instanceId');
      deps.bindings.upsert({ canvasInstanceId: projectId, nodeId: node.id, kind: 'text', appId: 'doc',
        appInstanceId: docId, mirrorPath, teamId: tenant.teamId });
      const written = await action(`/instances/${encodeURIComponent(docId)}/actions/doc.write`, { content: node.text });
      const mirror = written.data?.result?.mirror?.status;
      if (mirror && mirror !== 'synced' && mirror !== 'unbound') throw new Error(`doc saved; canvas mirror ${mirror}`);
      deps.audit.record({ actor: tenant, action: 'doc.sync', appId: 'doc', targetId: docId, status: 'succeeded' });
    } catch (error) {
      deps.audit.record({ actor: tenant, action: 'doc.sync', appId: 'doc', targetId: node.id, status: 'failed',
        summary: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
}
