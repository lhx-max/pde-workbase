import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
export function imageGroupNodeCopy(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}
export function ign() { return imageGroupNodeCopy(getCanvasActiveLocale()); }
const EN = {
  dragGroup: 'Drag whole group', defaultName: 'Reference group', countSuffix: (n: number) => `${n} images`,
  duplicate: 'Duplicate reference group', remove: 'Delete reference group',
  generate: 'Generate', ungroup: 'Ungroup', genTitle: 'Generate from reference group', close: 'Close',
  model: 'Model', ratio: 'Ratio', count: 'Count', resolution: 'Resolution',
  estimate: (estimate: number, members: number) => `About ${estimate} outputs · all ${members} images as references`,
  references: 'References',
  placeholder: 'What should we generate from this reference group… ⌘/Ctrl + Enter',
  submit: 'Generate →',
} as const;
const ZH = {
  dragGroup: '拖动整组', defaultName: '参考图组', countSuffix: (n: number) => `${n} 张`,
  duplicate: '复制参考图组', remove: '删除参考图组',
  generate: '生图', ungroup: '解散', genTitle: '参考图组生图', close: '关闭',
  model: '模型', ratio: '比例', count: '张数', resolution: '分辨率',
  estimate: (estimate: number, members: number) => `预计输出 ${estimate} 张 · 全部 ${members} 张作为参考`,
  references: '参考图',
  placeholder: '想基于这组参考图生成什么… ⌘/Ctrl + Enter 生成',
  submit: '直接生成 →',
} satisfies CopyShape<typeof EN>;
