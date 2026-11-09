import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';

/** Persisted default variant name — keep Chinese for backward compatibility. */
export const STORYBOARD_DEFAULT_VARIANT_NAME = '默认';

export function storyboardAssetsCopy(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}
export function sac() { return storyboardAssetsCopy(getCanvasActiveLocale()); }

const EN = {
  sceneWide: 'Wide scene view that fully shows spatial structure, entrances/exits, and how key objects relate.',
  sceneMulti: 'Show multiple observation angles of the same scene in one image, keeping layout, architecture, and object placement consistent.',
  sceneTop: 'Top-down scene view that clearly shows layout, circulation, and key object placement.',
  sceneDetail: 'Scene detail close-up showing materials of architecture and props plus environmental detail.',
  subjectThree: 'Front, side, and back three-views of the same subject side by side in one image — consistent scale and look, clean background.',
  subjectFront: 'Full front view that clearly shows silhouette, structure, and appearance.',
  subjectDetail: 'Subject close-up that clearly shows local structure, materials, and distinctive details.',
  timeDay: 'Daytime, natural daylight.',
  timeDusk: 'Dusk, low-angle sunset light and soft twilight.',
  timeNight: 'Night, artificial light and night ambience matching the scene setting.',
  refPolicyOnlyUser: 'Use only reference images the user explicitly added this time. Do not read other canvas images or prior results.',
  refPolicyNone: 'No reference images this time. Create only from the text setting below; do not look up, read, or reuse other canvas images or prior results.',
  genSubject: 'Generate a subject reference: the subject may be a person, animal, or object. Faithfully show form, material, and distinctive traits; keep it complete; do not anthropomorphize objects.',
  genScene: 'Generate a scene reference that clearly shows spatial layout, environment, and light.',
  promptSupplement: (v: string) => `Extra generation notes: ${v}`,
  visualStyle: (v: string) => `Visual style: ${v}`,
  referenceName: (name: string, i: number) => `${name} reference ${i + 1}`,
  refMappingHeader: 'Reference mapping (attachment order):',
  refMappingLine: (index: number, kind: string, name: string) =>
    `Reference ${index + 1} is ${kind === 'scene' ? 'scene' : 'subject'} “${name}”.`,
  kindSubject: 'subject',
  kindScene: 'scene',
  settingLine: (kindLabel: string, name: string, variantSuffix: string) =>
    `${kindLabel} “${name}”${variantSuffix}`,
  variantSuffix: (variantName: string) => ` · version “${variantName}”`,
  shotContextIntro:
    'The following are the subject and scene settings chosen for this shot. If older appearance or scene details appear above, prefer these and their reference images; keep shot action and framing from this shot’s description.',
  viewRequirement: (view: string) => `View requirement: ${view}`,
  timeRequirement: (time: string) => `Time-of-day requirement (overrides older time in the description): ${time}`,
  settingColon: (head: string, body: string) => `${head}: ${body}`,
  variantParen: (name: string) => ` (${name})`,
} as const;

const ZH = {
  sceneWide: '场景全景，完整交代空间结构、出入口与主要物件的位置关系。',
  sceneMulti: '在一张图片中展示同一场景的多个观察角度，保持空间布局、建筑结构和物件位置一致。',
  sceneTop: '场景俯视图，清晰呈现空间布局、动线与主要物件的位置关系。',
  sceneDetail: '场景局部特写，呈现建筑、道具的材质与环境细节。',
  subjectThree: '在一张图片中并排呈现同一主体的正面、侧面、背面三视图，比例一致、外观一致、纯净背景。',
  subjectFront: '正面完整视图，清晰展示主体轮廓、结构与外观。',
  subjectDetail: '主体特写，清晰表现局部结构、材质和辨识细节。',
  timeDay: '白天，自然日光。',
  timeDusk: '黄昏，低角度夕照与柔和暮色。',
  timeNight: '夜晚，符合场景设定的人工光源与夜色。',
  refPolicyOnlyUser: '仅使用本次用户明确添加的参考图，不读取其他画布图片或历史成图。',
  refPolicyNone: '本次没有参考图，仅根据以下文字设定重新创作；不得查找、读取或复用画布中的其他图片和历史成图。',
  genSubject: '生成主体参考图：主体可以是人、动物或物品，忠实表现其形态、材质与辨识特征，保持完整；不要将物品拟人化。',
  genScene: '生成场景参考图，清晰表现空间布局、环境与光线。',
  promptSupplement: (v: string) => `生图补充：${v}`,
  visualStyle: (v: string) => `视觉风格：${v}`,
  referenceName: (name: string, i: number) => `${name}参考图${i + 1}`,
  refMappingHeader: '参考图对应关系（按附件顺序）：',
  refMappingLine: (index: number, kind: string, name: string) =>
    `参考图 ${index + 1} 是${kind === 'scene' ? '场景' : '主体'}「${name}」。`,
  kindSubject: '主体',
  kindScene: '场景',
  settingLine: (kindLabel: string, name: string, variantSuffix: string) =>
    `${kindLabel}「${name}」${variantSuffix}`,
  variantSuffix: (variantName: string) => `（版本「${variantName}」）`,
  shotContextIntro:
    '以下为本镜头选定的主体与场景设定；若上文出现旧外貌或旧场景信息，以这里及对应参考图为准，镜头动作和构图仍遵循本镜描述。',
  viewRequirement: (view: string) => `视图要求：${view}`,
  timeRequirement: (time: string) => `时段要求（优先于描述中的旧时段）：${time}`,
  settingColon: (head: string, body: string) => `${head}：${body}`,
  variantParen: (name: string) => `（${name}）`,
} satisfies CopyShape<typeof EN>;
