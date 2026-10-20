import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BrowserResourceItem, BrowserResourceRead } from '@bezier/contracts';
import { resourceFile } from './client';

export interface ResourceThumbnailProps {
  item: BrowserResourceItem;
  navigationId: number;
  epoch?: number;
  read(resourceId: string, navigationId: number): Promise<BrowserResourceRead>;
  className?: string;
  enabled: boolean;
  fallback: ReactNode;
}

type ThumbnailWork = { cancelled: boolean; run(work: ThumbnailWork): Promise<void> };
const pending: ThumbnailWork[] = [];
let running = 0;

/** Share the read/decode budget across lists. Cancelled in-flight reads still
 * occupy their slot until they settle: the native read API is not abortable here. */
function drainThumbnails() {
  while (running < 2 && pending.length) {
    const work = pending.shift()!;
    if (work.cancelled) continue;
    running++;
    void work.run(work).catch(() => undefined).finally(() => { running--; drainThumbnails(); });
  }
}
function enqueueThumbnail(run: ThumbnailWork['run']): () => void {
  const work = { cancelled: false, run };
  pending.push(work);
  drainThumbnails();
  return () => {
    work.cancelled = true;
    const index = pending.indexOf(work);
    if (index !== -1) pending.splice(index, 1);
  };
}

function scrollingList(element: HTMLElement): Element | null {
  const marked = element.closest('[data-browser-resource-list]');
  if (marked) return marked;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(`${style.overflow} ${style.overflowY}`)) return parent;
  }
  return null;
}

/** Only the resized, inert raster survives decoding; no source-sized object URL
 * or cross-row byte cache is created. Native signature checks precede resourceFile. */
async function thumbnailBlob(file: File, current: () => boolean): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (!current()) return null;
    if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) return null;
    const scale = Math.min(1, 128 / bitmap.width, 128 / bitmap.height);
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
    canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/png'));
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function ResourceThumbnail({ item, navigationId, epoch = 0, read, className, enabled, fallback }: ResourceThumbnailProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const latestRead = useRef(read);
  latestRead.current = read;
  // Snapshot polling replaces item objects; only resource/lifecycle identity
  // changes should reset a failed attempt or discard a displayed thumbnail.
  const identity = useMemo(() => ({ id: item.id, navigationId, epoch, enabled, kind: item.kind, readable: item.readable }),
    [item.id, navigationId, epoch, enabled, item.kind, item.readable]);
  const [thumbnail, setThumbnail] = useState<{ identity: typeof identity; url: string; fail(): void } | null>(null);

  useEffect(() => {
    const element = wrapper.current;
    if (!element || !identity.enabled || identity.kind !== 'image' || !identity.readable
      || typeof IntersectionObserver === 'undefined' || typeof createImageBitmap === 'undefined') return;
    let disposed = false;
    let visible = false;
    let failed = false;
    let url: string | undefined;
    let cancel: (() => void) | undefined;
    const release = () => {
      cancel?.(); cancel = undefined;
      if (url) { URL.revokeObjectURL(url); url = undefined; }
      setThumbnail(null);
    };
    const fail = () => { failed = true; release(); };
    const observer = new IntersectionObserver(entries => {
      if (disposed) return;
      const entry = entries.filter(value => value.target === element).at(-1);
      if (!entry) return;
      const nextVisible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) { release(); return; }
      if (failed) return;
      cancel = enqueueThumbnail(async work => {
        const current = () => !disposed && visible && !work.cancelled;
        try {
          const result = await latestRead.current(identity.id, identity.navigationId);
          if (!current()) return;
          if (result.resourceId !== identity.id || result.navigationId !== identity.navigationId || !result.mime.startsWith('image/')) {
            throw new Error('Resource identity or kind changed');
          }
          const blob = await thumbnailBlob(resourceFile(result), current);
          if (!current()) return;
          if (!blob) { fail(); return; }
          url = URL.createObjectURL(blob);
          setThumbnail({ identity, url, fail });
        } catch { if (current()) fail(); }
      });
    }, { root: scrollingList(element), rootMargin: '0px', threshold: 0 });
    observer.observe(element);
    return () => { disposed = true; observer.disconnect(); release(); };
  }, [identity]);

  const shown = thumbnail?.identity === identity ? thumbnail : null;
  return <div ref={wrapper} className={className} data-browser-resource-thumbnail>
    {shown ? <img src={shown.url} alt="" onError={shown.fail} /> : fallback}
  </div>;
}
