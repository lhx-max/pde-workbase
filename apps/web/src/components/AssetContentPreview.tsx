import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui';
import { AssetDocumentPreview } from './AssetDocumentPreview';
import { AssetDetailBody, AssetDetailDialog, AssetDetailInspector, AssetDetailSection } from './AssetDetailDialog';
import type { PersonalAsset } from '@bezier/contracts';
import { personalAssets } from '../providers/asset-library';
import { AssetMetadataReadOnly } from './AssetMetadataReadOnly';
import styles from './AssetContentPreview.module.css';
import { useI18n } from '../i18n';

/** Preview identity and content travel together; callers own selection/editing, not rendering. */
export type AssetPreviewSource = {
  name: string;
  kind: string;
  url?: string;
  text?: string;
  mime?: string;
  spaceName?: string;
  asset?: PersonalAsset;
};

/** Keep the original record with its preview so reference details retain metadata. */
export function personalAssetPreviewSource(asset: PersonalAsset): AssetPreviewSource {
  const version = asset.versions.at(-1);
  const template = version?.filename === 'template-prompt.md' ? asset.source.template : undefined;
  const base = { asset, name: asset.name, kind: asset.kind, mime: version?.mime, url: version ? personalAssets.contentUrl(asset) : undefined };
  if (!template) return base;
  if (template.type === 'Image' && template.posterSrc) return { ...base, kind: 'image', url: template.posterSrc };
  if (template.type === 'Video' && template.previewVideo) return { ...base, kind: 'video', url: template.previewVideo };
  if (template.previewSrc) return { ...base, kind: 'webpage', mime: 'text/html', url: template.previewSrc };
  return { ...base, kind: 'text' };
}

export function filePreviewKind(name: string, mime = ''): string {
  if (/\.storyboard\.json$/i.test(name)) return 'script';
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg)$/i.test(name)) return 'audio';
  if (mime === 'text/html' || /\.html?$/i.test(name)) return 'webpage';
  if (mime.startsWith('text/') || /json|xml/.test(mime) || /\.(md|txt|json)$/i.test(name)) return 'text';
  return 'file';
}

/** Read local template responses explicitly: iframe load does not report HTTP errors. */
function TemplateSlidePreview({ url, name }: { url: string; name: string }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ html?: string; error?: boolean }>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult({}); setLoaded(false);
    const timer = setTimeout(() => {
      if (active) { setResult({ error: true }); controller.abort(); }
    }, 15_000);
    fetch(url, { signal: controller.signal, credentials: 'same-origin' }).then(async response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Invalid template response');
      const html = await response.text();
      if (!html.trim()) throw new Error('Empty template response');
      if (active && !controller.signal.aborted) setResult({ html });
    }).catch(() => { if (active) setResult({ error: true }); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [url, attempt]);
  return <div className={styles.slidePreview} data-asset-preview="slides" aria-busy={!result.error && !loaded}>
    {result.error ? <div className={styles.previewStatus} role="alert"><p>{t('entry.preview.readFailed')}</p><Button variant="ghost" onClick={() => setAttempt(value => value + 1)}>{t('entry.preview.retry')}</Button></div> : <>
      {!loaded && <div className={styles.previewStatus} role="status">{t('entry.preview.loading')}</div>}
      {result.html && <iframe key={attempt} data-asset-preview="slides" className={styles.frame} title={t('entry.preview.assetTitle', { name })} sandbox="allow-scripts" srcDoc={result.html} onLoad={() => setLoaded(true)} />}
    </>}
  </div>;
}

const DESKTOP_PREVIEW_WIDTH = 1920;
/** Keep template media queries at desktop width while filling the preview height. */
function DesktopTemplatePreview({ name, url, text }: { name: string; url?: string; text?: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scale: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        const next = { scale: width / DESKTOP_PREVIEW_WIDTH, height };
        setViewport(current => current.scale === next.scale && current.height === next.height ? current : next);
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  return <div ref={containerRef} className={styles.desktopViewport} data-asset-preview="desktop-webpage">
    <div className={styles.desktopViewportStage} style={{ width: DESKTOP_PREVIEW_WIDTH * viewport.scale, height: viewport.height }}>
      <iframe
        className={styles.desktopViewportFrame}
        style={{ height: viewport.scale ? viewport.height / viewport.scale : 0, transform: `scale(${viewport.scale})` }}
        title={t('entry.preview.assetTitle', { name })}
        sandbox="allow-scripts"
        src={text === undefined ? url : undefined}
        srcDoc={text}
      />
    </div>
  </div>;
}

export function AssetContentPreview({ source }: { source: AssetPreviewSource }) {
  const { t } = useI18n();
  const { name, kind, url, text, mime } = source;
  if (kind === 'text' || kind === 'script') return <AssetDocumentPreview kind={kind} text={text} url={url} />;
  if (kind === 'image' && url) return <img className={styles.media} src={url} alt={name} />;
  if (kind === 'video' && url) return <video className={styles.media} src={url} controls preload="metadata" />;
  if (kind === 'audio' && url) return <audio className={styles.media} src={url} controls preload="metadata" />;
  if (['webpage', 'slides', 'motion'].includes(kind) && (mime === 'text/html' || /\.html?$/i.test(name) || text !== undefined)) {
    // These endpoints return self-contained template HTML. Ordinary webpages
    // retain URL navigation, so their relative resources and origin are unchanged.
    if ((source.asset?.kind === 'slides' || kind === 'slides') && text === undefined && url && /^\/api\/skills\/[^/?]+\/example(?:\?|$)/.test(url)) {
      return <TemplateSlidePreview key={url} url={url} name={name} />;
    }
    if (kind === 'webpage' && (source.asset?.source.template?.type === 'Prototype' || (url && /^\/api\/skills\/[^/?]+\/example(?:\?|$)/.test(url)))) {
      return <DesktopTemplatePreview name={name} url={url} text={text} />;
    }
    return <iframe data-asset-preview={source.asset?.kind === 'slides' || kind === 'slides' ? 'slides' : kind} className={styles.frame} title={t('entry.preview.assetTitle', { name })} sandbox="allow-scripts" src={text === undefined ? url : undefined} srcDoc={text} />;
  }
  return <div className={styles.unavailable} role="status"><strong>{name}</strong><p>{t('entry.preview.unavailable')}</p></div>;
}

export function AssetPreviewDialog({ source, onClose, actions, loading, error, onRetry }: { source: AssetPreviewSource; onClose: () => void; actions?: ReactNode; loading?: boolean; error?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return <AssetDetailDialog title={source.name} onClose={onClose}>
    <AssetDetailBody>
      <div>{error ? <div role="alert">{error}{onRetry && <Button variant="ghost" onClick={onRetry}>{t('entry.preview.retry')}</Button>}</div> : loading ? <div role="status">{t('entry.preview.loading')}</div> : <AssetContentPreview source={source} />}</div>
      {source.asset ? <AssetMetadataReadOnly key={source.asset.id} asset={source.asset} spaceName={source.spaceName} actions={actions} /> : <AssetDetailInspector actions={actions}>
        <AssetDetailSection title={t('entry.preview.nameSection')}><p>{source.name}</p></AssetDetailSection>
        <AssetDetailSection title={t('entry.preview.previewSection')}><p>{t('entry.preview.previewHint')}</p></AssetDetailSection>
      </AssetDetailInspector>}
    </AssetDetailBody>
  </AssetDetailDialog>;
}

