import type { Dict } from '../types';

// Historical daemon text used only to identify already-shipped responses.
// Product copy lives in the active en/zh-CN dictionaries.
export const EXACT_API_ERROR_KEYS: Readonly<Record<string, keyof Dict>> = {
  '当前 Agent 未登录': 'api.error.agentSignIn',
  '视频生成时长最少 4 秒，请调整镜头或生成时长': 'api.error.videoMinLength',
  '当前视频提供方不支持恢复上游任务，请重新生成': 'api.error.videoRestart',
  '原任务记录不可用，请检查后再重试': 'api.error.taskUnavailable',
  '文档已变化，请刷新后重新审阅': 'api.error.conflict',
  '文档已变化，请刷新后重新编辑': 'api.error.conflict',
};

export const AGENT_SIGN_IN_ERROR_ZH = /^当前 Agent 未登录/u;
export const FFMPEG_START_ERROR_ZH = /^FFmpeg 启动失败/u;
export const MEDIA_RUNNING_ZH = '正在执行媒体生成';
export const MEDIA_QUEUED_ZH = /^等待媒体执行名额（最多 (\d+) 个并行），尚未提交供应商$/u;
