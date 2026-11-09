import React from 'react';
import { useCanvasPreviewScale, useCanvasRenderDetail } from './CanvasRenderPolicy';
import { useCanvasIdleWork } from '../platform/canvas-idle-work';

let decoding = 0;
const decodeQueue = new Set<() => void>();
function drainDecodes() {
  while (decoding < 2 && decodeQueue.size) {
    const start = decodeQueue.values().next().value!;
    decodeQueue.delete(start);
    start();
  }
}

/** Upgrades are bounded; canceled or failed upgrades leave the decoded image intact. */
function decodePreview(src: string, ready: () => void, work: ReturnType<typeof useCanvasIdleWork>) {
  let cancelled = false;
  let stop: (() => void) | undefined;
  const start = () => {
    decoding++;
    // A waiting decode slot may become available in the middle of a new gesture.
    const cancelStart = work.schedule(() => {
      const image = new Image();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        image.onload = null; image.onerror = null;
        decoding--;
        drainDecodes();
      };
      const timer = setTimeout(finish, 10_000);
      stop = () => { finish(); image.src = ''; };
      image.onload = async () => {
        try {
          await image.decode();
          if (!cancelled && !finished) ready();
        } catch { /* Keep the already displayed preview. */ }
        finally { finish(); }
      };
      image.onerror = finish;
      image.src = src;
    }, 0);
    stop = () => { cancelStart(); decoding--; drainDecodes(); };
  };
  decodeQueue.add(start);
  drainDecodes();
  return () => {
    if (cancelled) return;
    cancelled = true;
    decodeQueue.delete(start);
    stop?.();
  };
}

/** Preserve workspace credentials and revision; never rewrite external/data URLs. */
export function canvasPreviewUrl(src: string, kind: 'image' | 'poster' | 'video', width: number): string {
  if (!/^\/api\/projects\/[^/]+\/(?:files|raw)\//.test(src)) return src;
  const [base, hash] = src.split('#');
  const bucket = [128, 256, 512, 1024, 2048].find(value => value >= width) ?? 2048;
  return `${base}${base!.includes('?') ? '&' : '?'}odCanvasPreview=${kind}&odPreviewWidth=${bucket}${hash ? `#${hash}` : ''}`;
}

/** Keep original URLs intact for editing, exports, and zoom above preview resolution. */
export function canvasImageDisplayUrl(src:string,pixels:number,original=false):string {
  return original||pixels>2048?src:canvasPreviewUrl(src,'image',pixels);
}

export function CanvasPreviewImage({ src = '', previewSize = 420, original = false, onLoad, onError, ...props }:
  React.ImgHTMLAttributes<HTMLImageElement> & { previewSize?: number; original?: boolean }) {
  const scale = useCanvasPreviewScale();
  const { nearby } = useCanvasRenderDetail();
  const idleWork = useCanvasIdleWork();
  const candidate = canvasImageDisplayUrl(src, previewSize * scale * Math.min(globalThis.devicePixelRatio || 1, 2), original);
  const [displayed, setDisplayed] = React.useState({ source: src, url: candidate });
  const resolvedPreview = displayed.source === src && !original ? displayed.url : candidate;
  React.useEffect(() => {
    if (displayed.source !== src || (original && displayed.url !== candidate)) { setDisplayed({ source: src, url: candidate }); return; }
    if (displayed.url === candidate) return;
    let cancelDecode: (() => void) | undefined;
    let cancelCommit: (() => void) | undefined;
    const cancel = idleWork.schedule(() => {
      cancelDecode = decodePreview(candidate, () => {
        cancelCommit = idleWork.schedule(() => setDisplayed({ source: src, url: candidate }), 0);
      }, idleWork);
    }, 0);
    return () => { cancel(); cancelDecode?.(); cancelCommit?.(); };
  }, [candidate, displayed, idleWork, original, src]);
  const [failed, setFailed] = React.useState('');
  const resolved = failed === resolvedPreview ? src : resolvedPreview;
  // The canvas already tracks proximity to its transformed viewport. Visible
  // cards must not wait for the document's separate lazy-image heuristic.
  return <img {...props} src={resolved} loading={nearby ? 'eager' : 'lazy'} decoding="async" onLoad={event => {
    // A preview's natural dimensions must never overwrite original asset metadata.
    if (resolved === src) onLoad?.(event);
  }} onError={event => { if (resolved !== src) setFailed(resolvedPreview); else onError?.(event); }} />;
}
