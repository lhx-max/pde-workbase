import { cr } from '../locales/canvas-remainder';
/** Stack callbacks carry the owner binding; JSON alone silently retains stale dispatchers. */
export function createStoryboardStackSignature() {
  const ids = new WeakMap<Function, number>();
  let next = 0;
  return (data: Record<string, unknown>) => JSON.stringify(data, (key, value) => {
    if (key !== 'onGenerate' || typeof value !== 'function') return value;
    if (!ids.has(value)) ids.set(value, ++next);
    return ids.get(value);
  });
}

export function storyboardStackStatus(tasks: Array<{ status?: string }>, feedback = '') {
  const failed = /失败|错误|未开始|已删除/.test(feedback) || tasks.some(t => t.status === 'failed');
  return {
    generating: !failed && (tasks.some(t => t.status === 'generating') || (!tasks.some(t => t.status === 'ready') && /提交|排队|生成中|正在生成/.test(feedback))),
    generationError: failed ? feedback || cr().generateFailedRetry : !tasks.length && feedback ? feedback : undefined,
  };
}
