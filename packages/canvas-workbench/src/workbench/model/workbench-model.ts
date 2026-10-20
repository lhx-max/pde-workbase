import type { AgentTaskDisplay } from '../../platform/agent-bridge';
import type { CanvasWorkflowPendingRequest } from '../../CanvasWorkbenchSurface';
import type { WorkflowResultPosition } from '../workflow-result-layout';
import { WORKFLOW_RESULT_FALLBACK_ORIGIN } from '../workflow-result-layout';
import { workflowStageNodeId } from './canvas-node-builders';
import { cr } from '../../locales/canvas-remainder';
import { localizeDaemonMessage } from '../../locales/daemon-messages';
import type {
  ActiveImageTask,
  CanvasInstance,
  CanvasViewport,
  TaskDrafts,
  VisualBusiness,
  VisualRatio,
  VisualResolution,
} from './canvas-domain';
import type { CanvasBasicNode } from '../BasicCanvasNode';

export type PlanFlowSummary = {
  id: string;
  title: string;
  description: string;
  eyebrow: string;
  cardTitle: string;
  business: string;
  sourcePath: string;
  error?: string;
};

export type PendingWorkflowGeneration = {
  stepRunId: string;
  workflowRunId?: string;
  sourceArtifactId: string;
  selectedIds: string[];
  title: string;
  position: WorkflowResultPosition;
  baselineCanvasNodeIds?: string[];
  artifactCanvasNodeId?: string;
  error?: string;
};

export function workflowRegenerationPendingNodeId(stepRunId: string): string {
  return `workflow-regeneration-pending-${stepRunId}`;
}

export function workflowInitialPendingNodeId(stepRunId: string): string {
  return `workflow-initial-pending-${stepRunId}`;
}

export function workflowPendingArtifactPosition(args: {
  pending: CanvasWorkflowPendingRequest;
  stagePositions: Record<string, WorkflowResultPosition>;
  resolvedPositions: Record<string, WorkflowResultPosition>;
  basicNodes: CanvasBasicNode[];
  instances: CanvasInstance[];
}): WorkflowResultPosition {
  const { pending, stagePositions, resolvedPositions, basicNodes, instances } = args;
  if (pending.mode === 'delivery' && pending.parentResultId) {
    const parentId = workflowStageNodeId(pending.parentResultId);
    const parent = stagePositions[parentId] ?? resolvedPositions[pending.parentResultId];
    if (parent) return { x: parent.x + 600, y: parent.y };
  }
  if (pending.mode !== 'delivery') return WORKFLOW_RESULT_FALLBACK_ORIGIN;

  const nodes = [...basicNodes, ...instances];
  if (nodes.length === 0) return { x: 160, y: 120 };
  const rightmost = nodes.reduce((value, node) => (
    Math.max(value, node.x + ('width' in node && typeof node.width === 'number' ? node.width : 360))
  ), 0);
  return { x: rightmost + 80, y: 120 + (nodes.length % 3) * 72 };
}

export function deliveryPendingHasMaterialized(
  pending: CanvasWorkflowPendingRequest,
  basicNodes: CanvasBasicNode[],
): boolean {
  return pending.mode === 'delivery'
    && Boolean(pending.artifactCanvasNodeId)
    && basicNodes.some(node => node.id === pending.artifactCanvasNodeId);
}

export function genericWorkflowAgentBinding(
  value: unknown,
  fallbackTitle: string,
): AgentTaskDisplay['genericWorkflow'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const launch = value as Record<string, unknown>;
  const next = launch.next;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return undefined;
  const step = next as Record<string, unknown>;
  if (step.kind !== 'agent' || typeof launch.runId !== 'string' || typeof launch.workflowId !== 'string'
    || typeof step.stepRunId !== 'string') return undefined;
  const node = step.node && typeof step.node === 'object' && !Array.isArray(step.node)
    ? step.node as Record<string, unknown>
    : {};
  const config = node.agentConfig && typeof node.agentConfig === 'object' && !Array.isArray(node.agentConfig)
    ? node.agentConfig as Record<string, unknown>
    : {};
  const confirmation = config.confirmation && typeof config.confirmation === 'object' && !Array.isArray(config.confirmation)
    ? config.confirmation as Record<string, unknown>
    : {};
  const outputContract = config.outputContract && typeof config.outputContract === 'object' && !Array.isArray(config.outputContract)
    ? config.outputContract as Record<string, unknown>
    : {};
  return {
    runId: launch.runId,
    workflowId: launch.workflowId,
    stepRunId: step.stepRunId,
    nodeTitle: typeof node.title === 'string' && node.title.trim() ? node.title : fallbackTitle,
    expectsCandidates: confirmation.enabled !== false && Object.keys(confirmation).length > 0,
    ...(outputContract.format === 'json' || outputContract.format === 'markdown'
      ? { outputFormat: outputContract.format }
      : {}),
  };
}

export function sameViewportValue(current: CanvasViewport, next: CanvasViewport) {
  return Math.abs(current.x - next.x) < 0.5
    && Math.abs(current.y - next.y) < 0.5
    && Math.abs(current.scale - next.scale) < 0.001;
}

export type VisualPlanState = {
  requestId: string;
  revision: number;
  status: 'prepared' | 'committed' | 'executing' | 'completed' | 'failed';
  request?: {
    model: string;
    business: VisualBusiness;
    styleId: string;
  };
  result?: {
    prompt: string;
    negative?: string;
    summary: string;
  } | null;
  execution?: { taskIds?: string[]; error?: string };
};

export type ImageTaskSlot = {
  slotId: string;
  variantIndex: number;
  variant: string;
  model: string;
  outputIndex: number;
  ratio?: VisualRatio;
  status: 'queued' | 'running' | 'completed' | 'failed';
  path: string;
  name: string;
  error: string;
};

export type ImageTask = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  ratio?: VisualRatio;
  ratios?: VisualRatio[];
  resolution: VisualResolution;
  outputs: Array<{ slotId?: string; path: string; name: string; model: string }>;
  evalStatus?: 'pending' | 'running' | 'fixing' | 'awaiting-recheck' | 'completed' | '';
  evalOutputs?: Array<{
    id: string;
    path: string;
    name: string;
    model: string;
    parentSlotId: string;
    refinementPrompt?: string;
  }>;
  slots?: ImageTaskSlot[];
  retryContext?: {
    variants?: Array<{ prompt?: string; negative?: string; label?: string }>;
  };
  error?: string;
};

export type NativeMediaTask = {
  canvasDeliveryOwned?: boolean;
  canvasDelivery?: { status: string; error?: string | null };
  taskId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted';
  surface?: string;
  model?: string;
  aspect?: string;
  resolution?: string;
  file?: { name?: string; mime?: string; size?: number; stub?: boolean; intentionalStub?: boolean; usedStubFallback?: boolean };
  error?: { message?: string } | string | null;
};

export function nativeMediaErrorMessage(error: NativeMediaTask['error']): string {
  const raw = typeof error === 'string' ? error : error?.message || '';
  if (!raw) return '';
  if (/insufficient_balance/i.test(raw)) {
    return cr().designImageBalance;
  }
  if (/vela binary not found/i.test(raw)) {
    return cr().designImageRuntime;
  }
  const detail = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) || raw;
  return localizeDaemonMessage(detail.replace(/^Error:\s*/i, '').slice(0, 240));
}

export function nativeMediaTaskAsImageTask(
  task: NativeMediaTask,
  tracked: ActiveImageTask,
): ImageTask {
  const invalidResult = task.status === 'done' && (!task.file?.name?.trim()
    || task.file.size === 0 || task.file.stub || task.file.intentionalStub || task.file.usedStubFallback);
  const completed = task.status === 'done' && !invalidResult;
  const failed = task.status === 'failed' || task.status === 'interrupted' || invalidResult;
  const path = completed && typeof task.file?.name === 'string' ? task.file.name : '';
  const model = tracked.models?.[0] || (task.model?.includes('nano-banana') ? 'gemini' : 'gpt2');
  const ratio = (task.aspect || tracked.ratio || '1:1') as VisualRatio;
  const resolution = (task.resolution || tracked.resolution || '2K') as VisualResolution;
  const error = invalidResult ? cr().noRealImage : nativeMediaErrorMessage(task.error);
  const status: ImageTask['status'] = completed
    ? 'completed'
    : failed
      ? 'failed'
      : task.status === 'running'
        ? 'running'
        : 'queued';
  const slotId = `media-${task.taskId}`;
  const name = path.split('/').at(-1) || `${model}-${task.taskId}.png`;
  return {
    id: task.taskId,
    status,
    ratio,
    ratios: [ratio],
    resolution,
    outputs: path ? [{ slotId, path, name, model }] : [],
    slots: [{
      slotId,
      variantIndex: 1,
      variant: cr().normalImageGen,
      model,
      outputIndex: 1,
      ratio,
      status,
      path,
      name,
      error,
    }],
    error,
  };
}

export type CaseRuntimeSummary = {
  documentId: string;
  title: string;
  deliverable_type: string;
  phase: string;
  flow: Record<string, boolean>;
  full_chain?: boolean;
  progress: number;
  updated_at: string;
};

export function normalizeTaskDrafts(value: unknown): TaskDrafts {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TaskDrafts : {};
}

export function backendStyleId(styleId?: string): string | undefined {
  return styleId === 'fixed-template' ? undefined : styleId;
}
