import type { WorkflowArtifactKind, ArtifactGenerationConfig, ArtifactImageOptions } from '@bezier/contracts';
import type { WorkflowResultSurface } from '@bezier/contracts';

export type WorkflowAgentNodeConfig = {
  /** Empty means the workflow inherits the agent that launched the run. */
  agentId?: string;
  /** Empty means the selected agent's default model. */
  modelId?: string;
  systemPrompt?: string;
  skillIds: string[];
  /** Concrete knowledge item ids, never a whole knowledge-base id. */
  knowledgeIds: string[];
  /** Runtime parser hint. The editor only writes `format`; legacy rules migrate into System Prompt. */
  outputContract?: {
    format?: 'json' | 'markdown';
    /** @deprecated Migrated into System Prompt when an older workflow is opened. */
    minItems?: number;
    /** @deprecated Migrated into System Prompt when an older workflow is opened. */
    maxItems?: number;
    /** @deprecated Migrated into System Prompt when an older workflow is opened. */
    requiredFields?: string[];
    /** @deprecated Migrated into System Prompt when an older workflow is opened. */
    requiredText?: string[];
    /** @deprecated Migrated into System Prompt when an older workflow is opened. */
    forbiddenText?: string[];
    /** @deprecated Migrated into System Prompt when an older workflow is opened. */
    instructions?: string;
  };
  /** When set, the Agent output is rendered through the existing result component before downstream nodes run. */
  confirmation?: WorkflowReviewNodeConfig;
};

export function migrateLegacyOutputContractToPrompt(config?: WorkflowAgentNodeConfig): string | undefined {
  const systemPrompt = config?.systemPrompt?.trim() || '';
  const contract = config?.outputContract;
  if (!contract) return systemPrompt || undefined;
  const countLimits = [
    contract.minItems === undefined ? '' : `至少 ${contract.minItems} 项`,
    contract.maxItems === undefined ? '' : `最多 ${contract.maxItems} 项`,
  ].filter(Boolean);
  const countRule = contract.minItems !== undefined && contract.minItems === contract.maxItems
    ? `- 输出数量：恰好 ${contract.minItems} 项。`
    : countLimits.length > 0 ? `- 输出数量：${countLimits.join('，')}。` : '';
  const rules = [
    countRule,
    contract.requiredFields?.length
      ? `- 每项包含字段：${contract.requiredFields.join('、')}。`
      : '',
    contract.requiredText?.length
      ? `- 正文必须原样包含：${contract.requiredText.join('、')}。`
      : '',
    contract.forbiddenText?.length
      ? `- 正文不得包含：${contract.forbiddenText.join('、')}。`
      : '',
    contract.instructions?.trim() ? `- ${contract.instructions.trim()}` : '',
  ].filter(Boolean);
  if (rules.length === 0) return systemPrompt || undefined;
  const legacySection = `## 输出要求\n\n${rules.join('\n')}`;
  return systemPrompt ? `${systemPrompt}\n\n${legacySection}` : legacySection;
}

export type WorkflowClarificationQuestionType = 'text' | 'single' | 'multiple';
export type WorkflowClarificationTitleMode = 'ai' | 'manual';
export type WorkflowClarificationMode = 'configured' | 'auto';

export type WorkflowClarificationQuestionConfig = {
  id: string;
  titleMode: WorkflowClarificationTitleMode;
  /** Exact user-facing question when titleMode is manual. */
  title: string;
  /** What the Agent should ask when titleMode is ai. */
  titleDirection: string;
  type: WorkflowClarificationQuestionType;
  /** Choice-generation guidance. Unused for pure text input. */
  optionDirection: string;
  required: boolean;
  /** Whether this question accepts an additional answer outside its suggested structure. */
  allowOther: boolean;
};

/** Rules used by the current Agent to generate the left-hand conversation inquiry. */
export type WorkflowClarificationNodeConfig = {
  /** configured keeps an explicit question list; auto lets the current Agent design the form at runtime. */
  mode?: WorkflowClarificationMode;
  questions: WorkflowClarificationQuestionConfig[];
  autoConfig?: {
    /** The boundary the Agent must stay inside when deciding what to ask. */
    instruction: string;
    /** Runtime question budget. The Agent may ask fewer questions. */
    maxQuestions: number;
    /** Controls the input components the Agent may choose from. */
    allowedTypes: WorkflowClarificationQuestionType[];
  };
  /** Legacy fields remain readable while saved workflows migrate to rule-based inquiry. */
  title?: string;
  description?: string;
  submitLabel?: string;
  attachmentsEnabled?: boolean;
};

/** Workflow-level metadata is configured on the one Start node for now. */
export type WorkflowStartNodeConfig = {
  /** The user-authored WORKFLOW.md; frontmatter is the workflow discovery source. */
  workflowMarkdown?: string;
  workflowName: string;
  description: string;
  triggerScenarios: string[];
  includeProjectContext: boolean;
};

/** The interaction contract for one user-visible result artifact. */
export type WorkflowReviewSurfaceConfig = {
  /** Whether this projection is published for the result. At least one surface stays enabled. */
  enabled: boolean;
  selection: 'none' | 'single' | 'multiple';
  selectionRequired: boolean;
  feedbackEnabled: boolean;
  feedbackRequired: boolean;
  allowRegenerate: boolean;
  continueLabel: string;
};

export type WorkflowReviewSelectionMode = WorkflowReviewSurfaceConfig['selection'];

/** Independent interaction settings for the two projections of one result. */
export type WorkflowReviewNodeConfig = WorkflowReviewSurfaceConfig & {
  mode?: 'continue';
  /** User-facing title of the result component. */
  title?: string;
  /** Canvas artifact created after the user confirms this result. */
  artifactKind: 'text' | 'page' | 'image' | 'video';
  /** False keeps the result component as the only canvas artifact. */
  materializeOnConfirm?: boolean;
  chat?: WorkflowReviewSurfaceConfig;
  canvas?: WorkflowReviewSurfaceConfig;
};

/**
 * The editor exposes one selection rule because chat and canvas are two views
 * of the same review result. Keep all three persisted projections aligned so
 * reopening or recompiling a workflow cannot silently restore another mode.
 */
export function synchronizeWorkflowReviewSelection(
  config: WorkflowReviewNodeConfig,
  selection: WorkflowReviewSelectionMode,
  selectionRequired?: boolean,
): WorkflowReviewNodeConfig {
  const required = selection === 'none'
    ? false
    : selectionRequired ?? (config.selection === 'none' ? true : config.selectionRequired);
  const synchronizedSurface = (
    surface: WorkflowReviewSurfaceConfig | undefined,
  ): WorkflowReviewSurfaceConfig => ({
    enabled: surface?.enabled ?? config.enabled,
    selection,
    selectionRequired: required,
    feedbackEnabled: surface?.feedbackEnabled ?? config.feedbackEnabled,
    feedbackRequired: surface?.feedbackRequired ?? config.feedbackRequired,
    allowRegenerate: surface?.allowRegenerate ?? config.allowRegenerate,
    continueLabel: surface?.continueLabel ?? config.continueLabel,
  });

  return {
    ...config,
    selection,
    selectionRequired: required,
    chat: synchronizedSurface(config.chat),
    canvas: synchronizedSurface(config.canvas),
  };
}

/** A real canvas production node. Outgoing edges make it an intermediate artifact. */
export type WorkflowDeliveryNodeConfig = ArtifactGenerationConfig & {
  artifactKind: WorkflowArtifactKind;
  artifactName?: string;
  requirements?: string;
  image?: ArtifactImageOptions & { ratio: NonNullable<ArtifactImageOptions['ratio']>; count: number; resolution: NonNullable<ArtifactImageOptions['resolution']> };
};

export type WorkflowBranchRouteConfig = {
  /** Stable id used by the React Flow source handle and the runtime route. */
  id: string;
  label: string;
  /** Natural-language rule evaluated by the currently selected Agent. */
  condition: string;
};

export type WorkflowBranchNodeConfig = {
  /** What the Agent should decide at this point in the workflow. */
  instruction: string;
  routes: WorkflowBranchRouteConfig[];
  /** Safe fallback when the Agent response cannot be parsed or is not allowed. */
  defaultRouteId?: string;
};

export type WorkflowEditorStageSnapshot = {
  flowId: string;
  skippedStepIds: string[];
  enabledKnowledgeIds: string[];
  position: { x: number; y: number };
  /** Where this stage's review result appears at runtime. */
  resultSurfaces?: WorkflowResultSurface[];
  /** Agent execution overrides compiled from the graph node. */
  agentConfig?: WorkflowAgentNodeConfig;
  startConfig?: WorkflowStartNodeConfig;
};

/**
 * Configuration-time node kinds. `decision` and `canvas-card` are read-only
 * legacy values so existing saved canvases can be migrated on read.
 */
export type WorkflowEditorNodeKind =
  | 'start'
  | 'clarify'
  | 'agent'
  | 'review'
  | 'branch'
  | 'delivery'
  | 'decision'
  | 'canvas-card';

export type WorkflowEditorNodeSnapshot = {
  cardNumber?: number;
  inputReferences?: string[];
  id: string;
  kind: WorkflowEditorNodeKind;
  title: string;
  description: string;
  flowId?: string;
  resultSurfaces?: WorkflowResultSurface[];
  agentConfig?: WorkflowAgentNodeConfig;
  startConfig?: WorkflowStartNodeConfig;
  clarificationConfig?: WorkflowClarificationNodeConfig;
  reviewConfig?: WorkflowReviewNodeConfig;
  branchConfig?: WorkflowBranchNodeConfig;
  deliveryConfig?: WorkflowDeliveryNodeConfig;
  position: { x: number; y: number };
};

export type WorkflowEditorEdgeSnapshot = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/**
 * 画布编辑器保存的是“这次项目怎么跑”，流程正文仍由产品提供的定义源负责。
 * 这样业务规则升级后不复制旧定义，同时每张运行卡仍能保留自己的执行取舍。
 */
export type WorkflowEditorConfig = {
  nextCardNumber?: number;
  id: string;
  version: 1 | 2;
  title: string;
  updatedAt: string;
  stages: WorkflowEditorStageSnapshot[];
  /** v2: editor graph. `stages` remains the runtime-compatible compiled view. */
  nodes?: WorkflowEditorNodeSnapshot[];
  edges?: WorkflowEditorEdgeSnapshot[];
};

export function stageSnapshotOf(
  config: WorkflowEditorConfig | undefined,
  flowId: string,
): WorkflowEditorStageSnapshot | undefined {
  // 节点流 v2 可以没有旧版 stages 编译快照。读取旧草稿时把它当作
  // 空快照，而不是在交互时因为 undefined.find 让整个画布崩掉。
  return config?.stages?.find(stage => stage.flowId === flowId);
}
