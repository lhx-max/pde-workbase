import type { JsonValue } from '../common.js';
import type { ExecutionSnapshot } from './execution-snapshot.js';

export const WORKFLOW_STEP_KINDS = [
  'agent',
  'action',
  'eval',
  'human-gate',
  'questions',
  'wait',
  'publish',
  'terminate',
] as const;

export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'awaiting-input',
  'waiting',
  'succeeded',
  'terminated',
  'failed',
  'cancelled',
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_RUN_STATUSES = [
  'pending',
  'blocked',
  'running',
  'awaiting-input',
  'waiting',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
] as const;

export type WorkflowStepRunStatus = (typeof WORKFLOW_STEP_RUN_STATUSES)[number];

export type WorkflowInputType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'enum'
  | 'toggle'
  | 'number'
  | 'knowledge-ref'
  | 'upstream-ref';

export interface WorkflowInputDefinition {
  key: string;
  label: string;
  type: WorkflowInputType;
  required: boolean;
  options?: JsonValue[];
  defaultValue?: JsonValue;
  description?: string;
  sourceWorkflowId?: string;
}

export type WorkflowFailurePolicy =
  | { kind: 'stop' }
  | { kind: 'skip' }
  | { kind: 'retry'; maxAttempts: number };

export interface WorkflowRoute {
  id: string;
  to: string;
  when?: string;
  maxIterations?: number;
}

export interface WorkflowStepDefinition {
  id: string;
  title: string;
  kind: WorkflowStepKind;
  dependsOn: string[];
  instruction?: string;
  requirements?: string[];
  enabledWhen?: string;
  timeoutMs?: number;
  failurePolicy: WorkflowFailurePolicy;
  skippable?: boolean;
  skipReason?: string;
  inputSchemaRef?: string;
  outputSchemaRef?: string;
  actionId?: string;
  evaluationStage?: string;
  routes?: WorkflowRoute[];
  metadata?: Record<string, JsonValue>;
}

export type ResultShape = 'single' | 'collection';

export type ResultRenderer =
  | 'structured'
  | 'document'
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'code';

export type ResultCapability =
  | 'select'
  | 'edit'
  | 'comment'
  | 'regenerate'
  | 'evaluate'
  | 'download'
  | 'export'
  | 'publish'
  | 'continue';

/*
 * 不能叫 ArtifactStatus——api/artifacts.ts 已经占了这个名字（那套是
 * 'streaming' | 'complete' | 'error'，apps/web 的 manifest 在消费）。
 * 两个同名类型都从 index.ts 桶导出会撞成 TS2308，整个 contracts 包编译不过。
 * 这里是 ArtifactDescriptor 的状态，语义本来就窄，按它命名。
 */
export type ArtifactDescriptorStatus = 'generating' | 'ready' | 'failed';

export type ArtifactResource =
  | {
      kind: 'project-file';
      path: string;
      mimeType?: string;
    }
  | {
      kind: 'live-artifact';
      artifactId: string;
    };

/**
 * A durable final output shown on the canvas.
 *
 * WorkflowResultArtifact remains the interactive, in-process review model.
 * ArtifactDescriptor deliberately excludes selection, feedback and workflow
 * actions so final outputs can be produced by workflows or ordinary tools.
 */
export interface ArtifactDescriptor {
  id: string;
  projectId: string;
  title: string;
  summary?: string;
  renderer: ResultRenderer;
  resource: ArtifactResource;
  thumbnail?: {
    path?: string;
    url?: string;
  };
  /** Renderer-specific, JSON-safe summary data used only on the canvas card. */
  preview?: JsonValue;
  capabilities: Array<Extract<ResultCapability, 'edit' | 'download' | 'export' | 'publish'>>;
  status: ArtifactDescriptorStatus;
  updatedAt: string;
  source?: {
    workflowRunId?: string;
    stepRunId?: string;
    parentArtifactId?: string;
  };
}

export type WorkflowSelectionMode = 'none' | 'single' | 'multiple';

export interface WorkflowResultSelection {
  mode: WorkflowSelectionMode;
  min?: number;
  max?: number;
  itemIdPath?: string;
}

export type WorkflowResultFeedbackCondition = 'any' | 'empty' | 'present';

export interface WorkflowResultActionCondition {
  minSelection?: number;
  maxSelection?: number;
  feedback?: WorkflowResultFeedbackCondition;
}

export type WorkflowResultActionCompletion = 'keep-active' | 'lock-card';

export interface WorkflowResultActionDefinition {
  id: string;
  capability: ResultCapability;
  label: string;
  busyLabel?: string;
  when?: WorkflowResultActionCondition;
  /** Whether a successful action keeps this result interactive or freezes this version. */
  completion?: WorkflowResultActionCompletion;
}

export interface WorkflowResultFeedbackDefinition {
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type WorkflowResultSurface = 'chat' | 'canvas';

export interface WorkflowResultDefinition {
  id: string;
  title: string;
  sourceStepId: string;
  shape: ResultShape;
  renderer: ResultRenderer;
  schemaRef?: string;
  capabilities: ResultCapability[];
  /** UI surfaces that project this result. Missing means both for legacy workflows. */
  surfaces?: WorkflowResultSurface[];
  /** Capabilities exposed by the chat-side clarification card. Defaults to capabilities. */
  chatCapabilities?: ResultCapability[];
  selection?: WorkflowResultSelection;
  actions?: WorkflowResultActionDefinition[];
  feedback?: WorkflowResultFeedbackDefinition;
  rendererConfig?: Record<string, JsonValue>;
}

export interface WorkflowResultItem {
  id: string;
  title: string;
  summary?: string;
  data?: JsonValue;
}

export interface WorkflowResultArtifact {
  id: string;
  workflowRunId: string;
  resultDefinitionId: string;
  sourceStepRunId: string;
  version: number;
  projectId: string;
  title: string;
  shape: ResultShape;
  renderer: ResultRenderer;
  rendererConfig?: Record<string, JsonValue>;
  capabilities: ResultCapability[];
  /** UI projections enabled by the workflow definition. Missing means both. */
  surfaces?: WorkflowResultSurface[];
  /** Surface-specific subset for chat; canvas keeps using the full capabilities list. */
  chatCapabilities?: ResultCapability[];
  /** Chat-only interaction contract. Missing fields fall back to the canvas/base contract. */
  chatSelection?: WorkflowResultSelection;
  chatActions?: WorkflowResultActionDefinition[];
  chatFeedback?: WorkflowResultFeedbackDefinition;
  selection?: WorkflowResultSelection;
  actions: WorkflowResultActionDefinition[];
  feedback?: WorkflowResultFeedbackDefinition;
  /** Optional upstream result used by generic canvas lineage. */
  parentResultId?: string;
  /** Item sources inside parentResultId. Missing means the whole result. */
  parentItemIds?: string[];
  /** Optional non-result canvas node that anchors the first result in a run. */
  parentNodeId?: string;
  /** Persisted interaction state; clients must not infer it from business data. */
  state?: 'active' | 'locked' | 'completed';
  selectedIds?: string[];
  feedbackValue?: string;
  items?: WorkflowResultItem[];
  value?: JsonValue;
  createdAt: string;
}

export interface WorkflowResultListResponse {
  artifacts: WorkflowResultArtifact[];
}

export interface WorkflowResultInteractionRequest {
  /** Request-only execution choice for independent evaluation; never persisted. */
  execution?: ExecutionSnapshot;
  resultId: string;
  actionId: string;
  expectedVersion: number;
  selectedIds?: string[];
  feedback?: string;
  /** Projection that initiated the interaction; absent legacy requests are canvas-compatible. */
  surface?: WorkflowResultSurface;
  /**
   * 被编辑的单项 id（capability 'edit' 专用）。
   *
   * 选择类动作用 selectedIds，编辑是「改这一条」而不是「选中这一条」，
   * 两者语义不同不能复用：编辑不该把用户当前的勾选状态冲掉。
   */
  itemId?: string;
  /**
   * 单项字段补丁（capability 'edit' 专用）。
   *
   * key 是结果卡对外暴露的字段名（rendererConfig 里那套，来自流程 MD 的
   * `- 单项字段：`），不是业务领域模型的内部字段名——适配器负责映射回去，
   * 前端不需要知道业务 candidate 结构。
   */
  patch?: Record<string, string>;
  idempotencyKey: string;
}

export interface WorkflowResultInteractionResponse {
  ok: boolean;
  resultId: string;
  interactionId: string;
  state: 'accepted' | 'completed';
  visiblePrompt?: string;
  agentPrompt?: string;
  runMetadata?: Record<string, JsonValue>;
  message?: string;
}

export interface WorkflowExitDefinition {
  id: string;
  kind: 'success' | 'terminal' | 'error';
  when: string;
  nextWorkflowId?: string;
  action?: string;
  retryable?: boolean;
  preserveState?: boolean;
  parameters?: Record<string, string>;
}

export interface WorkflowDefinition {
  /** Opt-in presentation for invoked workflow assets; absent on internal/legacy flows. */
  canvasPresentation?: 'run-group';
  schemaVersion: 1;
  id: string;
  aliases: string[];
  version: string;
  digest: string;
  title: string;
  description?: string;
  inputs: WorkflowInputDefinition[];
  steps: WorkflowStepDefinition[];
  results: WorkflowResultDefinition[];
  exits: WorkflowExitDefinition[];
  limits: {
    maxStepRuns: number;
    maxDurationMs?: number;
    maxCost?: number;
  };
  source?: {
    format: 'markdown';
    path: string;
  };
}

export interface WorkflowRun {
  id: string;
  businessKey?: string;
  workflowId: string;
  definitionVersion: string;
  definitionDigest: string;
  projectId: string;
  status: WorkflowRunStatus;
  input: JsonValue;
  /** Versioned initial project-file references, captured on first consumption. */
  inputVersion?: JsonValue;
  variables: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
  termination?: {
    kind: 'completed' | 'business-stop' | 'limit-exceeded' | 'system-error';
    code: string;
    message: string;
  };
}

/** A completed, project-owned file passed between workflow steps. */
export type WorkflowArtifactFile = {
  kind: 'project-file';
  path: string;
  sha256: string;
  bytes: number;
};

export type WorkflowMaterializedContent = {
  content: string;
  files: WorkflowArtifactFile[];
};

/** Immutable provenance of a value handed to a workflow step. */
export interface WorkflowInputSource {
  stepRunId: string;
  stepId: string;
  title: string;
  kind: string;
  iteration: number;
  attempt: number;
  outputDigest: string;
}

/** Captured once when a step starts; referenced outputs are immutable. */
export interface WorkflowStepInputSnapshot {
  version: 1;
  definitionDigest: string;
  capturedAt: string;
  task: JsonValue;
  upstream: WorkflowInputSource[];
  content: WorkflowInputSource[];
  references?: WorkflowInputSource[];
  context: WorkflowInputSource[];
}

export interface WorkflowStepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  sequence: number;
  iteration: number;
  attempt: number;
  status: WorkflowStepRunStatus;
  input: JsonValue;
  inputSnapshot?: WorkflowStepInputSnapshot;
  output?: JsonValue;
  childRunId?: string;
  interactionId?: string;
  wakeAt?: string;
  selectedRoute?: {
    routeId: string;
    evaluatorVersion: string;
    inputDigest: string;
  };
  artifactRefs: string[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  startedAt?: string;
  finishedAt?: string;
}

export type WorkflowDiagnosticSeverity = 'error' | 'warning';

export type WorkflowDiagnosticCode =
  | 'INVALID_WORKFLOW_ID'
  | 'INVALID_ENTITY_ID'
  | 'DUPLICATE_ALIAS'
  | 'EMPTY_WORKFLOW'
  | 'DUPLICATE_INPUT_KEY'
  | 'DUPLICATE_STEP_ID'
  | 'DUPLICATE_RESULT_ID'
  | 'DUPLICATE_EXIT_ID'
  | 'MISSING_DEPENDENCY'
  | 'SELF_DEPENDENCY'
  | 'CYCLE_WITHOUT_LIMIT'
  | 'UNREACHABLE_STEP'
  | 'MISSING_ROUTE_TARGET'
  | 'DUPLICATE_ROUTE_ID'
  | 'DEFAULT_ROUTE_NOT_LAST'
  | 'MULTIPLE_DEFAULT_ROUTES'
  | 'INVALID_LOOP_LIMIT'
  | 'INVALID_LIMIT'
  | 'INVALID_RETRY_POLICY'
  | 'INVALID_CONDITION'
  | 'MISSING_ACTION_ID'
  | 'MISSING_OUTPUT_SCHEMA'
  | 'MISSING_RESULT_SOURCE'
  | 'MISSING_EXIT_CONDITION'
  | 'MISSING_EXIT_TARGET'
  | 'UNKNOWN_RESULT_PRESET'
  | 'UNKNOWN_CHAT_RESULT_CAPABILITY'
  | 'UNSUPPORTED_CHAT_RESULT_CAPABILITY'
  | 'UNKNOWN_RESULT_SURFACE'
  | 'INVALID_RESULT_SELECTION';

export interface WorkflowDiagnostic {
  severity: WorkflowDiagnosticSeverity;
  code: WorkflowDiagnosticCode;
  message: string;
  path?: string;
}

export interface WorkflowDoctorResult {
  valid: boolean;
  diagnostics: WorkflowDiagnostic[];
}

const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENTITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VARIABLE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const CONDITION_PATTERN = /^[\w.$()[\]{}'"\s=!<>&|:+\-*/]+$/;

export function diagnoseWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDoctorResult {
  const diagnostics: WorkflowDiagnostic[] = [];
  const report = (
    severity: WorkflowDiagnosticSeverity,
    code: WorkflowDiagnosticCode,
    message: string,
    path?: string,
  ) => diagnostics.push({ severity, code, message, ...(path ? { path } : {}) });

  if (!WORKFLOW_ID_PATTERN.test(definition.id)) {
    report('error', 'INVALID_WORKFLOW_ID', `Invalid workflow id: ${definition.id}`, 'id');
  }

  const aliases = new Set<string>();
  for (const alias of definition.aliases) {
    if (alias === definition.id || aliases.has(alias)) {
      report('error', 'DUPLICATE_ALIAS', `Duplicate workflow alias: ${alias}`, 'aliases');
    }
    aliases.add(alias);
  }

  if (definition.steps.length === 0) {
    report('error', 'EMPTY_WORKFLOW', 'Workflow must contain at least one step', 'steps');
  }
  if (!Number.isInteger(definition.limits.maxStepRuns) || definition.limits.maxStepRuns < 1) {
    report('error', 'INVALID_LIMIT', 'maxStepRuns must be a positive integer', 'limits.maxStepRuns');
  }
  if (
    definition.limits.maxDurationMs !== undefined
    && (!Number.isInteger(definition.limits.maxDurationMs) || definition.limits.maxDurationMs < 1)
  ) {
    report('error', 'INVALID_LIMIT', 'maxDurationMs must be a positive integer', 'limits.maxDurationMs');
  }
  if (
    definition.limits.maxCost !== undefined
    && (!Number.isFinite(definition.limits.maxCost) || definition.limits.maxCost <= 0)
  ) {
    report('error', 'INVALID_LIMIT', 'maxCost must be positive', 'limits.maxCost');
  }

  const inputKeys = new Set<string>();
  for (const [index, input] of definition.inputs.entries()) {
    if (!VARIABLE_KEY_PATTERN.test(input.key)) {
      report('error', 'INVALID_ENTITY_ID', `Invalid input key: ${input.key}`, `inputs[${index}].key`);
    }
    if (inputKeys.has(input.key)) {
      report('error', 'DUPLICATE_INPUT_KEY', `Duplicate input key: ${input.key}`, `inputs[${index}].key`);
    }
    inputKeys.add(input.key);
  }

  const stepById = new Map<string, WorkflowStepDefinition>();
  for (const [index, step] of definition.steps.entries()) {
    const path = `steps[${index}]`;
    if (!ENTITY_ID_PATTERN.test(step.id)) {
      report('error', 'INVALID_ENTITY_ID', `Invalid step id: ${step.id}`, `${path}.id`);
    }
    if (stepById.has(step.id)) {
      report('error', 'DUPLICATE_STEP_ID', `Duplicate step id: ${step.id}`, `${path}.id`);
    } else {
      stepById.set(step.id, step);
    }
    if (
      (step.kind === 'agent' || step.kind === 'action' || step.kind === 'eval')
      && !step.outputSchemaRef
    ) {
      report(
        'warning',
        'MISSING_OUTPUT_SCHEMA',
        `${step.kind} step "${step.id}" has no output schema`,
        `${path}.outputSchemaRef`,
      );
    }
    if (step.kind === 'action' && !step.actionId) {
      report('error', 'MISSING_ACTION_ID', `Action step "${step.id}" has no action id`, `${path}.actionId`);
    }
    if (
      step.failurePolicy.kind === 'retry'
      && (!Number.isInteger(step.failurePolicy.maxAttempts) || step.failurePolicy.maxAttempts < 2)
    ) {
      report(
        'error',
        'INVALID_RETRY_POLICY',
        `Step "${step.id}" must allow at least two attempts`,
        `${path}.failurePolicy`,
      );
    }
    if (step.enabledWhen && !isSafeCondition(step.enabledWhen)) {
      report(
        'error',
        'INVALID_CONDITION',
        `Step "${step.id}" has an invalid condition`,
        `${path}.enabledWhen`,
      );
    }
  }

  for (const [index, step] of definition.steps.entries()) {
    const path = `steps[${index}]`;
    for (const dependency of step.dependsOn) {
      if (dependency === step.id) {
        report('error', 'SELF_DEPENDENCY', `Step "${step.id}" depends on itself`, `${path}.dependsOn`);
      } else if (!stepById.has(dependency)) {
        report(
          'error',
          'MISSING_DEPENDENCY',
          `Step "${step.id}" depends on missing step "${dependency}"`,
          `${path}.dependsOn`,
        );
      }
    }

    const routeIds = new Set<string>();
    const routes = step.routes ?? [];
    const defaultRoutes = routes.filter((route) => !route.when);
    if (defaultRoutes.length > 1) {
      report(
        'error',
        'MULTIPLE_DEFAULT_ROUTES',
        `Step "${step.id}" has multiple default routes`,
        `${path}.routes`,
      );
    }
    if (defaultRoutes.length === 1 && routes.at(-1) !== defaultRoutes[0]) {
      report(
        'error',
        'DEFAULT_ROUTE_NOT_LAST',
        `Default route for step "${step.id}" must be last`,
        `${path}.routes`,
      );
    }
    for (const [routeIndex, route] of routes.entries()) {
      const routePath = `${path}.routes[${routeIndex}]`;
      if (!ENTITY_ID_PATTERN.test(route.id)) {
        report('error', 'INVALID_ENTITY_ID', `Invalid route id: ${route.id}`, `${routePath}.id`);
      }
      if (routeIds.has(route.id)) {
        report('error', 'DUPLICATE_ROUTE_ID', `Duplicate route id: ${route.id}`, `${routePath}.id`);
      }
      routeIds.add(route.id);
      if (!stepById.has(route.to)) {
        report(
          'error',
          'MISSING_ROUTE_TARGET',
          `Route "${route.id}" targets missing step "${route.to}"`,
          `${routePath}.to`,
        );
      }
      if (
        route.maxIterations !== undefined
        && (!Number.isInteger(route.maxIterations) || route.maxIterations < 1)
      ) {
        report(
          'error',
          'INVALID_LOOP_LIMIT',
          `Route "${route.id}" has an invalid maxIterations`,
          `${routePath}.maxIterations`,
        );
      }
      if (route.when && !isSafeCondition(route.when)) {
        report(
          'error',
          'INVALID_CONDITION',
          `Route "${route.id}" has an invalid condition`,
          `${routePath}.when`,
        );
      }
    }
  }

  const dependencyAdjacency = new Map<string, string[]>();
  for (const step of definition.steps) dependencyAdjacency.set(step.id, []);
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) dependencyAdjacency.get(dependency)?.push(step.id);
  }

  const roots = definition.steps.filter((step) => step.dependsOn.length === 0);
  const reachable = new Set<string>();
  const queue = roots.map((step) => step.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...(dependencyAdjacency.get(current) ?? []));
  }
  for (const [index, step] of definition.steps.entries()) {
    if (!reachable.has(step.id)) {
      report(
        'warning',
        'UNREACHABLE_STEP',
        `Step "${step.id}" is unreachable`,
        `steps[${index}]`,
      );
    }
  }

  for (const [stepIndex, step] of definition.steps.entries()) {
    for (const [routeIndex, route] of (step.routes ?? []).entries()) {
      if (
        hasPath(dependencyAdjacency, route.to, step.id)
        && !route.maxIterations
      ) {
        report(
          'error',
          'CYCLE_WITHOUT_LIMIT',
          `Back edge from "${step.id}" to "${route.to}" requires maxIterations`,
          `steps[${stepIndex}].routes[${routeIndex}]`,
        );
      }
    }
  }

  const resultIds = new Set<string>();
  for (const [index, result] of definition.results.entries()) {
    if (!ENTITY_ID_PATTERN.test(result.id)) {
      report('error', 'INVALID_ENTITY_ID', `Invalid result id: ${result.id}`, `results[${index}].id`);
    }
    if (resultIds.has(result.id)) {
      report('error', 'DUPLICATE_RESULT_ID', `Duplicate result id: ${result.id}`, `results[${index}].id`);
    }
    resultIds.add(result.id);
    if (!stepById.has(result.sourceStepId)) {
      report(
        'error',
        'MISSING_RESULT_SOURCE',
        `Result "${result.id}" references missing step "${result.sourceStepId}"`,
        `results[${index}].sourceStepId`,
      );
    }
  }

  const exitIds = new Set<string>();
  for (const [index, exit] of definition.exits.entries()) {
    if (!ENTITY_ID_PATTERN.test(exit.id)) {
      report('error', 'INVALID_ENTITY_ID', `Invalid exit id: ${exit.id}`, `exits[${index}].id`);
    }
    if (exitIds.has(exit.id)) {
      report('error', 'DUPLICATE_EXIT_ID', `Duplicate exit id: ${exit.id}`, `exits[${index}].id`);
    }
    exitIds.add(exit.id);
    if (!exit.when.trim()) {
      report(
        'error',
        'MISSING_EXIT_CONDITION',
        `Exit "${exit.id}" has no condition`,
        `exits[${index}].when`,
      );
    } else if (!isSafeCondition(exit.when)) {
      report(
        'error',
        'INVALID_CONDITION',
        `Exit "${exit.id}" has an invalid condition`,
        `exits[${index}].when`,
      );
    }
    if (exit.kind === 'success' && !exit.nextWorkflowId) {
      report(
        'error',
        'MISSING_EXIT_TARGET',
        `Success exit "${exit.id}" has no next workflow`,
        `exits[${index}].nextWorkflowId`,
      );
    }
    if (exit.kind !== 'success' && !exit.action) {
      report(
        'error',
        'MISSING_EXIT_TARGET',
        `Exit "${exit.id}" has no action`,
        `exits[${index}].action`,
      );
    }
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics,
  };
}

function hasPath(adjacency: Map<string, string[]>, from: string, to: string): boolean {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function isSafeCondition(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= 500
    && CONDITION_PATTERN.test(trimmed)
    && !/\b(?:eval|function|constructor|prototype|__proto__|import|require|new)\b/.test(trimmed);
}

/** Read-only execution projection; the persisted definition belongs to this run. */
export interface WorkflowCanvasRun {
  clarification?: { stepRunId: string; content: string };
  run: WorkflowRun;
  definition: WorkflowDefinition;
  steps: WorkflowStepRun[];
  execution: { managed: boolean; error?: string };
}
export interface WorkflowCanvasRunsResponse { runs: WorkflowCanvasRun[] }
