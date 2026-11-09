/**
 * 过程组件（Process Result）的数据契约与纯逻辑。
 *
 * 「过程组件」承载的是 AI 分轮产出候选、用户逐项评审并推进下一阶段这一类节点，
 * 适用于创意评审、话题方案、产品句等候选评审阶段。单份交付文档不在其列——它没有轮次、
 * 没有候选项，动作是导出与上传，属于交付节点，硬套进来只会把契约撑成四不像。
 *
 * 设计原则：
 * 1. 组件只认 contract 和 item model，不认任何具体阶段。想知道某阶段长什么样，
 *    看它的 `<flowId>_flow.md`，不要在组件里找 if。
 * 2. 阶段差异全部收敛成配置字段，其中唯一的结构性差异是「推进方式」：
 *    逐项推进（创意→话题、话题→产品句，每张卡一个按钮）
 *    批量推进（产品句→正文，多选后底部一个按钮）。
 * 3. 纯逻辑留在本文件，便于 node:test 直接单测，不必渲染 React。
 */

export type ProcessResultStatus = 'idle' | 'generating' | 'ready' | 'error';

export type ProcessResultRound<TItem> = {
  id: string;
  number: number;
  items: TItem[];
};

/** 选择语义。none＝不选，single＝逐项推进天然单选，multiple＝勾选后批量推进。 */
export type ProcessResultSelection = {
  mode: 'none' | 'single' | 'multiple';
  min?: number;
  max?: number;
  /**
   * 多选时行右侧那枚按钮的两个态文案，如「选入」/「已选」。
   *
   * 走配置而不是写死中文：这枚按钮跟推进按钮（advance.label）是同一个位置、
   * 同一套样式，推进文案既然由 MD 决定，选择文案没有理由例外。缺省值在
   * processSelectLabels 里兜底，MD 没配也不会出现空按钮。
   */
  selectLabel?: string;
  selectedLabel?: string;
};

/** 多选按钮的两态文案，MD 没配时给一组通用兜底。 */
export function processSelectLabels(
  selection: ProcessResultSelection,
): { select: string; selected: string } {
  return {
    select: selection.selectLabel?.trim() || '选入',
    selected: selection.selectedLabel?.trim() || '已选',
  };
}

export type ProcessResultCapabilities = {
  /** 单项可进编辑器 */
  edit: boolean;
  /** 单项可写改进意见 */
  itemFeedback: boolean;
  /** 整轮可重生 */
  roundRegenerate: boolean;
  /** 显示本轮评测卡 */
  evaluate: boolean;
  /** 标题栏显示「流程」按钮 */
  knowledge: boolean;
  /** 可推进到下一阶段 */
  advance: boolean;
};

/**
 * 推进方式。这是三个阶段唯一的结构性差异，必须显式配置，
 * 不能靠 selection.mode 反推——「多选」和「批量推进」是两件事，
 * 将来完全可能出现多选之后仍逐项推进的阶段。
 */
export type ProcessResultAdvance = {
  mode: 'per-item' | 'batch';
  /** 首次推进的按钮文案 */
  label: string;
  /** 已推进过之后的按钮文案（逐项推进用于区分「已出话题」的卡） */
  repeatLabel: string;
  /** 批量推进时底部的选择约束提示，如「至少保留 1 项」 */
  hint: string;
  /** 批量推进按钮进行中的文案 */
  pendingLabel: string;
};

/** 单项要展示的字段。key 对应产出 JSON 的字段名，label 是卡面文案。 */
export type ProcessResultFieldSpec = {
  key: string;
  label: string;
};

export type ProcessResultContract = {
  stageId: string;
  /**
   * 英文眉标，如 CREATIVE REVIEW。卡面已不再渲染——它是标题的英文重复，
   * 节点类型看中文标题就知道，一枚大写胶囊白占一行还先抢走视线。
   * 字段保留是因为 MD 里已经写了，也可能被别处（导出、日志）引用。
   */
  eyebrow: string;
  title: string;
  itemLabel: string;
  loadingLabel: string;
  roundDisplay: 'all-expanded' | 'latest-expanded';
  selection: ProcessResultSelection;
  capabilities: ProcessResultCapabilities;
  /** 单项标题取哪个字段 */
  titleField: string;
  /** 单项摘要（大段正文）取哪个字段，空＝不展示摘要 */
  summaryField: string;
  /** 单项标题行右侧徽标取哪个字段，如话题赛道、产品类型 */
  badgeField: string;
  /** 单项要展示的附加字段及其中文标签，按配置顺序渲染 */
  fields: ProcessResultFieldSpec[];
  advance: ProcessResultAdvance;
};

/**
 * 单项的统一展示模型。
 *
 * 各阶段把自己的原始数据（CreativeCard / TopicItem / ProductItem）映射成这个形状，
 * 组件只渲染它。这是「通用」的真正落点：早先版本只统一了卡片外壳，单项内容
 * 三个阶段各写一遍，改一次配色要改三处，抽象等于没做。
 */
export type ProcessResultItemModel = {
  /** 稳定标识，用于选择集合与 React key */
  id: string;
  /** 序号徽标，如「方向 A」「产品 B」。卡面不再展示，保留给无障碍标注与调试。 */
  seqLabel: string;
  /**
   * 行首数字序号（1 起）。
   *
   * 卡面从「方向 A / 产品 B」胶囊改成了文档列表的数字行号，所以展示层要的是
   * 数字本身，而不是从 seqLabel 里反解字母——反解在超过 26 项时必然出错。
   */
  ordinal: number;
  title: string;
  /** 大段正文摘要 */
  summary?: string;
  /** 标题行右侧的分类徽标，如话题赛道、产品类型 */
  badge?: string;
  /** 血缘说明，如「衍生 · 方向 A」 */
  lineage?: string;
  fields: Array<{ label: string; value: string }>;
  /** 用户已写的改进意见 */
  feedback?: string;
  /** 是否已推进过下一阶段 */
  produced?: boolean;
  /** 已推进的状态文案，如「已出话题」 */
  producedLabel?: string;
};

/**
 * 轮次归一：剔除脏轮次并按轮号倒序（最新在最上）。
 *
 * 会被剔除的情况都是真实踩过的：轮号非法（后端补号失败）、
 * 空轮次（Action 提交了但卡片写盘失败）、id 重复（同一轮渲染两次导致选择态串台）。
 */
export function normalizeProcessRounds<TItem>(
  rounds: ProcessResultRound<TItem>[],
): ProcessResultRound<TItem>[] {
  const seen = new Set<string>();
  return [...rounds]
    .filter(round => {
      if (
        !round.id
        || !Number.isFinite(round.number)
        || round.number < 0
        || round.items.length === 0
        || seen.has(round.id)
      ) {
        return false;
      }
      seen.add(round.id);
      return true;
    })
    .sort((left, right) => right.number - left.number);
}

export function processRoundLabel(
  round: Pick<ProcessResultRound<unknown>, 'number' | 'items'>,
  itemLabel: string,
): string {
  const label = itemLabel.trim() || '候选';
  return `第 ${round.number} 轮 · ${round.items.length} 个${label}`;
}

/** 序号徽标：A..Z 用完之后退回数字，避免第 27 项显示成乱码字符。 */
export function processSeqLabel(itemLabel: string, index: number): string {
  const label = itemLabel.trim() || '候选';
  const suffix = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
  return `${label} ${suffix}`;
}

/**
 * 按契约把产出对象摊成要展示的字段列表。
 *
 * 只认 contract.fields 声明过的键，且空值直接不出行——卡面上留一排「—」
 * 比少一行更难读。字段标签来自 MD，改 MD 即改卡面，代码里不留中文字面量。
 */
export function processItemFields(
  source: Record<string, unknown>,
  fields: ProcessResultFieldSpec[],
): Array<{ label: string; value: string }> {
  return fields.flatMap(field => {
    const raw = source[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value ? [{ label: field.label || field.key, value }] : [];
  });
}

/**
 * 摊出契约没声明、但模型确实产出了的额外字符串字段。
 *
 * 保留这个能力是有意的：MD 加了产出字段却忘了配展示时，内容仍然看得见，
 * 不会静默丢数据。已被 contract 消费掉的键和内部簿记键（下划线前缀）必须排除，
 * 否则同一份内容会在卡上出现两次。
 */
export function processItemExtraFields(
  source: Record<string, unknown>,
  contract: Pick<ProcessResultContract, 'titleField' | 'summaryField' | 'badgeField' | 'fields'>,
  reserved: readonly string[],
): Array<{ label: string; value: string }> {
  const consumed = new Set<string>([
    contract.titleField,
    contract.summaryField,
    contract.badgeField,
    ...contract.fields.map(field => field.key),
    ...reserved,
  ].filter(Boolean));
  return Object.entries(source).flatMap(([key, raw]) => {
    if (consumed.has(key) || key.startsWith('_')) return [];
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value ? [{ label: key, value }] : [];
  });
}

/** 批量推进的选择是否满足契约约束。 */
export function isSelectionValid(
  selectedCount: number,
  selection: ProcessResultSelection,
): boolean {
  if (selection.mode === 'none') return true;
  const min = selection.min ?? 1;
  if (selectedCount < min) return false;
  if (selection.max != null && selectedCount > selection.max) return false;
  return true;
}

/** 批量推进底部的计数文案。 */
export function selectionSummary(
  selectedCount: number,
  total: number,
  hint: string,
): string {
  const tail = hint.trim() ? ` · ${hint.trim()}` : '';
  return `已选 ${selectedCount}/${total}${tail}`;
}
