const MAX_HTML_BYTES = 4 * 1024 * 1024;

function httpUrl(source: string, base: string): URL {
  const url = new URL(source, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Thumbnail URL must use HTTP(S) without credentials');
  }
  return url;
}

/** Bound memory while reading, and stop the transport when a preview is revoked. */
async function readHtml(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('Content-Length')) > MAX_HTML_BYTES) {
    throw new Error('Thumbnail HTML exceeds the 4 MiB limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) throw new Error('Thumbnail HTML exceeds the 4 MiB limit');
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    signal.removeEventListener('abort', cancel);
    // Cancellation must not delay delivering an error or timeout to the owner.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Parse inertly; preserve authored content and scripts without injecting bridges. */
function thumbnailSrcDoc(html: string, url: string): string | undefined {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Rewriting a policy-bearing document can change base-uri and other CSP
  // behavior. Inspect actual elements, not comments or script text matching it.
  for (const meta of doc.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'content-security-policy') return undefined;
  }
  const bases = doc.querySelectorAll('base[href]');
  if (bases.length > 0) {
    for (const base of bases) {
      // Author bases resolve against the response URL, not against each other.
      base.setAttribute('href', httpUrl(base.getAttribute('href')!, url).href);
    }
  } else {
    const base = doc.createElement('base');
    base.href = url;
    doc.head.prepend(base);
  }
  // Keep the doctype (including public/system IDs) and document-level comments;
  // XML serialization of the html element would change script/text semantics.
  const serializer = new XMLSerializer();
  return Array.from(doc.childNodes, node => node === doc.documentElement
    ? doc.documentElement.outerHTML
    : serializer.serializeToString(node)).join('');
}

/**
 * Fetch same-origin HTML so transport failures can become thumbnail fallbacks.
 * Policy-bearing responses and external documents must stay URL navigations:
 * srcdoc would discard response CSP/X-Frame-Options and weaken their isolation.
 * The owner still supplies the iframe sandbox; this helper neither executes
 * scripts nor adds same-origin permission, preview bridges or export machinery.
 */
export async function loadAssetThumbnailDocument(
  source: string,
  signal: AbortSignal,
  reload = false,
): Promise<{ url: string; html?: string; srcDoc?: string }> {
  signal.throwIfAborted();
  // Authorized team packages are materialized as local object URLs. Keep them
  // in the existing opaque-origin iframe sandbox; never inline their scripts.
  const objectUrl = new URL(source, window.location.href);
  if (objectUrl.protocol === 'blob:' && objectUrl.origin === window.location.origin) return { url: objectUrl.href };
  const sourceUrl = httpUrl(source, window.location.href);
  if (sourceUrl.origin !== window.location.origin) return { url: sourceUrl.href };

  const response = await fetch(sourceUrl.href, { signal, cache: reload ? 'reload' : 'default', redirect: 'manual' });
  try {
    signal.throwIfAborted();
    // Browser manual redirects are opaque. Keep navigation on the original
    // URL so an external destination does not need CORS permission for fetch.
    if (response.type === 'opaqueredirect' || [301, 302, 303, 307, 308].includes(response.status)) {
      return { url: sourceUrl.href };
    }
    if (!response.ok) throw new Error(`Thumbnail request failed: HTTP ${response.status}`);
    const effectiveUrl = httpUrl(response.url || sourceUrl.href, sourceUrl.href);
    const url = effectiveUrl.href;
    if (effectiveUrl.origin !== window.location.origin
      || response.headers.has('Content-Security-Policy')
      || response.headers.has('Content-Security-Policy-Report-Only')
      || response.headers.has('X-Frame-Options')) {
      return { url };
    }
    const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (mime && mime !== 'text/html' && mime !== 'application/xhtml+xml') {
      throw new Error('Thumbnail response is not HTML');
    }
    const html = await readHtml(response, signal);
    signal.throwIfAborted();
    const srcDoc = thumbnailSrcDoc(html, url);
    signal.throwIfAborted();
    return srcDoc === undefined ? { url } : { url, html, srcDoc };
  } finally {
    // In particular, do not leave the preflight body downloading while the
    // owner navigates an iframe to a policy-bearing or redirected URL.
    if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}
