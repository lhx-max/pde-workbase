// Adapted from upstream 319e5eee WorkspaceAssetPicker; source ports replace product stores.
import type { PersonalAsset } from '@bezier/contracts';
import type { AssetLibraryAdapter } from '../../providers/asset-library';
export const PICKER_MEDIA_LIMIT = 200 * 1024 * 1024;
export const PICKER_TEXT_LIMIT = 2 * 1024 * 1024;
export function pickerKind(asset: PersonalAsset): string {
  const type = asset.versions.at(-1)?.filename === 'template-prompt.md' ? asset.source.template?.type : undefined;
  return ({ Slides: 'slides', Prototype: 'webpage', Image: 'image', Video: 'video', HyperFrames: 'webpage', Audio: 'audio' } as Record<string, string>)[type ?? ''] || asset.kind;
}
/** Both the record revision and the complete current version must still match.
 * A read of an old, individually addressable version is not fresh authorization. */
export async function validatePickerSelection(adapter: AssetLibraryAdapter, selected: readonly PersonalAsset[], signal: AbortSignal): Promise<PersonalAsset[]> {
  signal.throwIfAborted();
  return Promise.all(selected.map(async before => {
    const { asset } = await adapter.get(before.id, signal);
    signal.throwIfAborted();
    if (!asset || asset.id !== before.id || asset.deletedAt || asset.kind === 'folder' || !asset.versions.at(-1)) throw new Error('assetPicker.selectionGone');
    if (asset.revision !== before.revision || JSON.stringify(asset.versions.at(-1)) !== JSON.stringify(before.versions.at(-1))) throw new Error('assetPicker.selectionUpdated');
    return asset;
  }));
}
export function validatePickerUpload(files: readonly File[], kinds: readonly string[], single: boolean) {
  if (files.some(file => !kinds.some(kind => file.type.startsWith(`${kind}/`)))) throw new Error('entry.workspacePicker.uploadUnsupported');
  if (single && files.length > 1) throw new Error('entry.workspacePicker.singleOnly');
  if (files.some(file => file.size > PICKER_MEDIA_LIMIT)) throw new Error('entry.workspacePicker.tooLarge');
}
/** Stream limits apply to actual bytes too, never just source metadata/headers. */
export function pickerMediaUrl(adapter: AssetLibraryAdapter, asset: PersonalAsset): string {
  const version = asset.versions.at(-1);
  const template = version?.filename === 'template-prompt.md' ? asset.source.template : undefined;
  const kind = pickerKind(asset);
  return (kind === 'image' ? template?.posterSrc : kind === 'video' ? template?.previewVideo : undefined) || adapter.contentUrl(asset, version?.id);
}
export async function readPickerContent(adapter: AssetLibraryAdapter, asset: PersonalAsset, signal: AbortSignal, limit: number, media = false): Promise<Blob> {
  signal.throwIfAborted();
  const version = asset.versions.at(-1);
  if (!version) throw new Error('assetPicker.selectionGone');
  if (version.size > limit) throw new Error('entry.workspacePicker.tooLarge');
  const url = media ? pickerMediaUrl(adapter, asset) : adapter.contentUrl(asset, version.id);
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), ...(media && url !== adapter.contentUrl(asset, version.id) ? {credentials:'omit' as const, referrerPolicy:'no-referrer' as const} : {}) });
  signal.throwIfAborted();
  if (!response.ok || !response.body) throw new Error('entry.workspacePicker.templateReadFailed');
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('entry.workspacePicker.tooLarge'); }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('entry.workspacePicker.tooLarge');
      chunks.push(new Uint8Array(value).buffer);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || version.mime });
}
