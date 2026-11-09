import type { ResultCapability, WorkflowResultActionDefinition, WorkflowResultFeedbackDefinition, WorkflowResultSelection } from './api/workflows.js';

/**
 * Named presets for WorkflowResultDefinition.
 *
 * Each preset defines the "base" configuration for a result card.
 * Fields declared in the flow MD's `## 结果卡片` section override
 * the preset defaults at compile time (in the markdown compiler).
 *
 * New presets should be added here; the MD only needs `- 预设：<id>`.
 */
export type WorkflowResultPresetId =
  | 'single-select'
  | 'multi-select'
  // Historical document aliases. These do not enable a business module.
  | 'gr-single-select'
  | 'gr-multi-select';

export interface WorkflowResultPresetDefinition {
  /** Selection mode and min/max counts. Overridable per-flow via `- 最少/最多选择：`. */
  selection: WorkflowResultSelection;
  /**
   * Baseline capabilities. A flow may add or remove individual capabilities with
   * `- 支持XX：是/否`; see WORKFLOW_RESULT_CAPABILITY_FLAGS.
   */
  capabilities: ResultCapability[];
  /**
   * Action defaults.
   *
   * The compiler does NOT clone this array wholesale — it rebuilds action `when`
   * conditions from the resolved selection bounds so that a per-flow
   * `- 最多选择：N` override also reaches the action conditions. Only `busyLabel`
   * and `completion` are read from here as defaults; `label` and `when` declared
   * below are documentation of intent, not the compiled output.
   */
  actions: WorkflowResultActionDefinition[];
  /** Feedback config injected when the resolved capabilities include 'comment'. */
  feedback?: WorkflowResultFeedbackDefinition;
}

/**
 * 非推进类动作：评测和单项编辑。
 *
 * 和 continue / regenerate 放在同一个 actions 数组里，是为了让「能力是否开启」
 * 只有一个判据——卡片上出现什么按钮，完全由 artifact.actions 决定，前端不再靠
 * 猜 capability 名字自己拼按钮。这样流程 MD 写 `- 支持评测：否`，编译期就把
 * evaluate 从 capabilities 里删掉，动作也随之消失，不需要前端配合改代码。
 *
 * 两者的 completion 都是 keep-active：评测和改字段都不冻结当前版本，卡片仍可
 * 继续选、继续推进。when 都不设条件——评测针对整轮，编辑针对 request.itemId，
 * 都跟「选了几项 / 有没有填意见」无关。
 */
const REVIEW_SIDE_ACTIONS: WorkflowResultActionDefinition[] = [
  {
    id: 'evaluate',
    capability: 'evaluate',
    label: '开始评测',
    busyLabel: '正在发起评测…',
    completion: 'keep-active',
  },
  {
    id: 'edit-item',
    capability: 'edit',
    label: '保存修改',
    busyLabel: '正在保存…',
    completion: 'keep-active',
  },
];

/**
 * Generic single-select review preset.
 * - Exactly 1 item can be selected before continuing.
 * - Supports feedback → per-item regenerate or full-round regenerate.
 */
const SINGLE_SELECT_PRESET: WorkflowResultPresetDefinition = {
  selection: { mode: 'single', min: 1, max: 1 },
  capabilities: ['select', 'comment', 'edit', 'regenerate', 'evaluate', 'continue'],
  actions: [
    {
      id: 'continue',
      capability: 'continue',
      label: '继续',           // overridden per-flow via `- 后续按钮：`
      busyLabel: '正在启动…',
      when: { minSelection: 1, maxSelection: 1, feedback: 'empty' },
      completion: 'lock-card',
    },
    {
      id: 'regenerate-selection',
      capability: 'regenerate',
      label: '按意见调整所选结果',
      busyLabel: '正在重新生成…',
      when: { minSelection: 1, maxSelection: 1, feedback: 'present' },
      completion: 'keep-active',
    },
    {
      id: 'regenerate-all',
      capability: 'regenerate',
      label: '按意见全部重生',
      busyLabel: '正在重新生成…',
      when: { maxSelection: 0, feedback: 'present' },
      completion: 'keep-active',
    },
    ...REVIEW_SIDE_ACTIONS,
  ],
  feedback: {
    label: '调整意见（可选）',
    placeholder: '不选择：整轮按意见重生；选择后：只调整所选结果',
  },
};

/**
 * Generic multi-select review preset.
 * - At least one item must be selected; the flow may set an upper bound.
 * - Same regenerate/feedback pattern as single-select.
 */
const MULTI_SELECT_PRESET: WorkflowResultPresetDefinition = {
  selection: { mode: 'multiple', min: 1 },
  capabilities: ['select', 'comment', 'edit', 'regenerate', 'evaluate', 'continue'],
  actions: [
    {
      id: 'continue',
      capability: 'continue',
      label: '继续',           // overridden per-flow via `- 后续按钮：`
      busyLabel: '正在启动…',
      when: { minSelection: 1, feedback: 'empty' },
      completion: 'lock-card',
    },
    {
      id: 'regenerate-selection',
      capability: 'regenerate',
      label: '按意见调整所选结果',
      busyLabel: '正在重新生成…',
      when: { minSelection: 1, feedback: 'present' },
      completion: 'keep-active',
    },
    {
      id: 'regenerate-all',
      capability: 'regenerate',
      label: '按意见全部重生',
      busyLabel: '正在重新生成…',
      when: { maxSelection: 0, feedback: 'present' },
      completion: 'keep-active',
    },
    ...REVIEW_SIDE_ACTIONS,
  ],
  feedback: {
    label: '调整意见（可选）',
    placeholder: '不选择：整轮按意见重生；选择后：只调整所选结果',
  },
};

export const WORKFLOW_RESULT_PRESETS: Record<
  WorkflowResultPresetId,
  WorkflowResultPresetDefinition
> = {
  'single-select': SINGLE_SELECT_PRESET,
  'multi-select': MULTI_SELECT_PRESET,
  'gr-single-select': SINGLE_SELECT_PRESET,
  'gr-multi-select': MULTI_SELECT_PRESET,
};

/** Returns the preset for the given id, or null if unknown. */
export function resolveWorkflowResultPreset(
  id: string,
): WorkflowResultPresetDefinition | null {
  return (WORKFLOW_RESULT_PRESETS as Record<string, WorkflowResultPresetDefinition>)[id] ?? null;
}

/** All valid preset ids, for diagnostics that need to list the allowed values. */
export function listWorkflowResultPresetIds(): string[] {
  return Object.keys(WORKFLOW_RESULT_PRESETS);
}

/**
 * Maps an MD boolean flag label to the capabilities it controls.
 *
 * Used by the markdown compiler so that a flow using a preset can still turn a
 * single capability on or off (e.g. `- 支持评测：否`) instead of the flag being
 * silently ignored. `支持反馈` intentionally controls two capabilities because
 * the feedback textarea and the regenerate actions ship together.
 */
export const WORKFLOW_RESULT_CAPABILITY_FLAGS: ReadonlyArray<{
  label: string;
  capabilities: ResultCapability[];
}> = [
  { label: '支持编辑', capabilities: ['edit'] },
  { label: '支持反馈', capabilities: ['comment', 'regenerate'] },
  { label: '支持评测', capabilities: ['evaluate'] },
  { label: '支持后续', capabilities: ['continue'] },
  { label: '支持下载', capabilities: ['download'] },
  { label: '支持导出', capabilities: ['export'] },
  { label: '支持发布', capabilities: ['publish'] },
];
