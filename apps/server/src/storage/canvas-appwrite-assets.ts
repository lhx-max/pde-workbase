import { createHash, randomUUID } from 'node:crypto';
import { CanvasStateError, type CanvasAssetStore, type CanvasImageSource } from '@bezier/canvas-core';
import { PROJECT_LAYOUT } from '@bezier/contracts';
import { AppwriteClient } from './appwrite-client.js';
import { appwriteEnc as enc } from './appwrite-client.js';

interface FileIndexRow { $id: string; canvasId: string; path: string; fileId: string; kind: string; mime: string; size: number; sha256: string; createdAt: string }

/** Canvas files in Appwrite: bytes live in the storage bucket (object store /
 * CDN role from the 10-19 meeting), one canvas_files row indexes each
 * (canvasId, logical path) → fileId. Logical paths stay identical to the
 * filesystem mode so canvas state is portable between backends.
 * Video upload is intentionally out of scope this phase (research pending). */
export class AppwriteCanvasAssetStore implements CanvasAssetStore {
  private readonly files: string;
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string, private readonly bucketId: string, private readonly canvasId: string,
    filesCollection = 'canvas_files', private readonly readLocal?: (relative: string) => Promise<Uint8Array | null>) {
    this.files = filesCollection;
  }

  private async findFile(path: string): Promise<FileIndexRow | null> {
    const q = AppwriteClient.query([AppwriteClient.eq('canvasId', this.canvasId), AppwriteClient.eq('path', path), AppwriteClient.limit(1)]);
    const body = await this.client.call<{ documents: FileIndexRow[] }>('GET', `${this.client.docsPath(this.databaseId, this.files)}?${q}`);
    return body.documents[0] ?? null;
  }

  private async index(path: string, fileId: string, kind: string, mime: string, bytes: Uint8Array): Promise<void> {
    await this.client.call('POST', this.client.docsPath(this.databaseId, this.files), {
      documentId: `f-${randomUUID().replaceAll('-', '').slice(0, 30)}`,
      data: { canvasId: this.canvasId, path, fileId, kind, mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString() },
    });
  }

  /** Index miss falls back to the project filesystem and self-heals into the
   * bucket, so uploads that land on project disk work unchanged. */
  private async get(path: string, code: string, label: string, mime = 'application/octet-stream'): Promise<Uint8Array> {
    const row = await this.findFile(path);
    if (row) return this.client.download(`/storage/buckets/${enc(this.bucketId)}/files/${enc(row.fileId)}/download`);
    const local = this.readLocal ? await this.readLocal(path) : null;
    if (local === null) throw new CanvasStateError(404, code, `${label} not found`);
    const hash = createHash('sha256').update(local).digest('hex');
    const fileId = `f-${hash.slice(0, 30)}`;
    await this.client.upload(this.bucketId, fileId, path.split('/').pop() ?? 'file', local, mime)
      .catch((error: unknown) => {
        if (error instanceof CanvasStateError && error.status === 409) return;
        throw error;
      });
    await this.index(path, fileId, 'file', mime, local).catch((error: unknown) => {
      if (error instanceof CanvasStateError && error.status === 409) return;
      throw error;
    });
    return local;
  }

  async readImage(path: string): Promise<Uint8Array> {
    return this.get(path, 'CANVAS_IMAGE_NOT_FOUND', 'Image file', 'image/png');
  }

  async readAssetImage(): Promise<CanvasImageSource> {
    throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'Asset library is unavailable on the Appwrite backend');
  }

  async putImage(bytes: Uint8Array): Promise<{ path: string; src: string }> {
    if (bytes.length > 30_000_000) throw new CanvasStateError(400, 'CANVAS_INVALID_IMAGE', 'Image exceeds the 30 MB bucket limit');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = `${PROJECT_LAYOUT.images}/canvas-${hash}.png`;
    const existing = await this.findFile(path);
    if (existing) {
      const stored = await this.client.download(`/storage/buckets/${enc(this.bucketId)}/files/${enc(existing.fileId)}/download`);
      if (stored.length !== bytes.length || createHash('sha256').update(stored).digest('hex') !== hash)
        throw new CanvasStateError(409, 'CANVAS_IMAGE_CONTENT_CHANGED', 'Stored image snapshot has changed');
      return { path, src: `/api/projects/${encodeURIComponent(this.canvasId)}/files/${path.split('/').map(encodeURIComponent).join('/')}` };
    }
    const fileId = `img-${hash.slice(0, 30)}`;
    const uploaded = await this.client.upload(this.bucketId, fileId, `canvas-${hash}.png`, bytes, 'image/png')
      .catch(async (error: unknown) => {
        if (error instanceof CanvasStateError && error.status === 409) return { $id: fileId };
        throw error;
      });
    await this.index(path, uploaded.$id, 'image', 'image/png', bytes).catch((error: unknown) => {
      if (error instanceof CanvasStateError && error.status === 409) return; // claimed by the same-content commit
      throw error;
    });
    return { path, src: `/api/projects/${encodeURIComponent(this.canvasId)}/files/${path.split('/').map(encodeURIComponent).join('/')}` };
  }

  async readDocument(path: string): Promise<string> {
    const bytes = await this.get(path, 'CANVAS_DOCUMENT_NOT_FOUND', 'HTML file', 'text/html');
    const text = new TextDecoder().decode(bytes);
    if (text.length > 5_000_000) throw new CanvasStateError(400, 'CANVAS_INVALID_DOCUMENT', 'HTML exceeds 5 MB');
    return text;
  }

  async assertNewDocumentPath(path: string): Promise<void> {
    if (await this.findFile(path)) throw new CanvasStateError(409, 'CANVAS_INVALID_DOCUMENT', 'Use a new output path for generation');
  }

  async putDocument(input: { html: string; operationId: string; nodeId: string; format: 'html' | 'presentation'; sourcePath?: string }): Promise<string> {
    const bytes = new TextEncoder().encode(input.html);
    const hash = createHash('sha256').update(JSON.stringify([input.operationId, input.nodeId, input.html])).digest('hex').slice(0, 24);
    const directory = input.sourcePath ? input.sourcePath.split('/').slice(0, -1).join('/') : PROJECT_LAYOUT.pages;
    const path = `${directory}/canvas-${input.format === 'presentation' ? 'deck' : 'page'}-${hash}.html`;
    const existing = await this.findFile(path);
    if (existing) {
      const stored = await this.readDocument(path);
      if (stored !== input.html) throw new CanvasStateError(409, 'CANVAS_DOCUMENT_CONTENT_CHANGED', 'Stored document snapshot has changed');
      return path;
    }
    const fileId = `doc-${hash}`;
    const uploaded = await this.client.upload(this.bucketId, fileId, path.split('/').pop()!, bytes, 'text/html')
      .catch(async (error: unknown) => {
        if (error instanceof CanvasStateError && error.status === 409) return { $id: fileId };
        throw error;
      });
    await this.index(path, uploaded.$id, 'document', 'text/html', bytes).catch((error: unknown) => {
      if (error instanceof CanvasStateError && error.status === 409) return;
      throw error;
    });
    return path;
  }
}
