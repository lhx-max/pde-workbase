// Default scenario plugin bindings (plan §3.3 of plugin-driven-flow-plan).
//
// Both the web client (`EntryShell.handleCreate`) and the daemon
// (`/api/projects` + `/api/runs`) need to know which bundled scenario
// plugin to bind when the caller didn't pick one explicitly. Keeping
// the mapping in contracts lets both sides import the same table so the
// client and the server never disagree about what counts as the
// "default" plugin for a given project kind / task kind.
//
// Kind → scenario plugin mapping. Template examples are assets rather than
// installed plugins, so a default binding must point at a scenario that the
// daemon actually registers. Their template vocabulary remains available to
// the agent through the shared skill/template roots.
//
// Generic / catch-all kinds (template, other) keep bezier-new-generation,
// which runs discovery → plan → generate without a
// surface-specific seed. Media kinds keep bezier-media-generation, which
// dispatches through the media contract instead of emitting HTML.

import type { ProjectKind, ProjectMetadata } from '../api/projects.js';
import type { AppliedPluginSnapshot } from './apply.js';

export type TaskKind = AppliedPluginSnapshot['taskKind'];

// Plugin ids the kind/task-kind defaults can resolve to. Two tiers:
//   1. `bezier-*` scenarios (under `plugins/_official/scenarios/`) — generic
//      routers / pipelines without per-surface templates.
//   2. `example-*` scenarios (under `plugins/_official/examples/`) —
//      specialised bundled skills that ship a seed template + layout
//      vocabulary + checklist. Promoted to first-class defaults here so
//      the chip rail / project create paths bind them without the user
//      having to manually pick the skill.
// Kept as a string-literal union so a typo surfaces as a type error in
// both the web shell and the daemon resolver.
export type DefaultScenarioPluginId =
  | 'bezier-default'
  | 'bezier-new-generation'
  | 'bezier-media-generation'
  | 'bezier-plugin-authoring'
  | 'bezier-figma-migration'
  | 'bezier-code-migration'
  | 'bezier-tune-collab'
  | 'example-live-artifact'
  | 'example-simple-deck'
  | 'example-web-clone'
  | 'example-web-prototype';

export const DEFAULT_UNSELECTED_SCENARIO_PLUGIN_ID =
  'bezier-default' satisfies DefaultScenarioPluginId;

export const DEFAULT_SCENARIO_PLUGIN_BY_KIND: Record<ProjectKind, DefaultScenarioPluginId> = {
  // Prototypes bind to web-prototype's seed template (single-file HTML,
  // 1280×800 frame, section layouts library, P0 checklist).
  prototype: 'example-web-prototype',
  // simple-deck is an asset-catalogue entry, not an installed scenario.
  deck:      'bezier-new-generation',
  template:  'bezier-new-generation',
  brand:     'bezier-new-generation',
  image:     'bezier-media-generation',
  video:     'bezier-media-generation',
  audio:     'bezier-media-generation',
  other:     'bezier-new-generation',
};

export const DEFAULT_SCENARIO_PLUGIN_BY_TASK_KIND: Record<TaskKind, DefaultScenarioPluginId> = {
  'new-generation':  'bezier-new-generation',
  'figma-migration': 'bezier-figma-migration',
  'code-migration':  'bezier-code-migration',
  'tune-collab':     'bezier-tune-collab',
};

export function defaultScenarioPluginIdForKind(
  kind: ProjectKind | undefined,
): DefaultScenarioPluginId | null {
  if (!kind) return null;
  return DEFAULT_SCENARIO_PLUGIN_BY_KIND[kind] ?? null;
}

export function defaultScenarioPluginIdForProjectMetadata(
  metadata: Pick<ProjectMetadata, 'kind' | 'intent'> | null | undefined,
): DefaultScenarioPluginId | null {
  if (metadata?.intent === 'live-artifact') return 'example-live-artifact';
  if (metadata?.intent === 'web-clone') return 'example-web-clone';
  return defaultScenarioPluginIdForKind(metadata?.kind);
}

export function defaultScenarioPluginIdForTaskKind(
  taskKind: TaskKind | undefined,
): DefaultScenarioPluginId | null {
  if (!taskKind) return null;
  return DEFAULT_SCENARIO_PLUGIN_BY_TASK_KIND[taskKind] ?? null;
}
