import React from 'react';
import styles from './CanvasTextToolbar.module.css';

/** Keep editing controls inside the canvas even when the card crosses its edges. */
export function CanvasTextToolbar({ container, children }: { container: HTMLElement; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const toolbar = ref.current;
    const canvas = container.closest('.xy-flow-host');
    if (!toolbar || !canvas) return;
    const update = () => {
      // Reset before measuring so repeated pan/resize events cannot accumulate offsets.
      toolbar.style.transform = '';
      const bounds = canvas.getBoundingClientRect();
      const rect = toolbar.getBoundingClientRect();
      const card = container.getBoundingClientRect();
      const zoom = card.width / container.offsetWidth || 1;
      const dx = Math.max(bounds.left + 8 - rect.left, Math.min(0, bounds.right - 8 - rect.right));
      const topEdge = bounds.top + 8;
      const bottomEdge = bounds.bottom - 8;
      const below = card.bottom + 8;
      // Flip below the card when its top toolbar would obscure the first line.
      const preferredTop = rect.top < topEdge && below + rect.height <= bottomEdge ? below : rect.top;
      const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - rect.height));
      const dy = top - rect.top;
      const overlapsBody = top < card.bottom && top + rect.height > card.top;
      container.style.setProperty('--text-toolbar-inset', overlapsBody ? `${Math.max(0, top + rect.height - card.top + 8) / zoom}px` : '0px');
      toolbar.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`;
      toolbar.style.maxWidth = `${Math.max(0, bounds.width - 16) / zoom}px`;
    };
    update();
    const resize = new ResizeObserver(update);
    [canvas, container, toolbar].forEach(element => resize.observe(element));
    const movement = new MutationObserver(update);
    for (const element of [container.closest('.react-flow__viewport'), container.closest('.react-flow__node')]) {
      if (element) movement.observe(element, { attributes: true, attributeFilter: ['style'] });
    }
    window.addEventListener('resize', update);
    return () => { resize.disconnect(); movement.disconnect(); window.removeEventListener('resize', update); container.style.removeProperty('--text-toolbar-inset'); };
  }, [container]);
  return <div ref={ref} className={`basic-text-floating-toolbar-host nodrag nopan nowheel ${styles.toolbar}`}>{children}</div>;
}
