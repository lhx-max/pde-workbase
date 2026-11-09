import type { BezierCardWorkflowResult } from './artifacts/bezier-card.js';
import type {
  WorkflowResultArtifact,
  WorkflowResultSurface,
} from './api/workflows.js';

/** Legacy results predate explicit surface configuration and are visible on both sides. */
export function workflowResultSupportsSurface(
  artifact: Pick<WorkflowResultArtifact, 'surfaces'>,
  surface: WorkflowResultSurface,
): boolean {
  return artifact.surfaces === undefined || artifact.surfaces.includes(surface);
}

/**
 * Project a durable workflow result into the compact chat-card contract.
 * The chat never owns a copied business payload: it always receives this view
 * from the latest persisted artifact.
 */
export function workflowResultArtifactToBezierCard(
  artifact: WorkflowResultArtifact,
): BezierCardWorkflowResult {
  const hasChatContract = artifact.chatSelection !== undefined
    || artifact.chatActions !== undefined
    || artifact.chatFeedback !== undefined;
  const chatSelection = hasChatContract ? artifact.chatSelection : artifact.selection;
  const chatFeedback = hasChatContract ? artifact.chatFeedback : artifact.feedback;
  return {
    kind: 'workflow-result',
    projectId: artifact.projectId,
    resultId: artifact.id,
    version: artifact.version,
    title: artifact.title,
    shape: artifact.shape,
    renderer: artifact.renderer,
    ...(artifact.rendererConfig ? { rendererConfig: artifact.rendererConfig } : {}),
    capabilities: artifact.capabilities,
    ...(artifact.chatCapabilities ? { chatCapabilities: artifact.chatCapabilities } : {}),
    ...(artifact.state ? { state: artifact.state } : {}),
    ...(artifact.selectedIds ? { selectedIds: artifact.selectedIds } : {}),
    ...(artifact.feedbackValue !== undefined ? { feedbackValue: artifact.feedbackValue } : {}),
    ...(chatSelection ? { selection: chatSelection } : {}),
    actions: hasChatContract ? artifact.chatActions ?? [] : artifact.actions,
    ...(chatFeedback ? { feedback: chatFeedback } : {}),
    ...(artifact.items ? { items: artifact.items } : {}),
    ...(artifact.value !== undefined ? { value: artifact.value } : {}),
  };
}
