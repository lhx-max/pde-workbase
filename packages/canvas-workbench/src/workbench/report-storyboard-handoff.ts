import { parseWorkflowReport, reportStoryboardTasks, type WorkflowResultArtifact } from '@bezier/contracts';
import { STORYBOARD_CARD_DEFAULT_HEIGHT, STORYBOARD_CARD_DEFAULT_WIDTH, type CanvasBasicNode } from './BasicCanvasNode';
import { buildStoryboardGenerationPrompt, createDefaultStoryboardPlan } from './storyboard-card';
import type { AgentTaskSubmitter } from '../platform/agent-bridge';
import { cr } from '../locales/canvas-remainder';

/** Pending report work is a task, not an empty canvas result. Includes legacy placeholders. */
export function isPendingReportStoryboard(node: CanvasBasicNode): boolean {
  return node.kind === 'storyboard' && node.id.startsWith('report-shots-') && !node.storyboard?.shots?.length;
}

export async function submitReportStoryboards(drafts: CanvasBasicNode[], deps: {
  read: () => CanvasBasicNode[];
  write: (nodes: CanvasBasicNode[]) => void;
  persist: () => Promise<void>;
  submit: AgentTaskSubmitter;
}): Promise<void> {
  const errors: string[] = [];
  for (const draft of drafts) {
    const existing = deps.read().find(node => node.id === draft.id);
    // Reconfirm resumes old empty targets, but never duplicates accepted work
    // or replaces an already generated / user-edited storyboard.
    if (existing?.storyboard?.shots?.length || existing?.generation?.status === 'running') continue;
    const generation = { requestId: crypto.randomUUID(), status: 'running' as const, baseStoryboard: 'null' };
    const target = { ...draft, generation };
    deps.write([...deps.read().filter(node => node.id !== draft.id), target]);
    try {
      await deps.persist();
      // A deleted/replaced target must not be submitted after the asynchronous save.
      if (deps.read().find(node => node.id === draft.id)?.generation?.requestId !== generation.requestId) continue;
      await deps.submit(buildStoryboardGenerationPrompt(createDefaultStoryboardPlan(), draft.storyboardPrompt, 'general', [], draft.storyboardRequirements), {
        kind: 'instruction-card', title: draft.title,
        visiblePrompt: cr().splitPlan(draft.title, draft.storyboardRequirements!.shotCount, draft.storyboardRequirements!.totalDurationSec),
        canvasTextGeneration: { requestId: generation.requestId, nodeId: draft.id, outputKind: 'storyboard' },
        taskContext: { targetLabel: draft.title, baseVersionKind: 'target-snapshot', baseVersionSource: JSON.stringify({ source: draft.source, requirements: draft.storyboardRequirements, report: draft.storyboardPrompt }) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : cr().storyboardSubmitFail;
      errors.push(`${draft.title}：${message}`);
      deps.write(deps.read().map(node => node.id === draft.id && node.generation?.requestId === generation.requestId
        ? { ...node, generation: { ...generation, status: 'failed', error: message } } : node));
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

/** Pure preparation: validation runs before confirming the source card. */
export function prepareReportStoryboards(artifact: WorkflowResultArtifact, selectedIds: string[], feedback: string, position: { x: number; y: number }): CanvasBasicNode[] {
  const items = (artifact.items ?? []).filter(item => selectedIds.includes(item.id));
  const nodes: CanvasBasicNode[] = [];
  for (const item of items) {
    const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
    const report = parseWorkflowReport(data.report);
    // This opt-in content contract leaves unrelated reports alone.
    if (!report?.facts.some(fact => fact.label === cr().membershipTier)) continue;
    for (const task of reportStoryboardTasks(report)) {
      for (let copy = 0; copy < task.quantity; copy++) {
        const identity = `${artifact.id}|${item.id}|${task.tier}|${copy}`;
        // Reconfirm/retry returns to the same card. No dependence on mutable selection version.
        const id = 'report-shots-' + Array.from(identity).map(c => c.codePointAt(0)!.toString(16)).join('-');
        nodes.push({ id, kind: 'storyboard', title: `${item.title} · ${task.tier}${task.quantity > 1 ? ` · ${copy + 1}` : ''}`,
          // Reserve the source card + a full input-gallery column. Each branch
          // needs room for both subject and scene controls, not just the script.
          x: position.x + 1500, y: position.y + nodes.reduce((height, node) => height + Math.max(960, (node.storyboardRequirements?.shotCount || 0) * 216 + 344), 0),
          width: STORYBOARD_CARD_DEFAULT_WIDTH, height: STORYBOARD_CARD_DEFAULT_HEIGHT,
          storyboardEntryMode: 'generate',
          storyboardInitialLayoutPending: true,
          storyboardRequirements: { tier: task.tier, shotCount: task.shotCount, totalDurationSec: task.totalDurationSec },
          storyboardPrompt: [
            cr().planTierOnly(item.title, task.tier, copy),
            cr().confirmSource(artifact.id, String(artifact.version), item.id),
            cr().reportFollow,
            task.context,
            feedback.trim() ? cr().userFeedback(feedback.trim()) : '',
          ].filter(Boolean).join('\n\n'),
          source: { workflowRunId: artifact.workflowRunId, stepRunId: artifact.sourceStepRunId, nodeId: artifact.resultDefinitionId, resultId: artifact.id, itemIds: [item.id] },
        });
      }
    }
  }
  return nodes;
}
