import type { ComponentPropsWithoutRef } from 'react';
import './CollectionCard.css';

export type CollectionCardVariant = 'media' | 'compact';

export interface CollectionCardProps extends ComponentPropsWithoutRef<'article'> {
  /**
   * `media` is for projects and visual assets whose preview is the surface.
   * `compact` is for Skill, workflow, knowledge and extension catalogues.
   */
  variant?: CollectionCardVariant;
  interactive?: boolean;
}

export interface CollectionCardMediaProps extends ComponentPropsWithoutRef<'div'> {
  layout?: 'landscape' | 'natural';
}

export interface CollectionCardMediaActionsProps extends ComponentPropsWithoutRef<'div'> {
  align?: 'end' | 'center';
}

/**
 * Shared entity-card shell.
 *
 * This deliberately does not replace chat results, tool-call panels, canvas
 * nodes or modal sections. Those are state/content surfaces rather than
 * collection cards and keep their own semantic components.
 */
export function CollectionCard({
  variant = 'compact',
  interactive = false,
  className,
  ...props
}: CollectionCardProps) {
  return (
    <article
      {...props}
      data-card-variant={variant}
      data-interactive={interactive ? 'true' : undefined}
      className={[
        'collection-card',
        `collection-card--${variant}`,
        className,
      ].filter(Boolean).join(' ')}
    />
  );
}

/** Shared preview surface for visual collection cards. */
export function CollectionCardMedia({
  layout = 'landscape',
  className,
  ...props
}: CollectionCardMediaProps) {
  return (
    <div
      {...props}
      data-card-media-layout={layout}
      className={['collection-card__media', className].filter(Boolean).join(' ')}
    />
  );
}

/** Hover/focus metadata shared by template galleries and resource pickers. */
export function CollectionCardMediaMeta({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={['collection-card__media-meta', className].filter(Boolean).join(' ')}
    />
  );
}

/** Optional action slot; image cards may center it while landscape cards align end. */
export function CollectionCardMediaActions({
  align = 'end',
  className,
  ...props
}: CollectionCardMediaActionsProps) {
  return (
    <div
      {...props}
      data-card-action-align={align}
      className={['collection-card__media-actions', className].filter(Boolean).join(' ')}
    />
  );
}
