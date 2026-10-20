import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './WorkspaceEmptyState.module.css';

/** Shared fallback layout; page consumers own their actions. */
export function WorkspaceEmptyState({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(320);
  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      let parent = ref.current.parentElement;
      let bottomInset = 0;
      let bottom = window.innerHeight;
      let scrollOffset = 0;
      while (parent) {
        const style = getComputedStyle(parent);
        bottomInset += parseFloat(style.paddingBottom) || 0;
        if (/(auto|scroll)/.test(style.overflowY)) {
          bottom = Math.min(bottom, parent.getBoundingClientRect().top + parent.clientTop + parent.clientHeight);
          scrollOffset = parent.scrollTop;
          break;
        }
        bottomInset += parseFloat(style.marginBottom) || 0;
        parent = parent.parentElement;
      }
      setHeight(Math.max(180, Math.floor(bottom - ref.current.getBoundingClientRect().top - scrollOffset - bottomInset - 1)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (ref.current?.parentElement) observer?.observe(ref.current.parentElement);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, []);
  return <div ref={ref} className={styles.root} style={{ minHeight: height }} role="status">{children}</div>;
}
