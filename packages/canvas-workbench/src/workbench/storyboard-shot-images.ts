import type { StoryboardShot, StoryboardFrame } from './storyboard-card';
import type { WorkbenchImage } from './ImageAssetNode';
import { cr } from '../locales/canvas-remainder';

export type StoryboardFrameRole = 'first' | 'last';
export function storyboardFrame(shot: StoryboardShot, role: StoryboardFrameRole = 'first'): StoryboardFrame {
  return role === 'last' ? shot.tailFrame || {} : shot;
}
export function patchStoryboardFrame(shot: StoryboardShot, role: StoryboardFrameRole, patch: Partial<StoryboardFrame>): StoryboardShot {
  return role === 'last' ? { ...shot, tailFrame: { ...shot.tailFrame, ...patch } } : { ...shot, ...patch };
}
export function storyboardVideoFrames(shot: StoryboardShot, images: WorkbenchImage[]) {
  const first = selectedStoryboardShotImage(shot, images);
  const last = shot.tailFrame ? selectedStoryboardShotImage(shot.tailFrame, images) : undefined;
  if (!first?.path || (shot.tailFrame && !last?.path)) throw new Error(cr().needFirstLast);
  return { mode: shot.tailFrame ? 'firstlast' as const : 'i2v' as const, images: last ? [first, last] : [first] };
}
export function storyboardShotImages(shot: StoryboardFrame, images: WorkbenchImage[]) {
  const sources = new Set([shot.imageNodeId, ...(shot.imageNodeHistoryIds || [])].filter(Boolean));
  return images.filter(image => image.sourceInstanceId && sources.has(image.sourceInstanceId));
}

export function selectedStoryboardShotImage(shot: StoryboardFrame, images: WorkbenchImage[]) {
  const ready = storyboardShotImages(shot, images).filter(image => image.path && image.status !== 'generating' && image.status !== 'failed');
  return ready.find(image => image.path === shot.selectedImagePath) || ready.at(-1);
}
