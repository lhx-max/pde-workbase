import type { CanvasOperation } from '@bezier/contracts';

export type CanvasItem = Record<string, unknown> & { id: string };
export type ImageOperation = Extract<CanvasOperation, { type: 'image.attach' | 'image.replace' | 'image.transform' | 'image.select' }>;
export type DocumentOperation = Extract<CanvasOperation, { type: 'document.create' | 'document.begin' | 'document.select' }>;
export interface CanvasImageSource {
  bytes: Uint8Array;
  name: string;
  sourceAsset?: unknown;
}
/** Bound to one authorized canvas by the host. No caller-supplied URLs are fetched.
 * Writes create immutable files and reject existing content that differs.
 * A failed later state commit can leave an unreferenced file, never overwrite one. */
export interface CanvasAssetStore {
  readImage(path: string): Promise<Uint8Array>;
  readAssetImage(assetId: string, versionId?: string): Promise<CanvasImageSource>;
  putImage(bytes: Uint8Array): Promise<{ path: string; src: string }>;
  readDocument(path: string): Promise<string>;
  assertNewDocumentPath(path: string): Promise<void>;
  putDocument(input: { html: string; operationId: string; nodeId: string; format: 'html' | 'presentation'; sourcePath?: string }): Promise<string>;
}
export interface CanvasImageProcessor {
  process(bytes: Uint8Array, operation: ImageOperation): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}
