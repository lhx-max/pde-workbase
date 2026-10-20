import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
export function clipInspectorCopy(locale?: string | null) {
  return resolveCanvasLocale(locale) === 'zh-CN' ? ZH : EN;
}
export function ci() { return clipInspectorCopy(getCanvasActiveLocale()); }
const EN = {
  videoSize: 'Video size', resolution: 'Resolution', resetTransform: 'Reset frame adjust', resetEffects: 'Reset frame effects',
  inOutAnim: 'In / out animation', landscape: 'Landscape', portrait: 'Portrait', square: 'Square',
  clipParams: 'Clip parameters', adjustThisClip: 'Adjust this clip', videoSettings: 'Video settings',
  audio: 'Audio', image: 'Image', video: 'Video', editableAnytime: 'Editable anytime', commonSizes: 'Common video sizes',
  format: 'Format', outputFormat: 'Output format', videoMp4: 'Video · MP4', framePng: 'Current frame · PNG',
  frameWebp: 'Current frame · WebP', soundAndSpeed: 'Sound and playback speed', sourceInSec: 'Source in (sec)',
  playbackSpeed: 'Playback speed (×)', volumePct: 'Volume (%)', fadeInSec: 'Fade in (sec)', fadeOutSec: 'Fade out (sec)',
  unmute: 'Unmute', muteClip: 'Mute clip', unloop: 'Disable loop', loop: 'Loop playback', frameAdjust: 'Frame adjust',
  brightness: 'Brightness (%)', contrast: 'Contrast (%)', saturation: 'Saturation (%)', blurPx: 'Blur (px)',
  positionSize: 'Position and size', dragPreviewHint: 'You can also drag the preview frame and pull corners to resize.',
  posX: 'Horizontal position (%)', posY: 'Vertical position (%)', widthPct: 'Frame width (%)', heightPct: 'Frame height (%)',
  rotationDeg: 'Rotation (°)', opacityPct: 'Opacity (%)', crop: 'Crop', top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left',
  animTransition: 'Animation and transitions', noAnim: 'No animation', fade: 'Fade in/out', slide: 'Slide in/out',
  animDuration: 'Animation duration (sec)', crossfadePrev: 'Crossfade with previous clip',
  crossfadeHint: 'Crossfade moves this clip earlier to overlap. Undoable. Crop hides edges without changing timing.',
  imageDurationFree: 'Image display duration is freeform', readingDuration: 'Reading media duration…',
  autoSave: 'Changes save automatically to the canvas node.',
  cropSide: (side: string) => `${side} crop (%)`,
  sourceDuration: (sec: string) => `Source length ${sec} sec`,
} as const;
const ZH = {
  videoSize: '视频尺寸', resolution: '分辨率', resetTransform: '重置画面调整', resetEffects: '重置画面效果',
  inOutAnim: '入场 / 出场动画', landscape: '横屏', portrait: '竖屏', square: '方形',
  clipParams: '片段参数', adjustThisClip: '调整这个片段', videoSettings: '视频设置',
  audio: '音频', image: '图片', video: '视频', editableAnytime: '随时可改', commonSizes: '常用视频尺寸',
  format: '格式', outputFormat: '输出格式', videoMp4: '视频 · MP4', framePng: '当前帧 · PNG',
  frameWebp: '当前帧 · WebP', soundAndSpeed: '声音与播放速度', sourceInSec: '素材入点（秒）',
  playbackSpeed: '播放速度（倍）', volumePct: '音量（%）', fadeInSec: '声音淡入（秒）', fadeOutSec: '声音淡出（秒）',
  unmute: '取消静音', muteClip: '静音片段', unloop: '取消循环', loop: '循环播放', frameAdjust: '画面调整',
  brightness: '亮度（%）', contrast: '对比度（%）', saturation: '饱和度（%）', blurPx: '模糊（像素）',
  positionSize: '位置与大小', dragPreviewHint: '也可以直接拖动预览里的画面，拉动边角调整大小。',
  posX: '水平位置（%）', posY: '垂直位置（%）', widthPct: '画面宽度（%）', heightPct: '画面高度（%）',
  rotationDeg: '旋转（度）', opacityPct: '不透明度（%）', crop: '裁切', top: '顶部', right: '右侧', bottom: '底部', left: '左侧',
  animTransition: '动画与转场', noAnim: '无动画', fade: '淡入淡出', slide: '滑入滑出',
  animDuration: '动画时长（秒）', crossfadePrev: '与前一片段叠化',
  crossfadeHint: '叠化会将当前片段前移并重叠；可撤销。裁切隐藏画面边缘，不改变时间。',
  imageDurationFree: '图片可自由设置展示时长', readingDuration: '正在读取素材时长',
  autoSave: '更改会自动保存到画布节点。',
  cropSide: (side: string) => `${side}裁切（%）`,
  sourceDuration: (sec: string) => `素材总长 ${sec} 秒`,
} satisfies CopyShape<typeof EN>;
