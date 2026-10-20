import { describe, expect, it } from 'vitest';
import { newHookConfig, parseHookConfig } from '../src/api/hooks.js';

const config = (agentId: string, modelId = '') => ({ ...newHookConfig(), name: 'Hook', action: { ...newHookConfig().action, instruction: 'Summarize', model: { agentId, modelId } } });
describe('Hook agent identifiers are structural, not a runtime allowlist', () => {
  it.each(['qwen', 'hermes', 'deepseek-harness', 'local-business-profile', 'future_agent.v2'])('accepts %s for daemon registry validation', agentId => {
    expect(parseHookConfig(config(agentId)).action.model.agentId).toBe(agentId);
  });
  it.each(['../agent', 'agent with space', 'agent\n--flag', 'agent/cli'])('rejects malformed ID %j', agentId => {
    expect(() => parseHookConfig(config(agentId))).toThrow(/Agent|agent|模型/);
  });
  it('keeps default-agent selection and explicit model ownership distinct', () => {
    expect(parseHookConfig(config('')).action.model).toEqual({ agentId: '', modelId: '' });
    expect(() => parseHookConfig(config('', 'unowned-model'))).toThrow(/Agent|agent/);
  });
});
