import { PROJECT_LAYOUT, projectLayoutPath } from '@bezier/contracts';
import { cr } from '../locales/canvas-remainder';
export type CanvasWebpageGenerationIntent = {
  prompt: string;
  template?: string;
  templateTitle?: string;
  templateDescription?: string;
  templateReferencePath?: string;
  templatePrompt?: string;
  designSystemId?: string;
  designSystemTitle?: string;
};

export function normalizeCanvasWebpageGenerationIntent(input: {
  prompt?: unknown;
  template?: unknown;
  templateTitle?: unknown;
  templateDescription?: unknown;
  templateReferencePath?: unknown;
  templatePrompt?: unknown;
  designSystemId?: unknown;
  designSystemTitle?: unknown;
}): CanvasWebpageGenerationIntent {
  return {
    prompt: typeof input.prompt === 'string' ? input.prompt.trim() : '',
    ...(typeof input.template === 'string' && input.template
      ? { template: input.template }
      : {}),
    ...(typeof input.templateTitle === 'string' && input.templateTitle
      ? { templateTitle: input.templateTitle }
      : {}),
    ...(typeof input.templateDescription === 'string' && input.templateDescription
      ? { templateDescription: input.templateDescription }
      : {}),
    ...(typeof input.templateReferencePath === 'string' && input.templateReferencePath
      ? { templateReferencePath: input.templateReferencePath }
      : {}),
    ...(typeof input.templatePrompt === 'string' && input.templatePrompt
      ? { templatePrompt: input.templatePrompt }
      : {}),
    ...(typeof input.designSystemId === 'string' && input.designSystemId
      ? { designSystemId: input.designSystemId }
      : {}),
    ...(typeof input.designSystemTitle === 'string' && input.designSystemTitle
      ? { designSystemTitle: input.designSystemTitle }
      : {}),
  };
}

export function createWebpageGenerationTask(
  intent: CanvasWebpageGenerationIntent,
  requestId = globalThis.crypto.randomUUID(),
) {
  const outputPath = projectLayoutPath(PROJECT_LAYOUT.pages, `canvas-web-${requestId.slice(0, 8)}.html`);
  const templateInstruction = intent.templateReferencePath
    ? cr().webTemplateFromPath(intent.templateReferencePath)
    : cr().webTemplateAuto;
  const templatePrompt = intent.templatePrompt
    ? cr().webTemplateRequirement(intent.templatePrompt)
    : '';
  const designSystemInstruction = intent.designSystemId
    ? cr().webDesignSystemBound(intent.designSystemTitle || intent.designSystemId)
    : cr().webDesignSystemDefault;
  const agentPrompt = [
    cr().webAgentIntro(outputPath),
    templateInstruction,
    templatePrompt,
    designSystemInstruction,
    cr().webPreviewRule,
    cr().webRequest(intent.prompt),
  ].filter(Boolean).join('\n');

  return {
    requestId,
    outputPath,
    agentPrompt,
    visiblePrompt: cr().webVisiblePrompt(intent.templateTitle, intent.designSystemTitle, intent.prompt),
    designSystemId: intent.designSystemId,
  };
}
