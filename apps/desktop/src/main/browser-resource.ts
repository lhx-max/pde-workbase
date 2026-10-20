import { nativeMessage } from './locales/native-messages.js';
import { normalizedResourceMime, verifyResourceBytes } from './browser-resource-policy.js';

/** Adapted from upstream browser-resource.ts; retain bytes, never screenshot fallback. */
export async function readBrowserImage(response: Response, maxBytes = 25 * 1024 * 1024) {
  const reader = response.body?.getReader();
  try {
    if (response.status !== 200 || response.redirected || response.headers.has('content-range')) throw new Error(nativeMessage('Image response is unavailable'));
    const mime = normalizedResourceMime(response.headers.get('content-type') ?? undefined);
    if (!mime || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) throw new Error(nativeMessage('Unsupported image format; no screenshot substitution'));
    if (!reader) throw new Error(nativeMessage('Empty image resource'));
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error(nativeMessage('Image exceeds 25 MiB'));
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    if (!verifyResourceBytes(bytes, mime)) throw new Error(nativeMessage('Image signature does not match its MIME type'));
    return { mime, base64: bytes.toString('base64') };
  } finally { if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); } }
}
