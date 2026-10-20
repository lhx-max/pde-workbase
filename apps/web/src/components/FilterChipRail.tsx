import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui';
import { Icon } from './Icon';
import { useT } from '../i18n';
import './FilterChipRail.css';

export interface FilterChipRailItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
  empty?: boolean;
  title?: string;
}

interface FilterChipRailProps {
  ariaLabel: string;
  items: readonly FilterChipRailItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
  /** Full-size workspace navigation; compact filters retain their default size. */
  variant?: 'compact' | 'workspace';
  /** Show overflow navigation without changing the default rail consumers. */
  scrollControls?: boolean;
}

/**
 * Shared single-line category filter. This is deliberately a pressed-button
 * group rather than content Tabs: it filters one collection instead of
 * switching between independently labelled tab panels.
 */
export function FilterChipRail({
  ariaLabel,
  items,
  value,
  onValueChange,
  className,
  variant = 'compact',
  scrollControls = false,
}: FilterChipRailProps) {
  const t = useT();
  const railRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ overflow: false, start: true, end: true });
  const itemSignature = items.map((item) => item.id).join('\0');
  const scrollBehavior = (): ScrollBehavior =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    const rail = railRef.current;
    if (!scroller || !rail) return;
    const next = {
      overflow: scroller.scrollWidth > rail.clientWidth + 1,
      start: scroller.scrollLeft <= 1,
      end: scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1,
    };
    setEdges((previous) => previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end ? previous : next);
  }, []);

  const revealItem = (target: HTMLButtonElement) => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof scroller.scrollTo !== 'function') return;
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const hiddenOnLeft = Math.max(0, scrollerRect.left - targetRect.left);
    const hiddenOnRight = Math.max(0, targetRect.right - scrollerRect.right);
    if (hiddenOnLeft === 0 && hiddenOnRight === 0) return;

    const nextLeft = hiddenOnLeft > 0
      ? scroller.scrollLeft - hiddenOnLeft
      : scroller.scrollLeft + hiddenOnRight;
    scroller.scrollTo({
      left: Math.max(0, nextLeft),
      behavior: scrollBehavior(),
    });
  };

  useEffect(() => {
    if (!scrollControls) return;
    const scroller = scrollerRef.current;
    const rail = railRef.current;
    if (!scroller || !rail) return;
    const resize = () => {
      measure();
      const selected = scroller.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (selected) revealItem(selected);
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(rail);
    observer?.observe(scroller);
    Array.from(scroller.children).forEach((child) => observer?.observe(child));
    scroller.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer?.disconnect();
      scroller.removeEventListener('scroll', measure);
    };
  }, [scrollControls, value, itemSignature, measure]);

  const scrollPage = (direction: number) => {
    const scroller = scrollerRef.current;
    scroller?.scrollBy({ left: direction * Math.max(80, scroller.clientWidth * 0.7), behavior: scrollBehavior() });
  };

  return (
    <div ref={railRef} className={`filter-chip-rail${className ? ` ${className}` : ''}`} data-count={items.length} data-variant={variant} data-scroll-controls={scrollControls || undefined}>
      {scrollControls && edges.overflow ? (
        <Button type="button" className="filter-chip-rail__arrow bezier-tooltip" aria-label={t('filter.scrollLeft', { label: ariaLabel })} data-tooltip={t('filter.scrollLeftTip')} disabled={edges.start} onClick={() => scrollPage(-1)}>
          <Icon name="chevron-left" size={13} />
        </Button>
      ) : null}
      <div
        ref={scrollerRef}
        className="filter-chip-rail__scroller"
        role="group"
        aria-label={ariaLabel}
        data-hidden-start={scrollControls && edges.overflow && !edges.start || undefined}
        data-hidden-end={scrollControls && edges.overflow && !edges.end || undefined}
        onKeyDown={scrollControls ? (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
          buttons[next]?.focus({ preventScroll: true });
        } : undefined}
      >
        {items.map((item) => (
          <Button
            key={item.id}
            type="button"
            className="filter-chip-rail__item"
            aria-pressed={value === item.id}
            data-active={value === item.id ? 'true' : undefined}
            data-empty={item.empty ? 'true' : undefined}
            data-filter-chip-id={item.id}
            data-testid={item.testId}
            title={item.title}
            disabled={item.disabled}
            onFocus={scrollControls ? (event) => revealItem(event.currentTarget) : undefined}
            onClick={(event) => {
              onValueChange(item.id);
              revealItem(event.currentTarget);
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {scrollControls && edges.overflow ? (
        <Button type="button" className="filter-chip-rail__arrow bezier-tooltip" aria-label={t('filter.scrollRight', { label: ariaLabel })} data-tooltip={t('filter.scrollRightTip')} disabled={edges.end} onClick={() => scrollPage(1)}>
          <Icon name="chevron-right" size={13} />
        </Button>
      ) : null}
    </div>
  );
}
