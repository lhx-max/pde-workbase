import { describe, expect, it } from 'vitest';
import {
  agentIdToTracking,
  feedbackAgentProviderIdToTracking,
  handoffTargetIdToTracking,
} from '../src/analytics/events.js';

describe('current local CLI tracking', () => {
  it.each([
    ['claude', 'claude_code'], ['codex', 'codex_cli'], ['opencode', 'opencode'],
    ['hermes', 'hermes'], ['kimi', 'kimi_cli'], ['cursor-agent', 'cursor_agent'],
    ['deepseek-harness', 'deepseek_harness'], ['trae-cli', 'trae_cli'],
    ['grok-build', 'grok_build'],
  ])('tracks the retained %s CLI and its feedback', (id, expected) => {
    expect(agentIdToTracking(id)).toBe(expected);
    expect(feedbackAgentProviderIdToTracking(id)).toBe(expected);
    expect(handoffTargetIdToTracking(id)).toBe(id);
  });

  it.each(['devin', 'gemini', 'qwen', 'qoder', 'copilot', 'pi', 'kilo', 'amr'])('does not advertise retired CLI bucket %s', id => {
    expect(agentIdToTracking(id)).toBe('other');
  });

  it('keeps arbitrary adapter identities in the bounded unknown bucket', () => {
    expect(agentIdToTracking('sample-agent')).toBe('other');
    expect(feedbackAgentProviderIdToTracking('sample-agent')).toBe('other');
    expect(handoffTargetIdToTracking('sample-agent')).toBe('other');
  });

  it('preserves API providers, external editors and bounded unknown values', () => {
    expect(feedbackAgentProviderIdToTracking('google-gemini-api')).toBe('google_gemini');
    expect(feedbackAgentProviderIdToTracking('openai-api')).toBe('openai');
    expect(handoffTargetIdToTracking('qoder')).toBe('qoder');
    expect(handoffTargetIdToTracking('antigravity')).toBe('antigravity');
    expect(handoffTargetIdToTracking('qwen')).toBe('other');
    expect(agentIdToTracking('custom-cli-profile')).toBe('other');
    expect(agentIdToTracking(null)).toBe('other');
    expect(agentIdToTracking(undefined)).toBe('other');
  });
});

