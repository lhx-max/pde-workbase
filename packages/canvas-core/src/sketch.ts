import { canvasSketchDocumentSchema, type CanvasOperation } from '@bezier/contracts';
import type { CanvasItem } from './assets.js';
import { CanvasStateError } from './errors.js';

export type SketchOperation = Extract<CanvasOperation, { type: 'sketch.create' | 'sketch.update' }>;
export interface CanvasSketchStore {
  readSketch(path: string): Promise<string>;
  putSketch(content: string, operationId: string, nodeId: string): Promise<string>;
}

export async function prepareCanvasSketch(store: CanvasSketchStore, operationId: string, op: SketchOperation, current?: CanvasItem): Promise<CanvasItem> {
  let content: string;
  if (op.type === 'sketch.update') {
    if (!current || current.kind !== 'sketch') throw new CanvasStateError(400, 'CANVAS_OPERATION_UNSUPPORTED', 'Target is not a sketch');
    if (current.projectFilePath !== op.expectedPath || await store.readSketch(op.expectedPath) !== op.expectedContent)
      throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Sketch content changed');
    content = JSON.stringify(op.document);
  } else {
    content = op.source && 'path' in op.source ? await store.readSketch(op.source.path)
      : JSON.stringify(op.source?.document ?? { version: 2, elements: [], appState: {}, files: {} });
  }
  if (new TextEncoder().encode(content).length > 5_000_000)
    throw new CanvasStateError(400, 'CANVAS_INVALID_SKETCH', 'Sketch exceeds 5 MB');
  try { canvasSketchDocumentSchema.parse(JSON.parse(content)); }
  catch { throw new CanvasStateError(400, 'CANVAS_INVALID_SKETCH', 'Expected a version 1 or 2 sketch document'); }
  const projectFilePath = await store.putSketch(content, operationId, op.nodeId);
  if (op.type === 'sketch.update') return { ...current!, projectFilePath, sketchPending: false };
  return { id: op.nodeId, kind: 'sketch', x: op.x, y: op.y, width: op.width ?? 420, height: op.height ?? 300,
    title: op.title ?? '绘图', projectFilePath, sketchPending: false };
}
