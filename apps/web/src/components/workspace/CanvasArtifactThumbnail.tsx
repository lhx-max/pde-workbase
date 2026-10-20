import { useT } from '../../i18n';
import React from 'react';
import { DeckSlideThumbnail } from '../DeckSlideThumbnail';
import { parseDeckThumbnails, type ParsedDeckThumbnails } from '../../runtime/deck-thumbnail-parser';
import { useThumbnailLoadSlot } from '../../lib/thumbnail-load-gate';
import { installPreviewSnapshotBridge } from '../../runtime/srcdoc';
import { requestPreviewSnapshot } from '../../runtime/exports';

const snapshots = new Map<string, { image: string; expires: number }>();
const capturing = new Set<string>();
let capturingFrame = false;
function cachedSnapshot(src: string) {
  const value = snapshots.get(src);
  if (!value || value.expires <= Date.now()) { snapshots.delete(src); return undefined; }
  return value.image;
}

/** Capture only a page the user already opened. Never mount hidden webpages. */
export function cacheCanvasArtifactThumbnail(src: string, frame: HTMLIFrameElement) {
  if (cachedSnapshot(src) || capturing.has(src) || capturing.size >= 12) return;
  capturing.add(src);
  setTimeout(async () => {
    try {
      if (capturingFrame || !frame.isConnected || document.hidden) return;
      const doc = frame.contentDocument;
      // Avoid turning a large/complex document into a synchronous cloning task.
      if (!doc || doc.getElementsByTagName('*').length > 1500 || frame.clientWidth * frame.clientHeight > 2_000_000) return;
      if (!installPreviewSnapshotBridge(frame)) return;
      capturingFrame = true;
      try {
        const snapshot = await requestPreviewSnapshot(frame, 3000, { maxWidth: 512 });
        if (!snapshot || !/^data:image\/(png|jpeg);base64,/.test(snapshot.dataUrl) || snapshot.dataUrl.length > 512_000) return;
        snapshots.set(src, { image: snapshot.dataUrl, expires: Date.now() + 5 * 60_000 });
        while (snapshots.size > 24) snapshots.delete(snapshots.keys().next().value!);
      } finally { capturingFrame = false; }
    } catch { /* Cross-origin/CSP/unsupported captures keep the safe cover. */ }
    finally { capturing.delete(src); }
  }, 1200);
}

type Preview = { deck: ParsedDeckThumbnails; heading: string; summary: string };
// URL contains the workspace scope and content revision. Bound retained source
// data, and never reuse a thumbnail across members or artifact revisions.
const cache = new Map<string, Preview>();
async function loadPreview(src: string, signal: AbortSignal): Promise<Preview> {
  const existing = cache.get(src);
  if (existing) { cache.delete(src); cache.set(src, existing); return existing; }
  const value = await fetch(src, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) }).then(async response => {
    if (!response.ok) throw new Error(`Preview HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error('Preview too large');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,template,noscript').forEach(element => element.remove());
    return { deck: parseDeckThumbnails(html, src), heading: doc.querySelector('h1')?.textContent?.trim() || doc.title,
      summary: doc.querySelector('main p,p')?.textContent?.trim().slice(0, 300) || '' };
  });
  cache.set(src, value);
  while (cache.size > 24) cache.delete(cache.keys().next().value!);
  return value;
}

/** Reuse the existing sanitized deck renderer; unsupported HTML gets a text
 * cover, never a hidden live document. The complete artifact opens on selection. */
export function CanvasArtifactThumbnail({ src, title, presentation, loadingFallback, errorFallback }: {
  src: string; title: string; presentation: boolean;
  loadingFallback?: React.ReactNode; errorFallback?: React.ReactNode;
}) {
  const snapshot = cachedSnapshot(src);
  const [preview, setPreview] = React.useState<{ src: string; value: Preview }>();
  const [failed, setFailed] = React.useState(false);
  const t = useT();
  const handleThumbnailError = React.useCallback(() => setFailed(true), []);
  const { canLoad, settle } = useThumbnailLoadSlot(!snapshot, true);
  React.useEffect(() => {
    if (!canLoad) return;
    let alive = true;
    const controller = new AbortController();
    setFailed(false);
    loadPreview(src, controller.signal).then(value => { if (alive) setPreview({ src, value }); }, () => { if (alive) setFailed(true); }).finally(settle);
    return () => { alive = false; controller.abort(); };
  }, [src, canLoad, settle]);
  const current = preview?.src === src ? preview.value : undefined;
  if (snapshot && !failed) return <img src={snapshot} alt={title} decoding="async" onError={handleThumbnailError} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
  if (failed && errorFallback !== undefined) return <>{errorFallback}</>;
  if (!current && !failed && loadingFallback !== undefined) return <>{loadingFallback}</>;
  return current?.deck.renderable && !failed ? <DeckSlideThumbnail parsed={current.deck} index={0} onError={handleThumbnailError} />
    : <div className="canvas-artifact-cover"><small>{presentation ? t('canvas.cover.slides') : t('canvas.cover.page')}</small><strong>{current?.heading || title}</strong><p>{current?.summary}</p><small>{t('canvas.cover.hint')}</small></div>;
}
