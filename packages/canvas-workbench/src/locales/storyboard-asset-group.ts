import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';

export function storyboardAssetGroupCopy(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}
export function sag() { return storyboardAssetGroupCopy(getCanvasActiveLocale()); }

const EN = {
  character: 'Subject',
  scene: 'Scene',
  linkedShot: (index: number) => `Linked shot ${index + 1}`,
  noDescription: 'No shot description yet',
  replaceScene: (name: string) => `Will replace scene “${name}”`,
  noShots: 'No shots yet',
  removeHint: (label: string) => `Remove ${label} from this script and clear this script’s shot links. Other scripts and image files stay.`,
  cancel: 'Cancel',
  confirmRemove: 'Remove',
  kindGroup: (label: string) => `${label} group`,
  newKind: (label: string) => `New ${label}`,
  addKind: (label: string) => `Add ${label}`,
  viewLinkedOf: (name: string) => `View shots linked to ${name}`,
  cardAriaWithImage: (name: string, variant: string) => `${name} · ${variant}, view image details`,
  cardAriaNoImage: (name: string, variant: string) => `${name} · ${variant}, click to view linked shots`,
  linkedShotsOf: (name: string) => `${name} · linked shots`,
  adjustLinkedOf: (name: string) => `Adjust shots linked to ${name}`,
  linkedCount: (n: number) => `Linked to ${n} shots`,
  linkedShots: 'Linked shots',
  kindSettings: (label: string) => `${label} settings`,
  settings: 'Settings',
  emptyHint: (label: string) => `Add a ${label}, finish the text setting, then generate a reference. Multiple shots can reuse the same setting.`,
  imageDetails: 'Image details',
  kindReference: (label: string) => `${label} reference`,
  closeImageDetails: 'Close image details',
  removeKind: (label: string) => `Remove ${label}`,
} as const;

const ZH = {
  character: '主体',
  scene: '场景',
  linkedShot: (index: number) => `关联镜头 ${index + 1}`,
  noDescription: '未填写画面描述',
  replaceScene: (name: string) => `将替换场景「${name}」`,
  noShots: '暂无镜头',
  removeHint: (label: string) => `从当前脚本移除${label}并解除本脚本的镜头引用，其他脚本和图片文件保留。`,
  cancel: '取消',
  confirmRemove: '确认移除',
  kindGroup: (label: string) => `${label}图组`,
  newKind: (label: string) => `新${label}`,
  addKind: (label: string) => `添加${label}`,
  viewLinkedOf: (name: string) => `查看${name}关联镜头`,
  cardAriaWithImage: (name: string, variant: string) => `${name} · ${variant}，查看图片详情`,
  cardAriaNoImage: (name: string, variant: string) => `${name} · ${variant}，点击查看关联镜头`,
  linkedShotsOf: (name: string) => `${name} · 关联镜头`,
  adjustLinkedOf: (name: string) => `调整${name}关联镜头`,
  linkedCount: (n: number) => `关联 ${n} 个镜头`,
  linkedShots: '关联镜头',
  kindSettings: (label: string) => `${label}设置`,
  settings: '设置',
  emptyHint: (label: string) => `添加${label}并完善文字设定，再生成参考图。多个镜头可复用同一份设定。`,
  imageDetails: '图片详情',
  kindReference: (label: string) => `${label}参考图`,
  closeImageDetails: '关闭图片详情',
  removeKind: (label: string) => `移除${label}`,
} satisfies CopyShape<typeof EN>;
