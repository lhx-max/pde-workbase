export const POSITIVE_OPERATION_REFERENCE_PROMPT = `以参考图为设计系统样张：跟随其色温结构、明暗分层、分区骨架、主次节奏、视觉重心、材质光影与空间纵深；不要复制参考图中可指认的主体、人物、地标、原标题字形、专属装饰和标识。

允许保留相似的大构图节奏、视觉重心与画面分区，但主体造型、叙事内容、文字和局部细节必须按照本次需求重新设计。视觉重量与留白节奏对齐参考图，禁止整盘更换色温，也禁止只换文字照搬原图。

目标：远看属于同一套设计语言，近看不是同一张图。

跟参考图：色温结构、明暗分层、分区骨架、主次节奏、视觉重心、材质光影、空间纵深与留白关系。
跟本案：主体、人物、文案和局部造型。`;

export const ORDINARY_GLOW_REFERENCE_PROMPT = `以参考图作为凡人微光背景层的设计依据：学习其色温、光影、空间层次、构图节奏与情绪氛围，但不要复制参考图中的人物、主体、文字、Logo、标识或专属装饰。

只生成供凡人微光三联人物合成使用的纯背景层：画面不得出现人物、文字、边框或 Logo；中部及三联人物承载区域保持低对比、干净留白，边缘可保留环境与氛围层次。左、中、右三张人物图会在后续固定版式中自动合成，不要提前生成或模拟人物框。

目标：背景与参考图属于同一视觉语言，同时为后续三联人物、标题与标识保留清晰安全区。`;

export const POSITIVE_OPERATION_REFERENCE_PROMPT_FINGERPRINT = '目标：远看属于同一套设计语言，近看不是同一张图。';
export const POSITIVE_OPERATION_REQUIREMENT_LABEL = '本次需求：';
export const POSITIVE_OPERATION_GUIDANCE_LABEL = '参考图使用要求：';

export type PositiveOperationPromptParts = {
  requirement: string;
  guidance: string;
};

export function buildPositiveOperationReferencePrompt(
  requirement: string,
  guidance = POSITIVE_OPERATION_REFERENCE_PROMPT,
): string {
  return `${POSITIVE_OPERATION_REQUIREMENT_LABEL}\n${requirement.trim()}\n\n${POSITIVE_OPERATION_GUIDANCE_LABEL}\n${guidance.trim()}`;
}

export function extractPositiveOperationPromptParts(prompt: string): PositiveOperationPromptParts | null {
  if (prompt.startsWith(POSITIVE_OPERATION_REQUIREMENT_LABEL)) {
    const guidanceMarker = `\n\n${POSITIVE_OPERATION_GUIDANCE_LABEL}\n`;
    const guidanceStart = prompt.indexOf(guidanceMarker);
    if (guidanceStart >= 0) {
      return {
        requirement: prompt.slice(POSITIVE_OPERATION_REQUIREMENT_LABEL.length, guidanceStart).trim(),
        guidance: prompt.slice(guidanceStart + guidanceMarker.length).trim(),
      };
    }

    // 兼容上一版已经把「本次需求」置顶，但尚未写入分隔标记的数据。
    const instructionStart = prompt.indexOf(POSITIVE_OPERATION_REFERENCE_PROMPT);
    if (instructionStart >= 0) {
      return {
        requirement: prompt.slice(POSITIVE_OPERATION_REQUIREMENT_LABEL.length, instructionStart).trim(),
        guidance: prompt.slice(instructionStart).trim(),
      };
    }

    return {
      requirement: prompt.slice(POSITIVE_OPERATION_REQUIREMENT_LABEL.length).trim(),
      guidance: '',
    };
  }

  // 兼容已保存的旧顺序：通用约束在前，「本次需求」在末尾。
  const legacyMarker = `\n\n${POSITIVE_OPERATION_REQUIREMENT_LABEL}`;
  const requirementStart = prompt.lastIndexOf(legacyMarker);
  if (requirementStart >= 0 && prompt.includes(POSITIVE_OPERATION_REFERENCE_PROMPT_FINGERPRINT)) {
    return {
      requirement: prompt.slice(requirementStart + legacyMarker.length).trim(),
      guidance: prompt.slice(0, requirementStart).trim(),
    };
  }

  return null;
}

export function extractPositiveOperationRequirement(prompt: string): string | null {
  return extractPositiveOperationPromptParts(prompt)?.requirement ?? null;
}

/**
 * 正向运营资产图的参考图引导词。
 *
 * - 空草稿：直接填入通用约束，留出「本次需求」给用户继续写。
 * - 已有内容：把用户原文完整放进「本次需求」，不覆盖。
 * - 已注入：原样返回，避免重复选图时叠加同一段提示词。
 */
export function mergePositiveOperationReferencePrompt(currentText: string): string {
  const existing = extractPositiveOperationPromptParts(currentText);
  return existing
    ? buildPositiveOperationReferencePrompt(existing.requirement, existing.guidance)
    : buildPositiveOperationReferencePrompt(currentText);
}

/**
 * 凡人微光使用独立的背景层约束，不复用其它正向运营图片的换主体规则。
 * 已有的「本次需求」完整保留；只有通用默认约束会被替换，用户手改过的
 * 自定义约束不会在重复选图时被覆盖。
 */
export function mergeOrdinaryGlowReferencePrompt(currentText: string): string {
  const existing = extractPositiveOperationPromptParts(currentText);
  if (!existing) return buildPositiveOperationReferencePrompt(currentText, ORDINARY_GLOW_REFERENCE_PROMPT);
  const guidance = !existing.guidance || existing.guidance === POSITIVE_OPERATION_REFERENCE_PROMPT
    ? ORDINARY_GLOW_REFERENCE_PROMPT
    : existing.guidance;
  return buildPositiveOperationReferencePrompt(existing.requirement, guidance);
}
