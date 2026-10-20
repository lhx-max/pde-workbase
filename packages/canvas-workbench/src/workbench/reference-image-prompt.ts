import { canvasRemainderCopy, cr } from '../locales/canvas-remainder';
import { REFERENCE_IMAGE_PROMPT_EN, REFERENCE_IMAGE_PROMPT_ZH, referenceImageGuidance } from '../locales/reference-image-body';

/** Saved prompts keep the Chinese guidance. New prompts follow the host locale. */
export const REFERENCE_IMAGE_PROMPT = REFERENCE_IMAGE_PROMPT_ZH;
export const REFERENCE_IMAGE_PROMPT_FINGERPRINT = canvasRemainderCopy('zh-CN').refSameLanguage;
export const REFERENCE_IMAGE_REQUIREMENT_LABEL = canvasRemainderCopy('zh-CN').refThisRequest;
export const REFERENCE_IMAGE_GUIDANCE_LABEL = canvasRemainderCopy('zh-CN').refUsage;

export type ReferenceImagePromptParts = {
  requirement: string;
  guidance: string;
};

export function buildReferenceImagePrompt(
  requirement: string,
  guidance = referenceImageGuidance(),
): string {
  return `${cr().refThisRequest}\n${requirement.trim()}\n\n${cr().refUsage}\n${guidance.trim()}`;
}

function requirementLabels() {
  return [canvasRemainderCopy('zh-CN'), canvasRemainderCopy('en')].map(copy => ({
    requirement: copy.refThisRequest,
    guidance: copy.refUsage,
  }));
}

export function extractReferenceImagePromptParts(prompt: string): ReferenceImagePromptParts | null {
  const matched = requirementLabels().find(labels => prompt.startsWith(labels.requirement));
  if (matched) {
    const guidanceMarker = `\n\n${matched.guidance}\n`;
    const guidanceStart = prompt.indexOf(guidanceMarker);
    if (guidanceStart >= 0) {
      return {
        requirement: prompt.slice(matched.requirement.length, guidanceStart).trim(),
        guidance: prompt.slice(guidanceStart + guidanceMarker.length).trim(),
      };
    }

    const bodies = [REFERENCE_IMAGE_PROMPT_ZH, REFERENCE_IMAGE_PROMPT_EN];
    const instructionStart = bodies.map(body => prompt.indexOf(body)).find(index => index >= 0) ?? -1;
    if (instructionStart >= 0) {
      return {
        requirement: prompt.slice(matched.requirement.length, instructionStart).trim(),
        guidance: prompt.slice(instructionStart).trim(),
      };
    }

    return {
      requirement: prompt.slice(matched.requirement.length).trim(),
      guidance: '',
    };
  }

  // 兼容已保存的旧顺序：通用约束在前，「本次需求」在末尾。
  const legacyMarker = `\n\n${REFERENCE_IMAGE_REQUIREMENT_LABEL}`;
  const requirementStart = prompt.lastIndexOf(legacyMarker);
  if (requirementStart >= 0 && prompt.includes(REFERENCE_IMAGE_PROMPT_FINGERPRINT)) {
    return {
      requirement: prompt.slice(requirementStart + legacyMarker.length).trim(),
      guidance: prompt.slice(0, requirementStart).trim(),
    };
  }

  return null;
}

export function extractReferenceImageRequirement(prompt: string): string | null {
  return extractReferenceImagePromptParts(prompt)?.requirement ?? null;
}

/**
 * 参考图资产的引导词。
 *
 * - 空草稿：直接填入通用约束，留出「本次需求」给用户继续写。
 * - 已有内容：把用户原文完整放进「本次需求」，不覆盖。
 * - 已注入：原样返回，避免重复选图时叠加同一段提示词。
 */
export function mergeReferenceImagePrompt(currentText: string): string {
  const existing = extractReferenceImagePromptParts(currentText);
  return existing
    ? buildReferenceImagePrompt(existing.requirement, existing.guidance)
    : buildReferenceImagePrompt(currentText);
}
