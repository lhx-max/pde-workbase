import { PROJECT_LAYOUT, projectLayoutPath } from '@bezier/contracts';
import { cr } from '../locales/canvas-remainder';
export const PRESENTATION_LENGTH_OPTIONS = [
  { value: 'concise' as const, slides: 6, get label() { return cr().lengthBrief; }, get detail() { return cr().lengthBriefDetail; } },
  { value: 'standard' as const, slides: 10, get label() { return cr().lengthMedium; }, get detail() { return cr().lengthMediumDetail; } },
  { value: 'detailed' as const, slides: 15, get label() { return cr().lengthDetailed; }, get detail() { return cr().lengthDetailedDetail; } },
];
export type CanvasPresentationLength = (typeof PRESENTATION_LENGTH_OPTIONS)[number]['value'];

export type CanvasPresentationGenerationIntent = {
  prompt: string;
  length: CanvasPresentationLength;
  template: string;
  templateTitle: string;
  templateDescription?: string;
  templateReferencePath?: string;
  templatePrompt?: string;
};

export type CanvasPresentationGenerationLaunchRequest = CanvasPresentationGenerationIntent & {
  nonce: string;
};

export function normalizeCanvasPresentationGenerationIntent(input: {
  prompt?: unknown;
  length?: unknown;
  template?: unknown;
  templateTitle?: unknown;
  templateDescription?: unknown;
  templateReferencePath?: unknown;
  templatePrompt?: unknown;
}): CanvasPresentationGenerationIntent {
  const length = PRESENTATION_LENGTH_OPTIONS.some(option => option.value === input.length)
    ? input.length as CanvasPresentationLength
    : 'standard';
  return {
    prompt: typeof input.prompt === 'string' ? input.prompt.trim() : '',
    length,
    template: typeof input.template === 'string' && input.template ? input.template : 'smart',
    templateTitle: typeof input.templateTitle === 'string' && input.templateTitle
      ? input.templateTitle
      : cr().smartMatch,
    ...(typeof input.templateDescription === 'string' && input.templateDescription
      ? { templateDescription: input.templateDescription }
      : {}),
    ...(typeof input.templateReferencePath === 'string' && input.templateReferencePath
      ? { templateReferencePath: input.templateReferencePath }
      : {}),
    ...(typeof input.templatePrompt === 'string' && input.templatePrompt
      ? { templatePrompt: input.templatePrompt }
      : {}),
  };
}

export function createPresentationGenerationTask(
  intent: CanvasPresentationGenerationIntent,
  requestId = globalThis.crypto.randomUUID(),
) {
  const selectedLength = PRESENTATION_LENGTH_OPTIONS.find(option => option.value === intent.length)
    ?? PRESENTATION_LENGTH_OPTIONS[1]!;
  const outputPath = projectLayoutPath(PROJECT_LAYOUT.presentations, `canvas-ppt-${requestId.slice(0, 8)}.html`);
  const description = intent.templateDescription || cr().smartMatchDetail;
  const agentPrompt = cr().presentationAgentPrompt({
    lengthLabel: selectedLength.label,
    lengthDetail: selectedLength.detail,
    templateTitle: intent.templateTitle,
    description,
    templateReferencePath: intent.templateReferencePath,
    templatePrompt: intent.templatePrompt,
    outputPath,
    slides: selectedLength.slides,
    prompt: intent.prompt,
  });
  return {
    requestId,
    outputPath,
    totalSlides: selectedLength.slides,
    agentPrompt,
    visiblePrompt: cr().presentationVisiblePrompt(selectedLength.label, intent.templateTitle, intent.prompt),
  };
}
