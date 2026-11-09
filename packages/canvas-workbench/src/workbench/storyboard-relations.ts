import type { StoryboardAsset } from '@bezier/contracts';
import type { StoryboardShot } from './storyboard-card';

export type StoryboardRelationTarget = { kind: 'shot' | 'asset'; id: string; variantId?: string };
export type StoryboardRelationFocus = StoryboardRelationTarget & { storyboardId: string };

export function shotAssetRefs(shot: StoryboardShot) {
  return [...(shot.characters || []), ...(shot.scene ? [shot.scene] : [])];
}

/** Resolve default variants before matching, so another costume is never highlighted as the same reference. */
export function relatedStoryboardShots(shots: StoryboardShot[], assets: StoryboardAsset[], target?: StoryboardRelationTarget) {
  if (!target) return [];
  return shots.filter(shot => target.kind === 'shot' ? shot.id === target.id : shotAssetRefs(shot).some(ref => (
    ref.assetId === target.id && (!target.variantId || (ref.variantId || assets.find(a => a.id === ref.assetId)?.variants[0]?.id) === target.variantId)
  )));
}

export function storyboardRelationAssetIds(shots: StoryboardShot[], assets: StoryboardAsset[], target?: StoryboardRelationTarget) {
  if (!target) return [];
  return target.kind === 'asset' ? [target.id] : [...new Set(relatedStoryboardShots(shots, assets, target).flatMap(shot => shotAssetRefs(shot).map(r => r.assetId)))];
}

/** Only scroll the list, never the browser or canvas camera. Called on explicit navigation, not hover. */
export function revealStoryboardRelation(container: HTMLElement, selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) return;
  const bounds = container.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  const scale = bounds.height / (container.offsetHeight || bounds.height || 1);
  const visibleTop = container.querySelector('.storyboard-shot-grid-head')?.getBoundingClientRect().bottom || bounds.top;
  const offset = target.top < visibleTop ? target.top - visibleTop : target.bottom > bounds.bottom ? target.bottom - bounds.bottom : 0;
  container.scrollTop += offset / (scale || 1);
}
