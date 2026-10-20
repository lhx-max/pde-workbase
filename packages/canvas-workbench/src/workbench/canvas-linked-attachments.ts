import { canvasTextPath, PROJECT_LAYOUT, projectLayoutPath } from '@bezier/contracts';
import { storyboardPlanToText, type StoryboardPlan } from './storyboard-card';
import { clipCompositionKey } from './clip-editor-session';
import type { CanvasClipTimeline } from './clip-timeline';
import { cr } from '../locales/canvas-remainder';

export type CanvasLinkedAttachment = {
  validationError?: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  /** The edge source that contributed this attachment. */
  sourceNodeId: string;
  /** Original image dimensions, used by downstream media nodes to follow the source ratio. */
  naturalWidth?: number;
  naturalHeight?: number;
  /** Canvas-native text that has not been materialized as a project file yet. */
  content?: string;
};

type BasicArtifactSource = {
  id: string;
  kind: 'text' | 'sketch' | 'page' | 'image' | 'artifact' | 'storyboard' | 'video' | 'clip';
  title?: string;
  text?: string;
  storyboard?: StoryboardPlan;
  projectFilePath?: string;
  clipTimeline?: CanvasClipTimeline;
  clipExportKey?: string;
  generation?: {
    previewPath?: string;
  };
  sourceMime?: string;
  artifactFormat?: 'html' | 'presentation';
};

type ImageArtifactSource = {
  id: string;
  path?: string;
  name?: string;
  groupId?: string;
  sourceInstanceId?: string;
  embeddedInSource?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
};

type CanvasEdgeLike = { source: string; target: string; data?: { skipSourceContext?: boolean } };

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || path;
}

function defaultBasicPath(source: BasicArtifactSource): string | undefined {
  if (source.kind === 'clip' && source.clipExportKey && source.clipTimeline && source.clipExportKey !== clipCompositionKey(source.clipTimeline)) return undefined;
  if (source.projectFilePath) return source.projectFilePath;
  // HTML/PPT generators know their durable output path before the run reaches
  // its terminal state. The live preview already reads this same file, so a
  // downstream edge must expose it as the source attachment as well; otherwise
  // the connection is visible on canvas but the target composer looks empty.
  if (source.generation?.previewPath) return source.generation.previewPath;
  if (source.kind === 'text') return canvasTextPath(source.id);
  if (source.kind === 'storyboard') return projectLayoutPath(PROJECT_LAYOUT.storyboards, `${source.id}.md`);
  return undefined;
}

function basicInlineContent(source: BasicArtifactSource): string | undefined {
  if (source.kind === 'text') return source.text;
  if (source.kind === 'storyboard' && source.storyboard) return storyboardPlanToText(source.storyboard);
  return undefined;
}

function imageMime(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  return 'image/png';
}

function basicMime(source: BasicArtifactSource, path: string): string {
  if (source.kind === 'sketch') return 'application/json';
  if (source.sourceMime) return source.sourceMime;
  if (source.kind === 'text' || source.kind === 'storyboard') return 'text/markdown';
  if (source.kind === 'page' || /\.html?$/i.test(path)) return 'text/html';
  if (/\.(mp4|mov|m4v|webm)$/i.test(path)) return path.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(path)) return path.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return imageMime(path);
  return 'application/octet-stream';
}

/**
 * Resolve one canvas output into project-backed attachments.
 *
 * This is intentionally source-oriented: every future output node only needs
 * to expose a durable project path here. Every connection mode then consumes
 * the same attachment contract instead of implementing its own copy logic.
 */
export function resolveCanvasSourceAttachments(args: {
  sourceNodeId: string;
  basicNodes: readonly BasicArtifactSource[];
  images: readonly ImageArtifactSource[];
  groups?: readonly { id: string; memberIds: string[] }[];
}): CanvasLinkedAttachment[] {
  const { sourceNodeId, basicNodes, images } = args;
  const group = args.groups?.find(item => item.id === sourceNodeId);
  if (group) {
    const members = group.memberIds.map(id => resolveCanvasSourceAttachments({ sourceNodeId: id, basicNodes, images }));
    const error = !members.length ? cr().linkedGroupEmpty
      : members.some(items => !items.length) ? cr().linkedMissing
      : members.some(items => items.some(item => !item.mimeType.startsWith('image/'))) ? cr().linkedImagesOnly : '';
    if (error) return [{ name: cr().groupRefUnavailable, path: '', size: 0, mimeType: 'application/x-canvas-reference-error', sourceNodeId, validationError: error }];
    const resolved = members.flat();
    return [...new Map(resolved.map(item => [item.path, { ...item, sourceNodeId }])).values()];
  }
  const basic = basicNodes.find(node => node.id === sourceNodeId);
  if (basic) {
    const path = defaultBasicPath(basic);
    if (!path) return [];
    const content = basicInlineContent(basic);
    return [{
      name: basic.title?.trim() || baseName(path) || cr().referenceTextMd,
      path,
      size: 0,
      mimeType: basicMime(basic, path),
      sourceNodeId,
      ...(content ? { content } : {}),
    }];
  }

  const sourceImages = images.filter(image => (
    image.id === sourceNodeId
    || image.groupId === sourceNodeId
    || (image.sourceInstanceId === sourceNodeId && image.embeddedInSource)
  ));
  const byPath = new Map<string, CanvasLinkedAttachment>();
  for (const image of sourceImages) {
    if (!image.path || byPath.has(image.path)) continue;
    byPath.set(image.path, {
      name: image.name || baseName(image.path) || 'reference.png',
      path: image.path,
      size: 0,
      mimeType: imageMime(image.path),
      sourceNodeId,
      ...(image.naturalWidth ? { naturalWidth: image.naturalWidth } : {}),
      ...(image.naturalHeight ? { naturalHeight: image.naturalHeight } : {}),
    });
  }
  return [...byPath.values()];
}

/** Build the attachment inputs for every target from the canonical edge list. */
export function linkedAttachmentsByTarget(args: {
  edges: readonly CanvasEdgeLike[];
  basicNodes: readonly BasicArtifactSource[];
  images: readonly ImageArtifactSource[];
  groups?: readonly { id: string; memberIds: string[] }[];
}): Map<string, CanvasLinkedAttachment[]> {
  const result = new Map<string, CanvasLinkedAttachment[]>();
  for (const edge of args.edges) {
    if (edge.data?.skipSourceContext) continue;
    const resolved = resolveCanvasSourceAttachments({
      sourceNodeId: edge.source,
      basicNodes: args.basicNodes,
      images: args.images,
      groups: args.groups,
    });
    if (resolved.length === 0) continue;
    const current = result.get(edge.target) || [];
    const bySourceAndPath = new Map(current.map(item => [`${item.sourceNodeId}:${item.path}`, item]));
    for (const attachment of resolved) {
      bySourceAndPath.set(`${attachment.sourceNodeId}:${attachment.path}`, attachment);
    }
    result.set(edge.target, [...bySourceAndPath.values()]);
  }
  return result;
}

export function sameLinkedAttachments(
  current: readonly CanvasLinkedAttachment[] | undefined,
  next: readonly CanvasLinkedAttachment[],
): boolean {
  if ((current?.length || 0) !== next.length) return false;
  return next.every((attachment, index) => {
    const existing = current?.[index];
    return existing?.name === attachment.name
      && existing.path === attachment.path
      && existing.size === attachment.size
      && existing.mimeType === attachment.mimeType
      && existing.sourceNodeId === attachment.sourceNodeId
      && existing.naturalWidth === attachment.naturalWidth
      && existing.naturalHeight === attachment.naturalHeight
      && existing.validationError === attachment.validationError
      && existing.content === attachment.content;
  });
}
