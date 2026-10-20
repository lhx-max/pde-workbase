import type { CanvasSavedSnapshot, CanvasOperationReceipt } from '@bezier/contracts';
import type { StoredCanvasOperation } from './operations.js';

export type CanvasState = Record<string, unknown>;
export interface CanvasStateSnapshot { state: CanvasState; revision: number }
export interface CanvasStoredSnapshot extends CanvasStateSnapshot {
  operations: Record<string, StoredCanvasOperation>;
  snapshots?: Record<string, CanvasSavedSnapshot>;
}
export interface CanvasCommitInput {
  canvasId: string;
  expectedRevision: number;
  state: CanvasState;
  operation: StoredCanvasOperation;
}
/** Host resolves opaque canvasId and checks authorization before access.
 * State, monotonic revision and journal MUST commit in one atomic unit.
 * CAS requires storage-native conditional writes or shared serialization covering
 * every writer. GET + revision comparison + unconditional PUT is NOT CAS.
 * Same operation ID/input replays its receipt; different input fails with 409.
 * Unknown commit outcomes must be recovered by receipt, never a fresh ID. */
export interface CanvasStore {
  read(canvasId: string): Promise<CanvasStoredSnapshot>;
  compareAndSwap(input: CanvasCommitInput): Promise<CanvasStoredSnapshot & { receipt: CanvasOperationReceipt; replayed: boolean }>;
  receipt(canvasId: string, operationId: string): Promise<CanvasOperationReceipt | null>;
}
