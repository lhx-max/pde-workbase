import { useState, type ReactNode } from 'react';
import { NaturalMasonry } from './NaturalMasonry';
import type {
  ImageReferenceResourceGridItem,
  ImageReferenceResourceGridRenderProps,
} from '@bezier/canvas-workbench';

import { Button } from '@/src/components/ui';
import { useT } from '../../i18n';
import {
  CollectionCard,
  CollectionCardMedia,
  CollectionCardMediaActions,
  CollectionCardMediaMeta,
} from '../CollectionCard';
import type { TemplateDemo } from '../asset-ui-ports';
import { TemplateCardPreview } from '../TemplateCardPreview';
import styles from './SelectableImageMasonry.module.css';

type PreviewGridProps = ImageReferenceResourceGridRenderProps & {
  showCaptions?: boolean;
  isDisabled?: (item: ImageReferenceResourceGridItem) => boolean;
  onPreview?: (id: string) => void;
  renderCover?: (item: ImageReferenceResourceGridItem) => ReactNode;
  /** Existing library previews own their media surface; never wrap them twice. */
  renderMedia?: (item: ImageReferenceResourceGridItem, overlays: ReactNode) => ReactNode;
};

function ImagePlaceholder() {
  return (
    <span className={styles.placeholder} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m6.5 17 4-4 2.5 2.5 2-2 2.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}

function MasonryItem({
  item,
  onToggle,
  layout = 'natural',
  onPreview,
  renderCover,
  renderMedia,
  showCaptions = false,
  disabled = false,
}: {
  item: ImageReferenceResourceGridItem;
  onToggle: (id: string) => void;
  layout?: 'natural' | 'landscape';
  onPreview?: PreviewGridProps['onPreview'];
  renderCover?: PreviewGridProps['renderCover'];
  renderMedia?: PreviewGridProps['renderMedia'];
  showCaptions?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const template = item.templatePreview ? ({
    id: item.id,
    title: item.name,
    description: '',
    author: '',
    tags: [],
    accent: '',
    meta: item.meta,
    type: item.templatePreview.type === 'deck' ? 'Slides' : 'Prototype',
    subtype: item.meta,
    referencePath: '',
    cardMedia: item.preview ? {
      kind: 'media',
      mediaType: item.templatePreview.videoUrl ? 'video' : 'image',
      poster: item.preview,
      videoUrl: item.templatePreview.videoUrl ?? null,
      audioUrl: null,
      imageOnly: !item.templatePreview.videoUrl,
      loopHoldMs: null,
    } : null,
    posterSrc: item.preview ?? null,
    previewSrc: item.templatePreview.previewSrc ?? null,
    previewVideo: item.templatePreview.videoUrl ?? null,
    prompt: '',
  } satisfies TemplateDemo) : null;

  const cardMeta = (
    <>
      {item.checked ? <span className={styles.check} aria-hidden="true">✓</span> : null}
      {!showCaptions && <CollectionCardMediaMeta title={item.name} className={styles.cardMeta}>
        <strong>{item.name}</strong>
        {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
      </CollectionCardMediaMeta>}
    </>
  );

  const mediaSurface = renderMedia?.(item, cardMeta);
  const cover = mediaSurface ? null : renderCover?.(item);

  return (
    <CollectionCard
      variant="media"
      interactive
      className={[styles.card, layout === 'landscape' ? styles.landscape : ''].filter(Boolean).join(' ')}
      data-selected={item.checked ? 'true' : undefined}
    >
      <div className={styles.mediaArea}>
      <Button
        variant="ghost"
        className={styles.item}
        aria-label={[item.name, item.meta].filter(Boolean).join(' ')}
        aria-pressed={item.checked}
        disabled={disabled}
        onClick={() => onToggle(item.id)}
      >
        {mediaSurface || (cover ? <CollectionCardMedia className={styles.media} layout="landscape">{cover}{cardMeta}</CollectionCardMedia> : template ? (
          <TemplateCardPreview template={template} priority={false} foreground>
            {cardMeta}
          </TemplateCardPreview>
        ) : (
          <CollectionCardMedia
            className={styles.media}
            layout={layout === 'landscape' ? 'landscape' : 'natural'}
            data-loaded={loaded ? 'true' : 'false'}
          >
            {item.preview && item.kind === 'video' ? (
              <video className={styles.image} data-loaded="true" src={item.preview} muted preload="metadata" playsInline onLoadedMetadata={() => setLoaded(true)} />
            ) : item.kind === 'audio' ? (
              <span className={styles.placeholder} aria-hidden="true">♫</span>
            ) : item.preview ? (
              <img
                className={styles.image}
                src={item.preview}
                loading="lazy"
                alt=""
                draggable={false}
                data-loaded={loaded ? 'true' : 'false'}
                onLoad={() => setLoaded(true)}
              />
            ) : <ImagePlaceholder />}
            {cardMeta}
          </CollectionCardMedia>
        ))}
      </Button>
      {onPreview && <CollectionCardMediaActions align="center" className={styles.previewAction}>
        <Button variant="default" size="sm" className={`community-template-card__action ${styles.previewButton}`} onClick={() => onPreview(item.id)} aria-label={t('asset.preview.named', { name: item.name })}>{t('asset.preview.action')}</Button>
      </CollectionCardMediaActions>}
      </div>
      {showCaptions && <div className={styles.caption}><strong title={item.name}>{item.name}</strong><span title={item.meta}>{item.meta}</span></div>}
    </CollectionCard>
  );
}

export function SelectableTemplateGrid(props: PreviewGridProps) {
  return (
    <div className={styles.scrollRegion} data-testid="selectable-template-grid">
      {props.items.length ? (
        <div className={styles.templateGrid}>
          {props.items.map(item => (
            <MasonryItem
              key={item.id}
              item={item}
              disabled={props.isDisabled?.(item)}
              onToggle={props.onToggle}
              layout="landscape"
              showCaptions={props.showCaptions}
              onPreview={props.onPreview}
              renderCover={props.renderCover}
              renderMedia={props.renderMedia}
            />
          ))}
        </div>
      ) : props.emptyState}
    </div>
  );
}

/**
 * Selectable image waterfall shared by asset-derived pickers. Overlay behavior
 * stays with Dialog/Popover; this component owns only the image collection.
 */
export function SelectableImageMasonry({
  items,
  onToggle,
  emptyState,
  onPreview,
  renderCover,
  renderMedia,
  isDisabled,
}: PreviewGridProps) {
  return (
    <div className={styles.scrollRegion} data-testid="selectable-image-masonry">
      {items.length ? (
        <NaturalMasonry itemKeys={items.map(item => item.id)} className={styles.masonry}>
          {items.map(item => (
            <MasonryItem key={item.id} item={item} disabled={isDisabled?.(item)} onToggle={onToggle} onPreview={onPreview} renderCover={renderCover} renderMedia={renderMedia} />
          ))}
        </NaturalMasonry>
      ) : emptyState}
    </div>
  );
}
