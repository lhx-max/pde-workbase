import { describe, expect, it } from 'vitest';
import { isRetiredCliAgentId } from '../src/retired-cli-agents.js';

describe('retired built-in CLI compatibility', () => {
  it.each([
    'devin', 'qwen', 'qoder', 'copilot', 'amp', 'pi',
    'kiro', 'kilo', 'vibe', 'deepseek', 'aider', 'antigravity',
    'codebuddy', 'reasonix', 'mimo', 'atomcode', 'gemini', 'amr',
  ])('recognizes a retired selection: %s', id => {
    expect(isRetiredCliAgentId(id)).toBe(true);
  });

  it.each([
    'claude', 'codex', 'opencode', 'hermes', 'kimi', 'cursor-agent',
    'deepseek-harness', 'grok-build', 'sample-agent', 'trae-cli', 'byok-opencode',
    'custom-cli-profile', 'future_agent.v2',
  ])('does not blacklist a retained runtime or custom profile: %s', id => {
    expect(isRetiredCliAgentId(id)).toBe(false);
  });
});

