import { nativeImageModelId } from '@bezier/contracts';
import type { VisualModel } from './model/canvas-domain';
import { isCanvasMediaProviderEnabled } from '../platform/media-policy';
import { getCanvasMediaSnapshot, type CanvasMediaSnapshot } from '../platform/media-catalog';

export function isVisualModelEnabled(model: string): boolean {
  if (model === 'gpt2' || model === 'gemini') return false;
  const entry = getCanvasMediaSnapshot().image.find(item => item.id === model);
  return Boolean(entry && isCanvasMediaProviderEnabled(entry.provider));
}

export function defaultVisualModel(): VisualModel {
  return resolveVisualModelSelection(undefined, getCanvasMediaSnapshot());
}

/** Select from discovered models before submission; keep a usable explicit choice. */
export function resolveVisualModelSelection(
  current: string | undefined,
  catalog: CanvasMediaSnapshot,
): VisualModel {
  if (!catalog.ready || !catalog.image.length) return current || 'codex-gpt2';
  if (catalog.image.some(model => model.id === current)) return current!;
  return (catalog.image.find(model => model.default) ?? catalog.image[0]!).id;
}

/** Shared media endpoint IDs for the existing visual picker choices. */
export function visualModelToNativeMediaModel(model: VisualModel): string {
  if (!isVisualModelEnabled(model)) throw new Error('This media provider is disabled by the product configuration');
  return nativeImageModelId(model);}

/** Preserve the source's billing/provider choice; availability and auth errors
 * belong to submission, never to a silent provider fallback here. Historical
 * images without a recognized source use the current card's visible choice. */
export function resolveCompanionVisualModel(
  sourceModel: string | undefined,
  visibleModel: VisualModel,
): VisualModel {
  if (sourceModel?.trim()) return sourceModel;
  return visibleModel;
}
