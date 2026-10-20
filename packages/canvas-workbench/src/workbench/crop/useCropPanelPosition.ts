import React from 'react';
import { useStore } from '@xyflow/react';

/** Match the image's live canvas zoom, including the gap and viewport collision geometry. */
export function useCropPanelPosition(anchor: React.RefObject<HTMLDivElement>, panel: React.RefObject<HTMLElement>) {
  const transform = useStore(state => state.transform);
  const zoom = Number.isFinite(transform[2]) && transform[2] > 0 ? transform[2] : 1;
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  React.useLayoutEffect(() => {
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const width = (panel.current?.offsetWidth || 288) * zoom;
      const height = (panel.current?.offsetHeight || 420) * zoom;
      const margin = 12;
      const gap = 16 * zoom;
      const right = box.right + gap;
      const preferred = right + width <= window.innerWidth - margin ? right : box.left - width - gap;
      const left = Math.max(margin, Math.min(preferred, window.innerWidth - width - margin));
      const top = Math.max(margin, Math.min(box.top, window.innerHeight - height - margin));
      setPosition(old => old.left === left && old.top === top ? old : { left, top });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (anchor.current) observer?.observe(anchor.current);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [anchor, panel, transform, zoom]);
  return {
    ...position,
    transform: `scale(${zoom})`,
    transformOrigin: 'top left',
    maxWidth: `calc((100vw - 24px) / ${zoom})`,
    maxHeight: `calc((100dvh - 24px) / ${zoom})`,
  };
}
