import type { CopyShape } from '../../locales/copy-shape';
import { resolveCanvasLocale } from '../../locales/node-catalog';

const EN = {
  crop: 'Crop image', dimensions: 'Output size', width: 'Width', height: 'Height', aspect: 'Aspect ratio',
  free: 'Free', original: 'Original', lock: 'Lock aspect ratio', unlock: 'Unlock aspect ratio',
  reset: 'Reset crop', cancel: 'Cancel', done: 'Apply crop', processing: 'Saving…', loading: 'Loading image…', retry: 'Retry loading',
  hint: 'Drag the edges to crop. Arrow keys move the selection.', move: 'Move crop selection',
  more: 'Platform presets', video: 'Short video', social: 'Social',
  cover916: 'Vertical cover', cover34Single: 'Single-column cover', cover34Double: 'Double-column cover',
  landscape: 'Landscape', moments: 'Moments', wechat: 'Official-account header', weibo: 'Weibo', story: 'Story',
  loadFailed: 'Could not load the original image. Please try again.',
  saveFailed: 'Could not save this crop. Your selection is preserved; please try again.',
  nw: 'Resize top left', n: 'Resize top edge', ne: 'Resize top right', e: 'Resize right edge',
  se: 'Resize bottom right', s: 'Resize bottom edge', sw: 'Resize bottom left', w: 'Resize left edge',
} as const;
const ZH = {
  crop: '裁剪图片', dimensions: '输出尺寸', width: '宽度', height: '高度', aspect: '裁剪比例',
  free: '自由', original: '原始', lock: '锁定宽高比', unlock: '解锁宽高比',
  reset: '重置裁剪', cancel: '取消', done: '应用裁剪', processing: '保存中…', loading: '读取原图…', retry: '重新加载',
  hint: '拖动边缘调整范围，方向键移动选区', move: '移动裁剪选区',
  more: '平台预设', video: '短视频', social: '社交平台',
  cover916: '竖版封面', cover34Single: '单列封面', cover34Double: '双列封面',
  landscape: '横版', moments: '朋友圈', wechat: '公众号首图', weibo: '微博配图', story: '快拍',
  loadFailed: '原图加载失败，请重试。', saveFailed: '裁剪保存失败，已保留选区，请重试。',
  nw: '调整左上角', n: '调整上边缘', ne: '调整右上角', e: '调整右边缘',
  se: '调整右下角', s: '调整下边缘', sw: '调整左下角', w: '调整左边缘',
} satisfies CopyShape<typeof EN>;
export const cropCopy = (locale: string) => resolveCanvasLocale(locale) === 'zh-CN' ? ZH : EN;
