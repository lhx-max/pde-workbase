import type { ComponentPropsWithoutRef } from 'react';
import { CollectionCard } from './CollectionCard';
import './ProjectCard.css';

export type ProjectCardLayout = 'grid' | 'list';
export type ProjectCardDensity = 'default' | 'compact';

export interface ProjectCardProps extends ComponentPropsWithoutRef<'article'> {
  layout?: ProjectCardLayout;
  /** Compact keeps the shared list-card grammar for dense entity pickers. */
  density?: ProjectCardDensity;
  /** Optional quiet outline for cards placed on a same-color dialog surface. */
  outlined?: boolean;
}

export type ProjectCardFallbackVariant = 'project' | 'knowledge' | 'skill' | 'workflow' | 'mcp';

type ProjectCardFallbackPool = readonly [string, ...string[]];

const PROJECT_CARD_FALLBACKS: Record<ProjectCardFallbackVariant, ProjectCardFallbackPool> = {
  // Project artwork is deliberately stable per project ID: covers look varied across
  // the grid, but a refresh never swaps a project's visual identity at random.
  project: [
    '/project-card/fallback-project.png',
    '/project-card/fallback-project-02.png',
    '/project-card/fallback-project-03.png',
    '/project-card/fallback-project-04.png',
    '/project-card/fallback-project-05.png',
    '/project-card/fallback-project-06.png',
    '/project-card/fallback-project-07.png',
    '/project-card/fallback-project-08.png',
  ],
  knowledge: [
    '/project-card/fallback-knowledge.png',
    '/project-card/fallback-knowledge-02.png',
    '/project-card/fallback-knowledge-03.png',
    '/project-card/fallback-knowledge-04.png',
    '/project-card/fallback-knowledge-05.png',
    '/project-card/fallback-knowledge-06.png',
  ],
  skill: [
    '/project-card/fallback-skill.png',
    '/project-card/fallback-skill-02.png',
    '/project-card/fallback-skill-03.png',
    '/project-card/fallback-skill-04.png',
    '/project-card/fallback-skill-05.png',
    '/project-card/fallback-skill-06.png',
  ],
  workflow: [
    '/project-card/fallback-workflow.png',
    '/project-card/fallback-workflow-02.png',
    '/project-card/fallback-workflow-03.png',
    '/project-card/fallback-workflow-04.png',
    '/project-card/fallback-workflow-05.png',
    '/project-card/fallback-workflow-06.png',
  ],
  mcp: [
    '/project-card/fallback-mcp.png',
    '/project-card/fallback-mcp-02.png',
    '/project-card/fallback-mcp-03.png',
    '/project-card/fallback-mcp-04.png',
    '/project-card/fallback-mcp-05.png',
    '/project-card/fallback-mcp-06.png',
  ],
};

function stableFallbackIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function projectCardFallbackSrc(
  seed: string,
  variant?: ProjectCardFallbackVariant,
): string {
  const resolved = variant ?? 'project';
  const fallbacks = PROJECT_CARD_FALLBACKS[resolved];
  return fallbacks[stableFallbackIndex(seed, fallbacks.length)] ?? fallbacks[0];
}

/** Shared entity-card family. Projects use the grid form; catalogues use list. */
export function ProjectCard({
  className,
  layout = 'grid',
  density = 'default',
  outlined = false,
  ...props
}: ProjectCardProps) {
  return (
    <CollectionCard
      {...props}
      variant="compact"
      interactive
      data-card-layout={layout}
      data-card-density={density}
      data-card-outlined={outlined || undefined}
      className={['project-card', `project-card--${layout}`, className].filter(Boolean).join(' ')}
    />
  );
}

export function ProjectCardContent({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={['project-card__content', className].filter(Boolean).join(' ')} />;
}

/** Shared hover/focus action surface; callers retain permissions and commands. */
export function ProjectCardActions({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={['project-card__actions', className].filter(Boolean).join(' ')} />;
}

export function ProjectCardCover({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={['project-card__cover', className].filter(Boolean).join(' ')} />;
}

/** Shared illustrated fallback for cards without an immediately usable preview. */
export function ProjectCardCoverFallback({
  seed,
  variant,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'> & {
  seed: string;
  variant?: ProjectCardFallbackVariant;
}) {
  return (
    <img
      {...props}
      className={['project-card__fallback', className].filter(Boolean).join(' ')}
      src={projectCardFallbackSrc(seed, variant)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function ProjectCardBody({
  className,
  withDescription = false,
  ...props
}: ComponentPropsWithoutRef<'div'> & { withDescription?: boolean }) {
  return (
    <div
      {...props}
      className={['project-card__body', className].filter(Boolean).join(' ')}
      data-with-description={withDescription || undefined}
    />
  );
}

export function ProjectCardIdentity({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={['project-card__identity', className].filter(Boolean).join(' ')} />;
}

export function ProjectCardTitle({ className, ...props }: ComponentPropsWithoutRef<'strong'>) {
  return <strong {...props} className={['project-card__title', className].filter(Boolean).join(' ')} />;
}

export function ProjectCardDescription({ className, ...props }: ComponentPropsWithoutRef<'small'>) {
  return <small {...props} className={['project-card__description', className].filter(Boolean).join(' ')} />;
}

export function ProjectCardMeta({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={['project-card__meta', className].filter(Boolean).join(' ')} />;
}
