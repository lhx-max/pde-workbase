import { tActive } from '../i18n';
// Bounded, version-URL keyed cache. Unversioned/blob URLs are never cached.
const cache = new Map<string, string>();
const limit = 2 * 1024 * 1024;
export async function readAssetDocument(url: string, signal: AbortSignal, t: typeof tActive = tActive): Promise<string> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(t('asset.doc.previewFailed'));
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error(t('asset.doc.tooLarge'));
  }
  const reader = response.body?.getReader();
  let content = '';
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) { await reader.cancel(); throw new Error(t('asset.doc.tooLarge')); }
        content += decoder.decode(chunk.value, { stream: true });
      }
      content += decoder.decode();
    } finally { reader.releaseLock(); }
  } else content = await response.text();
  if (/[?&]version=/.test(url)) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value!);
    cache.set(url, content);
  }
  return content;
}
