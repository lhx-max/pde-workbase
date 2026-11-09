import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { prepareCanvasDocument, prepareCanvasImage, prepareCanvasSketch, prepareCanvasVideo } from '@bezier/canvas-core';
import type { CanvasEffects } from '../canvas/state.js';
import type { ResolveCanvasProjectRoot } from '../canvas/persistence.js';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { sharpCanvasImageProcessor } from '../canvas/image-processor.js';
import { AppwriteClient } from './appwrite-client.js';
import { AppwriteCanvasAssetStore } from './canvas-appwrite-assets.js';
import { AppwriteSketchStore, AppwriteVideoStore } from './canvas-appwrite-stores.js';

export { AppwriteSketchStore, AppwriteVideoStore } from './canvas-appwrite-stores.js';

/** Project-disk reads for the Appwrite fallback path: files that were
 * uploaded to the project directory (or predate Appwrite) get mirrored into
 * the bucket on first access. */
export async function readLocalProjectFile(resolveRoot: ResolveCanvasProjectRoot, projectId: string, relative: string): Promise<Uint8Array | null> {
  const root = await resolveRoot(projectId);
  if (!root) return null;
  const safe = normalizeSafeProjectFilePath(relative);
  try { assertProjectPathHasNoSymlinks(root, safe); } catch { return null; }
  const file = path.join(path.resolve(root), safe);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 30_000_000) return null;
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Effects handlers for the Appwrite backend: image/document via the shared
 * asset store, sketch/video via their own stores. Same logical paths as the
 * filesystem mode, so canvas state stays portable; local project files are
 * mirrored into the bucket on first read. */
export function appwriteCanvasEffects(client: AppwriteClient, databaseId: string, bucketId: string, resolveRoot?: ResolveCanvasProjectRoot): (projectId: string, operationId: string) => CanvasEffects {
  return (projectId, operationId) => {
    const readLocal = resolveRoot ? (relative: string) => readLocalProjectFile(resolveRoot, projectId, relative) : undefined;
    const assets = new AppwriteCanvasAssetStore(client, databaseId, bucketId, projectId, 'canvas_files', readLocal);
    const sketches = new AppwriteSketchStore(client, databaseId, bucketId, projectId, 'canvas_files', readLocal);
    const videos = new AppwriteVideoStore(client, databaseId, bucketId, projectId, 'canvas_files', readLocal);
    return {
      image: (op, node) => prepareCanvasImage(assets, sharpCanvasImageProcessor, operationId, op, node),
      document: (op, node) => prepareCanvasDocument(assets, operationId, op, node),
      sketch: (op, node) => prepareCanvasSketch(sketches, operationId, op, node),
      video: (op, node) => prepareCanvasVideo(videos, operationId, op, node),
    };
  };
}
