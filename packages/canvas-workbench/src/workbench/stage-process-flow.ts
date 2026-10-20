/**
 * 各阶段流程 id 的解析 + 工作流阶段链路的通用推导。
 *
 * 阶段链路的真值在流程 MD 里：每份 `<flowId>_flow.md` 的 cr().followFlow 字段声明
 * 下一阶段是谁。这里顺着已加载的契约把链路走出来，而不是把 'plan_topic'
 * 这类阶段名写死在前端——写死的话，改 MD 换阶段顺序前端不会跟着变，
 * 卡片就会拿错阶段的字段配置。
 *
 * 下面的常量只作为契约尚未加载完成时的兜底（首帧、或某份 MD 解析失败），
 * 不是真值来源。
 */
export const STAGE_PROCESS_FLOW_IDS = {
  topic: 'plan_topic',
  product: 'plan_product',
  article: 'plan_article',
} as const;

type FlowLike = {
  id?: string;
  result?: { next?: { flowId?: string } };
};

/**
 * 从入口流程沿 `result.next.flowId` 走 n 步，得到下游第 n 个阶段的流程 id。
 *
 * @param configs 已加载的契约表，键是流程 id
 * @param entryFlowId 入口流程 id（方案卡的 flowId）
 * @param depth 往下走几步：1＝话题，2＝产品句，3＝正文
 * @param fallback 链路还没加载出来时用的兜底 id
 */
export function resolveStageFlowId(
  configs: Record<string, FlowLike | undefined>,
  entryFlowId: string,
  depth: number,
  fallback: string,
): string {
  let current = configs[entryFlowId];
  let flowId = '';
  const seen = new Set<string>();
  for (let step = 0; step < depth; step += 1) {
    const next = current?.result?.next?.flowId || '';
    // 环形配置（A→B→A）会让这里无限打转，撞到重复即放弃走链，退回兜底。
    if (!next || seen.has(next)) return fallback;
    seen.add(next);
    flowId = next;
    current = configs[next];
  }
  return flowId || fallback;
}

/**
 * 取某份流程的**下一阶段**流程 id，没有下一阶段时返回空串。
 *
 * 这是给结果卡「流程」按钮用的：卡片展示的是接下来会跑什么流程，
 * 而不是产出自己的那份（否则创意卡和方案输入卡会显示同一份 plan_analysis）。
 *
 * 和 `resolveStageFlowId` 的关键区别是**不做兜底**：
 * - 链路真的到头了（正文交付，MD 的 cr().followFlow 为空）→ 返回 ''，按钮不渲染；
 * - 契约还没加载完 → 也返回 ''，按钮先不出现，等加载好自己会出来。
 *
 * 这里绝不能退回兜底常量，否则正文卡会挂上一个指向别人的流程。
 *
 * @param configs 已加载的契约表，键是流程 id
 * @param flowId 当前阶段的流程 id
 */
export function resolveNextStageFlowId(
  configs: Record<string, FlowLike | undefined>,
  flowId: string,
): string {
  if (!flowId) return '';
  const next = configs[flowId]?.result?.next?.flowId || '';
  // 自指（A 的后续写成 A）会让卡片显示自己的流程，等于没改，直接判无效。
  return next && next !== flowId ? next : '';
}
