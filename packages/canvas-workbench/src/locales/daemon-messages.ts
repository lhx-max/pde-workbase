import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';

const EN: Record<string, string> = {
  '视频生成时长最少 4 秒，请调整镜头或生成时长': 'Video must be at least 4 seconds. Adjust the shot or the duration.',
  '当前视频提供方不支持恢复上游任务，请重新生成': 'This video provider cannot resume the upstream task. Generate it again.',
  '画布交付需要有效的 clientRequestId': 'Canvas delivery needs a valid clientRequestId.',
  '原任务记录不可用，请检查后再重试': 'The original task record is unavailable. Check it and try again.',
  '正在执行媒体生成': 'Generating media.',
  '执行连接因服务重启中断，上游结果尚未确认；这不表示生成已取消。请先检查或取回原任务结果，避免重复生成。': 'The connection was interrupted while the service restarted, and the upstream result is not confirmed yet. This does not mean generation was cancelled. Check or retrieve the original task before generating again.',
  '无效的媒体交付目标': 'The media delivery target is invalid.',
  '无效的媒体预览地址': 'The media preview address is invalid.',
  '生成目标已删除，未开始执行': 'The generation target was deleted, so execution did not start.',
  '目标已有任务执行中，请等待当前任务完成': 'A task is already running on that target. Wait for it to finish.',
  '目标版本已变化，未开始执行': 'The target version changed, so execution did not start.',
  '媒体交付记录不存在，未提交供应商': 'The media delivery record does not exist, so nothing was sent to the provider.',
  '目标已删除或版本已变化，未提交供应商': 'The target was deleted or its version changed, so nothing was sent to the provider.',
  '媒体生成中断': 'Media generation was interrupted.',
  '任务未返回真实媒体文件': 'The task did not return a real media file.',
  '媒体文件不可用': 'The media file is unavailable.',
  '目标版本已变化，生成结果保留在项目文件中，未覆盖': 'The target version changed. The generated file stays in the project and was not applied over the target.',
  '请求请使用 context；runContext 仅用于已保存的消息，不能作为执行输入。': 'Send context in this request. runContext is only for saved messages and cannot be the execution input.',
  '提问已不可接续，未启动其他任务': 'That question can no longer be continued. No other task was started.',
  '原卡片已删除或已启动其他任务，未覆盖': 'The original card was deleted or another task already started, so nothing was overwritten.',
  '当前任务不能交付候选': 'This task cannot deliver a candidate.',
  '画布服务不可用': 'The canvas service is unavailable.',
  '候选无法恢复': 'The candidate could not be restored.',
  '运行尚无可保存的成功结果': 'This run does not have a successful result to save yet.',
  '没有可恢复的文本候选': 'There is no text candidate to restore.',
  '分镜结果格式无效，未交付': 'The storyboard result is invalid, so it was not delivered.',
  '缺少可验证的原文版本，不能自动采用': 'There is no verifiable original version, so it cannot be applied automatically.',
  '候选保存失败；已有回复仍保留，可再次重试保存': 'Saving the candidate failed. The existing reply is still there. You can try saving again.',
  '导出已取消': 'Export was cancelled.',
  '未找到 FFmpeg。请安装 FFmpeg，或设置 BEZIER_FFMPEG_PATH。': 'FFmpeg was not found. Install FFmpeg, or set BEZIER_FFMPEG_PATH.',
  '媒体并发上限必须为 1–32': 'The media concurrency limit must be from 1 to 32.',
  '服务已停止，尚未向供应商提交': 'The service stopped before anything was sent to the provider.',
  '当前 Agent 未登录': 'Sign in to the current agent and try again.',
};

/** Known media and run daemon sentences. Chinese stays the server text. */
export function localizeDaemonMessage(message: string, locale?: string | null): string {
  if (!message.trim()) return message;
  const resolved = locale === undefined ? getCanvasActiveLocale() : resolveCanvasLocale(locale);
  if (resolved !== 'en') return message;
  const known = EN[message];
  if (known) return known;
  const queued = /^等待媒体执行名额（最多 (\d+) 个并行），尚未提交供应商$/u.exec(message);
  if (queued?.[1]) {
    return `Waiting for a media slot (up to ${queued[1]} in parallel). The provider has not received the task yet.`;
  }
  if (/^FFmpeg\b/u.test(message) && /\p{Script=Han}/u.test(message)) {
    return 'Could not start FFmpeg. Check the media tools and try again.';
  }
  return /\p{Script=Han}/u.test(message)
    ? 'The operation could not be completed. Try again.'
    : message;
}
