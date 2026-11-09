import { getCanvasMediaSnapshot } from '../platform/media-catalog';

export const CANVAS_IMAGE_GENERATION_MODELS = [
  'codex-gpt-image-2',
] as const;

import { IMAGE_GENERATION_RATIOS } from '@bezier/contracts';
export const CANVAS_IMAGE_GENERATION_RATIOS = IMAGE_GENERATION_RATIOS;

export type CanvasImageGenerationModel = string;
export type CanvasImageGenerationRatio = (typeof CANVAS_IMAGE_GENERATION_RATIOS)[number];
export type CanvasImageGenerationResolution = '2K' | '4K';

/**
 * One image-generation request, independent of the surface that created it.
 *
 * Home creates this intent before a project exists. The canvas consumes the
 * same values that its own image card uses, so Home never needs a second media
 * execution path or a shadow set of defaults.
 */
export type CanvasImageGenerationIntent = {
  prompt: string;
  model: CanvasImageGenerationModel;
  ratio: CanvasImageGenerationRatio;
  resolution: CanvasImageGenerationResolution;
};

export type CanvasImageGenerationReference = {
  name: string;
  path: string;
  size?: number;
};

export type CanvasImageGenerationLaunchRequest = CanvasImageGenerationIntent & {
  nonce: string;
  references: CanvasImageGenerationReference[];
};

export function normalizeCanvasImageGenerationIntent(input: {
  prompt?: unknown;
  model?: unknown;
  ratio?: unknown;
  resolution?: unknown;
}): CanvasImageGenerationIntent {
  const model = typeof input.model === 'string' && (
    (CANVAS_IMAGE_GENERATION_MODELS as readonly string[]).includes(input.model)
    || getCanvasMediaSnapshot().image.some(model => model.id === input.model)
  )
    ? input.model as CanvasImageGenerationModel
    : 'codex-gpt-image-2';
  const ratio = CANVAS_IMAGE_GENERATION_RATIOS.includes(
    input.ratio as CanvasImageGenerationRatio,
  )
    ? input.ratio as CanvasImageGenerationRatio
    : '1:1';
  return {
    prompt: typeof input.prompt === 'string' ? input.prompt.trim() : '',
    model,
    ratio,
    resolution: input.resolution === '4K' || input.resolution === '4k' ? '4K' : '2K',
  };
}
