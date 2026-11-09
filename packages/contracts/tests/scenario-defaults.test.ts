// Plan §3.3 of plugin-driven-flow-plan — kind → bundled scenario plugin
// mapping. Web (`EntryShell`) and daemon (`/api/projects`, `/api/runs`)
// share this resolver; the test pins the table so a drift between the
// two surfaces is impossible.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO_PLUGIN_BY_KIND,
  DEFAULT_SCENARIO_PLUGIN_BY_TASK_KIND,
  DEFAULT_UNSELECTED_SCENARIO_PLUGIN_ID,
  defaultScenarioPluginIdForKind,
  defaultScenarioPluginIdForProjectMetadata,
  defaultScenarioPluginIdForTaskKind,
} from '../src/plugins/scenario-defaults.js';

describe('defaultScenarioPluginIdForKind', () => {
  it('maps every supported ProjectKind to a bundled scenario id', () => {
    const expected: Record<string, string> = {
      // Template examples are assets rather than installed scenarios.
      prototype: 'example-web-prototype',
      deck:      'bezier-new-generation',
      template:  'bezier-new-generation',
      brand:     'bezier-new-generation',
      image:     'bezier-media-generation',
      video:     'bezier-media-generation',
      audio:     'bezier-media-generation',
      other:     'bezier-new-generation',
    };
    for (const [kind, pluginId] of Object.entries(expected)) {
      expect(defaultScenarioPluginIdForKind(kind as never)).toBe(pluginId);
      expect(DEFAULT_SCENARIO_PLUGIN_BY_KIND[kind as never]).toBe(pluginId);
    }
  });

  it('returns null for an undefined kind so the daemon can skip the fallback', () => {
    expect(defaultScenarioPluginIdForKind(undefined)).toBeNull();
  });

  it('routes live-artifact intent to the dedicated bundled live artifact scenario', () => {
    expect(defaultScenarioPluginIdForProjectMetadata({
      kind: 'prototype',
      intent: 'live-artifact',
    })).toBe('example-live-artifact');
    expect(defaultScenarioPluginIdForProjectMetadata({ kind: 'prototype' }))
      .toBe('example-web-prototype');
    expect(defaultScenarioPluginIdForProjectMetadata(undefined)).toBeNull();
  });

  it('exposes the hidden free-form Home fallback plugin separately from kind defaults', () => {
    expect(DEFAULT_UNSELECTED_SCENARIO_PLUGIN_ID).toBe('bezier-default');
    expect(DEFAULT_SCENARIO_PLUGIN_BY_KIND.other).toBe('bezier-new-generation');
  });
});

describe('defaultScenarioPluginIdForTaskKind', () => {
  it('maps every taskKind to the matching scenario plugin', () => {
    expect(defaultScenarioPluginIdForTaskKind('new-generation')).toBe('bezier-new-generation');
    expect(defaultScenarioPluginIdForTaskKind('figma-migration')).toBe('bezier-figma-migration');
    expect(defaultScenarioPluginIdForTaskKind('code-migration')).toBe('bezier-code-migration');
    expect(defaultScenarioPluginIdForTaskKind('tune-collab')).toBe('bezier-tune-collab');
    expect(DEFAULT_SCENARIO_PLUGIN_BY_TASK_KIND['new-generation']).toBe('bezier-new-generation');
  });

  it('returns null when the taskKind is missing', () => {
    expect(defaultScenarioPluginIdForTaskKind(undefined)).toBeNull();
  });
});
