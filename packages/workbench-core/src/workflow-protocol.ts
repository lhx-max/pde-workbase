/**
 * Workflow 协议：注册表、卡片形状描述、运行时调度规格。
 *
 * 这是工作流系统的「单一真源」层：
 *
 *   输入          — 收集用户输入，由聊天区的澄清卡（WorkflowClarificationCard）承担；
 *                   契约类型见 plan-flow-contract.ts 的 InputCardContract
 *   ProcessCard   — 过程卡，记录流程步骤进展（目前以 PlanFlowStep 驱动）
 *   ResultCard    — 候选结果卡；shape=list 时分轮出候选，shape=object 时单份交付文档
 *
 * 三种卡片的契约与调度规则全在本文件声明，XyFlowCanvas 和 Workbench 的
 * 具体实现照着这里的类型走，不要在各自文件里再抄一份。
 */

// ─── 1. 结果卡形状 ─────────────────────────────────────────────────────────

/**
 * `list`  — 一轮多个候选（创意/话题/产品句）：ProcessResultCard 渲染。
 * `object` — 单份交付文档（方案正文）：ArticleReviewNode / 自定义渲染器。
 */
export type ResultCardShape = 'list' | 'object';

// ─── 2. 卡片能力声明 ────────────────────────────────────────────────────────

/**
 * 结果卡的能力集合。
 *
 * 这是 PlanFlowResult.capabilities 的通用化形式；
 * 外部工作流只需声明这些字段，不需要知道具体业务模块的字段结构。
 */
export type ResultCardCapabilities = {
  /** 单项可写改进意见 */
  itemFeedback: boolean;
  /** 整轮可重生 */
  roundRegenerate: boolean;
  /** 单项可进编辑器 */
  edit: boolean;
  /** 内联评测卡 */
  evaluation: boolean;
  /** 标题栏展示「流程」跳转按钮 */
  knowledge: boolean;
  /** 推进到下一阶段 */
  next: boolean;
};

// ─── 3. 阶段边规格 ─────────────────────────────────────────────────────────

/**
 * 描述「哪个节点出现后，画布上应该自动连线到哪个目标节点」。
 *
 * 这是运行时调度的协议约定：
 * - `sourceNodeId` — 上游节点 id（已完成某步）
 * - `targetNodeId` — 下游节点 id（应激活的卡）
 * - `condition`    — 可选；只有满足条件时才创建连线
 *
 * Workbench 的 `useEffect` 读取 `WorkflowEdgeSpec[]` 统一处理连线，
 * 不再各阶段各写一个 effect。
 */
export type WorkflowEdgeSpec = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** 当 condition 返回 false 时不创建（但也不删除已有的）连线 */
  condition?: boolean;
};

// ─── 4. 工作流注册表 ────────────────────────────────────────────────────────

/**
 * 单阶段节点描述：一个流程阶段对应一张结果卡。
 *
 * `stageId`      — 阶段标识，与 ProcessResultContract.stageId 对应
 * `nodeId`       — 画布节点 id
 * `shape`        — 该阶段产出的形状
 * `flowId`       — 驱动本阶段的流程 MD 的 id（`/api/plan-flow?flow=<flowId>`）
 * `nextFlowId`   — 下一阶段的流程 id，用于「流程」按钮；末尾阶段为空串
 */
export type WorkflowStageDescriptor = {
  stageId: string;
  nodeId: string;
  shape: ResultCardShape;
  flowId: string;
  nextFlowId: string;
};

/**
 * 工作流注册表：描述从输入卡到最终交付的完整阶段链路。
 *
 * 注意这是「类型注册」，不是「实例注册」：
 * 每条运行中的工作流（每张方案卡实例）按此模板派生出具体的节点 id 和连线。
 *
 * 产品只需提供流程定义并在服务端注册，前端通过 `stages` 动态解析，无需改代码。
 */
export type WorkflowDefinition = {
  /** 工作流标识（对应产品提供的定义 id，如 `research`） */
  id: string;
  title: string;
  description: string;
  /**
   * 阶段链路，按顺序排列。
   * 第 0 项是输入卡提交后的第一个结果阶段（创意/等价物）。
   */
  stages: WorkflowStageDescriptor[];
};

// ─── 5. 运行时调度：连线规格生成 ────────────────────────────────────────────

/**
 * 从工作流定义和当前实例状态推导出「应该存在的连线集合」。
 *
 * Workbench 只需把返回值和当前 edges 做 diff，补加缺失的、删除多余的，
 * 不再需要四个独立的 useEffect 各自写一套 「if…push edge」逻辑。
 *
 * @param instanceId  方案卡的实例 id
 * @param entryNodeId 方案卡节点 id（连线的最上游）
 * @param stages      由 resolveWorkflowStages() 派生出的阶段描述列表，
 *                    已经挂载了 condition（是否应该出现该节点）
 */
export function resolveWorkflowEdgeSpecs(
  instanceId: string,
  entryNodeId: string,
  stages: Array<WorkflowStageDescriptor & { active: boolean }>,
): WorkflowEdgeSpec[] {
  void instanceId;
  const specs: WorkflowEdgeSpec[] = [];
  let prevNodeId = entryNodeId;

  for (const stage of stages) {
    if (!stage.active) break;           // 阶段未激活则停止向后推
    specs.push({
      id: `auto-${prevNodeId}-${stage.stageId}`,
      sourceNodeId: prevNodeId,
      targetNodeId: stage.nodeId,
      condition: stage.active,
    });
    prevNodeId = stage.nodeId;
  }
  return specs;
}

/**
 * 把 `WorkflowEdgeSpec[]` 和当前 edges 做 diff，返回需要「追加」的边 id 集合。
 *
 * 调用方把 returned specs 全部 push 进 edges 即可，已有的不会重复添加。
 */
export function diffWorkflowEdges(
  specs: WorkflowEdgeSpec[],
  existingEdgeIds: Set<string>,
): WorkflowEdgeSpec[] {
  return specs.filter(spec => spec.condition !== false && !existingEdgeIds.has(spec.id));
}
