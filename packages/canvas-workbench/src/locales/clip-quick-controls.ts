import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
export function clipQuickControlsCopy(locale?: string | null) {
  return resolveCanvasLocale(locale) === 'zh-CN' ? ZH : EN;
}
export function cq() { return clipQuickControlsCopy(getCanvasActiveLocale()); }
const EN = {
  seconds: 'sec', secondsSpaced: ' sec', picture: 'Picture', speed: 'Speed', sound: 'Sound', animation: 'Animation',
  commonTools: 'Common clip tools', backToTools: '‹ Back to tools', done: 'Done ✓',
  pickTool: 'sec · pick a tool to start', clipTools: 'Clip tools', howShow: 'How should the frame display?',
  fitContain: 'Fit entire frame', fitCover: 'Fill frame', coverCrops: 'Fill crops anything past the edges.',
  containLetterbox: 'Keeps the full frame; letterboxing may appear when ratios differ.',
  pipCorner: 'Lower-right · picture-in-picture', dragPreview: 'Drag the preview frame and corners to move and scale.',
  howLong: 'How long should this image show?', displayDuration: 'Display duration',
  slowerOrFaster: 'Slower or faster?', playbackSpeed: 'Playback speed', slowMo: 'Slow motion', fastForward: 'Fast forward',
  current: 'Current', timesPlay: '× · play',
  speedNote: 'Keeps the selected content. Slowing lengthens; speeding shortens. Audio follows. Later clips do not auto-shift.',
  resetSpeed: 'Reset to normal speed', volumeLevel: 'Volume', volume: 'Volume', unmute: 'Enable original audio',
  mute: 'Mute original audio', naturalFade: 'Ease sound in and out', noFade: 'No fade', soft: 'Soft', gentle: 'Gentle',
  fadeHint: 'Fade eases volume up at the start and down at the end.',
  howAppear: 'How should the frame enter and leave?', noAnim: 'No animation', fade: 'Fade in/out', slide: 'Slide in/out',
  animDuration: 'Animation duration', previewHint: 'Play the preview to check the result.',
} as const;
const ZH = {
  seconds: '秒', secondsSpaced: ' 秒', picture: '画面', speed: '调速', sound: '声音', animation: '动画',
  commonTools: '常用片段工具', backToTools: '‹ 返回工具', done: '完成 ✓',
  pickTool: '秒 · 选一个工具开始', clipTools: '片段工具', howShow: '画面怎么显示？',
  fitContain: '完整显示', fitCover: '铺满画面', coverCrops: '铺满画面会裁掉超出边缘的部分。',
  containLetterbox: '保留完整画面，比例不同时可能留边。',
  pipCorner: '放到右下角 · 画中画', dragPreview: '直接拖动预览里的画面和边角，就能移动、缩放。',
  howLong: '这张图展示多久？', displayDuration: '展示时长',
  slowerOrFaster: '慢一点，还是快一点？', playbackSpeed: '播放速度', slowMo: '慢动作', fastForward: '快放',
  current: '当前', timesPlay: '× · 播放',
  speedNote: '保留选中的内容，放慢会变长，加速会变短。原声一起变速，后面的片段不会自动移动。',
  resetSpeed: '恢复正常速度', volumeLevel: '声音大小', volume: '音量', unmute: '开启原声',
  mute: '关闭原声', naturalFade: '声音自然开始和结束', noFade: '无淡化', soft: '轻柔', gentle: '舒缓',
  fadeHint: '淡化会让开头逐渐变响，结尾逐渐变轻。',
  howAppear: '画面如何出现和离开？', noAnim: '无动画', fade: '淡入淡出', slide: '滑入滑出',
  animDuration: '动画时长', previewHint: '点击预览播放，看看效果是否合适。',
} satisfies CopyShape<typeof EN>;
