/** Optional post-processing must not hold up ordinary image delivery when its owner is absent. */
export function businessImageEvaluationAction(input: {
  enabled: boolean;
  requested: boolean;
  handledElsewhere: boolean;
  status: string;
  evaluationStatus?: string;
}): 'start' | 'wait' | 'none' {
  if (!input.enabled || !input.requested || input.handledElsewhere || input.status !== 'completed') return 'none';
  if (!input.evaluationStatus || input.evaluationStatus === 'pending') return 'start';
  return input.evaluationStatus === 'completed' ? 'none' : 'wait';
}
