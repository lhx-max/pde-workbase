import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';

/** Historical guidance stored with saved prompts. Recognition keeps this exact text. */
export const REFERENCE_IMAGE_PROMPT_ZH = `以参考图为设计系统样张：跟随其色温结构、明暗分层、分区骨架、主次节奏、视觉重心、材质光影与空间纵深；不要复制参考图中可指认的主体、人物、地标、原标题字形、专属装饰和标识。

允许保留相似的大构图节奏、视觉重心与画面分区，但主体造型、叙事内容、文字和局部细节必须按照本次需求重新设计。视觉重量与留白节奏对齐参考图，禁止整盘更换色温，也禁止只换文字照搬原图。

目标：远看属于同一套设计语言，近看不是同一张图。

跟参考图：色温结构、明暗分层、分区骨架、主次节奏、视觉重心、材质光影、空间纵深与留白关系。
跟本案：主体、人物、文案和局部造型。`;

export const REFERENCE_IMAGE_PROMPT_EN = `Use the reference image as a design-system sample: follow its color-temperature structure, light and dark layers, layout skeleton, primary and secondary rhythm, visual focus, material light, and spatial depth. Do not copy identifiable subjects, people, landmarks, original title lettering, exclusive ornaments, or logos.

A similar overall rhythm, focus, and region split is fine, but the subject, story, text, and local details must be redesigned for this request. Match the reference's visual weight and whitespace. Do not replace the whole color temperature, and do not keep the original image while only swapping the words.

Goal: look like the same design language from afar, not the same image up close.

From the reference: color temperature, light and dark layers, layout skeleton, rhythm, focus, material light, depth, and whitespace.
From this request: subject, people, copy, and local form.`;

export function referenceImageGuidance(locale?: string | null): string {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? REFERENCE_IMAGE_PROMPT_ZH : REFERENCE_IMAGE_PROMPT_EN;
}
