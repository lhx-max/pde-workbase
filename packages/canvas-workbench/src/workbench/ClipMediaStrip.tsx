'use client';

import React from 'react';
import { getClipMediaVisual, mediaSourceWindow, type ClipMediaVisual } from './clip-media-visual';
import type { CanvasTimelineClip } from './clip-timeline';

function useNearViewport(elementRef: React.RefObject<HTMLElement>, enabled: boolean) {
  const [nearViewport, setNearViewport] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef, enabled]);
  return nearViewport;
}

export const ClipMediaStrip = React.memo(function ClipMediaStrip({
  clip,
  url,
  enabled,
}: {
  clip: CanvasTimelineClip;
  url: string;
  enabled: boolean;
}) {
  const rootRef = React.useRef<HTMLSpanElement>(null);
  const nearViewport = useNearViewport(rootRef, enabled);
  const [visual, setVisual] = React.useState<ClipMediaVisual | null>(null);

  React.useEffect(() => {
    if (!nearViewport || clip.kind === 'image') return;
    let current = true;
    void getClipMediaVisual(url, clip.kind).then(result => {
      if (current) setVisual(result);
    });
    return () => { current = false; };
  }, [clip.kind, nearViewport, url]);

  if (!enabled) return null;
  const dataUrl = clip.kind === 'image' ? url : visual?.dataUrl;
  if (!dataUrl) {
    return <span ref={rootRef} className={`clip-media-strip is-${clip.kind} is-loading`} aria-hidden />;
  }
  const sourceWindow = clip.loop ? { leftPercent: 0, widthPercent: 100 } : mediaSourceWindow(
    clip.sourceIn,
    clip.duration,
    visual?.duration || clip.sourceDuration,
    clip.playbackRate,
  );
  return (
    <span ref={rootRef} className={`clip-media-strip is-${clip.kind}${clip.loop ? ' is-loop' : ''}`} aria-hidden>
      <span
        className="clip-media-strip-source"
        style={{
          left: `${sourceWindow.leftPercent}%`,
          width: `${sourceWindow.widthPercent}%`,
          backgroundImage: `url(${JSON.stringify(dataUrl)})`,
        }}
      />
    </span>
  );
});
