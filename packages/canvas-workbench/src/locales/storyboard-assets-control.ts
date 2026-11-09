import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';

export function storyboardAssetsControlCopy(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}
export function sactl() { return storyboardAssetsControlCopy(getCanvasActiveLocale()); }

const EN = {
  close: 'Close',
  character: 'Subject',
  scene: 'Scene',
  projectKind: (label: string) => `Project ${label}`,
  unnamed: 'Untitled',
  addKind: (label: string) => `Add ${label}`,
  newKind: (label: string) => `New ${label}`,
  selectToEdit: (label: string) => `Select a ${label} to edit text settings, versions, and references.`,
  addOrExtract: (label: string) => `Add a ${label}, or extract automatically when generating a storyboard from text.`,
  viewLinked: (name: string) => `View links for ${name}`,
  missingRef: 'Missing reference',
  linkSubjectsScenes: 'Link subjects and scenes',
  adjustRefs: 'Adjust subject and scene references',
  addReference: '+ Add reference',
  subjectsMulti: 'Subjects (multi-select)',
  sceneSingle: 'Scene (single-select)',
  versionOf: (name: string) => `${name} versions`,
  needGroupFirst: 'Add a subject or scene in the left image group first.',
  sharedAcrossStoryboards: ' Shared by every storyboard in this project.',
} as const;

const ZH = {
  close: '关闭',
  character: '主体',
  scene: '场景',
  projectKind: (label: string) => `项目${label}`,
  unnamed: '未命名',
  addKind: (label: string) => `添加${label}`,
  newKind: (label: string) => `新${label}`,
  selectToEdit: (label: string) => `选择${label}编辑文字设定、版本和参考图。`,
  addOrExtract: (label: string) => `添加${label}，或从文本生成分镜时自动提取。`,
  viewLinked: (name: string) => `查看${name}关联`,
  missingRef: '缺失参考',
  linkSubjectsScenes: '关联主体与场景',
  adjustRefs: '调整主体与场景参考',
  addReference: '＋ 添加参考',
  subjectsMulti: '主体（多选）',
  sceneSingle: '场景（单选）',
  versionOf: (name: string) => `${name}版本`,
  needGroupFirst: '请先在左侧图组添加主体或场景。',
  sharedAcrossStoryboards: ' 同一项目的所有分镜共用。',
} satisfies CopyShape<typeof EN>;
