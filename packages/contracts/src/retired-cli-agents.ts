/** Retired built-in local CLI IDs, for reading old selections and profiles.
 * This is not a model/provider denylist and must not be applied to API model IDs.
 * Unknown custom profiles remain the responsibility of the runtime registry.
 */
export const RETIRED_CLI_AGENT_IDS = [
  'devin', 'qwen', 'qoder', 'copilot', 'amp', 'pi',
  'kiro', 'kilo', 'vibe', 'deepseek', 'aider', 'antigravity',
  'codebuddy', 'reasonix', 'mimo', 'atomcode', 'gemini', 'amr',
] as const;

const retiredCliAgentIds: ReadonlySet<string> = new Set(RETIRED_CLI_AGENT_IDS);

export function isRetiredCliAgentId(id: string): boolean {
  return retiredCliAgentIds.has(id);
}
