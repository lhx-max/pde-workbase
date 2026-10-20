type InheritableVisualDraft = {
  models?: readonly string[];
  visualBusiness?: string;
  imageCount?: number;
  imageRatio?: string;
  imageRatios?: readonly string[];
  imageResolution?: string;
};

export function resolveConnectedVisualSourceDraft<T>(
  drafts: Readonly<Record<string, T>>,
  sourceId: string,
  sourceInstanceId?: string,
): T | undefined {
  return drafts[sourceId] ?? (sourceInstanceId ? drafts[sourceInstanceId] : undefined);
}

/**
 * 通过图片卡右侧加号创建子图片卡时，继承母卡底部可见的生图设置。
 * 提示词、任务状态和资产选择等一次性状态不属于子卡初始设置，不在这里复制。
 */
export function inheritConnectedVisualDraftSettings<T extends InheritableVisualDraft>(
  source: T | undefined,
): Partial<T> {
  if (!source) return {};

  const inherited: Partial<T> = {};
  if (source.models?.length) inherited.models = [...source.models] as T['models'];
  if (source.visualBusiness) inherited.visualBusiness = source.visualBusiness as T['visualBusiness'];
  if (source.imageCount) inherited.imageCount = source.imageCount as T['imageCount'];
  if (source.imageRatio) inherited.imageRatio = source.imageRatio as T['imageRatio'];
  if (source.imageRatios?.length) inherited.imageRatios = [...source.imageRatios] as T['imageRatios'];
  if (source.imageResolution) inherited.imageResolution = source.imageResolution as T['imageResolution'];
  return inherited;
}
