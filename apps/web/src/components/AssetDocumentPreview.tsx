import { useEffect, useRef, useState } from 'react';
import { Button } from '@/src/components/ui';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { readAssetDocument } from './asset-document-content';
import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import styles from './AssetDocumentPreview.module.css';

const FIELD_KEYS = ['description', 'characters', 'scene', 'shotSize', 'cameraMovement', 'lighting', 'dialogue', 'sound', 'finalPrompt'] as const;

/** The same readable document is used in library covers, detail and save dialogs. */
export function AssetDocumentPreview({ text, url, kind, compact = false }: { text?: string; url?: string; kind: string; compact?: boolean }) {
  const t = useT();
  const listSep = t('entry.documentPreview.listSep');
  const readable = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(v => typeof v === 'string').join(listSep) : '';
  const [loaded, setLoaded] = useState<{url: string; text?: string; error?: string}>();
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(!compact);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!compact || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [compact]);
  useEffect(() => {
    if (text !== undefined || !url || !visible) return;
    const controller = new AbortController();
    setLoaded({url});
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let cancelled = false;
    readAssetDocument(url, controller.signal)
      .then(value => { if (!controller.signal.aborted) setLoaded({url, text:value}); })
      .catch(e => { if (!cancelled) setLoaded({url, error: controller.signal.aborted ? t('entry.documentPreview.loadTimeout') : e.message}); })
      .finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [text, url, visible, attempt, t]);
  const content = text ?? (!url ? '' : loaded?.url === url ? loaded?.text : undefined);
  let plan: { shots?: Record<string, unknown>[]; assets?: Record<string, unknown>[]; aspectRatio?: string; visualStyle?: string } | undefined;
  if ((kind === 'script' || kind === 'text') && content) {
    try { const parsed = JSON.parse(content); if (parsed && Array.isArray(parsed.shots)) plan = { ...parsed, shots: parsed.shots.filter((s: unknown) => s && typeof s === 'object'), assets: Array.isArray(parsed.assets) ? parsed.assets.filter((s: unknown) => s && typeof s === 'object') : [] }; } catch { /* Plain Markdown scripts remain readable. */ }
  }
  const fieldText = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join(listSep);
    if (value && typeof value === 'object' && 'assetId' in value) {
      const asset = plan?.assets?.find(a => a.id === value.assetId);
      if (!asset) return t('entry.documentPreview.missingRef', { id: String(value.assetId) });
      const variants = Array.isArray(asset.variants) ? asset.variants as Record<string, unknown>[] : [];
      const variantId = 'variantId' in value ? value.variantId : asset.activeVariantId;
      const variant = variants.find(v => v.id === variantId) ?? (!variantId ? variants[0] : undefined);
      return [readable(asset.name), variant ? readable(variant.name) : variantId ? t('entry.documentPreview.missingVariant') : ''].filter(Boolean).join(' · ');
    }
    return readable(value);
  };
  return <div ref={container} className={`${styles.document} ${compact ? styles.compact : ''}`} aria-label={compact ? t('entry.documentPreview.ariaCompact') : t('entry.documentPreview.ariaFull')}>
    {content === undefined ? <div role={loaded?.url === url && loaded?.error ? 'alert' : 'status'}>{loaded?.url === url && loaded?.error ? <>{loaded.error}{!compact && <Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)}>{t('entry.documentPreview.retry')}</Button>}</> : t('entry.documentPreview.loading')}</div> : plan ? <>
      <header><small>{t('entry.documentPreview.storyboardMeta', { count: plan.shots!.length })}{plan.aspectRatio ? ` · ${plan.aspectRatio}` : ''}</small><h2>{t('entry.documentPreview.shotScript')}</h2></header>
      {plan.visualStyle && <p>{t('entry.documentPreview.visualStyle', { style: plan.visualStyle })}</p>}
      {plan.shots!.slice(0, compact ? 2 : undefined).map((shot, index) => <section key={index}>
        <h3>{t('entry.documentPreview.shotHeading', { n: String(index + 1).padStart(2, '0') })}{typeof shot.durationSec === 'number' ? <small>{t('entry.documentPreview.shotDuration', { sec: shot.durationSec })}</small> : null}</h3>
        <dl>{FIELD_KEYS.map((key) => fieldText(shot[key]) ? <div key={key}><dt>{t(`entry.documentPreview.field.${key}` as keyof Dict)}</dt><dd>{fieldText(shot[key])}</dd></div> : null)}</dl>
      </section>)}
      {!compact && !!plan.assets?.length && <section><h3>{t('entry.documentPreview.assetsSection')}</h3>{plan.assets.map((asset, index) => <div key={index}><h4>{readable(asset.name)}</h4><p>{readable(asset.description)}</p>{Array.isArray(asset.variants) && asset.variants.filter(v => v && typeof v === 'object').map((variant, i) => <div key={i}><strong>{readable(variant.name)}</strong><p>{readable(variant.descriptionOverride ?? variant.description)}</p>{variant.prompt && <p>{readable(variant.prompt)}</p>}</div>)}</div>)}</section>}
    </> : <div dangerouslySetInnerHTML={{__html:renderMarkdownToSafeHtml((compact ? content?.slice(0, 3000) : content) || t('entry.documentPreview.emptyBody'))}} />}
  </div>;
}
