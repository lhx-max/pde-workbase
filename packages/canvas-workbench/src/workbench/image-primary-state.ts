import type { WorkbenchImage } from './ImageAssetNode';

/**
 * 把改造前落成独立节点的“首代生成图”迁回视觉母卡。
 *
 * 每张母卡只吸收一张：优先最后一张已完成图片；继续生成的子图和参考图组
 * 结果保留在画布上。无迁移时返回原数组，避免触发无意义持久化。
 */
export function embedLegacyPrimaryImages(
  images: WorkbenchImage[],
  visualInstanceIds: Iterable<string>,
): WorkbenchImage[] {
  const preferredBySource = new Map<string, string>();
  for (const instanceId of visualInstanceIds) {
    const roots = images.filter(image => (
      image.sourceInstanceId === instanceId
      && !image.parentImageId
      && !image.parentGroupId
      && (image.assetKind === 'generated' || Boolean(image.taskId || image.slotId))
    ));
    if (!roots.length || roots.some(image => image.embeddedInSource)) continue;
    const preferred = [...roots].reverse().find(image => (
      image.status === 'ready' && Boolean(image.path || image.src)
    )) || roots[0];
    if (!preferred) continue;
    preferredBySource.set(instanceId, preferred.id);
  }
  if (!preferredBySource.size) return images;
  return images.map(image => (
    image.sourceInstanceId && preferredBySource.get(image.sourceInstanceId) === image.id
      ? { ...image, embeddedInSource: true }
      : image
  ));
}
