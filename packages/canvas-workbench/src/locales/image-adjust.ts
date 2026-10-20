import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
export function imageAdjustCopy(locale?: string | null) {
  return resolveCanvasLocale(locale) === 'zh-CN' ? ZH : EN;
}
export function ia() { return imageAdjustCopy(getCanvasActiveLocale()); }
const EN = {
  readFailed: 'Could not read the image', applyGrade: 'Apply color grade',
  portraitWarm: 'Portrait · warm', portraitSoft: 'Portrait · soft light', landscapeVivid: 'Landscape · vivid',
  naturalFilm: 'Natural · film', travelBright: 'Travel · bright', classicBw: 'Classic · B&W', modernBw: 'Modern · B&W',
  magazine: 'Magazine', softBw: 'Soft · B&W', vintagePolaroid: 'Vintage Polaroid',
  color: 'Color', vibrance: 'Vibrance', saturation: 'Saturation', temperature: 'Temperature', tint: 'Tint', hue: 'Hue',
  light: 'Light', brightness: 'Brightness', exposure: 'Exposure', contrast: 'Contrast', blacks: 'Blacks', whites: 'Whites',
  highlights: 'Highlights', shadows: 'Shadows', detail: 'Detail', sharpen: 'Sharpen', clarity: 'Clarity', smooth: 'Smooth',
  blur: 'Blur', grain: 'Grain', scene: 'Scene', vignette: 'Vignette', ambiance: 'Ambiance', bloom: 'Bloom', dehaze: 'Dehaze',
  lutInvalid: 'Invalid LUT. Only 2–65 step 3D .cube files are supported.',
  browserUnsupported: 'This browser cannot color-grade images', exportFailed: 'Could not export the graded image',
  saveFailed: 'Could not save the graded image', importLutFailed: 'Could not import LUT',
  colorGrade: 'Color', close: 'Close', loadingImage: 'Loading image…', params: 'Grade parameters', filter: 'Filter',
  noFilter: 'No filter', presets: 'Presets', myLuts: 'My LUTs', import: 'Import', deleteCurrentLut: 'Delete current LUT',
  strength: 'Strength', filterStrength: 'Filter strength', livePreview: 'Live preview · saves on apply',
  reset: 'Reset', cancel: 'Cancel', saving: 'Saving…',
  previewAria: (name: string) => `${name} color preview`,
} as const;
const ZH = {
  readFailed: '图片读取失败', applyGrade: '应用调色',
  portraitWarm: '人像 · 暖调', portraitSoft: '人像 · 柔光', landscapeVivid: '风光 · 鲜艳',
  naturalFilm: '自然 · 胶片', travelBright: '旅拍 · 明亮', classicBw: '经典 · 黑白', modernBw: '现代 · 黑白',
  magazine: '杂志风', softBw: '柔光 · 黑白', vintagePolaroid: '复古拍立得',
  color: '颜色', vibrance: '自然饱和度', saturation: '饱和度', temperature: '色温', tint: '色调', hue: '色相',
  light: '光亮', brightness: '亮度', exposure: '曝光', contrast: '对比度', blacks: '黑色', whites: '白色',
  highlights: '高光', shadows: '暗调', detail: '细节', sharpen: '锐化', clarity: '清晰度', smooth: '平滑',
  blur: '模糊', grain: '颗粒', scene: '场景', vignette: '暗角', ambiance: '氛围美化', bloom: '泛光', dehaze: '除雾',
  lutInvalid: 'LUT 文件无效，仅支持 2–65 阶的 3D .cube 文件',
  browserUnsupported: '浏览器不支持图片调色', exportFailed: '调色结果导出失败',
  saveFailed: '调色结果保存失败', importLutFailed: '导入 LUT 失败',
  colorGrade: '调色', close: '关闭', loadingImage: '正在载入图片…', params: '调色参数', filter: '滤镜',
  noFilter: '无滤镜', presets: '预设', myLuts: '我的 LUT', import: '导入', deleteCurrentLut: '删除当前 LUT',
  strength: '强度', filterStrength: '滤镜强度', livePreview: '实时预览 · 应用后保存',
  reset: '重置', cancel: '取消', saving: '正在保存…',
  previewAria: (name: string) => `${name} 调色预览`,
} satisfies CopyShape<typeof EN>;
