import { cr } from '../locales/canvas-remainder';
export type AnnotationRegenerateModel = string;
export type AnnotationRegenerateRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type AnnotationRegenerateResolution = '2K' | '4K';

type SourceImage = {
  model?: string;
  ratio?: string;
  resolution?: string;
};

type UploadedAnnotation = {
  name: string;
  path: string;
};

type AnnotationRegenerateCanvasSource = SourceImage & {
  id: string;
  embeddedInSource?: boolean;
};

type AnnotationRegenerateOwner = {
  id: string;
};

const RATIOS = new Set<AnnotationRegenerateRatio>(['1:1', '3:4', '4:3', '9:16', '16:9']);
const RESOLUTIONS = new Set<AnnotationRegenerateResolution>(['2K', '4K']);

export function buildAnnotationRegenerateInstruction(annotationTexts: string[]): string {
  const texts = [...new Set(annotationTexts.map(text => text.trim()).filter(Boolean))];
  return [
    cr().annotateStrict,
    cr().annotateNotFinal,
    texts.length ? cr().annotateTexts(texts.join('；')) : '',
    cr().annotateKeepRest,
  ].filter(Boolean).join('\n');
}

export function buildAnnotationRegeneratePatch(
  source: SourceImage,
  annotated: UploadedAnnotation,
  instruction: string,
) {
  const model = source.model?.trim() || undefined;
  const ratio = RATIOS.has(source.ratio as AnnotationRegenerateRatio)
    ? source.ratio as AnnotationRegenerateRatio
    : undefined;
  const resolution = RESOLUTIONS.has(source.resolution as AnnotationRegenerateResolution)
    ? source.resolution as AnnotationRegenerateResolution
    : undefined;

  return {
    text: instruction.trim(),
    attachments: [
      { name: annotated.name, path: annotated.path, size: 0, mimeType: 'image/png' },
    ],
    ...(model ? { models: [model] } : {}),
    imageCount: 1,
    ...(ratio ? { imageRatios: [ratio] } : {}),
    ...(resolution ? { imageResolution: resolution } : {}),
    rawPrompt: true as const,
  };
}

/**
 * Build a self-contained target for annotation regeneration.
 *
 * The owner is optional on purpose: imported and legacy image nodes may never
 * have belonged to a visual card. Their visible image id is still a valid edge
 * source, so annotation regeneration must not be blocked by missing ownership.
 */
export function buildAnnotationRegenerateTarget(input: {
  source: AnnotationRegenerateCanvasSource;
  owner?: AnnotationRegenerateOwner | null;
  annotated: UploadedAnnotation;
  instruction: string;
  targetId: string;
  targetX: number;
  targetY: number;
  edgeId: string;
}) {
  const visibleSourceId = input.source.embeddedInSource && input.owner
    ? input.owner.id
    : input.source.id;
  return {
    targetInstance: {
      id: input.targetId,
      kind: 'visual' as const,
      x: input.targetX,
      y: input.targetY,
    },
    edge: {
      id: input.edgeId,
      source: visibleSourceId,
      target: input.targetId,
    },
    draft: buildAnnotationRegeneratePatch(input.source, input.annotated, input.instruction),
  };
}
