import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
export function resultCardCopy(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}
export function rc() { return resultCardCopy(getCanvasActiveLocale()); }
const EN = {
  document: 'Document', image: 'Image', video: 'Video', html: 'Page', audio: 'Audio',
  file: 'File', code: 'Code', structured: 'Data', recipients: 'Recipients',
  sectionN: (n: number) => `Section ${n}`, openDetails: 'Open details',
  generating: 'Generating', failed: 'Failed', complete: 'Done',
  generatingTitle: (title: string) => `${title} generating`,
  liveArtifact: (id: string) => `Live artifact · ${id}`,
} as const;
const ZH = {
  document: '文档', image: '图片', video: '视频', html: '页面', audio: '音频',
  file: '文件', code: '代码', structured: '数据', recipients: '收文单位',
  sectionN: (n: number) => `第 ${n} 部分`, openDetails: '打开详情',
  generating: '生成中', failed: '生成失败', complete: '已完成',
  generatingTitle: (title: string) => `${title}生成中`,
  liveArtifact: (id: string) => `实时产物 · ${id}`,
} satisfies CopyShape<typeof EN>;
