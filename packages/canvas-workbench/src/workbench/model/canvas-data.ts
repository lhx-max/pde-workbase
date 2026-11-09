import type { StageEvaluation } from './canvas-domain';

export function pickLatestEvaluation(
  evaluation: StageEvaluation | undefined,
): StageEvaluation | undefined {
  if (!evaluation) return undefined;
  const all = [...(evaluation.history || []), evaluation];
  const running = all.find(item => item.status === 'running');
  return running || all[all.length - 1];
}
