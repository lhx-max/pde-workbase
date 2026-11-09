import {
  BROWSER_RESOURCE_LIMITS, BrowserResourceError,
  type BrowserResourceAction, type BrowserResourceErrorCode, type BrowserResourceGrant,
  type BrowserResourceItem, type BrowserResourceRead, type BrowserResourceSnapshot,
  type WorkspaceCollabContext,
} from '@bezier/contracts';
import { workspaceProjectHeaders } from './context';
import type { BrowserCaptureSource, BrowserSavedCapture } from './project-capture';

const ERROR_CODES = new Set<BrowserResourceErrorCode>([
  'unavailable', 'invalid-request', 'unauthorized', 'stale-document', 'unsupported-resource', 'too-large', 'timeout', 'read-failed',
]);
export function resourceErrorCode(error: unknown): BrowserResourceErrorCode {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && ERROR_CODES.has(code as BrowserResourceErrorCode) ? code as BrowserResourceErrorCode : 'read-failed';
}
export async function resourceCommand<A extends BrowserResourceAction>(
  projectId: string, grant: BrowserResourceGrant, action: A,
  input: { resourceId?: string; navigationId?: number } = {},
  context?: WorkspaceCollabContext | null, signal?: AbortSignal,
): Promise<A extends 'read' ? BrowserResourceRead : BrowserResourceSnapshot> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/browser-resources/${action}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-browser-resource-token': grant.accessToken,
      ...(context ? workspaceProjectHeaders(context) : {}) },
    body: JSON.stringify({ sessionId: grant.sessionId, ...input }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000),
  });
  const body = await response.json();
  if (!response.ok) {
    const code = resourceErrorCode(body?.error);
    throw new BrowserResourceError(code, 'Browser resource request failed');
  }
  return body;
}

/** Only native-attested, bounded bytes reach a preview or the existing upload API. */
export function resourceFile(result: BrowserResourceRead, name = result.name): File {
  if (typeof result.base64 !== 'string' || result.base64.length > Math.ceil(BROWSER_RESOURCE_LIMITS.bytes / 3) * 4
    || !/^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|flac)|font\/(woff2?|ttf|otf))$/.test(result.mime)) {
    throw new BrowserResourceError('unsupported-resource', 'Unsupported resource payload');
  }
  const binary = atob(result.base64);
  if (!binary.length || binary.length > BROWSER_RESOURCE_LIMITS.bytes) throw new BrowserResourceError('too-large', 'Resource exceeds the read limit');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], safeResourceFilename(name), { type: result.mime });
}
export function safeResourceFilename(value: string): string {
  return value.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 180) || 'resource';
}
export function resourceAssetKind(item: BrowserResourceItem): 'image' | 'video' | 'audio' | 'file' {
  return item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' ? item.kind : 'file';
}
export function resourceBytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function resourceCliCommand(projectId: string, grant: BrowserResourceGrant): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const origin = typeof window === 'undefined' ? undefined : window.location.origin;
  if (!origin || !/^https?:\/\//.test(origin)) throw new BrowserResourceError('unavailable', 'Browser server URL is unavailable');
  return `CANVAS_BROWSER_RESOURCE_TOKEN=${quote(grant.accessToken)} CANVAS_SERVER_URL=${quote(origin)} canvas-server browser resources list --project ${quote(projectId)} --session ${quote(grant.sessionId)} --json`;
}
export type ResourceSaveProgress = { id: string; state: 'reading' | 'saving' | 'saved' | 'failed' | 'cancelled'; error?: BrowserResourceErrorCode; assetId?: string };
export type ResourceBatchMetadata = { spaceId: string; tags: string[]; prefix: string; parentId?: string | null; aiFill?: boolean };
export type ResourceBatchUpload = (file: File, parentId: string | null, source: BrowserCaptureSource, spaceId: string,
  metadata: { kind: 'image' | 'video' | 'audio' | 'file'; tags: string[]; name: string; aiFill: boolean; captureId?: string }) => Promise<{ asset: BrowserSavedCapture }>;

/** Sequential, non-transactional import. Cancellation stops subsequent files;
 * an in-flight upload settles so its persisted outcome is never misreported.
 * Inputs are frozen at confirmation; successful IDs must not be resubmitted.
 */
export async function saveResourceBatch(options: {
  items: readonly BrowserResourceItem[]; navigationId: number; projectId: string;
  metadata: ResourceBatchMetadata; shouldStop(): boolean;
  read(item: BrowserResourceItem): Promise<BrowserResourceRead>;
  captureId?(item: BrowserResourceItem): string;
  upload: ResourceBatchUpload; onProgress(progress: ResourceSaveProgress): void;
}): Promise<void> {
  const items = Array.from(new Map(options.items.map(item => [item.id, item])).values());
  if (items.length > BROWSER_RESOURCE_LIMITS.batch) throw new BrowserResourceError('invalid-request', 'Too many selected resources');
  const metadata = { ...options.metadata, tags: [...options.metadata.tags] };
  for (const item of items) {
    if (options.shouldStop()) break;
    try {
      if (!item.readable) throw new BrowserResourceError('unsupported-resource', 'Resource is discovery-only');
      options.onProgress({ id: item.id, state: 'reading' });
      const result = await options.read(item);
      if (options.shouldStop()) { options.onProgress({ id: item.id, state: 'cancelled' }); break; }
      if (result.resourceId !== item.id || result.navigationId !== options.navigationId) {
        throw new BrowserResourceError('stale-document', 'Resource identity changed');
      }
      const filename = safeResourceFilename(`${metadata.prefix ? `${metadata.prefix}-` : ''}${result.name}`);
      const file = resourceFile(result, filename);
      options.onProgress({ id: item.id, state: 'saving' });
      const aiFill = metadata.aiFill === true && item.kind === 'image' && result.mime.startsWith('image/');
      const { asset } = await options.upload(file, metadata.parentId ?? null, { url: result.pageUrl, projectId: options.projectId }, metadata.spaceId,
        { kind: resourceAssetKind(item), tags: metadata.tags, name: filename, aiFill, captureId: options.captureId?.(item) });
      options.onProgress({ id: item.id, state: 'saved', assetId: asset.id });
    } catch (error) {
      options.onProgress({ id: item.id, state: 'failed', error: resourceErrorCode(error) });
      if (['stale-document', 'unauthorized', 'unavailable'].includes(resourceErrorCode(error))) break;
    }
  }
}
