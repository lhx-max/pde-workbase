import type { ContinueGenerateParams } from './ImageAssetNode';
import { cr } from '../locales/canvas-remainder';

export function storyboardVersionAttachments(path: string, params: ContinueGenerateParams) {
  return [...new Map([{ name: cr().currentVersion, path, mimeType: 'image/png', size: 0 }, ...(params.references || [])].map(ref => [ref.path, ref])).values()];
}

/** Persist the exact owner binding before dispatch; never silently fall back to a loose image. */
export async function submitStoryboardVersion(deps: {
  valid: (generationId?: string) => boolean;
  create: () => string;
  bind: (generationId: string) => void;
  persist: () => Promise<void>;
  submit: (generationId: string) => Promise<void>;
}) {
  if (!deps.valid()) throw new Error(cr().assetChangedReopen);
  const id = deps.create();
  deps.bind(id);
  await deps.persist();
  if (!deps.valid(id)) throw new Error(cr().targetDeleted);
  await deps.submit(id);
}
