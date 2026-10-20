import { z } from 'zod';

/** Resource identity is authority-bound by the daemon, never an arbitrary URL. */
export const thumbnailSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project-file'), projectId: z.string().min(1).max(256), filename: z.string().min(1).max(2048) }).strict(),
  z.object({ kind: z.literal('personal-asset'), assetId: z.string().min(1).max(256), versionId: z.string().min(1).max(256).optional() }).strict(),
  z.object({ kind: z.literal('template'), templateId: z.string().min(1).max(256) }).strict(),
]);
export type ThumbnailSource = z.infer<typeof thumbnailSourceSchema>;

export const thumbnailDocumentRequestSchema = z.object({
  source: thumbnailSourceSchema,
  /** Current editor visual source. Never writes back to the resource. */
  html: z.string().max(4 * 1024 * 1024).optional(),
  mode: z.enum(['page', 'deck']),
  viewport: z.object({
    width: z.number().int().min(160).max(4096),
    height: z.number().int().min(90).max(4096),
  }).strict().refine(value => value.width * value.height <= 4_194_304, 'Thumbnail viewport exceeds pixel budget'),
}).strict();
export type ThumbnailDocumentRequest = z.infer<typeof thumbnailDocumentRequestSchema>;

/** Register once per source revision; image requests share one renderer document. */
export interface ThumbnailDocumentResponse {
  documentId: string;
}

export const thumbnailPageQuerySchema = z.object({
  width: z.coerce.number().pipe(z.union([z.literal(320), z.literal(640)])).default(320),
  priority: z.enum(['active', 'visible', 'prefetch']).default('visible'),
}).strict();
export type ThumbnailPriority = z.infer<typeof thumbnailPageQuerySchema>['priority'];
export type ThumbnailWidth = 320 | 640;

/** GET /api/thumbnails/documents/:id/pages/:index returns image/webp or this error. */
export interface ThumbnailErrorResponse {
  error: {
    code: 'THUMBNAIL_INVALID_REQUEST' | 'THUMBNAIL_UNAVAILABLE' | 'THUMBNAIL_STALE' | 'THUMBNAIL_FAILED';
    message: string;
  };
}
