import { z } from 'zod';

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/).refine(value => !Object.hasOwn(Object.prototype, value), 'Reserved ID');
const ids = z.array(id).min(1).max(100).refine(values => new Set(values).size === values.length, 'Duplicate node IDs');
const coordinate = z.number().finite().min(-1e7).max(1e7);
export const canvasLayoutModeSchema = z.enum(['left', 'center-x', 'right', 'top', 'center-y', 'bottom', 'distribute-x', 'distribute-y', 'row', 'column', 'grid', 'flow']);
export type CanvasLayoutMode = z.infer<typeof canvasLayoutModeSchema>;
export const canvasRelationsLayoutSchemas = [
  z.object({ type: z.literal('group.create'), groupId: id, nodeIds: ids.refine(values => values.length >= 2), name: z.string().trim().min(1).max(160).optional() }).strict(),
  z.object({ type: z.literal('group.rename'), groupId: id, name: z.string().trim().min(1).max(160) }).strict(),
  z.object({ type: z.literal('group.add'), groupId: id, nodeIds: ids }).strict(),
  z.object({ type: z.literal('group.remove'), groupId: id, nodeIds: ids }).strict(),
  z.object({ type: z.literal('group.dissolve'), groupId: id }).strict(),
  z.object({ type: z.literal('group.move'), groupId: id, x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal('layout.arrange'), nodeIds: ids.refine(values => values.length >= 2), mode: canvasLayoutModeSchema, gap: z.number().finite().min(0).max(10000).optional(), columns: z.number().int().min(1).max(100).optional() }).strict(),
] as const;
export const canvasRelationsLayoutSchema = z.discriminatedUnion('type', canvasRelationsLayoutSchemas);
export type CanvasRelationsLayoutOperation = z.infer<typeof canvasRelationsLayoutSchema>;
