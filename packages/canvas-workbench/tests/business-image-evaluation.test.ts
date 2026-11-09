import { expect, it } from 'vitest';
import { businessImageEvaluationAction } from '../src/workbench/business-image-evaluation';

const completed = { enabled: true, requested: true, handledElsewhere: false, status: 'completed' };
it.each([undefined, 'pending'])('starts a requested evaluation at state %s', (evaluationStatus) => {
  expect(businessImageEvaluationAction({ ...completed, evaluationStatus })).toBe('start');
});
it('waits only for an enabled in-progress evaluation', () => {
  expect(businessImageEvaluationAction({ ...completed, evaluationStatus: 'running' })).toBe('wait');
});
it.each([
  { enabled: false }, { requested: false }, { handledElsewhere: true },
  { status: 'running' }, { status: 'failed' }, { evaluationStatus: 'completed' },
])('lets normal image delivery complete without a business evaluation: %j', (override) => {
  expect(businessImageEvaluationAction({ ...completed, ...override })).toBe('none');
});
