/**
 * Blank, user-authored workflows must not depend on any built-in business
 * workflow. A product may intentionally ship without business presets, so loading
 * them before honoring `startBlank` would make an empty editor fail closed.
 */
export async function loadWorkflowEditorPresetFlows<T>(
  startBlank: boolean,
  flowIds: readonly string[],
  loadFlow: (flowId: string) => Promise<T>,
): Promise<T[]> {
  if (startBlank) return [];
  return await Promise.all(flowIds.map(flowId => loadFlow(flowId)));
}
