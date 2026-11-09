import { z } from 'zod';
import type { CanvasDescriptor } from './canvas-management.js';

export const CANVAS_EMBED_CHANNEL = 'da.canvas' as const;
export const canvasEmbedCommandSchema = z.discriminatedUnion('type', [
  z.object({ channel: z.literal(CANVAS_EMBED_CHANNEL), version: z.literal(1), requestId: z.string().min(1).max(128), canvasId: z.string().min(1).max(160), type: z.literal('save') }).strict(),
  z.object({ channel: z.literal(CANVAS_EMBED_CHANNEL), version: z.literal(1), requestId: z.string().min(1).max(128), canvasId: z.string().min(1).max(160), type: z.literal('context') }).strict(),
  z.object({ channel: z.literal(CANVAS_EMBED_CHANNEL), version: z.literal(1), requestId: z.string().min(1).max(128), canvasId: z.string().min(1).max(160), type: z.literal('focus'), nodeId: z.string().min(1).max(160) }).strict(),
]);
export type CanvasEmbedCommand = z.infer<typeof canvasEmbedCommandSchema>;
export type CanvasEmbedEvent = {
  channel: typeof CANVAS_EMBED_CHANNEL; version: 1; canvasId: string;
} & ({ type: 'ready' } | { type: 'result'; requestId: string; command: CanvasEmbedCommand['type']; result: unknown }
  | { type: 'error'; requestId: string; code: 'CANVAS_EMBED_ACTION_FAILED'; message: string });

/** A launch descriptor, never a new authorization grant or public share link. */
export interface CanvasEmbedResponse {
  canvas: CanvasDescriptor;
  embed: {
    path: string; workspaceId: string | null; mode: 'edit'; protocolVersion: 1;
    commands: readonly ['save', 'context', 'focus']; framing: 'same-origin' | 'configured-origins';
    /** Exact server-configured host origins; never an authorization grant. */
    allowedParentOrigins?: readonly string[];
  };
}
