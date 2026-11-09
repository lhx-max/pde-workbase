/**
 * 步骤取舍 —— 这一次派单跑哪几步。
 *
 * 和知识勾选（knowledge-selection.ts）刻意做成同一套形状：都存在
 * localStorage、都按 flowId 分桶、都用事件广播变更。用户在同一张卡上
 * 勾知识和勾步骤，两者行为不一致会很别扭。
 *
 * 但有一条关键区别：**知识可以全关，步骤不能**。少一份知识只是判断依据
 * 变少，产出还在；少了落盘那一步就什么都不会留下，而界面上完全看不出
 * 「这次白跑了」。所以这里对能不能跳做硬性判断，不交给用户。
 */

const STORAGE_KEY = 'gr:flow-step-selection';

/** 存的是「被跳过的步骤 id」，不是「启用的」。
 *
 * 反过来存会有一个静默失效：MD 里新增一步时，旧的启用清单里没有它，
 * 于是新步骤默认被跳过——改了 MD 却不生效，且没有任何提示。
 * 存跳过清单则新步骤天然参与，符合「MD 是真值」的约定。
 */
type SkipMap = Record<string, string[]>;

export type StepActor = 'AI' | 'Action' | 'Eval';

export type SelectableStep = {
  id: string;
  title: string;
  actor: StepActor;
  /** 这一步挂的知识 id，跳过时要一并从预取清单里摘掉 */
  knowledgeIds?: string[];
};

/**
 * 把契约里宽松的 `actor: string` 收成三种执行者之一。
 *
 * 认不出的值一律当 `Action`，而不是当 `AI`：
 * 后端强校验只允许这三种，能走到前端的未知值意味着契约层出了问题。
 * 此时按最保守的方式处理——`Action` 不可跳过，用户不会误以为
 * 一个来历不明的步骤可以被安全略过。
 */
export function toStepActor(actor: string): StepActor {
  return actor === 'AI' || actor === 'Eval' ? actor : 'Action';
}

function readMap(): SkipMap {
  // 显式判断宿主环境，而不是靠 catch 兜住 `window is not defined`。
  //
  // 这个模块被 configured-flow-execution 依赖，而后者在 Node 测试里被直接
  // 调用（没有 window）。靠异常兜住能跑，但那是运气：任何人把 catch 收窄或
  // 改成只捕 JSON 错误，测试就会集体炸，且报错指向存储而不是宿主环境。
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as SkipMap;
  } catch {
    // 存储被手改坏或跨版本格式变化时，退回「一步都不跳」这个安全默认，
    // 不能抛——抛在渲染路径上会让整张流程卡白掉。
    return {};
  }
}

/**
 * 这一步能不能被跳过。
 *
 * - `Action`：唯一会落盘的一步。跳了这一步，AI 生成的东西无处可去，
 *   用户看到「跑完了」但 CASE 里什么都没有。永不允许。
 * - `Eval`：本来就不进派单，由自动评测开关控制，这里没有可勾的语义。
 * - `AI`：允许跳。但如果全流程只剩它一步 AI 步骤，跳了就没人产出内容，
 *   Action 会收到空结果。所以还要看剩余数量，见 `canSkipStep`。
 */
export function isSkippableActor(actor: SelectableStep['actor']): boolean {
  return actor === 'AI';
}

/**
 * 在当前跳过清单的前提下，某一步是否还能被跳过。
 *
 * 除了执行者本身要允许，还必须保证**至少留下一个 AI 步骤**：
 * 一个 AI 步骤都不剩时，Action 拿不到任何生成内容，提交必然失败，
 * 而失败点在最后一步，用户很难反推是自己前面全跳了。
 */
export function canSkipStep(steps: SelectableStep[], stepId: string, skipped: string[]): boolean {
  const target = steps.find(step => step.id === stepId);
  if (!target || !isSkippableActor(target.actor)) return false;
  const skippedSet = new Set(skipped);
  if (skippedSet.has(stepId)) return true; // 已经跳过的，允许再取消跳过
  const remaining = steps.filter(
    step => step.actor === 'AI' && step.id !== stepId && !skippedSet.has(step.id),
  );
  return remaining.length > 0;
}

/** 本次被跳过的步骤 id，已按 MD 顺序过滤掉不该存在的残留。 */
export function skippedStepIds(flowId: string, steps: SelectableStep[]): string[] {
  const saved = readMap()[flowId];
  if (!Array.isArray(saved)) return [];
  const known = new Map(steps.map(step => [step.id, step]));
  // 双重过滤：
  //   1. MD 里已经删掉的步骤 id 要丢弃，否则残留会一直挂在存储里；
  //   2. 执行者改成 Action 的步骤要恢复执行——不能因为历史上它是 AI
  //      并被跳过，就让现在的落盘步骤继续被跳掉。
  return steps
    .filter(step => saved.includes(step.id) && isSkippableActor(known.get(step.id)!.actor))
    .map(step => step.id);
}

export function setStepSkipped(
  flowId: string,
  stepId: string,
  skipped: boolean,
  steps: SelectableStep[],
): void {
  const current = new Set(skippedStepIds(flowId, steps));
  if (skipped) {
    // 不可跳的步骤直接忽略，不写入存储：写进去再靠读取时过滤，
    // 会在存储里留下一条永远生效不了的记录，排查时极具误导性。
    if (!canSkipStep(steps, stepId, [...current])) return;
    current.add(stepId);
  } else {
    current.delete(stepId);
  }
  const next = {
    ...readMap(),
    // 按 MD 顺序存，保证不同浏览器读出来的顺序一致
    [flowId]: steps.filter(step => current.has(step.id)).map(step => step.id),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('gr:step-selection-changed', {
    detail: { flowId, skippedIds: next[flowId] },
  }));
}

/**
 * 跳过的步骤所挂的知识 id。
 *
 * 这是本模块存在的第二个理由：跳了某一步，它的知识就不该再预取。
 * 不摘掉的话，用户跳掉「结构化分析」却仍然为它拉了 5700 字的规则，
 * 白花时间和 token，而界面上只显示「已跳过」，看不出还在读。
 */
export function knowledgeIdsOfSkippedSteps(flowId: string, steps: SelectableStep[]): string[] {
  const skipped = new Set(skippedStepIds(flowId, steps));
  return steps
    .filter(step => skipped.has(step.id))
    .flatMap(step => step.knowledgeIds || []);
}
