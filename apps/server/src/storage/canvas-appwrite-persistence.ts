import { createHash, randomUUID } from 'node:crypto';
import { CanvasStateError, type StoredCanvasOperation } from '@bezier/canvas-core';
import type { CanvasFileContent, CanvasPersistence, CanvasStoredBlob } from '../canvas/persistence.js';
import { AppwriteClient, appwriteEnc as enc } from './appwrite-client.js';

interface CanvasDoc { $id: string; revision: number; state: string; operations?: string; snapshots?: string; extra?: string }
interface OperationDoc { $id: string; operationId: string; fingerprint: string; receipt: string; before: string; after: string }
interface FileIndexRow { $id: string; path: string; fileId: string }

/** State-document blob split into canvases-doc attributes. `extra` is a JSON
 * object carrying every unknown top-level field, so the file-backend
 * pass-through contract holds verbatim. */
const BLOB_KEYS = new Set(['version', 'projectId', 'updatedAt', 'state', 'revision', 'operations', 'snapshots']);

function packBlob(blob: CanvasStoredBlob): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(blob)) if (!BLOB_KEYS.has(key) && value !== undefined) extra[key] = value;
  return {
    revision: blob.revision,
    state: JSON.stringify(blob.state),
    operations: JSON.stringify(blob.operations ?? {}),
    snapshots: JSON.stringify(blob.snapshots ?? {}),
    extra: JSON.stringify(extra),
  };
}

function unpackBlob(doc: CanvasDoc | null): CanvasStoredBlob {
  const base: CanvasStoredBlob = { state: {}, revision: 0, operations: {}, snapshots: {} };
  if (!doc) return base;
  const extra = doc.extra ? JSON.parse(doc.extra) as Record<string, unknown> : {};
  return {
    ...extra, ...base,
    state: doc.state ? JSON.parse(doc.state) as Record<string, unknown> : {},
    revision: doc.revision ?? 0,
    operations: doc.operations ? JSON.parse(doc.operations) as Record<string, StoredCanvasOperation> : {},
    snapshots: doc.snapshots ? JSON.parse(doc.snapshots) as Record<string, NonNullable<CanvasStoredBlob['snapshots']>[string]> : {},
  };
}

/** Canvas state document + journal in one Appwrite doc: one PATCH commits
 * state, revision and the receipt journal atomically — identical to the
 * filesystem single-document write. `canvas_operations` is a best-effort
 * query index only; the doc journal is authoritative. Reads union both so
 * canvases created before the embedded journal still reply correctly. */
export class AppwriteCanvasPersistence implements CanvasPersistence {
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string,
    private readonly canvases = 'canvases', private readonly operations = 'canvas_operations') {}

  private docPath(projectId: string): string {
    return `${this.client.docsPath(this.databaseId, this.canvases)}/${enc(projectId)}`;
  }

  async load(projectId: string): Promise<CanvasStoredBlob> {
    const doc = await this.client.getOrNull<CanvasDoc>(this.docPath(projectId));
    const blob = unpackBlob(doc);
    // Legacy canvases journaled only into the index collection; union it in
    // under the embedded journal so old receipts keep replaying.
    if (doc) {
      const q = AppwriteClient.query([AppwriteClient.eq('canvasId', projectId), AppwriteClient.limit(5000)]);
      const rows = await this.client.call<{ documents: OperationDoc[] }>('GET', `${this.client.docsPath(this.databaseId, this.operations)}?${q}`);
      const operations = blob.operations ?? {};
      for (const row of rows.documents) {
        if (!operations[row.operationId]) operations[row.operationId] = { fingerprint: row.fingerprint, receipt: JSON.parse(row.receipt), before: JSON.parse(row.before), after: JSON.parse(row.after) };
      }
      blob.operations = operations;
    }
    return blob;
  }

  async commit(projectId: string, blob: CanvasStoredBlob, changedOperationId?: string): Promise<void> {
    const payload = packBlob(blob);
    const doc = await this.client.getOrNull<CanvasDoc>(this.docPath(projectId));
    if (doc) await this.client.call('PATCH', this.docPath(projectId), { data: payload });
    else await this.client.call('POST', this.client.docsPath(this.databaseId, this.canvases), { documentId: projectId, data: payload });
    // Query index: authoritative data already committed above, so a failure
    // here must not roll the commit back.
    if (changedOperationId && blob.operations?.[changedOperationId]) {
      const entry = blob.operations[changedOperationId];
      await this.client.call('POST', this.client.docsPath(this.databaseId, this.operations), {
        documentId: `op-${randomUUID().replaceAll('-', '').slice(0, 30)}`,
        data: { canvasId: projectId, operationId: changedOperationId, fingerprint: entry.fingerprint,
          receipt: JSON.stringify(entry.receipt), before: JSON.stringify(entry.before ?? {}), after: JSON.stringify(entry.after ?? {}) },
      }).catch(() => {});
    }
  }

  async describe(projectId: string): Promise<string> { return `appwrite://canvases/${projectId}`; }
}

type LocalRead = (projectId: string, relative: string) => Promise<Uint8Array | null>;

/** Canvas text files: bytes in the storage bucket, one canvas_files index row
 * per (canvasId, logical path). A missing index row falls back to the project
 * filesystem and self-heals into the bucket, so files that predate Appwrite —
 * or uploads that land on the project disk — keep working. */
export class AppwriteCanvasFileContent implements CanvasFileContent {
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string, private readonly bucketId: string,
    private readonly files = 'canvas_files', private readonly readLocal?: LocalRead) {}

  private async find(projectId: string, relative: string): Promise<FileIndexRow | null> {
    const q = AppwriteClient.query([AppwriteClient.eq('canvasId', projectId), AppwriteClient.eq('path', relative), AppwriteClient.limit(1)]);
    const body = await this.client.call<{ documents: FileIndexRow[] }>('GET', `${this.client.docsPath(this.databaseId, this.files)}?${q}`);
    return body.documents[0] ?? null;
  }

  private async download(fileId: string): Promise<Uint8Array> {
    return this.client.download(`/storage/buckets/${enc(this.bucketId)}/files/${enc(fileId)}/download`);
  }

  private async uploadIndexed(projectId: string, relative: string, bytes: Uint8Array, mime = 'text/markdown'): Promise<string> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const fileId = `txt-${hash.slice(0, 30)}`;
    await this.client.upload(this.bucketId, fileId, relative.split('/').pop() ?? 'file', bytes, mime)
      .catch((error: unknown) => {
        if (error instanceof CanvasStateError && error.status === 409) return;
        throw error;
      });
    const data = { canvasId: projectId, path: relative, fileId, kind: 'text', mime, size: bytes.length, sha256: hash, createdAt: new Date().toISOString() };
    const existing = await this.find(projectId, relative);
    if (!existing) {
      await this.client.call('POST', this.client.docsPath(this.databaseId, this.files), { documentId: `f-${randomUUID().replaceAll('-', '').slice(0, 30)}`, data })
        .catch((error: unknown) => {
          if (error instanceof CanvasStateError && error.status === 409) return;
          throw error;
        });
    } else if (existing.fileId !== fileId) {
      await this.client.call('PATCH', `${this.client.docsPath(this.databaseId, this.files)}/${enc(existing.$id)}`, { data });
      await this.deleteFile(existing.fileId).catch(() => {});
    }
    return fileId;
  }

  private async deleteFile(fileId: string): Promise<void> {
    await this.client.call('DELETE', `/storage/buckets/${enc(this.bucketId)}/files/${enc(fileId)}`);
  }

  async read(projectId: string, relative: string): Promise<string | null> {
    const row = await this.find(projectId, relative);
    if (row) return new TextDecoder().decode(await this.download(row.fileId));
    const local = this.readLocal ? await this.readLocal(projectId, relative) : null;
    if (local === null) return null;
    const fileId = await this.uploadIndexed(projectId, relative, local);
    return new TextDecoder().decode(await this.download(fileId));
  }

  async write(projectId: string, relative: string, content: string): Promise<void> {
    await this.uploadIndexed(projectId, relative, new TextEncoder().encode(content));
  }
}
