import { createHash, randomUUID } from 'node:crypto';
import { CanvasStateError, type CanvasSketchStore, type CanvasVideoStore } from '@bezier/canvas-core';
import { AppwriteClient, appwriteEnc as enc } from './appwrite-client.js';

export type LocalRead = (relative: string) => Promise<Uint8Array | null>;

interface FileIndexRow { $id: string; path: string; fileId: string }

async function findFile(client: AppwriteClient, databaseId: string, files: string, canvasId: string, path: string): Promise<FileIndexRow | null> {
  const q = AppwriteClient.query([AppwriteClient.eq('canvasId', canvasId), AppwriteClient.eq('path', path), AppwriteClient.limit(1)]);
  const body = await client.call<{ documents: FileIndexRow[] }>('GET', `${client.docsPath(databaseId, files)}?${q}`);
  return body.documents[0] ?? null;
}

async function download(client: AppwriteClient, bucketId: string, fileId: string): Promise<Uint8Array> {
  return client.download(`/storage/buckets/${enc(bucketId)}/files/${enc(fileId)}/download`);
}

async function uploadIndexed(client: AppwriteClient, databaseId: string, bucketId: string, files: string, canvasId: string, relative: string, kind: string, mime: string, bytes: Uint8Array): Promise<string> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const fileId = `${kind.slice(0, 3)}-${hash.slice(0, 30)}`.slice(0, 36);
  await client.upload(bucketId, fileId, relative.split('/').pop() ?? 'file', bytes, mime)
    .catch((error: unknown) => {
      if (error instanceof CanvasStateError && error.status === 409) return;
      throw error;
    });
  const data = { canvasId, path: relative, fileId, kind, mime, size: bytes.length, sha256: hash, createdAt: new Date().toISOString() };
  await client.call('POST', client.docsPath(databaseId, files), { documentId: `f-${randomUUID().replaceAll('-', '').slice(0, 30)}`, data })
    .catch((error: unknown) => {
      if (error instanceof CanvasStateError && error.status === 409) return;
      throw error;
    });
  return fileId;
}

/** Index-aware read with a project-disk fallback: files uploaded to the
 * project directory (or predating Appwrite) mirror into the bucket on first
 * access. Without a fallback reader, a miss stays a miss. */
async function readWithFallback(client: AppwriteClient, databaseId: string, bucketId: string, files: string, canvasId: string, relative: string, kind: string, mime: string, readLocal: LocalRead | undefined, notFound: string, code: string): Promise<Uint8Array> {
  const row = await findFile(client, databaseId, files, canvasId, relative);
  if (row) return download(client, bucketId, row.fileId);
  const local = readLocal ? await readLocal(relative) : null;
  if (local === null) throw new CanvasStateError(404, code, notFound);
  await uploadIndexed(client, databaseId, bucketId, files, canvasId, relative, kind, mime, local);
  return local;
}

/** Sketch documents (.sketch.json) in the bucket, indexed by logical path. */
export class AppwriteSketchStore implements CanvasSketchStore {
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string, private readonly bucketId: string,
    private readonly canvasId: string, private readonly files = 'canvas_files', private readonly readLocal?: LocalRead) {}

  async readSketch(path: string): Promise<string> {
    const bytes = await readWithFallback(this.client, this.databaseId, this.bucketId, this.files, this.canvasId, path, 'sketch', 'application/json', this.readLocal, 'Sketch file not found', 'CANVAS_SKETCH_NOT_FOUND');
    return new TextDecoder().decode(bytes);
  }

  async putSketch(content: string, operationId: string, nodeId: string) {
    const hash = createHash('sha256').update(`${operationId}:${nodeId}:${content}`).digest('hex').slice(0, 24);
    const relative = `canvas-sketches/canvas-${hash}.sketch.json`;
    const existing = await findFile(this.client, this.databaseId, this.files, this.canvasId, relative);
    if (existing) {
      const stored = await this.readSketch(relative);
      if (stored !== content) throw new CanvasStateError(409, 'CANVAS_SKETCH_CONTENT_CHANGED', 'Stored sketch snapshot has changed');
      return { path: relative };
    }
    await uploadIndexed(this.client, this.databaseId, this.bucketId, this.files, this.canvasId, relative, 'sketch', 'application/json', new TextEncoder().encode(content));
    return { path: relative };
  }
}

/** Video presence/MP4 check against the bucket index. */
export class AppwriteVideoStore implements CanvasVideoStore {
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string, private readonly bucketId: string,
    private readonly canvasId: string, private readonly files = 'canvas_files', private readonly readLocal?: LocalRead) {}

  async assertVideo(path: string): Promise<void> {
    const bytes = await readWithFallback(this.client, this.databaseId, this.bucketId, this.files, this.canvasId, path, 'video', 'video/mp4', this.readLocal, 'Video file not found', 'CANVAS_VIDEO_NOT_FOUND');
    if (bytes.length < 12 || new TextDecoder('latin1').decode(bytes.subarray(4, 8)) !== 'ftyp')
      throw new CanvasStateError(400, 'CANVAS_INVALID_VIDEO', 'Expected an MP4 file');
  }
}
