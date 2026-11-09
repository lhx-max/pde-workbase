'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useReducedMotion } from 'motion/react';

import { CollectionCardMedia } from './CollectionCard';
import type { TemplateDemo } from './asset-ui-ports';
import { DeckSlideThumbnail } from './DeckSlideThumbnail';
import { MediaSurface } from './asset-library/AssetMediaSurface';
import { useInView } from './plugins-home/useInView';
import { useThumbnailLoadSlot } from '../lib/thumbnail-load-gate';
import {
  parseDeckThumbnails,
  type ParsedDeckThumbnails,
} from '../runtime/deck-thumbnail-parser';

import { loadAssetThumbnailDocument } from '../runtime/asset-thumbnail-document';
import { useI18n } from '../i18n';
import styles from './TemplateCardPreview.module.css';
import './asset-library/AssetCardShared.css';

const TEMPLATE_THUMBNAIL_ROOT_MARGIN = '160px';
export const TEMPLATE_THUMBNAIL_RETRY_DELAY_MS = 1_000;
// Retain completed parses only, bounded by both count and source size. HTTP
// cache policy still applies; changed response bytes invalidate the old parse.
const deckPreviewCache = new Map<string, { html: string; parsed: ParsedDeckThumbnails }>();

function parseDeckPreview(html: string, source: string): ParsedDeckThumbnails {
  const cached = deckPreviewCache.get(source);
  if (cached?.html === html) {
    deckPreviewCache.delete(source);
    deckPreviewCache.set(source, cached);
    return cached.parsed;
  }
  const parsed = parseDeckThumbnails(html, source);
  // A cloned canvas has no bitmap or running renderer. Authored document bases
  // likewise belong to the original document, not the shadow renderer's base.
  if (/<canvas(?:\s|>)/i.test(parsed.slides[0] ?? '') || /<base\b/i.test(html)) parsed.renderable = false;
  deckPreviewCache.set(source, { html, parsed });
  while (deckPreviewCache.size > 32 || [...deckPreviewCache.values()].reduce((size, entry) => size + entry.html.length, 0) > 8_000_000) {
    deckPreviewCache.delete(deckPreviewCache.keys().next().value!);
  }
  return parsed;
}

/**
 * The single template-card preview used by both the Assets catalogue and all
 * template pickers. A baked poster is only a fast path: stale or missing
 * posters fall back to the canonical HTML/deck example instead of leaving a
 * blank tile.
 */
export function TemplateCardPreview({
  template,
  priority,
  foreground = false,
  children,
}: {
  template: TemplateDemo;
  priority: boolean;
  /** Visible dialogs can load without waking background catalogue thumbnails. */
  foreground?: boolean;
  children?: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [motionPreviewActive, setMotionPreviewActive] = useState(false);
  const canPreviewMotion = Boolean(
    template.type === 'HyperFrames'
      && template.cardMedia?.poster
      && template.previewSrc
      && !shouldReduceMotion,
  );

  return (
    <CollectionCardMedia
      className="community-template-card__preview"
      layout={template.type === 'Image' ? 'natural' : 'landscape'}
      data-motion-preview={canPreviewMotion ? (motionPreviewActive ? 'active' : 'idle') : undefined}
      onMouseEnter={() => {
        if (canPreviewMotion) setMotionPreviewActive(true);
      }}
      onMouseLeave={() => setMotionPreviewActive(false)}
      onFocusCapture={() => {
        if (canPreviewMotion) setMotionPreviewActive(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setMotionPreviewActive(false);
        }
      }}
    >
      <TemplateThumb
        template={template}
        priority={priority}
        foreground={foreground}
        motionPreviewActive={motionPreviewActive && canPreviewMotion}
      />
      {children}
    </CollectionCardMedia>
  );
}

function TemplateThumb({
  template,
  priority,
  foreground,
  motionPreviewActive,
}: {
  template: TemplateDemo;
  priority: boolean;
  foreground: boolean;
  motionPreviewActive: boolean;
}) {
  const media = template.cardMedia;
  if (media?.poster) {
    if (template.type === 'HyperFrames' && template.previewSrc) {
      return (
        <MotionTemplateThumb
          template={template}
          priority={priority}
          active={motionPreviewActive}
          foreground={foreground}
        />
      );
    }
    return media.mediaType === 'image'
      ? <NaturalImageTemplateThumb template={template} priority={priority} foreground={foreground} />
      : <ObservedMediaTemplateThumb template={template} foreground={foreground} />;
  }

  if (template.previewSrc && template.type !== 'Image') {
    return <HtmlTemplateThumb template={template} foreground={foreground} />;
  }
  return <PaperTemplateThumb template={template} />;
}

function PaperTemplateThumb({ template }: { template: Pick<TemplateDemo, 'title' | 'type'> }) {
  return (
    <div className={`community-template-thumb community-template-thumb--${template.type.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="community-template-thumb__paper">
        <span className="community-template-thumb__line is-primary" />
        <strong>{template.title.split(' ')[0]}</strong>
        <span className="community-template-thumb__line is-short" />
        <div className="community-template-thumb__grid">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function MotionTemplateThumb({
  template,
  priority,
  active,
  foreground,
}: {
  template: TemplateDemo;
  priority: boolean;
  active: boolean;
  foreground: boolean;
}) {
  const [mounted, setMounted] = useState(active);
  const [ready, setReady] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => setPosterFailed(false), [template.cardMedia?.poster, template.previewSrc]);

  useEffect(() => {
    if (active) {
      setMounted(true);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
      setReady(false);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    setMounted(false);
    setReady(false);
  }, [template.previewSrc]);

  if (posterFailed) return <PaperTemplateThumb template={template} />;
  return (
    <div className={`community-template-thumb__motion${active ? ' is-active' : ''}${ready ? ' is-ready' : ''}`}>
      <img
        className="community-template-thumb__image community-template-thumb__motion-poster"
        src={template.cardMedia?.poster ?? ''}
        alt={`${template.title} preview`}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onError={() => setPosterFailed(true)}
      />
      {mounted && template.previewSrc ? (
        <iframe
          className="community-template-thumb__motion-frame"
          title={`${template.title} motion preview`}
          src={template.previewSrc}
          sandbox="allow-scripts"
          tabIndex={-1}
          aria-hidden
          onLoad={() => setReady(true)}
        />
      ) : null}
    </div>
  );
}

function NaturalImageTemplateThumb({
  template,
  priority,
  foreground,
}: {
  template: TemplateDemo;
  priority: boolean;
  foreground: boolean;
}) {
  const media = template.cardMedia!;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [media.poster]);
  if (failed) return <PaperTemplateThumb template={template} />;

  return (
    <div className="community-template-thumb__natural-image">
      <img
        className="community-template-thumb__image"
        src={media.poster ?? ''}
        alt={`${template.title} preview`}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={(event) => event.currentTarget.parentElement?.classList.add('is-loaded')}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function ObservedMediaTemplateThumb({ template, foreground }: { template: TemplateDemo; foreground: boolean }) {
  const { ref: keepRef, inView: keep } = useInView<HTMLDivElement>({
    rootMargin: '1500px',
    once: false,
  });
  const { ref: visibleRef, inView: visible } = useInView<HTMLDivElement>({
    rootMargin: '0px',
    once: false,
  });
  const setRef = useCallback((node: HTMLDivElement | null) => {
    keepRef.current = node;
    visibleRef.current = node;
  }, [keepRef, visibleRef]);
  const media = template.cardMedia!;
  const [useLiveHtmlFallback, setUseLiveHtmlFallback] = useState(false);

  useEffect(() => setUseLiveHtmlFallback(false), [media.poster, template.previewSrc]);
  if (useLiveHtmlFallback) return <PaperTemplateThumb template={template} />;

  return (
    <div className="community-template-thumb__media" ref={setRef}>
      <MediaSurface
        preview={media}
        pluginTitle={template.title}
        inView={keep}
        visible={visible}
        idlePlayback={false}
        prewarmVideo={false}
        onPosterError={() => setUseLiveHtmlFallback(true)}
      />
    </div>
  );
}

type HtmlThumbProps = { template: Pick<TemplateDemo, 'title' | 'type' | 'previewSrc'>; foreground?: boolean };

export function HtmlTemplateThumb(props: HtmlThumbProps) {
  // Standalone library uses the original sandboxed document renderer. Cached
  // platform thumbnails are an optional host capability, not a local dependency.
  const key = `${props.template.type}:${props.template.previewSrc}`;
  return <ObservedHtmlThumb key={key} {...props} />;
}

function ThumbnailStatus({ title, failed = false }: { title: string; failed?: boolean }) {
  const { t } = useI18n();
  return <div className={styles.status}>
    <strong title={title}>{title}</strong>
    <span>{t(failed ? 'preview.errorTitle' : 'common.loading')}</span>
  </div>;
}

function ObservedHtmlThumb({ template, foreground = false }: HtmlThumbProps) {
  const { ref, inView } = useInView<HTMLDivElement>({
    rootMargin: TEMPLATE_THUMBNAIL_ROOT_MARGIN,
    once: false,
  });
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const handleFailure = useCallback(() => setFailed(true), []);
  useEffect(() => {
    if (!inView) { setFailed(false); return; }
    if (!failed || attempt > 0) return;
    // One bounded recovery, not an endless reload loop. No nested retry buttons:
    // resource pickers already wrap this presentation component in a button.
    const timer = window.setTimeout(() => {
      setFailed(false);
      setAttempt(1);
    }, TEMPLATE_THUMBNAIL_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, failed, inView]);
  return <div ref={ref} className={`community-template-thumb__html community-template-thumb__html--${template.type.toLowerCase()}`}>
    {inView ? <HtmlThumbAttempt key={attempt} template={template} foreground={foreground} reload={attempt > 0} onFailure={handleFailure} />
      : <ThumbnailStatus title={template.title} />}
  </div>;
}

function HtmlThumbAttempt({ template, foreground, reload, onFailure }: HtmlThumbProps & { reload: boolean; onFailure: () => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [parsedDeck, setParsedDeck] = useState<ParsedDeckThumbnails | null>(null);
  const [document, setDocument] = useState<Awaited<ReturnType<typeof loadAssetThumbnailDocument>> | null>(null);
  // Parsing and iframe loads share the same bounded budget. Unmounting the
  // observed card aborts its fetch and destroys its live WebGL/animation context.
  const { canLoad, timedOut, settle } = useThumbnailLoadSlot(Boolean(template.previewSrc), foreground, true, 'revoke');
  const frames = useRef<number[]>([]);
  const cancelPaint = useCallback(() => {
    frames.current.forEach(frame => cancelAnimationFrame(frame));
    frames.current = [];
  }, []);
  useEffect(() => cancelPaint, [cancelPaint]);
  const reveal = useCallback(() => {
    setReady(true);
    settle();
  }, [settle]);
  useEffect(() => {
    if (!canLoad || failed) cancelPaint();
    if (failed || timedOut) onFailure();
  }, [canLoad, failed, timedOut, onFailure, cancelPaint]);

  useEffect(() => {
    if (!canLoad || failed || !template.previewSrc) return;
    const controller = new AbortController();
    void loadAssetThumbnailDocument(template.previewSrc, controller.signal, reload).then(document => {
      if (controller.signal.aborted) return;
      setDocument(document);
      // Policy-protected documents remain URL-loaded, including for Slides.
      if (template.type === 'Slides' && document.html) {
        const parsed = parseDeckPreview(document.html, document.url);
        if (parsed.renderable && parsed.slides.length > 0) setParsedDeck(parsed);
      }
    }).catch(() => {
      if (!controller.signal.aborted) { setFailed(true); settle(); }
    });
    return () => controller.abort();
  }, [canLoad, failed, template.previewSrc, template.type, reload, settle]);

  const error = failed || timedOut;
  return <div className={`community-template-thumb__html${ready && !error ? ' is-ready' : ''}`}
    data-preview-state={error ? 'error' : ready ? 'loaded' : 'loading'} aria-busy={!error && !ready}>
    {!ready || error ? <ThumbnailStatus title={template.title} failed={error} /> : null}
    {canLoad && !error && parsedDeck ? <DeckSlideThumbnail parsed={parsedDeck} index={0} onReady={reveal} onError={() => {
      setReady(false);
      setParsedDeck(null);
    }} /> : canLoad && !error && document ? <iframe
      className="community-template-thumb__html-frame"
      title={`${template.title} preview`}
      src={document.srcDoc === undefined ? document.url : undefined}
      srcDoc={document.srcDoc}
      sandbox="allow-scripts"
      loading="eager"
      tabIndex={-1}
      aria-hidden
      onLoad={() => {
        cancelPaint();
        // load is not a pixel-readiness guarantee, especially for WebGL. At
        // least allow the document a paint opportunity before fading it in;
        // keep the lease deadline active rather than waiting indefinitely.
        frames.current.push(requestAnimationFrame(() => {
          frames.current.push(requestAnimationFrame(reveal));
        }));
      }}
      onError={() => { cancelPaint(); setFailed(true); settle(); }}
    /> : null}
  </div>;
}
