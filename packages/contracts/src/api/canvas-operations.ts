import { canvasRelationsLayoutSchemas } from './canvas-relations-layout.js';
import { z } from 'zod';
import { canvasSketchDocumentSchema } from './canvas-cards.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/).refine(v => !Object.prototype.hasOwnProperty.call(Object.prototype, v), 'Reserved ID');
const coordinate = z.number().finite().min(-1e7).max(1e7);
const projectImagePath = z.string().min(1).max(2000);
export const canvasImageSourceSchema = z.union([
  z.object({path: projectImagePath}).strict(),
  z.object({assetId: z.string().min(1).max(200), versionId: z.string().min(1).max(200).optional()}).strict(),
]);
export const canvasImageCropSchema = z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).strict();
const baseCollection = z.array(z.object({ id: z.string().min(1) }).passthrough())
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate base IDs');
const textFields = z.object({
  title: z.string().max(1000), text: z.string().max(500_000),
  x: coordinate, y: coordinate,
  width: z.number().finite().min(40).max(10000), height: z.number().finite().min(40).max(10000),
  textEntryMode: z.literal('edit'),
}).partial().strict();
export const canvasTextNodeSchema = textFields.extend({ id, kind: z.literal('text'), x: coordinate, y: coordinate }).strict();
const dimensions = { width: z.number().finite().min(40).max(10000), height: z.number().finite().min(40).max(10000) };
const commonCard = z.object({id, x:coordinate, y:coordinate, title:z.string().max(1000).optional(), width:dimensions.width.optional(),height:dimensions.height.optional()});
const videoFields = z.object({text:z.string().max(500_000).optional(),videoModel:z.string().max(200).optional(),videoMode:z.enum(['t2v','i2v','firstlast']).optional(),videoAspect:z.enum(['16:9','9:16','1:1','4:3','3:4']).optional(),videoLength:z.number().int().min(1).max(120).optional(),videoResolution:z.string().max(40).optional(),videoFirstFrameUrl:z.string().url().max(4000).optional(),videoLastFrameUrl:z.string().url().max(4000).optional()}).strict();
const storyboardShotFields = z.object({description:z.string().max(50000).optional(),shotSize:z.enum(['远景','全景','中景','近景','特写']).optional(),cameraMovement:z.enum(['固定','推进','拉远','横移','跟拍','环绕']).optional(),durationSec:z.number().finite().min(1).max(120).optional(),dialogue:z.string().max(50000).optional(),lighting:z.string().max(10000).optional(),sound:z.string().max(10000).optional(),finalPrompt:z.string().max(50000).optional()}).strict();
export const canvasCardKindSchema = z.string().min(7).max(160).regex(/^card\.[a-z0-9-]+\.[a-z0-9-]+$/, 'Card kinds use card.<team>.<name>');
export const canvasBasicCardSchema = z.union([canvasTextNodeSchema,
  commonCard.extend({kind:z.literal('storyboard')}).strict(),
  commonCard.extend({kind:z.literal('video'),...videoFields.shape}).strict(),
  // Team card packs: envelope is validated, `data` is the team's opaque box and
  // passthrough keeps any other team-owned top-level fields across persistence.
  commonCard.extend({kind:canvasCardKindSchema,data:z.record(z.string(),z.unknown()).optional(),dataVersion:z.number().int().nonnegative().optional()}).passthrough(),
]);
export const canvasOperationSchema = z.discriminatedUnion('type', [
  ...canvasRelationsLayoutSchemas,
  z.object({type:z.literal('document.create'),nodeId:id,format:z.enum(['html','presentation']),x:coordinate,y:coordinate,width:z.number().min(40).max(10000).optional(),height:z.number().min(40).max(10000).optional(),title:z.string().max(1000).optional(),prompt:z.string().max(500_000).optional(),source:z.union([z.object({path:projectImagePath}).strict(),z.object({html:z.string().min(1).max(5_000_000)}).strict()]).optional()}).strict(),
  z.object({type:z.literal('document.begin'),nodeId:id,requestId:id,outputPath:projectImagePath,expectedPath:z.string().max(2000).optional()}).strict(),
  z.object({type:z.literal('document.select'),nodeId:id,path:projectImagePath,expectedPath:projectImagePath.optional()}).strict(),
  z.object({type:z.literal('image.attach'),nodeId:id,source:canvasImageSourceSchema,x:coordinate,y:coordinate,name:z.string().min(1).max(1000).optional()}).strict(),
  z.object({type:z.literal('image.replace'),nodeId:id,source:canvasImageSourceSchema,expectedPath:projectImagePath.optional()}).strict(),
  z.object({type:z.literal('image.transform'),nodeId:id,crop:canvasImageCropSchema.optional(),rotate:z.number().int().min(0).max(360).optional(),expectedPath:projectImagePath.optional()}).strict(),
  z.object({type:z.literal('image.select'),nodeId:id,path:projectImagePath,expectedPath:projectImagePath.optional()}).strict(),
  z.object({ type: z.literal('node.create'), node: canvasBasicCardSchema }).strict(),
  z.object({ type: z.literal('node.update'), nodeId: id, set: textFields.refine(v => Object.keys(v).length > 0) }).strict(),
  z.object({ type: z.literal('node.rename'), nodeId: id, title: z.string().max(1000) }).strict(),
  z.object({ type: z.literal('node.resize'), nodeId: id, ...dimensions }).strict(),
  z.object({ type: z.literal('sketch.create'), nodeId: id, x: coordinate, y: coordinate, title: z.string().max(1000).optional(), width: dimensions.width.optional(), height: dimensions.height.optional(), source: z.union([z.object({ path: projectImagePath }).strict(), z.object({ document: canvasSketchDocumentSchema }).strict()]).optional() }).strict(),
  z.object({ type: z.literal('sketch.update'), nodeId: id, document: canvasSketchDocumentSchema, expectedPath: projectImagePath, expectedContent: z.string().max(5_000_000) }).strict(),
  z.object({type:z.literal('storyboard.shot.add'),nodeId:id,shotId:id,index:z.number().int().min(0).max(50).optional(),set:storyboardShotFields.optional()}).strict(),
  z.object({type:z.literal('storyboard.shot.update'),nodeId:id,shotId:id,set:storyboardShotFields.refine(v=>Object.keys(v).length>0)}).strict(),
  z.object({type:z.literal('storyboard.shot.references'),nodeId:id,shotId:id,characters:z.array(z.object({assetId:z.string().min(1).max(200),variantId:z.string().min(1).max(200).optional()}).strict()).max(50),scene:z.object({assetId:z.string().min(1).max(200),variantId:z.string().min(1).max(200).optional()}).strict().nullable()}).strict(),
  z.object({type:z.literal('storyboard.shot.move'),nodeId:id,shotId:id,index:z.number().int().min(0).max(49)}).strict(),
  z.object({type:z.literal('storyboard.shot.delete'),nodeId:id,shotId:id}).strict(),
  z.object({type:z.literal('storyboard.shot.duplicate'),nodeId:id,shotId:id,newShotId:id}).strict(),
  z.object({type:z.literal('video.configure'),nodeId:id,set:videoFields.refine(v=>Object.keys(v).length>0)}).strict(),
  z.object({type:z.literal('video.attach'),nodeId:id,path:projectImagePath,expectedPath:z.string().max(2000).optional()}).strict(),
  z.object({type:z.literal('video.select'),nodeId:id,resultId:id,expectedPath:z.string().max(2000).optional()}).strict(),
  z.object({ type: z.literal('node.move'), nodeId: id, x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal('node.duplicate'), nodeId: id, newNodeId: id, x: coordinate, y: coordinate }).strict(),
  z.object({ type: z.literal('node.delete'), nodeId: id }).strict(),
  z.object({ type: z.literal('edge.connect'), edge: z.object({ id, source: id, target: id,
    sourceHandle: z.string().max(160).nullable().optional(), targetHandle: z.string().max(160).nullable().optional(),
    data: z.object({ connectedAt: z.number().finite().optional() }).strict().optional(),
  }).strict() }).strict(),
  z.object({ type: z.literal('edge.disconnect'), edgeId: id }).strict(),
  z.object({ type: z.literal('operation.undo'), operationId: id }).strict(),
]);
/** Team card-pack operation: platform validates the envelope, `params` stays opaque. */
export const canvasCardOperationSchema = z.object({
  type: z.string().regex(/^card\.[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/, 'Card operations use card.<team>.<name>.<verb>'),
  nodeId: id,
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();
/** Template-literal discriminant keeps switch narrowing intact across the op union. */
export interface CanvasCardOperation {
  type: `card.${string}`;
  nodeId: string;
  params?: Record<string, unknown>;
}

export const canvasOperationsRequestSchema = z.object({
  operationId: id, baseRevision: z.number().finite().nonnegative().int(),
  operations: z.array(z.union([canvasOperationSchema, canvasCardOperationSchema])).min(1).max(100),
  // UI autosave can hold a draft from before its latest revision poll. These
  // read-only preconditions prevent that draft from overwriting a newer value.
  expectedState: z.object({ workbenchBasicNodes: baseCollection.optional(), workbenchEdges: baseCollection.optional(), workbenchImages: baseCollection.optional() }).strict().optional(),
}).strict();
export type CanvasOperation = z.infer<typeof canvasOperationSchema>;
export type CanvasOperationsRequest = z.infer<typeof canvasOperationsRequestSchema>;
export interface CanvasOperationReceipt {
  operationId: string;
  status: 'applied' | 'noop';
  baseRevision: number;
  revision: number;
  nodeIds: string[];
  createdAt: string;
}
export interface CanvasOperationsResponse {
  ok: true;
  receipt: CanvasOperationReceipt;
  revision: number;
  state: Record<string, unknown>;
  replayed: boolean;
}

export const canvasOperationsJsonSchema = zodToJsonSchema(canvasOperationsRequestSchema, { target: 'jsonSchema7' });
