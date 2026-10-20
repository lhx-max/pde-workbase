import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
export function clipExportPanelCopy(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}
export function cep() { return clipExportPanelCopy(getCanvasActiveLocale()); }
const EN = {
  exportClip: 'Export clip', closeExport: 'Close export', format: 'Format',
  videoMp4: 'Video · MP4', framePng: 'Current frame · PNG', frameWebp: 'Current frame · WebP',
  quality: 'Quality', draft: 'Quick preview', standard: 'Standard', high: 'High quality',
  fps: 'Frame rate', stillHint: (sec: string) => `Still frames use the playhead at ${sec} sec; they do not replace the video export.`,
  complete: 'Export complete', failed: 'Export failed', cancelled: 'Cancelled', exporting: 'Exporting',
  backgroundHint: 'You can close this panel or return to the canvas — export keeps running; reopen to check the result.',
  staleHint: 'The timeline changed; this job is an older version. Export again to refresh the file.',
  downloadFailed: 'Download failed', downloadFile: 'Download file', cancelExport: 'Cancel export',
  starting: 'Starting…', exportAgain: 'Export again', startExport: 'Start export',
} as const;
const ZH = {
  exportClip: '导出剪辑', closeExport: '关闭导出', format: '格式',
  videoMp4: '视频 · MP4', framePng: '当前帧 · PNG', frameWebp: '当前帧 · WebP',
  quality: '质量', draft: '快速预览', standard: '标准', high: '高质量',
  fps: '帧率', stillHint: (sec: string) => `静帧取自当前播放头：${sec} 秒；不会替换视频成片。`,
  complete: '导出完成', failed: '导出失败', cancelled: '已取消', exporting: '正在导出',
  backgroundHint: '可以关闭面板或返回画布，导出会继续；重开后可查看结果。',
  staleHint: '时间轴已修改，此任务是之前的版本；请再次导出以更新成片。',
  downloadFailed: '下载失败', downloadFile: '下载成片', cancelExport: '取消导出',
  starting: '正在启动…', exportAgain: '再次导出', startExport: '开始导出',
} satisfies CopyShape<typeof EN>;
