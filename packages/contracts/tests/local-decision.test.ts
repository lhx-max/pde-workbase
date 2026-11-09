import { describe, expect, it } from 'vitest';
import { localDecisionCapability, parseLocalDecisionRequest, type LocalDecisionStatus } from '../src/api/local-decision.js';

describe('local decision contract', () => {
  const request = { state: 'Observed block', questions: { q: { type: 'noul', instructions: 'Same purpose?' } } };
  it('accepts bounded questions without trusting extra runtime parameters', () => {
    expect(parseLocalDecisionRequest({ ...request, executable: '/tmp/unsafe' })).toEqual(request);
  });
  it.each([{}, { ...request, questions: {} }, { ...request, state: [] }, { ...request, state: 'x'.repeat(70_000) }, { ...request, questions: { q: { type: 'script', instructions: 'x' } } }])('rejects malformed or unbounded requests', input => {
    expect(() => parseLocalDecisionRequest(input)).toThrow();
  });
  it('only advertises ready and enabled runtime; otherwise tells AI to skip', () => {
    const status: LocalDecisionStatus = { installed: true, enabled: true, phase: 'ready', version: '0.3.5', error: null, stage: null, progress: null, activeModel: 'multilingual', models: [] };
    expect(localDecisionCapability(status)).toContain('decision predict');
    expect(localDecisionCapability(status)).toContain('decision-assistant');
    expect(localDecisionCapability(status)).not.toContain('laya-decision');
    expect(localDecisionCapability({ ...status, phase: 'starting' })).toContain('Do not call');
    expect(localDecisionCapability({ ...status, enabled: false })).toContain('Do not call');
    expect(localDecisionCapability(undefined)).toBe('');
  });
});
