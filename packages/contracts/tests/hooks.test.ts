import { describe, expect, it } from 'vitest';
import { newHookConfig, parseHookConfig } from '../src/api/hooks.js';

describe('Hook Agent selection contract', () => {
  it.each(['', 'codex', 'sample-agent', 'gemini', 'deepseek', 'custom-cli-profile'])('preserves Agent selection %s for runtime capability resolution', agentId => {
    const base = newHookConfig();
    const model = { agentId, modelId: '' };
    expect(parseHookConfig({ ...base, name: '分析', action: { ...base.action, instruction: '分析', model } }).action.model).toEqual(model);
  });
  it.each(['../codex', 'codex --model anything', 'agent\nname'])('rejects malformed Agent identifiers: %s', agentId => {
    const base = newHookConfig();
    expect(() => parseHookConfig({ ...base, name: '分析', action: { ...base.action, instruction: '分析', model: { agentId, modelId: '' } } })).toThrow('Agent');
  });
});

