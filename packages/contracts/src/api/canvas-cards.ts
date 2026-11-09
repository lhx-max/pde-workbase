import { z } from 'zod';

/** File payloads preserve editor-owned fields (including future element types). */
export const canvasSketchDocumentSchema = z.union([
  z.object({ version: z.literal(1), items: z.array(z.record(z.unknown())).max(10000) }).passthrough(),
  z.object({ version: z.literal(2), elements: z.array(z.record(z.unknown())).max(10000),
    appState: z.record(z.unknown()).nullable().optional(), files: z.record(z.unknown()).optional(),
  }).passthrough(),
]);
export type CanvasSketchDocument = z.infer<typeof canvasSketchDocumentSchema>;
export const CANVAS_CARD_KINDS = ['text', 'image', 'sketch', 'storyboard', 'video', 'page', 'presentation'] as const;
