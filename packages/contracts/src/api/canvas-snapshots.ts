import { z } from 'zod';
import type { CanvasOperationsResponse } from './canvas-operations.js';

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/).refine(value => !Object.hasOwn(Object.prototype, value));
const mutation = { operationId: id, baseRevision: z.number().int().nonnegative() };
export const canvasSnapshotCreateSchema = z.object({ ...mutation, name: z.string().trim().min(1).max(120) }).strict();
export const canvasSnapshotMutationSchema = z.object(mutation).strict();
export type CanvasSnapshotCreateRequest = z.infer<typeof canvasSnapshotCreateSchema>;
export type CanvasSnapshotMutationRequest = z.infer<typeof canvasSnapshotMutationSchema>;
export interface CanvasSnapshotInfo {
  id: string; name: string; createdAt: string; sourceRevision: number; nodeCount: number;
  scope: 'canvas-state-and-file-references';
}
export interface CanvasSnapshotFileReference { path: string; sha256: string; bytes: number }
export interface CanvasSavedSnapshot extends CanvasSnapshotInfo {
  state: Record<string, unknown>;
  files: CanvasSnapshotFileReference[];
  digest: string;
}
export interface CanvasSnapshotsResponse { revision: number; snapshots: CanvasSnapshotInfo[] }
export interface CanvasSnapshotResponse { revision: number; snapshot: CanvasSavedSnapshot }
export interface CanvasSnapshotMutationResponse extends CanvasOperationsResponse { snapshotId: string }
