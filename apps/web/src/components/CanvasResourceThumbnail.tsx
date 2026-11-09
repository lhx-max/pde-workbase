'use client';

import { useEffect, useRef, useState } from 'react';

/** Sidebar visibility controls loading; do not stack browser lazy heuristics on it. */
export function CanvasResourceThumbnail({ src }: { src: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    if (image.current) observer.observe(image.current);
    return () => observer.disconnect();
  }, []);
  return <img ref={image} src={visible ? src : undefined} alt="" draggable={false} loading="eager" decoding="async" />;
}
