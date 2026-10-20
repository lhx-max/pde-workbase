import { snapshotContent, snapshotVariables, snapshotPromptContext, readInputSource, captureStepInput } from './input-snapshot.js';
import { normalizeWorkflowExecutionConfirmation, workflowArtifactInstructions, type ArtifactGenerationConfig, type WorkflowArtifactTarget, type WorkflowArtifactKind } from '@bezier/contracts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseWorkflowReport } from '@bezier/contracts';
import type { Database } from '../storage/database.js';
import type {
  JsonValue,
  WorkflowDefinition,
  WorkflowStepRun,
  WorkflowResultArtifact,
  WorkflowResultInteractionResponse,
  WorkflowResultSurface,
} from '@bezier/contracts';
import { WorkflowResultError, type WorkflowResultAdapterContext, type WorkflowResultService } from './results.js';
import { WorkflowRuntime } from './runtime.js';
import { getWorkflowRun, listProjectWorkflowRunIds, listActiveWorkflowRunIds, type WorkflowRunSnapshot } from './persistence.js';

// The persisted digest identifies the compiled runtime definition, not only
// the canvas JSON. Bump this whenever compileGraph changes its output shape so
// definitions produced by different compiler revisions cannot share a key.
const GENERIC_WORKFLOW_GRAPH_COMPILER_ABI = '8';
const RESULT_LINEAGE_INPUT_KEY = '__workflowResultLineage';

type NodeKind = 'start' | 'clarify' | 'agent' | 'review' | 'branch' | 'delivery';
export interface WorkflowGraphNode {
  cardNumber?: number;
  inputReferences?: string[];
  id: string;
  kind: NodeKind;
  title: string;
  description: string;
  resultSurfaces?: WorkflowResultSurface[];
  startConfig?: {
    workflowMarkdown?: string;
    workflowName?: string;
    description?: string;
    triggerScenarios?: string[];
    includeProjectContext?: boolean;
  };
  agentConfig?: {
    agentId?: string;
    modelId?: string;
    systemPrompt?: string;
    skillIds?: string[];
    knowledgeIds?: string[];
    outputContract?: {
      format?: 'json' | 'markdown';
      minItems?: number;
      maxItems?: number;
      requiredFields?: string[];
      requiredText?: string[];
      forbiddenText?: string[];
      instructions?: string;
    };
    confirmation?: {
      mode?: 'continue';
      materializeOnConfirm?: boolean;
      title?: string;
      artifactKind?: WorkflowArtifactKind | 'document' | 'canvas' | 'file';
      enabled?: boolean;
      selection?: 'none' | 'single' | 'multiple';
      selectionRequired?: boolean;
      feedbackEnabled?: boolean;
      feedbackRequired?: boolean;
      allowRegenerate?: boolean;
      continueLabel?: string;
      chat?: WorkflowReviewSurfaceConfig;
      canvas?: WorkflowReviewSurfaceConfig;
    };
  };
  clarificationConfig?: {
    mode?: 'configured' | 'auto';
    questions?: Array<{
      id: string;
      titleMode: 'ai' | 'manual';
      title?: string;
      titleDirection?: string;
      type: 'text' | 'single' | 'multiple';
      optionDirection?: string;
      required?: boolean;
      allowOther?: boolean;
    }>;
    autoConfig?: {
      instruction?: string;
      maxQuestions?: number;
      allowedTypes?: Array<'text' | 'single' | 'multiple'>;
    };
    title?: string;
    description?: string;
    submitLabel?: string;
    attachmentsEnabled?: boolean;
  };
  reviewConfig?: {
    mode?: 'continue';
    title?: string;
    artifactKind?: WorkflowArtifactKind | 'document' | 'canvas' | 'file';
    enabled?: boolean;
    selection?: 'none' | 'single' | 'multiple';
    selectionRequired?: boolean;
    feedbackEnabled?: boolean;
    feedbackRequired?: boolean;
    allowRegenerate?: boolean;
    continueLabel?: string;
    /** False keeps the workflow result card as the only canvas artifact. */
    materializeOnConfirm?: boolean;
    chat?: WorkflowReviewSurfaceConfig;
    canvas?: WorkflowReviewSurfaceConfig;
  };
  branchConfig?: {
    instruction?: string;
    routes?: Array<{ id: string; label?: string; condition?: string }>;
    defaultRouteId?: string;
  };
  deliveryConfig?: ArtifactGenerationConfig & {
    artifactName?: string;
    requirements?: string;
    artifactKind?: WorkflowArtifactKind | 'document' | 'canvas' | 'file';
  };
}

export interface WorkflowCanvasArtifactWriter {
  fileVersions?(projectId: string, value: JsonValue, verifyOnly?: boolean): Promise<JsonValue>;
  materialize(input: {
    projectId: string;
    workflowRunId: string;
    stepRunId: string;
    nodeId: string;
    sourceAgentStepRunId?: string;
    sourceResultId?: string;
    sourceItemIds?: string[];
    kind: WorkflowArtifactKind;
    title: string;
    content: string;
    requireArtifact?: boolean;
    generation?: ArtifactGenerationConfig;
    image?: NonNullable<WorkflowGraphNode['deliveryConfig']>['image'];
  }): Promise<{ canvasNodeId: string; kind: WorkflowArtifactKind; revision?: number; content?: string; files?: import('@bezier/contracts').WorkflowArtifactFile[] }>;
}

type WorkflowReviewSurfaceConfig = {
  enabled?: boolean;
  selection?: 'none' | 'single' | 'multiple';
  selectionRequired?: boolean;
  feedbackEnabled?: boolean;
  feedbackRequired?: boolean;
  allowRegenerate?: boolean;
  continueLabel?: string;
};

function reviewSurface(
  review: NonNullable<WorkflowGraphNode['reviewConfig']>,
  surface: 'chat' | 'canvas',
): Required<WorkflowReviewSurfaceConfig> {
  const value = review[surface] ?? review;
  return {
    enabled: value.enabled ?? true,
    selection: value.selection ?? review.selection ?? 'single',
    selectionRequired: value.selectionRequired ?? review.selectionRequired ?? true,
    feedbackEnabled: value.feedbackEnabled ?? review.feedbackEnabled ?? true,
    feedbackRequired: value.feedbackRequired ?? review.feedbackRequired ?? false,
    allowRegenerate: value.allowRegenerate ?? review.allowRegenerate ?? true,
    continueLabel: value.continueLabel?.trim() || review.continueLabel?.trim() || '确认并继续',
  };
}

function reviewCapabilities(review: Required<WorkflowReviewSurfaceConfig>) {
  return [
    ...(review.selection !== 'none' ? ['select' as const] : []),
    ...(review.feedbackEnabled ? ['comment' as const] : []),
    ...(review.allowRegenerate ? ['regenerate' as const] : []),
    'continue' as const,
  ];
}

function reviewActions(review: Required<WorkflowReviewSurfaceConfig>) {
  return [
    ...(review.allowRegenerate ? [{
      id: 'regenerate', capability: 'regenerate' as const, label: '重新生成',
      busyLabel: '正在重新生成…', completion: 'keep-active' as const,
    }] : []),
    {
      // A confirmation records the chosen version, but it does not retire the
      // result card. Users can return to any historical output and branch from
      // it again.
      id: 'continue', capability: 'continue' as const, label: review.continueLabel, completion: 'keep-active' as const,
      ...(review.selection !== 'none' && review.selectionRequired ? { when: { minSelection: 1 } } : {}),
    },
  ];
}

export interface WorkflowGraphConfig {
  canvasPresentation?: 'run-group';
  nextCardNumber?: number;
  id: string;
  version: 1 | 2;
  title: string;
  updatedAt: string;
  nodes?: WorkflowGraphNode[];
  edges?: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
}

type DeliveryTarget = {
  nodeId: string;
  title: string;
  kind: WorkflowArtifactKind;
};

export type Next =
  | { kind: 'clarify'; stepRunId: string; node: WorkflowGraphNode; prompt: string }
  | {
      kind: 'agent';
      stepRunId: string;
      node: WorkflowGraphNode;
      prompt: string;
      /** When an Agent hands straight to a deliverable, the canvas can reserve
       * the exact final slot while the Agent is running. */
      deliveryTarget?: DeliveryTarget;
      /** Latest accepted result directly upstream of this Agent. */
      parentResultId?: string;
      /** Child items selected from that result for this Agent run. */
      parentItemIds?: string[];
    }
  | { kind: 'review'; stepRunId: string; node: WorkflowGraphNode; resultId: string }
  | { kind: 'delivery'; stepRunId: string; node: WorkflowGraphNode }
  | { kind: 'branch'; stepRunId: string; node: WorkflowGraphNode; prompt: string }
  | { kind: 'completed' }
  | { kind: 'failed' | 'cancelled'; message?: string };

/**
 * The small generic coordinator deliberately owns only orchestration state.
 * It does not render a card and it does not know business modules. The web app turns `next`
 * into its existing left clarification card / chat send / canvas result card.
 */
export class GenericWorkflowGraphService {
  private readonly runtime: WorkflowRuntime;
  private readonly configs = new Map<string, WorkflowGraphConfig>();
  private readonly interactions = new Map<string, Promise<Omit<WorkflowResultInteractionResponse, 'resultId' | 'interactionId'>>>();
  private readonly interactingRuns = new Set<string>();
  private readonly deliveries = new Map<string, Promise<{ snapshot: WorkflowRunSnapshot; next: Next; artifact: { canvasNodeId: string; kind: WorkflowArtifactKind; revision?: number } }>>();

  constructor(
    private readonly db: Database,
    private readonly results: WorkflowResultService,
    private readonly artifactWriter?: WorkflowCanvasArtifactWriter,
  ) {
    this.runtime = new WorkflowRuntime(db);
  }

  register(): void {
    this.results.registerAdapter('workflow.generic', (context) => this.interact(context));
  }

  listConfigs(): WorkflowGraphConfig[] {
    const rows = this.db.prepare(
      `SELECT config_json AS configJson FROM workflow_graph_configs ORDER BY updated_at DESC`,
    ).all() as Array<{ configJson: string }>;
    return rows.map(row => normalizeConfig(JSON.parse(row.configJson))).filter(Boolean) as WorkflowGraphConfig[];
  }

  /** Lightweight, prompt-safe directory for canvas-authored workflows. */
  renderDiscoveryCatalog(): string {
    const configs = this.listConfigs();
    if (configs.length === 0) return '';
    return configs.map(config => {
      const start = config.nodes?.find(node => node.kind === 'start')?.startConfig;
      const metadata = workflowMetadata(start, config.title);
      return [
        `- id: ${config.id}`,
        `  名称：${metadata.name}`,
        `  匹配说明：${metadata.description || '尚未填写流程说明'}`,
        ...(metadata.body ? [`  WORKFLOW.md 入口约定：\n${indentMarkdown(metadata.body)}`] : []),
      ].join('\n');
    }).join('\n');
  }

  getConfig(id: string): WorkflowGraphConfig | null {
    const row = this.db.prepare(
      `SELECT config_json AS configJson FROM workflow_graph_configs WHERE id = ?`,
    ).get(id) as { configJson: string } | undefined;
    return row ? normalizeConfig(JSON.parse(row.configJson)) : null;
  }

  saveConfig(input: WorkflowGraphConfig): WorkflowGraphConfig {
    const config = requireConfig(input);
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO workflow_graph_configs (id, title, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, config_json = excluded.config_json, updated_at = excluded.updated_at`,
    ).run(config.id, config.title, JSON.stringify(config), now, now);
    return config;
  }

  /** Validate an AI-authored proposal without persisting it. */
  validateRunnableConfig(input: WorkflowGraphConfig): WorkflowGraphConfig {
    const config = requireConfig(input);
    requireRunnableGraph(config);
    return config;
  }

  deleteConfig(id: string): boolean {
    return this.db.prepare(`DELETE FROM workflow_graph_configs WHERE id = ?`).run(id).changes > 0;
  }

  start(input: { projectId: string; workflowId: string; value?: JsonValue }): { snapshot: WorkflowRunSnapshot; next: Next } {
    const config = this.getConfig(input.workflowId);
    if (!config) throw new WorkflowResultError(404, 'WORKFLOW_NOT_FOUND', '工作流未找到');
    if (!config.nodes?.some(node => node.kind !== 'start')) {
      throw new WorkflowResultError(400, 'WORKFLOW_EMPTY', '请先在开始节点后添加至少一个执行节点');
    }
    requireRunnableGraph(config);
    const definition = compileGraph(config);
    const start = config.nodes?.find(node => node.kind === 'start')?.startConfig;
    const metadata = workflowMetadata(start, config.title);
    const value = {
      ...(isRecord(input.value) ? input.value : input.value === undefined ? {} : { task: input.value }),
      workflow: {
        title: metadata.name,
        description: metadata.description,
        ...(start?.includeProjectContext !== false ? { projectId: input.projectId } : {}),
      },
    } as JsonValue;
    const snapshot = this.runtime.create({
      projectId: input.projectId,
      definition,
      value,
      variables: isRecord(value) ? value : {},
    });
    const next = this.next(snapshot.run.id);
    return { snapshot: this.runtime.get(snapshot.run.id), next };
  }

  startOrResumeActive(input: { projectId: string; workflowId: string; value?: JsonValue; requestId?: string }): {
    snapshot: WorkflowRunSnapshot;
    next: Next;
    reused: boolean;
  } {
    if (!input.requestId) return this.startOrResumeUnkeyed(input);
    const digest = createHash('sha256').update(JSON.stringify([input.workflowId, input.value ?? null])).digest('hex');
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT run_id, request_digest FROM workflow_start_requests WHERE project_id = ? AND request_id = ?')
        .get(input.projectId, input.requestId!) as { run_id: string; request_digest: string } | undefined;
      if (previous) {
        if (previous.request_digest !== digest) throw new WorkflowResultError(409, 'WORKFLOW_REQUEST_CONFLICT', '相同请求标识不能提交不同内容');
        return { ...this.current(previous.run_id), reused: true };
      }
      const started = this.startOrResumeUnkeyed(input);
      this.db.prepare('INSERT INTO workflow_start_requests(project_id, request_id, request_digest, run_id) VALUES (?, ?, ?, ?)')
        .run(input.projectId, input.requestId!, digest, started.snapshot.run.id);
      return started;
    })();
  }

  private startOrResumeUnkeyed(input: { projectId: string; workflowId: string; value?: JsonValue }): {
    snapshot: WorkflowRunSnapshot;
    next: Next;
    reused: boolean;
  } {
    const active = this.db.prepare(
      `SELECT id FROM workflow_runs
        WHERE project_id = ? AND workflow_id = ?
          AND status IN ('pending','running','awaiting-input','waiting')
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).get(input.projectId, input.workflowId) as { id: string } | undefined;
    if (active) {
      const snapshot = this.runtime.get(active.id);
      const currentInput = { ...(isRecord(snapshot.run.input) ? snapshot.run.input : {}) };
      delete currentInput.workflow;
      const requestedInput = { ...(isRecord(input.value) ? input.value : {}) };
      delete requestedInput.workflow;
      if (input.value !== undefined && !isDeepStrictEqual(currentInput, requestedInput)) {
        throw new WorkflowResultError(409, 'WORKFLOW_ACTIVE_INPUT_CONFLICT', '这个工作流还有未完成的任务，请先恢复或停止原任务');
      }
      return { snapshot, next: this.next(active.id), reused: true };
    }
    return { ...this.start(input), reused: false };
  }

  getActiveProjectRun(projectId: string): { snapshot: WorkflowRunSnapshot; next: Next } | null {
    const active = this.db.prepare(
      `SELECT id FROM workflow_runs
        WHERE project_id = ?
          AND status IN ('pending','running','awaiting-input','waiting')
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).get(projectId) as { id: string } | undefined;
    if (!active) return null;
    const snapshot = this.runtime.get(active.id);
    // A saved workflow edit creates a new compiled definition. Do not restore
    // an older execution branch as if it were current. The one safe exception
    // is a delivery already waiting to persist an output from that immutable
    // run snapshot; finishing it prevents a valid result from being stranded.
    return { snapshot, next: this.next(active.id) };
  }

  submitClarification(input: { runId: string; stepRunId: string; values: JsonValue }): { snapshot: WorkflowRunSnapshot; next: Next } {
    const snapshot = this.runtime.get(input.runId);
    const step = requireStep(snapshot, input.stepRunId, 'clarify');
    if (step.status === 'succeeded') {
      if (JSON.stringify(step.output) !== JSON.stringify(input.values)) throw new WorkflowResultError(409, 'WORKFLOW_ANSWER_CONFLICT', '这个问题已经回答，不能重复提交不同答案');
      return { snapshot, next: this.next(input.runId) };
    }
    const node = requireNodeFromStepSnapshot(snapshot, step.stepId);
    validateClarificationValues(node, input.values);
    this.runtime.complete(input.runId, step.id, { output: input.values });
    const next = this.next(input.runId);
    return { snapshot: this.runtime.get(input.runId), next };
  }

  /** Rebuild the user-input hand-off after a web refresh without advancing a run. */
  resumeAwaitingInput(runId: string): { snapshot: WorkflowRunSnapshot; next: Next } | null {
    const snapshot = this.runtime.get(runId);
    const active = snapshot.steps.find(step => step.status === 'awaiting-input');
    if (!active) return null;
    const config = this.configFor(snapshot);
    return { snapshot, next: nextFor(snapshot, config, active, this.results) };
  }

  completeAgent(input: { runId: string; stepRunId: string; output: JsonValue }): { snapshot: WorkflowRunSnapshot; next: Next } {
    const snapshot = this.runtime.get(input.runId);
    const step = requireStep(snapshot, input.stepRunId, 'agent');
    if (step.status === 'succeeded') {
      const next = this.next(input.runId);
      return { snapshot: this.runtime.get(input.runId), next };
    }
    const node = requireNodeFromStepSnapshot(snapshot, step.stepId);
    const selectedRegenerationCount = resultLineage(step.input)?.expectedItemCount;
    validateAgentOutput(node, input.output, selectedRegenerationCount);
    if (step.status === 'cancelled') {
      // The user may branch from an earlier result while this Agent is still
      // finishing.  The active graph correctly moves to the new branch, but a
      // terminal response that was already generated is still a real output.
      // Preserve it as an immutable historical result card without advancing
      // or reopening the superseded branch.
      this.db.prepare('UPDATE workflow_step_runs SET output_json = ? WHERE id = ? AND status = \'cancelled\' AND output_json IS NULL').run(JSON.stringify(input.output), step.id);
      const preserved = this.runtime.get(input.runId);
      this.publishAgentResults(preserved, step.stepId, preserved.steps.find(item => item.id === step.id)!.output!, step.id);
      const next = this.next(input.runId);
      return { snapshot: this.runtime.get(input.runId), next };
    }
    this.runtime.complete(input.runId, step.id, { output: input.output });
    const current = this.runtime.get(input.runId);
    this.publishAgentResults(current, step.stepId, input.output);
    const next = this.next(input.runId);
    return { snapshot: this.runtime.get(input.runId), next };
  }

  /**
   * A delivery node is an automatic output sink, not a second user input.
   * Keep the Agent completion and immediate materialization in one server-side
   * hand-off so a browser refresh/unmount cannot strand the canvas skeleton.
   */
  async completeAgentAndDelivery(input: { runId: string; stepRunId: string; output: JsonValue }): Promise<{
    snapshot: WorkflowRunSnapshot;
    next: Next;
    artifact?: { canvasNodeId: string; kind: WorkflowArtifactKind; revision?: number };
  }> {
    const completed = await this.completeAgentWithFiles(input);
    return this.completeAutomaticDelivery(input.runId, completed.next, completed.snapshot);
  }

  async completeAgentWithFiles(input: { runId: string; stepRunId: string; output: JsonValue }) {
    const state = this.runtime.get(input.runId);
    const source = requireStep(state, input.stepRunId, 'agent');
    const output = (source.status === 'succeeded' || source.status === 'cancelled') && source.output !== undefined ? source.output : this.artifactWriter?.fileVersions
      ? await this.artifactWriter.fileVersions(state.run.projectId, input.output)
      : input.output;
    return this.completeAgent({ ...input, output });
  }

  /** Apply the runtime invariant at every hand-off: delivery nodes execute on
   * the server immediately and are never returned as required browser input. */
  async completeAutomaticDelivery(runId: string, next: Next, snapshot?: WorkflowRunSnapshot): Promise<{
    snapshot: WorkflowRunSnapshot;
    next: Next;
    artifact?: { canvasNodeId: string; kind: WorkflowArtifactKind; revision?: number };
  }> {
    if (next.kind !== 'delivery') return { snapshot: snapshot ?? this.runtime.get(runId), next };
    const delivered = await this.completeDelivery({ runId, stepRunId: next.stepRunId });
    return { snapshot: delivered.snapshot, next: delivered.next, artifact: delivered.artifact };
  }

  /**
   * Delivery is durable work, not a browser-only UI transition. If the daemon
   * restarted after an Agent output had been persisted, finish any pending
   * delivery node during boot so its loading placeholder cannot be orphaned.
   */
  async recoverPendingDeliveries(): Promise<{ attempted: number; completed: number; failed: number }> {
    let attempted = 0;
    let completed = 0;
    let failed = 0;
    for (const runId of listActiveWorkflowRunIds(this.db)) {
      if (this.db.prepare('SELECT 1 FROM workflow_execution_owners WHERE run_id = ?').get(runId)) continue;
      const snapshot = this.runtime.get(runId);
      if (snapshot.run.status !== 'awaiting-input') continue;
      const next = this.next(runId);
      if (next.kind !== 'delivery') continue;
      attempted += 1;
      try {
        await this.completeDelivery({ runId, stepRunId: next.stepRunId });
        completed += 1;
      } catch {
        // Keep the delivery step resumable. A later boot or the explicit
        // delivery endpoint can retry when its storage dependency recovers.
        failed += 1;
      }
    }
    return { attempted, completed, failed };
  }

  async completeDelivery(input: { runId: string; stepRunId: string }): Promise<{ snapshot: WorkflowRunSnapshot; next: Next; artifact: { canvasNodeId: string; kind: WorkflowArtifactKind; revision?: number } }> {
    const key = `${input.runId}:${input.stepRunId}`;
    const pending = this.deliveries.get(key);
    if (pending) return pending;
    const work = this.performDelivery(input);
    this.deliveries.set(key, work);
    try { return await work; } finally { this.deliveries.delete(key); }
  }

  private async performDelivery(input: { runId: string; stepRunId: string }): Promise<{ snapshot: WorkflowRunSnapshot; next: Next; artifact: { canvasNodeId: string; kind: WorkflowArtifactKind; revision?: number } }> {
    const snapshot = this.runtime.get(input.runId);
    const step = requireStep(snapshot, input.stepRunId, 'delivery');
    const node = requireNodeFromStepSnapshot(snapshot, step.stepId);
    if (step.status === 'succeeded' && isRecord(step.output) && typeof step.output.canvasNodeId === 'string') {
      return { snapshot, next: this.next(input.runId), artifact: { canvasNodeId: step.output.canvasNodeId, kind: step.output.artifactKind as WorkflowArtifactKind } };
    }
    if (!['pending', 'running', 'awaiting-input', 'waiting'].includes(snapshot.run.status) || step.status !== 'awaiting-input') {
      throw new WorkflowResultError(409, 'WORKFLOW_DELIVERY_INACTIVE', '这个交付步骤已停止，不能重新写入画布');
    }
    if (!this.artifactWriter) {
      throw new WorkflowResultError(503, 'WORKFLOW_ARTIFACT_WRITER_UNAVAILABLE', '画布产物能力不可用');
    }
    const kind = normalizedArtifactKind(node.deliveryConfig?.artifactKind);
    const config = this.configFor(snapshot);
    const upstream = step.inputSnapshot ? snapshotContent(snapshot, step.inputSnapshot) : directParentOutputs(snapshot, config, node.id);
    if (Object.keys(upstream).length === 0) {
      throw new WorkflowResultError(409, 'WORKFLOW_DELIVERY_SOURCE_MISSING', '产物节点没有可交付的上游执行结果');
    }
    if (step.inputSnapshot && Object.keys(upstream).length !== 1) {
      throw new WorkflowResultError(409, 'WORKFLOW_DELIVERY_AMBIGUOUS', '产物收到多个内容来源，请先连接执行卡合并内容，再交付产物');
    }
    // Delivery nodes do not publish an intermediate result card of their own.
    // Preserve the nearest confirmed result as the canvas artifact's parent so
    // every workflow can render the final edge without workflow-specific code.
    const lineage = step.inputSnapshot
      ? [...step.inputSnapshot.context].reverse().map(source => resultLineage(readInputSource(snapshot, source))).find(Boolean) ?? null
      : nearestResultLineage(snapshot, config, node.id);
    const producerNode = upstreamAgentOf(config, node.id);
    const contentSource = step.inputSnapshot?.content[0];
    const contentStep = contentSource ? snapshot.steps.find(item => item.id === contentSource.stepRunId) : undefined;
    const producerStep = contentSource?.kind === 'review'
      ? snapshot.steps.find(item => item.id === contentStep?.inputSnapshot?.upstream[0]?.stepRunId)
      : contentStep ?? (producerNode ? latestStepRun(snapshot.steps, producerNode.id, 'succeeded') : undefined);
    if (step.inputSnapshot && this.artifactWriter.fileVersions) {
      await this.artifactWriter.fileVersions(snapshot.run.projectId, upstream, true);
    }
    const artifact = await this.artifactWriter.materialize({
      projectId: snapshot.run.projectId,
      workflowRunId: snapshot.run.id,
      stepRunId: step.id,
      nodeId: node.id,
      ...(producerStep ? { sourceAgentStepRunId: producerStep.id } : {}),
      ...(lineage?.parentResultId ? { sourceResultId: lineage.parentResultId } : {}),
      ...(lineage?.parentItemIds?.length ? { sourceItemIds: lineage.parentItemIds } : {}),
      kind,
      title: deliveryArtifactTitle(node, upstream),
      content: deliveryContent(upstream, node),
      requireArtifact: true,
      ...(node.deliveryConfig ? { generation: node.deliveryConfig } : {}),
    });
    this.runtime.complete(snapshot.run.id, step.id, {
      output: {
        delivered: true,
        content: artifact.content ?? artifactContent(upstream),
        files: artifact.files ?? [],
        artifactKind: kind,
        canvasNodeId: artifact.canvasNodeId,
        ...(artifact.revision === undefined ? {} : { canvasRevision: artifact.revision }),
      },
      artifactRefs: [`canvas-node:${artifact.canvasNodeId}`],
    });
    let next = this.next(snapshot.run.id);
    if (next.kind === 'delivery') {
      next = (await this.completeAutomaticDelivery(snapshot.run.id, next)).next;
    }
    return { snapshot: this.runtime.get(snapshot.run.id), next, artifact };
  }

  failAgent(input: {
    runId: string;
    stepRunId: string;
    error: { code: string; message: string; retryable: boolean };
  }): WorkflowRunSnapshot {
    const snapshot = this.runtime.get(input.runId);
    const step = requireStep(snapshot, input.stepRunId, 'agent');
    if (step.status === 'failed' || !['pending', 'running', 'awaiting-input', 'waiting'].includes(snapshot.run.status)) {
      return snapshot;
    }
    if (step.status !== 'running') throw new Error('Workflow Agent step is not running');
    return this.runtime.fail(input.runId, step.id, input.error);
  }

  chooseBranch(input: { runId: string; stepRunId: string; routeId: string; value?: JsonValue }): { snapshot: WorkflowRunSnapshot; next: Next } {
    const snapshot = this.runtime.get(input.runId);
    const step = requireStep(snapshot, input.stepRunId, 'branch');
    const allowed = allowedBranchRouteIds(snapshot, step.stepId);
    if (!allowed.includes(input.routeId)) throw new Error(`工作流判断返回了未知分支：${input.routeId || '空'}`);
    this.runtime.complete(input.runId, step.id, {
      output: input.value ?? { routeId: input.routeId },
      selectedRouteId: input.routeId,
    });
    const next = this.next(input.runId);
    return { snapshot: this.runtime.get(input.runId), next };
  }

  resolveBranchDecision(input: { runId: string; stepRunId: string; decision: string }): {
    snapshot: WorkflowRunSnapshot;
    next: Next;
    decision: { routeId: string; reason: string; confidence?: number; fallback: boolean };
  } {
    const snapshot = this.runtime.get(input.runId);
    const step = requireStep(snapshot, input.stepRunId, 'branch');
    const node = requireNodeFromStepSnapshot(snapshot, step.stepId);
    const allowed = allowedBranchRouteIds(snapshot, step.stepId);
    const parsed = parseBranchDecision(input.decision);
    const configuredFallback = node.branchConfig?.defaultRouteId;
    const routeId = parsed && allowed.includes(parsed.routeId)
      ? parsed.routeId
      : configuredFallback && allowed.includes(configuredFallback)
        ? configuredFallback
        : '';
    if (!routeId) {
      throw new Error(parsed
        ? `Agent 选择了未连接的分支：${parsed.routeId}`
        : 'Agent 判断结果无法解析，且没有可用的兜底分支');
    }
    const decision = {
      routeId,
      reason: parsed?.reason || 'Agent 返回无法解析，已使用配置的兜底分支。',
      ...(parsed?.confidence === undefined ? {} : { confidence: parsed.confidence }),
      fallback: !parsed || parsed.routeId !== routeId,
    };
    this.runtime.complete(input.runId, step.id, {
      output: decision,
      selectedRouteId: routeId,
    });
    const next = this.next(input.runId);
    return { snapshot: this.runtime.get(input.runId), next, decision };
  }

  async prepareStepInput(runId: string, stepRunId: string): Promise<void> {
    if (!this.artifactWriter?.fileVersions) return;
    let snapshot = this.runtime.get(runId);
    const step = snapshot.steps.find(item => item.id === stepRunId);
    if (!step?.inputSnapshot) return;
    const task = await this.artifactWriter.fileVersions(snapshot.run.projectId, snapshot.run.inputVersion ?? step.inputSnapshot.task);
    this.db.prepare('UPDATE workflow_runs SET input_version_json = ? WHERE id = ? AND input_version_json IS NULL')
      .run(JSON.stringify(task), runId);
    const pinnedTask = this.runtime.get(runId).run.inputVersion!;
    // A concurrent first reader may have pinned a different version. Verify
    // the winner before starting work, never silently replace its snapshot.
    await this.artifactWriter.fileVersions(snapshot.run.projectId, pinnedTask, true);
    this.db.prepare('UPDATE workflow_step_runs SET input_snapshot_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...step.inputSnapshot, task: pinnedTask }), step.id);
    snapshot = this.runtime.get(runId);
    await this.artifactWriter.fileVersions(snapshot.run.projectId, snapshotContent(snapshot, snapshot.steps.find(item => item.id === stepRunId)!.inputSnapshot!), true);
    await this.artifactWriter.fileVersions(snapshot.run.projectId, snapshotVariables(snapshot, snapshot.steps.find(item => item.id === stepRunId)!.inputSnapshot!), true);
  }

  listProjectRuns(projectId: string): WorkflowRunSnapshot[] {
    return listProjectWorkflowRunIds(this.db, projectId).flatMap(id => { const run = this.getRun(id); return run ? [run] : []; });
  }

  getRun(runId: string): WorkflowRunSnapshot | null { return getWorkflowRun(this.db, runId); }

  current(runId: string): { snapshot: WorkflowRunSnapshot; next: Next } {
    const next = this.next(runId);
    return { snapshot: this.runtime.get(runId), next };
  }

  retryFailed(runId: string, stepRunId: string): { snapshot: WorkflowRunSnapshot; next: Next } {
    const snapshot = this.runtime.get(runId);
    const step = snapshot.steps.find(item => item.id === stepRunId);
    if (!step) throw new WorkflowResultError(404, 'WORKFLOW_STEP_MISSING', '找不到失败步骤');
    const newer = snapshot.steps.some(item => item.stepId === step.stepId && item.attempt > step.attempt);
    if (newer) return this.current(runId);
    if (snapshot.run.status !== 'failed' || step.status !== 'failed') throw new WorkflowResultError(409, 'WORKFLOW_RETRY_INACTIVE', '仅能重新执行已失败的步骤');
    this.runtime.requeueFromStep(runId, step.stepId);
    return this.current(runId);
  }

  cancel(runId: string): WorkflowRunSnapshot { return this.runtime.cancel(runId); }

  private next(runId: string): Next {
    let snapshot = this.runtime.get(runId);
    if (snapshot.run.status === 'succeeded') return { kind: 'completed' };
    if (snapshot.run.status === 'failed' || snapshot.run.status === 'terminated') return { kind: 'failed', ...(snapshot.run.termination?.message ? { message: snapshot.run.termination.message } : {}) };
    if (snapshot.run.status === 'cancelled') return { kind: 'cancelled' };
    const config = this.configFor(snapshot);
    const running = snapshot.steps.find(step => step.status === 'running');
    if (running) {
      const node = requireNode(config, running.stepId);
      const target = directDeliveryTarget(config, node.id);
      if (node.kind === 'agent') return { kind: 'agent', stepRunId: running.id, node,
        prompt: isRecord(running.input) && typeof running.input.__executionPrompt === 'string' ? running.input.__executionPrompt : stepAgentPrompt(snapshot, config, node, running),
        ...(target ? { deliveryTarget: target } : {}) };
    }
    const active = snapshot.steps.find(step => step.status === 'awaiting-input');
    if (active) {
      snapshot = this.runtime.awaitInput(runId, active.id);
      const activeStep = snapshot.steps.find(step => step.id === active.id)!;
      const activeNode = requireNode(config, activeStep.stepId);
      if (activeNode.kind === 'review') this.publishWaitingReviewResult(snapshot, config, activeNode);
      return nextFor(snapshot, config, activeStep, this.results);
    }
    const pending = snapshot.steps.find(step => step.status === 'pending');
    if (!pending) return { kind: 'completed' };
    const node = requireNode(config, pending.stepId);
    if (node.kind === 'clarify' || node.kind === 'review' || node.kind === 'branch' || node.kind === 'delivery') {
      snapshot = this.runtime.awaitInput(runId, pending.id);
      if (node.kind === 'review') this.publishWaitingReviewResult(snapshot, config, node);
      return nextFor(snapshot, config, snapshot.steps.find(step => step.id === pending.id)!, this.results);
    }
    if (node.kind === 'agent') {
      const pinnedInput = captureStepInput(snapshot, pending, Date.now());
      const inheritedLineage = pinnedInput
        ? [...pinnedInput.context].reverse().map(source => resultLineage(readInputSource(snapshot, source))).find(Boolean) ?? null
        : nearestResultLineage(snapshot, config, node.id);
      const deliveryTarget = directDeliveryTarget(config, node.id);
      const claimed = this.runtime.claim(
        runId,
        pending.id,
        undefined,
        inheritedLineage
          ? {
              ...(isRecord(pending.input) ? pending.input : {}),
              [RESULT_LINEAGE_INPUT_KEY]: inheritedLineage,
            }
          : undefined,
      );
      return {
        kind: 'agent',
        stepRunId: claimed.id,
        node,
        prompt: stepAgentPrompt(this.runtime.get(runId), config, node, claimed),
        ...(deliveryTarget ? { deliveryTarget } : {}),
        ...(inheritedLineage?.parentResultId ? { parentResultId: inheritedLineage.parentResultId } : {}),
        ...(inheritedLineage?.parentItemIds?.length ? { parentItemIds: inheritedLineage.parentItemIds } : {}),
      };
    }
    throw new Error(`Unsupported workflow node: ${node.kind}`);
  }

  private publishAgentResults(
    snapshot: WorkflowRunSnapshot,
    agentStepId: string,
    output: JsonValue,
    sourceStepRunId?: string,
  ): void {
    const config = this.configFor(snapshot);
    const resultNodes = config.nodes!.filter(node => (
      node.kind === 'review'
      && parentsOf(config, node.id).some(parent => parent.id === agentStepId)
    ));
    for (const node of resultNodes) {
      const source = sourceStepRunId
        ? snapshot.steps.find(step => step.id === sourceStepRunId)
        : snapshot.steps
            .filter(step => step.stepId === agentStepId)
            .sort((left, right) => right.iteration - left.iteration || right.attempt - left.attempt)[0];
      if (!source) continue;
      this.publishReviewResult(snapshot, config, node, source, output);
    }
  }

  private publishWaitingReviewResult(
    snapshot: WorkflowRunSnapshot,
    config: WorkflowGraphConfig,
    node: WorkflowGraphNode,
  ): void {
    const sourceNode = upstreamAgentOf(config, node.id);
    if (!sourceNode) return;
    const source = snapshot.steps
      .filter(step => step.stepId === sourceNode.id && step.status === 'succeeded')
      .sort((left, right) => right.iteration - left.iteration || right.attempt - left.attempt)[0];
    if (!source) return;
    const directParentIds = new Set(parentsOf(config, node.id).map(parent => parent.id));
    const directParent = snapshot.steps
      .filter(step => directParentIds.has(step.stepId) && step.status === 'succeeded')
      .sort((left, right) => right.iteration - left.iteration || right.attempt - left.attempt)[0];
    const parentOutput = directParent?.output;
    const output = isRecord(parentOutput) && parentOutput.result !== undefined
      ? parentOutput.result
      : source.output;
    if (output === undefined) return;
    this.publishReviewResult(snapshot, config, node, source, output);
  }

  private publishReviewResult(
    snapshot: WorkflowRunSnapshot,
    config: WorkflowGraphConfig,
    node: WorkflowGraphNode,
    source: WorkflowRunSnapshot['steps'][number],
    output: JsonValue,
  ): void {
    const review = node.reviewConfig ?? {};
    const canvasReview = reviewSurface(review, 'canvas');
    const chatReview = reviewSurface(review, 'chat');
    const configuredSurfaces: WorkflowResultSurface[] = node.resultSurfaces?.length
      ? node.resultSurfaces
      : ['chat', 'canvas'];
    const items = outputItems(output);
    const hasReport = items.some(item => isRecord(item.data) && parseWorkflowReport(item.data.report));
    const sourceNode = config.nodes?.find(candidate => candidate.id === source.stepId);
    const renderer = sourceNode?.kind === 'agent' && sourceNode.agentConfig?.outputContract?.format === 'markdown'
      ? 'document' as const
      : 'structured' as const;
    const documentContent = renderer === 'document' ? artifactContent({ result: output }) : undefined;
    const resultId = workflowResultId(snapshot.run.id, node.id, source.id);
    if (this.results.get(resultId)) return;
    const previous = this.results.list({
      projectId: snapshot.run.projectId,
      workflowRunId: snapshot.run.id,
    }).at(-1);
    const lineage = resultLineage(source.input);
    const artifact: WorkflowResultArtifact = {
      id: resultId,
      workflowRunId: snapshot.run.id,
      resultDefinitionId: node.id,
      sourceStepRunId: source.id,
      // Each Agent attempt is an immutable result card. New generations append
      // a new identity instead of overwriting a version the user already saw.
      version: 1,
      projectId: snapshot.run.projectId,
      title: node.title || '结果确认',
      shape: items.length > 1 ? 'collection' : 'single',
      renderer,
      capabilities: [...reviewCapabilities(canvasReview), ...(hasReport ? ['edit' as const] : [])],
      chatCapabilities: reviewCapabilities(chatReview),
      surfaces: configuredSurfaces
        .filter(surface => surface === 'chat' ? chatReview.enabled : canvasReview.enabled),
      selection: {
        mode: canvasReview.selection,
        ...(canvasReview.selection !== 'none' && canvasReview.selectionRequired ? { min: 1 } : {}),
      },
      chatSelection: {
        mode: chatReview.selection,
        ...(chatReview.selection !== 'none' && chatReview.selectionRequired ? { min: 1 } : {}),
      },
      actions: [...reviewActions(canvasReview), ...(hasReport ? [{ id: 'edit-report', capability: 'edit' as const, label: '保存方案', completion: 'keep-active' as const }] : [])],
      chatActions: reviewActions(chatReview),
      ...(canvasReview.feedbackEnabled ? { feedback: {
        label: canvasReview.feedbackRequired ? '调整意见（必填）' : '调整意见',
        placeholder: canvasReview.feedbackRequired ? '请输入调整意见' : '可选：告诉 Agent 下一步需要注意什么',
        required: canvasReview.feedbackRequired,
      } } : {}),
      ...(chatReview.feedbackEnabled ? { chatFeedback: {
        label: chatReview.feedbackRequired ? '调整意见（必填）' : '调整意见',
        placeholder: chatReview.feedbackRequired ? '请输入调整意见' : '可选：告诉 Agent 下一步需要注意什么',
        required: chatReview.feedbackRequired,
      } } : {}),
      ...(lineage?.parentResultId
        ? { parentResultId: lineage.parentResultId }
        : previous ? { parentResultId: previous.id } : {}),
      ...(lineage?.parentItemIds?.length ? { parentItemIds: lineage.parentItemIds } : {}),
      state: 'active', items, value: {
        resultNodeId: node.id,
        artifactKind: normalizedArtifactKind(node.reviewConfig?.artifactKind),
        ...(documentContent === undefined ? {} : { content: documentContent }),
      }, createdAt: new Date().toISOString(),
    };
    this.results.publish({ artifact, adapterId: 'workflow.generic' });
  }

  private async interact(context: WorkflowResultAdapterContext): Promise<Omit<WorkflowResultInteractionResponse, 'resultId' | 'interactionId'>> {
    const key = this.interactionKey(context);
    const stored = this.db.prepare('SELECT response_json FROM workflow_execution_actions WHERE action_key = ?').get(key) as { response_json: string } | undefined;
    if (stored) return JSON.parse(stored.response_json);
    const pending = this.interactions.get(key);
    if (pending) return pending;
    const runId = context.artifact.workflowRunId;
    if (this.interactingRuns.has(runId)) throw new WorkflowResultError(409, 'WORKFLOW_INTERACTION_PENDING', '前一次选择正在保存，请稍后再提交其他选择');
    this.interactingRuns.add(runId);
    const work = (async () => {
      // If the process stopped after the runtime transition but before the
      // response receipt, the persisted transition still proves acceptance.
      const snapshot = this.runtime.get(context.artifact.workflowRunId);
      const applied = snapshot.steps.some(step => (isRecord(step.input) && step.input.__interactionKey === key)
        || (isRecord(step.output) && step.output.__interactionKey === key));
      const result = applied ? this.interactionResume(snapshot.run.id) : await this.performInteraction(context);
      this.db.prepare('INSERT OR IGNORE INTO workflow_execution_actions(action_key, run_id, response_json) VALUES (?, ?, ?)')
        .run(key, snapshot.run.id, JSON.stringify(result));
      return result;
    })();
    this.interactions.set(key, work);
    try { return await work; } finally { this.interactions.delete(key); this.interactingRuns.delete(runId); }
  }

  private interactionKey(context: WorkflowResultAdapterContext): string {
    return createHash('sha256').update(JSON.stringify([context.artifact.id, context.request.actionId,
      context.request.expectedVersion, [...(context.request.selectedIds ?? [])].sort(), context.request.feedback ?? '',
      context.request.itemId ?? '', context.request.patch ?? {}])).digest('hex');
  }

  private interactionResume(runId: string): Omit<WorkflowResultInteractionResponse, 'resultId' | 'interactionId'> {
    const { snapshot, next } = this.current(runId);
    return { ok: true, state: next.kind === 'completed' ? 'completed' : 'accepted',
      ...(next.kind === 'agent' ? { agentPrompt: next.prompt } : {}),
      runMetadata: { genericWorkflow: { runId, workflowId: snapshot.run.workflowId, next } as unknown as JsonValue } };
  }

  private async performInteraction(context: WorkflowResultAdapterContext): Promise<Omit<WorkflowResultInteractionResponse, 'resultId' | 'interactionId'>> {
    const snapshot = this.runtime.get(context.artifact.workflowRunId);
    const config = this.configFor(snapshot);
    const resultNodeId = String((context.artifact.value as Record<string, unknown> | undefined)?.resultNodeId
      ?? (context.artifact.value as Record<string, unknown> | undefined)?.reviewNodeId
      ?? context.artifact.resultDefinitionId);
    let step = latestStepRun(snapshot.steps, resultNodeId, 'awaiting-input');
    if (context.request.actionId === 'edit-report') {
      const item = context.artifact.items?.find(candidate => candidate.id === context.request.itemId);
      if (!item || !isRecord(item.data) || !parseWorkflowReport(item.data.report)) {
        throw new WorkflowResultError(400, 'WORKFLOW_REPORT_ITEM_INVALID', '找不到可编辑的方案');
      }
      if (!step) throw new WorkflowResultError(409, 'WORKFLOW_REPORT_ALREADY_CONFIRMED', '本轮已确认，请重新生成一个方案版本后编辑');
      const patch = context.request.patch ?? {};
      if (Object.keys(patch).some(key => key !== 'report')) throw new WorkflowResultError(400, 'WORKFLOW_REPORT_PATCH_INVALID', '只允许修改方案报告');
      let value: unknown;
      try { value = JSON.parse(patch.report ?? ''); } catch { throw new WorkflowResultError(400, 'WORKFLOW_REPORT_INVALID', '方案格式不正确'); }
      const report = parseWorkflowReport(value);
      // Reject lossy normalization at the write boundary rather than silently dropping edits.
      if (!report || !isDeepStrictEqual(report, value)) throw new WorkflowResultError(400, 'WORKFLOW_REPORT_INVALID', '方案字段不完整或包含不支持的内容');
      this.results.publish({ adapterId: 'workflow.generic', artifact: {
        ...context.artifact, version: context.artifact.version + 1,
        items: context.artifact.items!.map(candidate => candidate.id === item.id
          ? { ...candidate, data: { ...item.data as Record<string, JsonValue>, report: report as unknown as JsonValue } }
          : candidate),
      } });
      return { ok: true, state: 'accepted', message: '方案已保存，确认时将使用本次修改。' };
    }
    if (context.request.actionId === 'regenerate') {
      const sourceStep = snapshot.steps.find(item => item.id === context.artifact.sourceStepRunId);
      if (!sourceStep) throw new WorkflowResultError(409, 'WORKFLOW_SOURCE_STEP_MISSING', '找不到需要重新生成的执行步骤');
      if (sourceStep.status !== 'succeeded' && sourceStep.status !== 'cancelled') {
        throw new WorkflowResultError(409, 'WORKFLOW_SOURCE_STEP_INCOMPLETE', '这张结果卡没有可复用的成功执行记录');
      }
      const sourceNode = requireNode(config, sourceStep.stepId);
      if (sourceNode.kind !== 'agent') throw new WorkflowResultError(409, 'WORKFLOW_SOURCE_NOT_AGENT', '当前结果不是由执行节点生成的');
      const latestSourceStep = latestStepRun(snapshot.steps, sourceStep.stepId);
      if (latestSourceStep && ['pending', 'running', 'waiting'].includes(latestSourceStep.status)) {
        return {
          ok: true,
          state: 'accepted',
          message: '新结果正在生成，完成后会新增一张卡片；当前卡片不会改变。',
        };
      }
      // The review boundary can still be awaiting input after a regenerated
      // Agent attempt failed. In that state requeueStep would inspect the
      // failed latest attempt and reject the request. Reopen the serial branch
      // instead; the source artifact above proves that a successful historical
      // attempt exists and authorises this replay.
      const availableItemIds = new Set((context.artifact.items ?? []).map(item => item.id));
      const selectedItemIds = [...new Set(context.request.selectedIds ?? [])]
        .filter(itemId => availableItemIds.has(itemId));
      const sourceItems = selectedItemIds.length > 0
        ? (context.artifact.items ?? []).filter(item => selectedItemIds.includes(item.id))
        : context.artifact.items ?? [];
      const lineageInput: JsonValue = {
        ...(isRecord(sourceStep.input) ? sourceStep.input : {}),
        __interactionKey: this.interactionKey(context),
        [RESULT_LINEAGE_INPUT_KEY]: {
          parentResultId: context.artifact.id,
          ...(selectedItemIds.length > 0 ? { parentItemIds: selectedItemIds } : {}),
          ...(selectedItemIds.length > 0 ? { expectedItemCount: selectedItemIds.length } : {}),
        },
      };
      const feedback = context.request.feedback?.trim();
      const prompt = [
        stepAgentPrompt(snapshot, config, sourceNode, sourceStep, selectedItemIds.length > 0 ? selectedItemIds.length : undefined),
        '请重新生成当前步骤的结果，不要继续后续节点。',
        selectedItemIds.length > 0
          ? `本次只重生成用户所选的 ${selectedItemIds.length} 条历史结果，保持相同输出结构，不要补生成未选条目：${JSON.stringify(sourceItems).slice(0, 20_000)}`
          : `本次重生成基于用户点击的整张历史结果卡：${JSON.stringify(sourceItems).slice(0, 20_000)}`,
        ...(feedback ? [`用户的调整意见：${feedback}`] : []),
      ].join('\n\n');
      const queued = this.db.transaction(() => {
        const durableInput = { ...(isRecord(lineageInput) ? lineageInput : {}), __executionPrompt: prompt };
        const attempt = step && latestSourceStep?.status === 'succeeded'
          ? this.runtime.requeueStep(snapshot.run.id, sourceStep.stepId, undefined, durableInput, sourceStep.id)
          : this.runtime.requeueFromStep(snapshot.run.id, sourceStep.stepId, undefined, durableInput, sourceStep.id)
              .find(item => item.stepId === sourceStep.stepId)!;
        this.runtime.claim(snapshot.run.id, attempt.id);
        return attempt;
      })();
      const next: Extract<Next, { kind: 'agent' }> = {
        kind: 'agent', stepRunId: queued.id, node: sourceNode, prompt,
      };
      return {
        ok: true,
        state: 'accepted',
        message: '已提交新一轮生成，结果会作为新卡片追加；当前卡片不会改变。',
        agentPrompt: prompt,
        visiblePrompt: feedback
          ? `${selectedItemIds.length > 0 ? '基于所选结果重新生成' : '全部重新生成'}：${feedback}`
          : selectedItemIds.length > 0 ? '基于所选结果重新生成' : '全部重新生成',
        runMetadata: {
          genericWorkflow: {
            runId: snapshot.run.id,
            workflowId: snapshot.definition.id,
            next,
          } as unknown as JsonValue,
        },
      };
    }
    const reviewNode = requireNode(config, resultNodeId);
    if (reviewNode.kind !== 'review') {
      throw new WorkflowResultError(400, 'WORKFLOW_RESULT_ACTION_UNAVAILABLE', '该结果卡不需要确认，可直接查看或重新生成');
    }
    const artifactKind = normalizedArtifactKind(reviewNode.reviewConfig?.artifactKind);
    if (artifactKind === 'video') {
      throw new WorkflowResultError(400, 'WORKFLOW_ARTIFACT_VIDEO_UNAVAILABLE', '视频产物节点尚未开放');
    }
    const isTerminalDocumentResult = context.artifact.renderer === 'document'
      && !(config.edges ?? []).some(edge => edge.source === reviewNode.id);
    // Older runs persisted the final Markdown review with
    // materializeOnConfirm=false.  It is still the terminal deliverable, not
    // an intermediate process result, so confirming it must create the real
    // editable canvas document. Intermediate structured results keep honoring
    // their explicit false value.
    const materializeOnConfirm = reviewNode.reviewConfig?.mode !== 'continue'
      && (isTerminalDocumentResult || reviewNode.reviewConfig?.materializeOnConfirm !== false);
    if (materializeOnConfirm && !this.artifactWriter) {
      throw new WorkflowResultError(503, 'WORKFLOW_ARTIFACT_WRITER_UNAVAILABLE', '画布产物能力不可用');
    }
    if (!step) {
      const replayed = this.runtime.requeueFromStep(snapshot.run.id, resultNodeId);
      const pendingReview = replayed.find(item => item.stepId === resultNodeId);
      if (!pendingReview) throw new WorkflowResultError(409, 'WORKFLOW_REVIEW_REPLAY_FAILED', '无法从该历史结果继续');
      this.runtime.awaitInput(snapshot.run.id, pendingReview.id);
      step = this.runtime.get(snapshot.run.id).steps.find(item => item.id === pendingReview.id);
    }
    if (!step) throw new WorkflowResultError(409, 'WORKFLOW_REVIEW_NOT_ACTIVE', '无法恢复该结果的确认步骤');
    const availableItemIds = new Set((context.artifact.items ?? []).map(item => item.id));
    const selectedIds = [...new Set(context.request.selectedIds ?? [])]
      .filter(itemId => availableItemIds.has(itemId));
    const selectedItems = selectedIds.length > 0
      ? (context.artifact.items ?? []).filter(item => selectedIds.includes(item.id)).map(item => item.data ?? item.title)
      : [];
    const sourceStep = snapshot.steps.find(item => item.id === context.artifact.sourceStepRunId);
    const artifactValue: JsonValue = selectedItems.length === 1
      ? selectedItems[0]!
      : selectedItems.length > 1
        ? selectedItems as JsonValue
        : context.artifact.items?.length === 1
          ? context.artifact.items[0]!.data ?? context.artifact.items[0]!.title
          : sourceStep?.output ?? context.artifact.value ?? null;
    const canvasArtifact = materializeOnConfirm
      ? await this.artifactWriter!.materialize({
          projectId: snapshot.run.projectId,
          workflowRunId: snapshot.run.id,
          stepRunId: step.id,
          nodeId: reviewNode.id,
          ...(sourceStep ? { sourceAgentStepRunId: sourceStep.id } : {}),
          sourceResultId: context.artifact.id,
          ...(selectedIds.length > 0 ? { sourceItemIds: selectedIds } : {}),
          kind: artifactKind,
          title: reviewNode.title || artifactKindLabel(artifactKind),
          content: artifactContent({ result: artifactValue }),
        })
      : undefined;
    if (sourceStep) this.runtime.bindReviewSource(snapshot.run.id, step.id, sourceStep.id);
    this.runtime.complete(snapshot.run.id, step.id, {
      output: {
        selectedIds,
        __interactionKey: this.interactionKey(context),
        selectedItems,
        result: artifactValue,
        feedback: context.request.feedback ?? '',
        [RESULT_LINEAGE_INPUT_KEY]: {
          parentResultId: context.artifact.id,
          ...(selectedIds.length > 0 ? { parentItemIds: selectedIds } : {}),
        },
        artifactKind,
        ...(canvasArtifact ? { canvasNodeId: canvasArtifact.canvasNodeId } : {}),
        ...(canvasArtifact?.revision === undefined ? {} : { canvasRevision: canvasArtifact.revision }),
      },
      ...(canvasArtifact ? { artifactRefs: [`canvas-node:${canvasArtifact.canvasNodeId}`] } : {}),
    });
    let next = this.next(snapshot.run.id);
    if (next.kind === 'delivery') {
      next = (await this.completeAutomaticDelivery(snapshot.run.id, next)).next;
    }
    return {
      ok: true,
      state: next.kind === 'completed' ? 'completed' : 'accepted',
      message: next.kind === 'agent' ? '确认完成，已进入下一位 Agent。' : next.kind === 'completed' ? '工作流已交付。' : '确认完成，正在推进下一步。',
      ...(next.kind === 'agent' ? { agentPrompt: next.prompt, visiblePrompt: '继续工作流' } : {}),
      ...(next.kind !== 'completed' ? {
        runMetadata: {
          genericWorkflow: {
            runId: snapshot.run.id,
            workflowId: snapshot.definition.id,
            next,
          } as unknown as JsonValue,
        },
      } : {}),
    };
  }

  private configFor(snapshot: WorkflowRunSnapshot): WorkflowGraphConfig {
    // Runs execute their persisted definition snapshot, never the current
    // editable canvas. That is what makes an in-flight run reproducible after
    // a user changes or deletes the draft it was launched from.
    return {
      id: snapshot.definition.id,
      version: 2,
      title: snapshot.definition.title,
      updatedAt: snapshot.definition.version,
      nodes: [
        { id: 'start', kind: 'start', title: '开始', description: '' },
        ...snapshot.definition.steps.map(step => {
          const node = step.metadata?.node;
          if (!isNode(node)) throw new Error(`Workflow run has invalid node snapshot: ${step.id}`);
          return node;
        }),
      ],
      edges: snapshot.definition.steps.flatMap(step => step.dependsOn.map(source => ({
        id: `${source}-${step.id}`, source, target: step.id,
      }))),
    };
  }

  private usesCurrentDefinition(snapshot: WorkflowRunSnapshot): boolean {
    const current = this.getConfig(snapshot.definition.id);
    return Boolean(current && compileGraph(current).digest === snapshot.definition.digest);
  }
}

function nextFor(snapshot: WorkflowRunSnapshot, config: WorkflowGraphConfig, step: WorkflowRunSnapshot['steps'][number], results: WorkflowResultService): Next {
  const node = requireNode(config, step.stepId);
  if (node.kind === 'clarify') {
    return {
      kind: 'clarify',
      stepRunId: step.id,
      node,
      prompt: clarificationGenerationPrompt(snapshot, node, step.id),
    };
  }
  if (node.kind === 'review') {
    const latest = results.list({
      projectId: snapshot.run.projectId,
      workflowRunId: snapshot.run.id,
    }).filter(artifact => artifact.resultDefinitionId === node.id).at(-1);
    return {
      kind: 'review',
      stepRunId: step.id,
      node,
      resultId: latest?.id ?? `${snapshot.run.id}:${node.id}`,
    };
  }
  if (node.kind === 'branch') return { kind: 'branch', stepRunId: step.id, node, prompt: branchDecisionPrompt(snapshot, node, step.id) };
  if (node.kind === 'delivery') return { kind: 'delivery', stepRunId: step.id, node };
  throw new Error(`Unexpected waiting node: ${node.kind}`);
}

function compileGraph(config: WorkflowGraphConfig): WorkflowDefinition {
  const nodes = topologicallyOrderedNodes(config);
  const completionStepId = (nodeId: string) => {
    const node = nodes.find(item => item.id === nodeId);
    return node?.kind === 'agent' && node.agentConfig?.confirmation ? `${node.id}-confirmation` : nodeId;
  };
  const steps = nodes.flatMap(node => {
    const dependsOn = parentsOf(config, node.id)
      .filter(parent => parent.kind !== 'start')
      .map(parent => completionStepId(parent.id));
    const base = {
      id: node.id, title: node.title, kind: (node.kind === 'agent' ? 'agent' : 'action') as 'agent' | 'action',
      dependsOn,
      instruction: node.description,
      ...(node.kind === 'agent' ? {} : { actionId: `workflow.${node.kind}` }),
      outputSchemaRef: node.kind === 'agent' && node.agentConfig?.outputContract?.format === 'markdown' ? 'markdown' : 'json',
      failurePolicy: { kind: 'stop' as const },
      ...(node.kind === 'branch' ? { routes: (config.edges ?? []).filter(edge => edge.source === node.id).map(edge => ({
        id: edge.sourceHandle || edge.id,
        to: edge.target,
        // The generic graph selects this route explicitly after the Agent
        // returns routeId; this marker keeps the definition free of multiple
        // implicit defaults without turning natural language into code.
        when: '${branchDecision}',
      })) } : {}),
      metadata: { inputReferences: (node.inputReferences ?? []).map(completionStepId), dataflowVersion: 1, nodeKind: node.kind, node: node as unknown as JsonValue } as Record<string, JsonValue>,
    };
    if (node.kind !== 'agent' || !node.agentConfig?.confirmation) return [base];
    const reviewNode: WorkflowGraphNode = {
      id: `${node.id}-confirmation`, kind: 'review', title: node.agentConfig.confirmation.title?.trim() || `${node.title || 'Agent'}结果确认`, description: '确认 Agent 产出后继续流程。',
      resultSurfaces: node.resultSurfaces?.length ? node.resultSurfaces : ['chat', 'canvas'],
      reviewConfig: { ...node.agentConfig.confirmation, ...(directArtifactTargets(config, node.id).length ? { materializeOnConfirm: false } : {}) },
    };
    return [base, {
      id: reviewNode.id, title: reviewNode.title, kind: 'action' as const, dependsOn: [node.id], instruction: reviewNode.description,
      actionId: 'workflow.review', outputSchemaRef: 'json', failurePolicy: { kind: 'stop' as const },
      metadata: { dataflowVersion: 1, nodeKind: 'review', node: reviewNode as unknown as JsonValue } as Record<string, JsonValue>,
    }];
  });
  const digest = createHash('sha256')
    .update(`generic-workflow-graph-compiler-v${GENERIC_WORKFLOW_GRAPH_COMPILER_ABI}\0`)
    .update(JSON.stringify(config))
    .digest('hex');
  return {
    schemaVersion: 1, id: config.id, aliases: [], version: config.updatedAt, digest,
    ...(config.canvasPresentation === 'run-group' ? { canvasPresentation: 'run-group' as const } : {}),
    title: config.title, description: 'Canvas-authored generic workflow', inputs: [],
    steps,
    results: [], exits: [{ id: 'complete', kind: 'terminal', when: '${completed}', action: 'complete' }],
    // Historical result cards may open a fresh serial branch many times. Keep
    // a generous safety ceiling without turning the UI into a one-shot flow.
    limits: { maxStepRuns: Math.max(nodes.length * 100, 500) },
  };
}

/**
 * Runtime route direction is derived from definition order. Canvas nodes are
 * persisted in creation order, which is unrelated to execution order, so a
 * valid forward branch must be compiled in graph order instead.
 */
function topologicallyOrderedNodes(config: WorkflowGraphConfig): WorkflowGraphNode[] {
  const nodes = config.nodes!.filter(node => node.kind !== 'start');
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const originalIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]));
  for (const edge of config.edges ?? []) {
    if (!nodeById.has(edge.target) || !nodeById.has(edge.source)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const ready = nodes.filter(node => indegree.get(node.id) === 0);
  const ordered: WorkflowGraphNode[] = [];
  const sortReady = () => ready.sort((a, b) => originalIndex.get(a.id)! - originalIndex.get(b.id)!);
  sortReady();
  while (ready.length > 0) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const targetId of outgoing.get(node.id) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        ready.push(nodeById.get(targetId)!);
        sortReady();
      }
    }
  }
  // requireRunnableGraph rejects cycles before compilation. Preserve the
  // saved order only as a defensive fallback for direct internal callers.
  return ordered.length === nodes.length ? ordered : nodes;
}

function requireConfig(value: WorkflowGraphConfig): WorkflowGraphConfig {
  const config = normalizeConfig(value);
  if (!config || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(config.id)) throw new Error('工作流 ID 无效');
  if (!config.nodes?.some(node => node.kind === 'start')) throw new Error('工作流必须有一个开始节点');
  const ids = new Set<string>();
  for (const node of config.nodes) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(node.id) || ids.has(node.id)) throw new Error(`节点 ID 无效或重复：${node.id}；请使用小写字母开头的短横线命名，且每个节点 ID 唯一`);
    ids.add(node.id);
    const contract = node.kind === 'agent' ? node.agentConfig?.outputContract : undefined;
    if (!contract) continue;
    for (const [label, value] of [['最少数量', contract.minItems], ['最多数量', contract.maxItems]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
        throw new Error(`执行卡“${node.title}”的${label}必须是正整数`);
      }
    }
    if (contract.minItems !== undefined && contract.maxItems !== undefined && contract.minItems > contract.maxItems) {
      throw new Error(`执行卡“${node.title}”的最少数量不能大于最多数量`);
    }
  }
  for (const edge of config.edges ?? []) if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error('连线引用了不存在的节点');
  for (const node of config.nodes.filter(item => item.kind === 'branch')) {
    const routeIds = (node.branchConfig?.routes ?? []).map(route => route.id);
    if (routeIds.length > 0 && new Set(routeIds).size !== routeIds.length) throw new Error(`判断卡“${node.title}”存在重复分支 ID`);
    for (const edge of (config.edges ?? []).filter(item => item.source === node.id && item.sourceHandle)) {
      if (routeIds.length > 0 && !routeIds.includes(edge.sourceHandle!)) throw new Error(`判断卡“${node.title}”的连线引用了不存在的分支`);
    }
  }
  return config;
}

function requireRunnableGraph(config: WorkflowGraphConfig): void {
  for (const node of config.nodes ?? []) {
    const ancestors = new Set<string>();
    const visit = (id: string) => { for (const edge of config.edges ?? []) if (edge.target === id && !ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); } };
    visit(node.id); ancestors.delete(node.id);
    if (node.inputReferences !== undefined && (!Array.isArray(node.inputReferences) || node.inputReferences.some(id => typeof id !== 'string' || !ancestors.has(id) || config.nodes?.find(item => item.id === id)?.kind === 'start'))) {
      throw new Error('额外输入只能引用当前节点之前的上游卡片');
    }
  }

  const nodes = config.nodes ?? [];
  const edges = config.edges ?? [];
  const startNodes = nodes.filter(node => node.kind === 'start');
  if (startNodes.length !== 1) {
    throw new WorkflowResultError(400, 'WORKFLOW_START_INVALID', '工作流必须且只能有一个开始节点');
  }
  const startId = startNodes[0]!.id;
  if (edges.some(edge => edge.target === startId)) {
    throw new WorkflowResultError(400, 'WORKFLOW_START_HAS_INPUT', '开始节点不能有输入连线');
  }
  if (!edges.some(edge => edge.source === startId)) {
    throw new WorkflowResultError(400, 'WORKFLOW_START_DISCONNECTED', '开始节点至少需要连接一个后续节点');
  }
  if (edges.some(edge => edge.source === edge.target)) {
    throw new WorkflowResultError(400, 'WORKFLOW_SELF_LOOP', '工作流节点不能连接自己');
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      throw new WorkflowResultError(400, 'WORKFLOW_CYCLE_UNSUPPORTED', '当前不支持普通节点回环，请删除循环连线');
    }
    if (visited.has(id)) return;
    visiting.add(id);
    reachable.add(id);
    for (const target of outgoing.get(id) ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  visit(startId);
  const unreachable = nodes.filter(node => !reachable.has(node.id));
  if (unreachable.length > 0) {
    throw new WorkflowResultError(
      400,
      'WORKFLOW_NODE_UNREACHABLE',
      `以下节点没有从“开始”接入流程：${unreachable.map(node => node.title || node.id).join('、')}`,
    );
  }
  const unavailableVideo = nodes.find(node => (
    (node.kind === 'review' && normalizedArtifactKind(node.reviewConfig?.artifactKind) === 'video')
    || (node.kind === 'agent' && node.agentConfig?.confirmation
      && normalizedArtifactKind(node.agentConfig.confirmation.artifactKind) === 'video')
  ));
  if (unavailableVideo) {
    throw new WorkflowResultError(400, 'WORKFLOW_ARTIFACT_VIDEO_UNAVAILABLE', '视频产物节点尚未开放');
  }

  for (const node of nodes.filter(item => item.kind === 'delivery')) {
    const sources = edges.filter(edge => edge.target === node.id).map(edge => edge.source);
    const hasProducer = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const source = nodes.find(item => item.id === id);
      if (source?.kind === 'agent' || source?.kind === 'delivery') return true;
      return edges.filter(edge => edge.target === id).some(edge => hasProducer(edge.source, new Set(seen)));
    };
    if (sources.length === 0 || sources.includes(startId) || !hasProducer(node.id)) {
      throw new WorkflowResultError(
        400,
        'WORKFLOW_DELIVERY_SOURCE_MISSING',
        `产物卡“${node.title}”必须连接一个会产生内容的上游节点`,
      );
    }
  }

  for (const node of config.nodes?.filter(item => item.kind === 'branch') ?? []) {
    const edges = (config.edges ?? []).filter(edge => edge.source === node.id);
    const routeIds = edges.map(edge => edge.sourceHandle || edge.id);
    if (routeIds.length < 2) {
      throw new WorkflowResultError(400, 'WORKFLOW_BRANCH_INCOMPLETE', `判断卡“${node.title}”至少需要连接两条分支路线`);
    }
    if (new Set(routeIds).size !== routeIds.length) {
      throw new WorkflowResultError(400, 'WORKFLOW_BRANCH_DUPLICATE', `判断卡“${node.title}”的一条分支只能连接一个下游节点`);
    }
    const configuredRoutes = new Map((node.branchConfig?.routes ?? []).map(route => [route.id, route]));
    for (const routeId of routeIds) {
      const route = configuredRoutes.get(routeId);
      if (route && !route.condition?.trim()) {
        throw new WorkflowResultError(400, 'WORKFLOW_BRANCH_CONDITION_EMPTY', `判断卡“${node.title}”存在未填写的判断条件`);
      }
    }
    const fallback = node.branchConfig?.defaultRouteId;
    if (fallback && !routeIds.includes(fallback)) {
      throw new WorkflowResultError(400, 'WORKFLOW_BRANCH_FALLBACK_MISSING', `判断卡“${node.title}”的兜底分支尚未连接`);
    }
  }
}

function normalizeConfig(value: unknown): WorkflowGraphConfig | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  const nodes = Array.isArray(value.nodes) ? value.nodes.filter(isNode) as unknown as WorkflowGraphNode[] : [];
  const edges = Array.isArray(value.edges) ? value.edges.filter(isEdge) : [];
  const normalizedNodes = nodes.map(node => {
    if (node.kind !== 'agent' || !node.agentConfig?.confirmation) return node;
    const { confirmation, ...agentConfig } = node.agentConfig;
    const checkpoint = confirmation.mode === 'continue'
      ? normalizeWorkflowExecutionConfirmation(confirmation)
      : confirmation;
    return { ...node, agentConfig: { ...agentConfig, confirmation: { ...checkpoint, title: confirmation.title?.trim() || `${node.title || '执行'}确认` } } };
  });

  return {
    id: value.id,
    ...(value.canvasPresentation === 'run-group' ? { canvasPresentation: 'run-group' as const } : {}),
    version: value.version === 1 ? 1 : 2,
    title: value.title,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    ...(typeof value.nextCardNumber === 'number' ? { nextCardNumber: value.nextCardNumber } : {}),
    nodes: normalizedNodes,
    edges,
  };
}
function workflowMetadata(start: WorkflowGraphNode['startConfig'], fallbackName: string) {
  const fallback = {
    name: start?.workflowName?.trim() || fallbackName,
    description: start?.description?.trim() || '',
    scenarios: (start?.triggerScenarios || []).map(item => item.trim()).filter(Boolean),
    body: '',
  };
  const markdown = start?.workflowMarkdown;
  const match = typeof markdown === 'string' ? markdown.match(/^---\s*\n([\s\S]*?)\n---\s*([\s\S]*)$/u) : null;
  if (!match) return fallback;
  const lines = (match[1] ?? '').split('\n');
  const scalar = (key: string) => {
    const line = lines.find(item => new RegExp(`^${key}:\\s*`, 'u').test(item));
    return line === undefined ? undefined : line.replace(new RegExp(`^${key}:\\s*`, 'u'), '').trim();
  };
  const scenariosAt = lines.findIndex(line => /^scenarios:\s*(?:\[\])?$/u.test(line));
  const scenarios: string[] = [];
  if (scenariosAt >= 0) for (const line of lines.slice(scenariosAt + 1)) {
    if (!/^\s+-\s+/u.test(line)) break;
    const scenario = line.replace(/^\s+-\s+/u, '').trim();
    if (scenario) scenarios.push(scenario);
  }
  return {
    name: scalar('name') || fallback.name,
    description: scalar('description') ?? fallback.description,
    scenarios: scenariosAt >= 0 ? scenarios : fallback.scenarios,
    body: match[2]?.trim().slice(0, 2_000) || '',
  };
}
function indentMarkdown(value: string): string { return value.split('\n').map(line => `    ${line}`).join('\n'); }
function isNode(value: unknown): value is WorkflowGraphNode { return isRecord(value) && typeof value.id === 'string' && typeof value.kind === 'string' && ['start','clarify','agent','review','branch','delivery'].includes(value.kind) && typeof value.title === 'string' && typeof value.description === 'string'; }
function isEdge(value: unknown): value is { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null } { return isRecord(value) && typeof value.id === 'string' && typeof value.source === 'string' && typeof value.target === 'string'; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function resultLineage(value: JsonValue): { parentResultId: string; parentItemIds?: string[]; expectedItemCount?: number } | null {
  if (!isRecord(value)) return null;
  const raw = value[RESULT_LINEAGE_INPUT_KEY];
  if (!isRecord(raw) || typeof raw.parentResultId !== 'string' || !raw.parentResultId.trim()) return null;
  const parentItemIds = Array.isArray(raw.parentItemIds)
    ? [...new Set(raw.parentItemIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))]
    : [];
  const expectedItemCount = typeof raw.expectedItemCount === 'number'
    && Number.isInteger(raw.expectedItemCount)
    && raw.expectedItemCount > 0
    ? raw.expectedItemCount
    : undefined;
  return {
    parentResultId: raw.parentResultId,
    ...(parentItemIds.length > 0 ? { parentItemIds } : {}),
    ...(expectedItemCount === undefined ? {} : { expectedItemCount }),
  };
}
function nearestResultLineage(
  snapshot: WorkflowRunSnapshot,
  config: WorkflowGraphConfig,
  nodeId: string,
): { parentResultId: string; parentItemIds?: string[] } | null {
  const visited = new Set<string>([nodeId]);
  let frontier = parentsOf(config, nodeId).map(node => node.id);
  while (frontier.length > 0) {
    const layer = [...new Set(frontier)].filter(id => !visited.has(id));
    if (layer.length === 0) return null;
    layer.forEach(id => visited.add(id));
    const candidates = snapshot.steps
      .filter(step => layer.includes(step.stepId) && step.status === 'succeeded' && step.output !== undefined)
      .sort((left, right) => right.sequence - left.sequence || right.iteration - left.iteration || right.attempt - left.attempt);
    for (const candidate of candidates) {
      const lineage = resultLineage(candidate.output!);
      if (lineage) return lineage;
    }
    frontier = layer.flatMap(id => parentsOf(config, id).map(node => node.id));
  }
  return null;
}
function requireNode(config: WorkflowGraphConfig, id: string): WorkflowGraphNode { const node = config.nodes!.find(item => item.id === id); if (!node) throw new Error(`Workflow node not found: ${id}`); return node; }
function requireStep(snapshot: WorkflowRunSnapshot, stepRunId: string, kind: NodeKind) { const step = snapshot.steps.find(item => item.id === stepRunId); if (!step || requireNodeFromDefinition(snapshot, step.stepId).kind !== kind) throw new Error('Workflow step does not match request'); return step; }
function requireNodeFromDefinition(snapshot: WorkflowRunSnapshot, id: string) { const step = snapshot.definition.steps.find(item => item.id === id); if (!step) throw new Error('Workflow definition step missing'); return { kind: String(step.metadata?.nodeKind) as NodeKind }; }
function awaitingDeliveryStep(snapshot: WorkflowRunSnapshot): boolean {
  const active = snapshot.steps.find(step => step.status === 'awaiting-input');
  return Boolean(active && requireNodeFromDefinition(snapshot, active.stepId).kind === 'delivery');
}
function requireNodeFromStepSnapshot(snapshot: WorkflowRunSnapshot, id: string): WorkflowGraphNode {
  const step = snapshot.definition.steps.find(item => item.id === id);
  const node = step?.metadata?.node;
  if (!isNode(node)) throw new Error(`Workflow run has invalid node snapshot: ${id}`);
  return node;
}
function parentsOf(config: WorkflowGraphConfig, id: string) { const ids = (config.edges ?? []).filter(edge => edge.target === id).map(edge => edge.source); return config.nodes!.filter(node => ids.includes(node.id)); }
function workflowResultId(runId: string, reviewNodeId: string, sourceStepRunId: string): string {
  return `${runId}:${reviewNodeId}:${sourceStepRunId}`;
}
function latestStepRun(
  steps: WorkflowRunSnapshot['steps'],
  stepId: string,
  status?: WorkflowRunSnapshot['steps'][number]['status'],
) {
  return steps
    .filter(step => step.stepId === stepId && (!status || step.status === status))
    .sort((left, right) => right.iteration - left.iteration || right.attempt - left.attempt)[0];
}
function upstreamAgentOf(config: WorkflowGraphConfig, nodeId: string): WorkflowGraphNode | undefined {
  const visited = new Set<string>();
  const pending = [...parentsOf(config, nodeId)];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.kind === 'agent') return node;
    pending.push(...parentsOf(config, node.id));
  }
  return undefined;
}
function normalizedArtifactKind(
  kind: NonNullable<WorkflowGraphNode['deliveryConfig']>['artifactKind'],
): WorkflowArtifactKind {
  if (kind === 'page' || kind === 'canvas') return 'page';
  if (kind === 'image') return 'image';
  if (kind === 'video' || kind === 'presentation') return kind;
  return 'text';
}
function artifactKindLabel(kind: WorkflowArtifactKind): string {
  if (kind === 'page') return '网页';
  if (kind === 'presentation') return 'PPT';
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  return '文本';
}
function directArtifactTargets(config: WorkflowGraphConfig, sourceId: string): WorkflowArtifactTarget[] {
  const visited = new Set<string>();
  const collect = (id: string): WorkflowArtifactTarget[] => {
    if (visited.has(id)) return [];
    visited.add(id);
    return (config.edges ?? []).filter(edge => edge.source === id).flatMap(edge => {
      const node = config.nodes?.find(item => item.id === edge.target);
      // Historical standalone confirmation nodes forward the same accepted output.
      if (node && ['review', 'branch', 'clarify'].includes(node.kind)) return collect(node.id);
      if (node?.kind !== 'delivery') return [];
      return [{ ...node.deliveryConfig, nodeId: node.id, title: node.title, kind: normalizedArtifactKind(node.deliveryConfig?.artifactKind) }];
    });
  };
  return collect(sourceId);
}

/**
 * A single direct delivery can reserve its eventual canvas slot while its
 * source Agent runs. Multiple deliveries intentionally opt out: one loading
 * card must never pretend to represent several independent outputs.
 */
function directDeliveryTarget(config: WorkflowGraphConfig, sourceId: string): DeliveryTarget | undefined {
  const targets = (config.edges ?? [])
    .filter(edge => edge.source === sourceId)
    .map(edge => config.nodes?.find(node => node.id === edge.target))
    .filter((node): node is WorkflowGraphNode => node?.kind === 'delivery')
    .flatMap(node => {
      const kind = normalizedArtifactKind(node.deliveryConfig?.artifactKind);
      return kind === 'video' ? [] : [{
        nodeId: node.id,
        title: node.deliveryConfig?.artifactName?.trim() || node.title || artifactKindLabel(kind),
        kind,
      }];
    });
  return targets.length === 1 ? targets[0] : undefined;
}
function directParentOutputs(
  snapshot: WorkflowRunSnapshot,
  config: WorkflowGraphConfig,
  nodeId: string,
): Record<string, JsonValue> {
  const parentIds = new Set(parentsOf(config, nodeId).filter(node => node.kind !== 'start').map(node => node.id));
  const latest = new Map<string, WorkflowRunSnapshot['steps'][number]>();
  for (const step of snapshot.steps) {
    if (!parentIds.has(step.stepId) || step.status !== 'succeeded' || step.output === undefined) continue;
    const current = latest.get(step.stepId);
    if (!current || step.iteration > current.iteration || (step.iteration === current.iteration && step.attempt > current.attempt)) {
      latest.set(step.stepId, step);
    }
  }
  return Object.fromEntries(Array.from(latest, ([id, step]) => [id, step.output!])) as Record<string, JsonValue>;
}
/** Names come from the configured target or its own receipt, never another output. */
function deliveryArtifactTitle(node: WorkflowGraphNode, upstream: Record<string, JsonValue>): string {
  if (node.deliveryConfig?.artifactName?.trim()) return node.deliveryConfig.artifactName.trim();
  // Missing means a legacy graph where the node title was the artifact name.
  if (node.deliveryConfig?.artifactName === undefined && node.title) return node.title;
  const content = artifactContent(upstream);
  for (const match of content.matchAll(/<workflow-artifacts>([\s\S]*?)<\/workflow-artifacts>/gu)) {
    try {
      const receipt: unknown = JSON.parse(match[1]!);
      if (!isRecord(receipt) || !Array.isArray(receipt.artifacts)) continue;
      const entry = receipt.artifacts.find(item => isRecord(item) && item.nodeId === node.id && item.kind === normalizedArtifactKind(node.deliveryConfig?.artifactKind));
      if (isRecord(entry) && typeof entry.title === 'string' && entry.title.trim()) return entry.title.trim().slice(0, 200);
    } catch { /* File validation reports malformed receipts during materialization. */ }
  }
  if (normalizedArtifactKind(node.deliveryConfig?.artifactKind) === 'text') {
    const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim();
    if (heading) return heading.slice(0, 200);
  }
  return node.title || artifactKindLabel(normalizedArtifactKind(node.deliveryConfig?.artifactKind));
}
/** A delivery can forward its completed artifact, but cannot convert formats. */
function deliveryContent(inputs: Record<string, JsonValue>, target: WorkflowGraphNode): string {
  const source = Object.values(inputs)[0];
  if (isRecord(source) && source.delivered === true) {
    const kind = normalizedArtifactKind(target.deliveryConfig?.artifactKind);
    if (source.artifactKind !== kind) throw new Error('产物类型不同，请先连接执行卡完成转换');
    if (Array.isArray(source.files) && source.files.length) {
      return `<workflow-artifacts>${JSON.stringify({ artifacts: source.files.map(file => ({ ...(isRecord(file) ? file : {}), kind, nodeId: target.id })) })}</workflow-artifacts>`;
    }
  }
  return artifactContent(inputs);
}

function artifactContent(inputs: Record<string, JsonValue>): string {
  const values = Object.values(inputs);
  const value: JsonValue = values.length === 1 ? values[0]! : inputs;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (isRecord(item)) {
        return [item.title, item.summary, item.content].filter(part => typeof part === 'string' && part.trim()).join('\n');
      }
      return JSON.stringify(item);
    }).filter(Boolean).join('\n\n');
  }
  if (isRecord(value)) {
    if (value.result !== undefined) return artifactContent({ result: value.result });
    for (const key of ['content', 'text', 'html', 'summary', 'prompt']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key];
    }
    const items = value.items;
    if (Array.isArray(items) && items.length > 0) {
      return items.map(item => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) {
          return [item.title, item.summary, item.content].filter(part => typeof part === 'string' && part.trim()).join('\n');
        }
        return JSON.stringify(item);
      }).filter(Boolean).join('\n\n');
    }
  }
  return JSON.stringify(value, null, 2);
}
function outputItems(output: JsonValue) {
  const values = isRecord(output) && Array.isArray(output.items) ? output.items : output;
  if (Array.isArray(values)) return values.map((item, index) => ({
    id: String(index + 1),
    title: titleOf(item, index),
    ...summaryOf(item),
    data: item,
  }));
  return [{ id: 'result', title: titleOf(values, 0), ...summaryOf(values), data: values }];
}
function titleOf(value: JsonValue, index: number) { return isRecord(value) && typeof value.title === 'string' ? value.title : `结果 ${index + 1}`; }

/**
 * A result candidate is always presented as a readable title plus its actual
 * content. Older agents may call that field summary/description/body, while
 * the workflow output contract standardises on content. Keep the fallback at
 * the runtime boundary so both the chat card and canvas projection receive the
 * same two-line record.
 */
function summaryOf(value: JsonValue): { summary?: string } {
  if (!isRecord(value)) return {};
  for (const key of ['summary', 'content', 'description', 'body']) {
    const text = value[key];
    if (typeof text === 'string' && text.trim()) return { summary: text.trim() };
  }
  return {};
}
function stepAgentPrompt(snapshot: WorkflowRunSnapshot, config: WorkflowGraphConfig, node: WorkflowGraphNode, step: WorkflowStepRun, count?: number): string {
  const input = step.inputSnapshot;
  return agentPrompt(node,
    input ? snapshotVariables(snapshot, input) : snapshot.run.variables,
    input ? snapshotContent(snapshot, input) : directParentOutputs(snapshot, config, node.id),
    directArtifactTargets(config, node.id), count);
}

function agentPrompt(
  node: WorkflowGraphNode,
  variables: Record<string, JsonValue>,
  directInputs: Record<string, JsonValue>,
  artifactTargets: WorkflowArtifactTarget[],
  expectedItemCount?: number,
) {
  // Keep the durable history intact. Only remove duplicate bodies from the
  // outbound prompt; upstream data and earlier user decisions remain available.
  const promptVariables = { ...variables };
  if (isRecord(variables.workflowContext)) {
    const context = { ...variables.workflowContext };
    if (isRecord(context.nodeOutputs)) {
      const outputs = { ...context.nodeOutputs };
      if (typeof context.latestNodeId === 'string'
        && isDeepStrictEqual(context.latestOutput, outputs[context.latestNodeId])) delete context.latestOutput;
      for (const [id, output] of Object.entries(directInputs)) {
        if (isDeepStrictEqual(outputs[id], output)) delete outputs[id];
      }
      context.nodeOutputs = outputs;
    }
    promptVariables.workflowContext = context;
  }
  const config = node.agentConfig ?? {};
  const confirmation = config.confirmation;
  const outputContract = config.outputContract;
  // Older saved contracts predate the explicit format field and were JSON contracts.
  const outputFormat = outputContract
    ? outputContract.format ?? 'json'
    : confirmation ? 'json' : undefined;
  const itemCount = expectedItemCount !== undefined
    ? `items 必须恰好 ${expectedItemCount} 项。`
    : outputContract
    ? outputContract.minItems === outputContract.maxItems && outputContract.minItems !== undefined
      ? `items 必须恰好 ${outputContract.minItems} 项。`
      : [
          outputContract.minItems === undefined ? '' : `items 至少 ${outputContract.minItems} 项。`,
          outputContract.maxItems === undefined ? '' : `items 最多 ${outputContract.maxItems} 项。`,
        ].filter(Boolean).join(' ')
    : '';
  const requiredFields = outputContract?.requiredFields?.length
    ? `每个 item 必须包含这些字段：${outputContract.requiredFields.join(' / ')}。`
    : '';
  const requiredText = outputContract?.requiredText?.length
    ? `正文必须原样包含：${outputContract.requiredText.join(' / ')}。`
    : '';
  const forbiddenText = outputContract?.forbiddenText?.length
    ? `正文不得包含：${outputContract.forbiddenText.join(' / ')}。`
    : '';
  const outputFormatContract = outputFormat === 'markdown'
    ? [
        '输出格式：Markdown。',
        '直接输出 Markdown 正文，不要包裹 JSON 或 Markdown 代码块。',
        requiredText,
        forbiddenText,
        outputContract?.instructions?.trim() || '',
      ].filter(Boolean).join('\n')
    : outputFormat === 'json'
      ? [
        '输出格式：JSON。',
        confirmation ? '这一步的结果会交给用户确认。' : '',
        '只输出合法 JSON，不要使用 Markdown 代码块或附加解释。',
        `格式：{"items":[{${(outputContract?.requiredFields?.length ? outputContract.requiredFields : ['title', 'summary', 'content'])
          .map(field => `"${field}":""`).join(',')}}]}。`,
        itemCount || (confirmation?.selection === 'multiple'
          ? '生成至少 3 个可独立多选的结果。'
          : confirmation?.selection === 'single'
            ? '生成至少 3 个可供单选的候选结果。'
            : '生成 1 个完整结果。'),
        requiredFields,
        outputContract?.instructions?.trim() || '',
      ].filter(Boolean).join('\n')
      : '';
  return [
    node.description || '完成当前工作流步骤。',
    config.skillIds?.length ? `Skills: ${config.skillIds.join(', ')}` : '',
    config.knowledgeIds?.length ? `Knowledge: ${config.knowledgeIds.join(', ')}` : '',
    outputFormatContract,
    Object.keys(directInputs).length > 0
      ? `Direct upstream inputs: ${JSON.stringify(directInputs)}`
      : '',
    workflowArtifactInstructions(artifactTargets),
    `Workflow variables: ${JSON.stringify(promptVariables)}`,
  ].filter(Boolean).join('\n\n');
}

function validateAgentOutput(node: WorkflowGraphNode, output: JsonValue, expectedItemCount?: number): void {
  const contract = node.agentConfig?.outputContract;
  if (!contract) return;
  if (contract.format === 'markdown') {
    const markdown = typeof output === 'string'
      ? output
      : isRecord(output) && typeof output.content === 'string'
        ? output.content
        : '';
    if (!markdown.trim()) throw new Error('执行结果必须是非空 Markdown 内容');
    const missingText = (contract.requiredText ?? []).filter(text => text.trim() && !markdown.includes(text));
    if (missingText.length > 0) throw new Error(`Markdown 正文缺少必需内容：${missingText.join('、')}`);
    const forbiddenText = (contract.forbiddenText ?? []).filter(text => text.trim() && markdown.includes(text));
    if (forbiddenText.length > 0) throw new Error(`Markdown 正文包含禁用内容：${forbiddenText.join('、')}`);
    return;
  }
  const items = isRecord(output) && Array.isArray(output.items)
    ? output.items
    : Array.isArray(output) ? output : [output];
  if (expectedItemCount !== undefined && items.length !== expectedItemCount) {
    throw new Error(`本次重新生成需要 ${expectedItemCount} 项结果，实际 ${items.length} 项`);
  }
  if (expectedItemCount === undefined && contract.minItems !== undefined && items.length < contract.minItems) {
    throw new Error(`执行结果数量不足：至少需要 ${contract.minItems} 项，实际 ${items.length} 项`);
  }
  if (expectedItemCount === undefined && contract.maxItems !== undefined && items.length > contract.maxItems) {
    throw new Error(`执行结果数量过多：最多允许 ${contract.maxItems} 项，实际 ${items.length} 项`);
  }
  const fields = contract.requiredFields ?? [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) throw new Error(`执行结果第 ${index + 1} 项必须是结构化对象`);
    const missing = fields.filter(field => {
      const value = item[field];
      return value === undefined || value === null || (typeof value === 'string' && !value.trim());
    });
    if (missing.length > 0) throw new Error(`执行结果第 ${index + 1} 项缺少字段：${missing.join('、')}`);
  }
}

function clarificationGenerationPrompt(
  snapshot: WorkflowRunSnapshot,
  node: WorkflowGraphNode,
  stepRunId: string,
): string {
  const autoMode = node.clarificationConfig?.mode === 'auto';
  const autoMaxQuestions = Math.max(1, Math.min(5, Math.round(node.clarificationConfig?.autoConfig?.maxQuestions ?? 3)));
  const configuredAutoTypes = (node.clarificationConfig?.autoConfig?.allowedTypes ?? ['text', 'single', 'multiple'])
    .filter(type => type === 'text' || type === 'single' || type === 'multiple');
  const autoAllowedTypes = configuredAutoTypes.length > 0 ? configuredAutoTypes : ['text'];
  const autoInstruction = node.clarificationConfig?.autoConfig?.instruction?.trim()
    || '只询问完成下一步确实缺失的信息；已经存在于用户任务、项目上下文或上游节点中的内容不要重复问。';
  const configured = node.clarificationConfig?.questions?.length
    ? node.clarificationConfig.questions
    : [{
        id: 'brief',
        titleMode: 'manual' as const,
        title: node.clarificationConfig?.title || node.title || '补充任务信息',
        type: 'text' as const,
        required: false,
        allowOther: false,
      }];
  const rules = configured.map((question, index) => ({
    order: index + 1,
    id: question.id,
    title: question.titleMode === 'manual'
      ? { mode: 'fixed', value: question.title || question.titleDirection || `问题 ${index + 1}` }
      : { mode: 'generate', direction: question.titleDirection || '根据当前任务询问最关键的缺失信息' },
    answerType: question.type,
    ...(question.type === 'text'
      ? {}
      : { optionDirection: question.optionDirection || '根据当前任务生成 3–5 个不重复的可选项' }),
    required: question.required === true,
    allowOther: question.allowOther === true,
  }));
  const formId = `workflow-${snapshot.run.id}-${stepRunId}`;
  const formTitle = node.clarificationConfig?.title || node.title || '补充任务信息';
  const formDescription = node.clarificationConfig?.description?.trim() || '';
  const submitLabel = node.clarificationConfig?.submitLabel?.trim() || '继续';
  if (autoMode) return [
    '你正在执行工作流的“询问”节点。只生成询问卡，不要回答问题，不要继续后续任务。',
    `你可以生成 1～${autoMaxQuestions} 道问题。先阅读共享上下文，只问完成下一步确实缺失的信息；能少问就少问。`,
    `询问边界：${autoInstruction}`,
    `允许的回答类型：${autoAllowedTypes.join('、')}。映射：text → textarea，single → radio，multiple → checkbox。`,
    '每道题自行决定标题、回答类型、是否必填、是否允许“其他”；单选和多选必须生成 2～5 个具体且互斥的 options。',
    '问题 id 使用 auto-1、auto-2……，顺序连续且不得重复。不要询问共享上下文中已有的事实。',
    '只返回下面这种完整标签，不要 Markdown 代码块，不要添加任何其他文字：',
    `<question-form id="${formId}" kind="workflow-intake" workflow="${snapshot.definition.id}" title="${escapeXmlAttribute(formTitle)}">`,
    JSON.stringify({
      lang: 'zh-CN',
      ...(formDescription ? { description: formDescription } : {}),
      submitLabel,
      questions: [{
        id: 'auto-1',
        label: '根据缺失信息生成的问题',
        type: 'textarea|radio|checkbox',
        required: false,
        allowCustom: true,
        options: [],
      }],
    }),
    '</question-form>',
    `当前共享上下文：${JSON.stringify(snapshotPromptContext(snapshot, stepRunId))}`,
  ].join('\n\n');
  return [
    '你正在执行工作流的“询问”节点。只生成询问卡，不要回答问题，不要继续后续任务。',
    '必须严格按配置的数量、顺序和 id 生成问题；fixed 标题必须原样使用。',
    '当前共享上下文里已经明确的事实不得重复询问，也不得把通用项目发现问题替换进来。',
    ...(formDescription ? [`本节点的询问边界（优先级高于通用澄清习惯）：${formDescription}`] : []),
    'answerType 映射：text → textarea，single → radio，multiple → checkbox。',
    '单选和多选必须给出具体 options，每项使用 {"label":"用户可读文案","value":"稳定短 ID","description":"一句说明"}。',
    'allowOther=true 时输出 allowCustom=true、customLabel="其他"、customPlaceholder="填写你的回答"。',
    '只返回下面这种完整标签，不要 Markdown 代码块，不要添加任何其他文字：',
    `<question-form id="${formId}" kind="workflow-intake" workflow="${snapshot.definition.id}" title="${escapeXmlAttribute(formTitle)}">`,
    JSON.stringify({
      lang: 'zh-CN',
      ...(formDescription ? { description: formDescription } : {}),
      submitLabel,
      questions: [{
        id: '配置中的 id',
        label: '问题标题',
        type: 'textarea|radio|checkbox',
        required: true,
        options: [],
      }],
    }),
    '</question-form>',
    `问题配置：${JSON.stringify(rules)}`,
    `当前共享上下文：${JSON.stringify(snapshotPromptContext(snapshot, stepRunId))}`,
  ].join('\n\n');
}

function validateClarificationValues(node: WorkflowGraphNode, values: JsonValue): void {
  if (!isRecord(values)) throw new Error('询问答案必须是结构化对象');
  if (node.clarificationConfig?.mode === 'auto') {
    const maxQuestions = Math.max(1, Math.min(5, Math.round(node.clarificationConfig.autoConfig?.maxQuestions ?? 3)));
    const entries = Object.entries(values);
    if (entries.length > maxQuestions) throw new Error(`询问答案不能超过 ${maxQuestions} 道问题`);
    for (const [id, value] of entries) {
      if (!/^auto-\d+$/u.test(id)) throw new Error(`自动询问答案包含无效问题：${id}`);
      if (typeof value !== 'string' && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
        throw new Error(`自动询问“${id}”的答案类型不正确`);
      }
    }
    return;
  }
  const questions = node.clarificationConfig?.questions ?? [];
  for (const question of questions) {
    const value = values[question.id];
    const present = typeof value === 'string'
      ? value.trim().length > 0
      : Array.isArray(value)
        ? value.some(item => typeof item === 'string' && item.trim().length > 0)
        : false;
    if (question.required && !present) throw new Error(`请完成必填问题：${question.title || question.titleDirection || question.id}`);
    if (value === undefined || value === null || value === '') continue;
    if ((question.type === 'text' || question.type === 'single') && typeof value !== 'string') {
      throw new Error(`问题“${question.title || question.id}”的答案类型不正确`);
    }
    if (question.type === 'multiple' && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
      throw new Error(`问题“${question.title || question.id}”的答案类型不正确`);
    }
  }
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function allowedBranchRouteIds(snapshot: WorkflowRunSnapshot, nodeId: string): string[] {
  const step = snapshot.definition.steps.find(item => item.id === nodeId);
  if (!step) throw new Error(`Workflow branch step missing: ${nodeId}`);
  const ids = (step.routes ?? []).map(route => route.id);
  if (ids.length === 0) throw new Error('判断卡至少需要连接一条分支路线');
  return ids;
}

function branchDecisionPrompt(snapshot: WorkflowRunSnapshot, node: WorkflowGraphNode, stepRunId: string): string {
  const allowed = allowedBranchRouteIds(snapshot, node.id);
  const configured = new Map((node.branchConfig?.routes ?? []).map(route => [route.id, route]));
  const routeLines = allowed.map(routeId => {
    const route = configured.get(routeId);
    return `- ${routeId}: ${route?.condition || route?.label || '根据当前上下文判断是否进入这条路线'}`;
  });
  const context = JSON.stringify(snapshotPromptContext(snapshot, stepRunId));
  return [
    '你正在执行工作流中的“判断”节点。请只负责选择路线，不要继续执行路线后的任务。',
    node.branchConfig?.instruction || node.description || '根据当前工作流上下文选择下一条路线。',
    '可选路线（routeId 必须逐字返回以下 ID 之一）：',
    routeLines.join('\n'),
    '只返回严格 JSON，不要使用 Markdown 代码块，也不要添加其他文字：',
    '{"routeId":"路线ID","reason":"一句话判断依据","confidence":0.0}',
    `当前共享上下文：${context}`,
  ].join('\n\n');
}

function parseBranchDecision(raw: string): { routeId: string; reason: string; confidence?: number } | null {
  const source = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(source.slice(start, end + 1)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.routeId !== 'string' || !record.routeId.trim()) return null;
    const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : undefined;
    return {
      routeId: record.routeId.trim(),
      reason: typeof record.reason === 'string' && record.reason.trim() ? record.reason.trim() : 'Agent 已选择此路线。',
      ...(confidence === undefined ? {} : { confidence }),
    };
  } catch {
    return null;
  }
}
