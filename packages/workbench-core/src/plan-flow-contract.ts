/**
 * `/api/plan-flow` 返回的流程契约类型 —— 单一真源。
 *
 * 这份类型此前在 Workbench.tsx 和 XyFlowCanvas.tsx 各抄了一份，
 * 后端加字段要同步改两处，漏一处就是运行时才发现的类型谎言。
 * 需要用流程契约的地方一律从这里 import。
 *
 * 各产品可用自己的 Markdown 解析器生成这份契约；核心层只定义稳定的数据形状。
 */

import type {
  ProcessResultAdvance,
  ProcessResultContract,
  ProcessResultFieldSpec,
} from './process-result-model';

/**
 * `## 输入卡片` 章节的契约。
 *
 * 类型留在这里，但**画布上已经没有输入卡组件了**：输入能力整体在左侧聊天区，
 * 由澄清卡（WorkflowClarificationCard 的 intake 模式）承担，
 * 用户确认后直接 bootstrap 建档；画布节点是建档之后才创建的，只做展示。
 *
 * 类型仍保留，是因为 MD 里 `## 输入卡片` 章节还在被后端解析，contract.input 会照常
 * 返回，而 title 仍被画布用作卡面标题的兜底。删掉类型只会让这条数据变成 any。
 */
export type PlanFlowInputAttachments = {
  enabled: boolean;
  multiple: boolean;
  accept: string;
  label: string;
};

export type PlanFlowInputParameter = {
  id: string;
  label: string;
  type: 'segmented' | 'switch';
  options?: string[];
  defaultValue: string | boolean;
};

export type InputCardContract = {
  title: string;
  /** 业务模块名，缺省等于 title */
  business?: string;
  eyebrow: string;
  placeholder: string;
  attachments: PlanFlowInputAttachments;
  parameters: PlanFlowInputParameter[];
  submit: {
    label: string;
    pendingLabel: string;
    shortcut: boolean;
  };
  afterSubmit: {
    lockInput: boolean;
    lockedLabel: string;
    runningLabel: string;
  };
};

/**
 * 可切换的业务线选项，来自 /api/plan-flows。
 *
 * 画布不再提供切换入口（输入走聊天区），但 Workbench 仍用它做流程发现与默认流程选择。
 */
export type InputCardFlowOption = {
  id: string;
  /** 业务线名（`输入卡片` 的 `业务线`） */
  business: string;
  /** 卡片标题（`输入卡片` 的 `标题`），业务线缺省时兜底 */
  cardTitle: string;
  /** 流程说明（MD 里的 `> 引用`） */
  description?: string;
  /** 该流程文件解析失败的原因 */
  error?: string;
};

export type PlanFlowKnowledgeMode = 'inline' | 'agent' | 'extract' | 'evaluation';

export type PlanFlowKnowledge = {
  id: string;
  title: string;
  path: string;
  defaultEnabled: boolean;
  allowDisable: boolean;
  mode: PlanFlowKnowledgeMode;
  required: boolean;
  instruction: string;
};

/**
 * 这一步要读的 CASE 文件（`#### 读取文件`）。
 *
 * prefetch＝后端把正文取好内联进指令；self＝仍让 AI 自己发 HTTP 去读。
 * 写进配置之前，「读哪些文件」是八个调用点各自手写的一行中文，
 * 措辞互不相同、流程卡上也看不见，改一处不影响其他处。
 */
export type PlanFlowCaseFile = {
  mode: 'prefetch' | 'self';
  /** CASE 内的相对路径，如 整理/01_话题方案.json */
  path: string;
  purpose: string;
};

export type PlanFlowStep = {
  id: string;
  title: string;
  actor: string;
  /** 真实读取入口（接口或路径），只发给 AI，不在流程卡展示 */
  fetch?: string;
  instruction: string;
  /** 由配置的「展示」字段声明该步额外渲染什么，避免前端按 step.id 写死 */
  display?: {
    type: 'table' | 'list';
    source: 'analysisDimensions';
  } | null;
  /** `#### 要求` 子块条目；空数组表示该步无要求，不显示入口 */
  requirements?: string[];
  /** `#### 读取文件` 子块条目；空数组表示该步不读 CASE 文件 */
  caseFiles?: PlanFlowCaseFile[];
  /** Action 步骤的 body.params 契约 */
  parameters?: Array<{ name: string; note: string }>;
  /** Action 步骤的请求骨架原文，AI 照抄填空 */
  payload?: string;
  /** Eval 步骤评哪个阶段（creative / topic / product_sentence / plan） */
  evaluationStage?: string;
  /** Eval 步骤被输入卡的哪个开关控制；空＝无条件执行 */
  enabledBy?: string;
  knowledge: PlanFlowKnowledge[];
};

/**
 * 结果卡片契约。
 *
 * display / advance 是过程组件（创意、话题、产品句）用来渲染单项和推进按钮的部分；
 * 方案正文是交付节点，`output.shape === 'object'`，这两组字段为空。
 */
export type PlanFlowResult = {
  eyebrow: string;
  title: string;
  itemLabel: string;
  loadingLabel: string;
  roundDisplay: 'all-expanded' | 'latest-expanded';
  selection: {
    mode: 'none' | 'single' | 'multiple';
    min?: number | null;
    max?: number | null;
    /** 多选按钮的两态文案，如「选入」/「已选」 */
    selectLabel?: string | null;
    selectedLabel?: string | null;
  };
  capabilities: {
    /** 旧字段，等价于 itemFeedback && roundRegenerate 的并集，保留兼容 */
    feedback: boolean;
    /** 单项可写改进意见 */
    itemFeedback: boolean;
    /** 整轮可重生 */
    roundRegenerate: boolean;
    edit: boolean;
    evaluation: boolean;
    knowledge: boolean;
    next: boolean;
  };
  /** 单项卡面渲染配置：标题/摘要/徽标取哪个字段，附加字段及其中文标签 */
  display: {
    titleField: string;
    summaryField: string;
    badgeField: string;
    fields: ProcessResultFieldSpec[];
  };
  /** 推进方式与文案；label / repeatLabel 在 next 里，这里只有模式相关项 */
  advance: Pick<ProcessResultAdvance, 'mode' | 'hint' | 'pendingLabel'>;
  actions: {
    feedback: string;
    update: string;
    select: string;
    roundPrepare: string;
    itemPrepare: string;
  };
  evaluationStage: string;
  next: {
    capability: string;
    label: string;
    repeatLabel: string;
    /** 下一阶段的流程 id（MD 的 `后续流程`），阶段链路靠它串起来 */
    flowId: string;
  };
};

export type PlanFlowOutput = {
  count: number;
  fields: string[];
  action: string;
  trigger: string;
  /** 结果容器参数名：创意 cards、话题 topics、产品句 products、正文 article */
  container?: string;
  /** list＝一轮多个候选（过程组件）；object＝单份文档（交付节点） */
  shape?: 'list' | 'object';
};

export type PlanFlowConstraints = {
  /** 原始可读规则，流程卡和 AI 指令直接展示；结构化字段由 Action 执行。 */
  lines: string[];
  orderedValues: Array<{ field: string; values: string[] }>;
  booleanCounts: Array<{ field: string; value: boolean; count: number }>;
  fixedValues: Array<{ path: string; value: string }>;
  suffixes: Array<{ path: string; value: string }>;
  arrayMappings: Array<{ path: string; source: string }>;
  prefixMappings: Array<{ path: string; source: string }>;
  bannedPhrases: string[];
};

export type PlanFlowMessage = {
  heading: string;
  preface: string;
  /** 知识读取命令模板，含 {path} 占位符 */
  knowledgeCommand: string;
  closing: string;
  closingExtras: Record<string, string>;
  knowledgeWikiId?: string;
};

/** `/api/plan-flow` 的完整返回。 */
export type PlanFlowContract = {
  version: number;
  /** 流程 id（= playbooks/<id>_flow.md 的前缀），随 Action 回传给后端取同一份契约 */
  id: string;
  title: string;
  description: string;
  /** `## 输入卡片` 章节；未配置该章节的流程文件此字段为 null。 */
  input: InputCardContract | null;
  analysisDimensions: Array<{ id: string; label: string; question: string }>;
  /** 维度区折叠头的文案（= MD 的 `## 需求分析维度` 章节名），卡上不写死中文 */
  analysisLabel: string;
  steps: PlanFlowStep[];
  output: PlanFlowOutput;
  constraints: PlanFlowConstraints;
  result: PlanFlowResult;
  message: PlanFlowMessage;
};

/**
 * 把 `/api/plan-flow` 的 result 段翻成过程组件的 contract。
 *
 * 三个阶段共用这一处转换。早先版本在创意节点里内联做映射，
 * 结果话题和产品句只能各自另写一套，「通用组件」就退化成了「创意组件」。
 *
 * 这里不做任何阶段判断：能力、字段、推进方式全部照抄配置。
 * 想改某阶段的行为，改它的 MD，不要回来加分支。
 */
export function toProcessContract(
  stageId: string,
  result: PlanFlowResult,
): ProcessResultContract {
  return {
    stageId,
    eyebrow: result.eyebrow,
    title: result.title,
    itemLabel: result.itemLabel,
    loadingLabel: result.loadingLabel,
    roundDisplay: result.roundDisplay,
    selection: {
      mode: result.selection.mode,
      min: result.selection.min ?? undefined,
      max: result.selection.max ?? undefined,
      selectLabel: result.selection.selectLabel ?? undefined,
      selectedLabel: result.selection.selectedLabel ?? undefined,
    },
    capabilities: {
      edit: result.capabilities.edit,
      itemFeedback: result.capabilities.itemFeedback,
      roundRegenerate: result.capabilities.roundRegenerate,
      evaluate: result.capabilities.evaluation,
      knowledge: result.capabilities.knowledge,
      advance: result.capabilities.next,
    },
    titleField: result.display.titleField,
    summaryField: result.display.summaryField,
    badgeField: result.display.badgeField,
    fields: result.display.fields,
    advance: {
      mode: result.advance.mode,
      // 推进按钮文案沿用 next 段：它本来就是「后续按钮 / 再次按钮」，
      // 不必在 MD 里再重复配一遍。
      label: result.next.label,
      repeatLabel: result.next.repeatLabel || result.next.label,
      hint: result.advance.hint,
      pendingLabel: result.advance.pendingLabel || result.next.label,
    },
  };
}
