import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@bezier/contracts';
import { AppwriteClient, appwriteEnc as enc } from './appwrite-client.js';
import { createProjectRegistry, type RegistryState } from './project-registry.js';
import { CanvasStateError } from '../canvas/errors.js';

/** This is the App's asset metadata, not a second MA business-project directory.
 * The JSON file is an explicitly disposable working projection, rebuilt from
 * the same canvases rows that own state. Metadata writes must be flushed before
 * an HTTP success or a canvas state commit. One backend writer is supported.
 */
export function createCloudProjectRegistry(root: string, client: AppwriteClient, databaseId: string) {
  let tail: Promise<void> = Promise.resolve();
  const metadata = new Map<string, string>();
  const legacyIds = new Set<string>();
  const docs = client.docsPath(databaseId, 'canvases');
  const ready = (async () => {
    const projects: Project[] = [];
    let offset = 0;
    while (true) {
      const query = AppwriteClient.query([AppwriteClient.limit(100), JSON.stringify({ method: 'offset', values: [offset] })]);
      const page = await client.call<{ total: number; documents: Array<{ $id: string; $createdAt?: string; $updatedAt?: string; teamId?: string; createdBy?: string; assetMetadata?: string }> }>('GET', `${docs}?${query}`);
      for (const row of page.documents) {
        // Legacy ownership is unknown. Keep the canvas addressable in this
        // process, and never stamp teamId/createdBy back onto the cloud row.
        if (!row.teamId || !row.createdBy || !row.assetMetadata) {
          const createdAt = Date.parse(row.$createdAt ?? '');
          const updatedAt = Date.parse(row.$updatedAt ?? '');
          projects.push({
            id: row.$id,
            name: row.$id,
            skillId: null,
            designSystemId: null,
            createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
          });
          legacyIds.add(row.$id);
          continue;
        }
        const project = JSON.parse(row.assetMetadata) as Project;
        if (project.id !== row.$id || project.teamId !== row.teamId || project.createdBy !== row.createdBy) throw new CanvasStateError(503, 'ASSET_OWNERSHIP_CORRUPT', 'Cloud canvas ownership metadata is inconsistent');
        projects.push(project); metadata.set(project.id, JSON.stringify(project));
      }
      offset += page.documents.length;
      if (offset >= page.total) break;
      if (!page.documents.length) throw new CanvasStateError(503, 'CANVAS_STORAGE_ERROR', 'Incomplete canvas metadata pagination');
    }
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'project-registry.json'), JSON.stringify({ version: 1, projects, tabs: {} } satisfies RegistryState), { mode: 0o600 });
  })();
  const registry = createProjectRegistry(root, snapshot => {
    tail = tail.then(async () => {
      await ready;
      for (const project of snapshot.projects) {
        if (legacyIds.has(project.id)) continue;
        if (!project.teamId || !project.createdBy) throw new CanvasStateError(400, 'ASSET_OWNERSHIP_REQUIRED', 'Canvas requires verified team and creator');
        const serialized = JSON.stringify(project);
        if (metadata.get(project.id) === serialized) continue;
        const target = `${docs}/${enc(project.id)}`;
        const existing = await client.getOrNull<{ teamId?: string; createdBy?: string }>(target);
        if (existing && (existing.teamId !== project.teamId || existing.createdBy !== project.createdBy)) throw new CanvasStateError(409, 'ASSET_OWNERSHIP_CONFLICT', 'Existing canvas ownership cannot be reassigned');
        const data = { teamId: project.teamId, createdBy: project.createdBy, assetMetadata: serialized };
        if (existing) await client.call('PATCH', target, { data });
        else await client.call('POST', docs, { documentId: project.id, data: { ...data, revision: 0, state: '{}', operations: '{}', snapshots: '{}', extra: '{}' } });
        metadata.set(project.id, serialized);
      }
      const retained=new Set(snapshot.projects.map(project=>project.id));
      for(const [id,serialized] of metadata){
        const project=JSON.parse(serialized) as Project;
        if(retained.has(id)||project.archivedAt)continue;
        const archived={...project,archivedAt:Date.now(),updatedAt:Date.now()};
        await client.call('PATCH',`${docs}/${enc(id)}`,{data:{assetMetadata:JSON.stringify(archived)}});
        metadata.set(id,JSON.stringify(archived));
      }
    });
    // Flush still observes the original rejection. Attach a sink immediately
    // so a failed async metadata write cannot become an unhandled rejection.
    void tail.catch(()=>{});
  });
  return Object.assign(registry, { ready, flush: async () => { await ready; await tail; } });
}
