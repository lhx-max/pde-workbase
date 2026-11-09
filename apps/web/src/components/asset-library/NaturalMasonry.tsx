import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './NaturalMasonry.module.css';

/**
 * Shared natural-height collection geometry for the library and its pickers.
 * Consumers supply keyed cards and a density preset; this component owns
 * column geometry, 1px grid rows, measurement and observer lifetime. Sparse grid
 * placement fills available columns without reordering or remounting cards.
 */
export function NaturalMasonry({ children, itemKeys, className, enabled = true, density = 'picker' }: {
  children: ReactNode;
  itemKeys: readonly string[];
  className?: string;
  enabled?: boolean;
  density?: 'picker' | 'library' | 'compact';
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const membership = JSON.stringify(itemKeys);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !enabled) return;
    const cards = Array.from(grid.children) as HTMLElement[];
    let active = true;
    const measure = () => {
      if (!active) return;
      const computedGap = parseFloat(getComputedStyle(grid).columnGap);
      const gap = Number.isFinite(computedGap) ? computedGap : 16;
      // Read all natural heights before writing spans to avoid layout thrashing.
      // offsetHeight is unaffected by a dialog's entrance scale transform.
      const spans = cards.map(card => `span ${Math.max(1, Math.ceil(card.offsetHeight + gap))}`);
      cards.forEach((card, index) => {
        if (card.style.gridRowEnd !== spans[index]) card.style.gridRowEnd = spans[index]!;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(grid);
    cards.forEach(card => observer?.observe(card));
    // A viewport breakpoint can change the gutter even in a fixed-width host.
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      // A mixed collection can become a regular grid after filtering images out.
      cards.forEach(card => card.style.removeProperty('grid-row-end'));
    };
  }, [membership, enabled, density]);

  return <div ref={gridRef} data-masonry-density={density} className={[className, enabled ? styles.grid : ''].filter(Boolean).join(' ')}>{children}</div>;
}
