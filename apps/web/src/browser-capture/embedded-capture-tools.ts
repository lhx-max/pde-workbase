/** Guest observations are untrusted hints, never commands. Only a host-side
 * button can read image bytes or open the product save dialog. No credentials,
 * app bridge, or user data are installed into the page. */
export type CaptureRect = { x: number; y: number; width: number; height: number };
export type EmbeddedCaptureHint = CaptureRect & ({ kind: 'selection' } | { kind: 'image'; url: string; alt: string });
export const EMBEDDED_CAPTURE_HINT_PREFIX = '__loom_capture_hint__:';
export const SELECTION_LIMIT = 100_000;

export function captureHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^https?:\/\/[^/]*@/i.test(value)) return null;
    return url.href;
  } catch { return null; }
}

export function parseEmbeddedCaptureHint(value: unknown): EmbeddedCaptureHint | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!['x', 'y', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]) && Math.abs(item[key] as number) < 100_000)) return null;
  const rect = { x: item.x as number, y: item.y as number, width: item.width as number, height: item.height as number };
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (item.kind === 'selection') return { ...rect, kind: 'selection' };
  const url = captureHttpUrl(item.url);
  if (item.kind !== 'image' || !url) return null;
  return { ...rect, kind: 'image', url, alt: typeof item.alt === 'string' ? item.alt.slice(0, 240) : '' };
}

/** Pure DOM observer; emits only geometry and an image URL, not selection text.
 * Editable/password controls are deliberately excluded from automatic hints. */
export function embeddedCaptureObserverScript(id: string, pageUrl: string, images: boolean, selections = true): string {
  return `(() => {
    const key = '__loomCaptureObserver';
    window[key]?.stop();
    if (location.href !== ${JSON.stringify(pageUrl)}) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let image = null, pointer = null, queued = false, last = '', stopped = false, suppressed = false;
    const rect = r => ({ x: r.left, y: r.top, width: r.width, height: r.height });
    // Cover links and hover controls can be deeply nested siblings of a picture.
    // Resolve them only through the nearest small image-bearing container, with
    // a bounded ancestor walk; never search behind unrelated dialogs/headers
    // or change the site's hit testing. Editable fields remain excluded.
    const imageAtPointer = () => {
      if (!pointer) return null;
      const { x, y } = pointer;
      const positioned = Number.isFinite(x) && Number.isFinite(y);
      const target = positioned && document.elementFromPoint ? document.elementFromPoint(x, y) : pointer.target;
      if (!(target instanceof Element)) return null;
      const direct = target.closest('img');
      if (direct) return direct;
      if (!positioned || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return null;
      for (let scope = target, depth = 0; scope && depth < 16 && scope !== document.body && scope !== document.documentElement; scope = scope.parentElement, depth++) {
        if (scope.matches('header,nav,dialog,[role="dialog"]')) return null;
        const images = scope.querySelectorAll('img');
        if (!images.length) continue;
        if (images.length > 32) return null;
        const container = scope.getBoundingClientRect();
        const candidates = Array.from(images).filter(img => {
          const r = img.getBoundingClientRect(), style = getComputedStyle(img);
          return r.width >= 72 && r.height >= 56 && x >= r.left && x < r.right && y >= r.top && y < r.bottom
            && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0'
            && container.width <= r.width * 1.5 + 8 && container.height <= r.height * 2 + 8;
        });
        return candidates.length === 1 ? candidates[0] : null;
      }
      return null;
    };
    const editable = node => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return !!element?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    };
    const emit = value => {
      const encoded = JSON.stringify(value);
      if (encoded !== last) { last = encoded; console.info(${JSON.stringify(EMBEDDED_CAPTURE_HINT_PREFIX + id + ':')} + encoded); }
    };
    const update = () => {
      queued = false;
      if (stopped) return;
      const next = ${JSON.stringify(images)} ? imageAtPointer() : null;
      if (next !== image) { image = next; suppressed = false; }
      if (suppressed) { emit(null); return; }
      const selection = getSelection();
      if (${JSON.stringify(selections)} && selection && !selection.isCollapsed && selection.rangeCount && !editable(selection.anchorNode) && !editable(selection.focusNode)) {
        const text = selection.toString();
        if (text.trim() && text.length <= ${SELECTION_LIMIT}) {
          const r = selection.getRangeAt(0).getBoundingClientRect();
          if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) { emit({kind:'selection', ...rect(r)}); return; }
        }
      }
      if (${JSON.stringify(images)} && image?.isConnected) {
        const r = image.getBoundingClientRect();
        if (r.width >= 72 && r.height >= 56 && r.bottom > 0 && r.top < innerHeight) {
          emit({kind:'image', url:image.currentSrc || image.src, alt:(image.alt || '').slice(0,240), ...rect(r)}); return;
        }
      }
      emit(null);
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    document.addEventListener('selectionchange', () => { suppressed = false; schedule(); }, {signal});
    document.addEventListener('pointermove', event => {
      pointer = { target: event.target, x: event.clientX, y: event.clientY };
      schedule();
    }, {capture:true, signal});
    document.addEventListener('pointerleave', () => { pointer = null; image = null; schedule(); }, {signal});
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { suppressed = true; emit(null); } }, {capture:true, signal});
    document.addEventListener('contextmenu', () => { suppressed = true; emit(null); }, {capture:true, signal});
    addEventListener('scroll', schedule, {capture:true, signal});
    addEventListener('resize', schedule, {signal});
    window[key] = { id:${JSON.stringify(id)}, stop:() => { stopped = true; controller.abort(); } };
    update();
  })()`;
}

export function stopEmbeddedCaptureObserverScript(id: string): string {
  return `(() => { const observer = window.__loomCaptureObserver; if (observer?.id === ${JSON.stringify(id)}) { observer.stop(); delete window.__loomCaptureObserver; } })()`;
}

export const READ_EMBEDDED_SELECTION_SCRIPT = `(() => {
  const selection = getSelection();
  const editable = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  if (!selection || editable(selection.anchorNode) || editable(selection.focusNode)) return null;
  const text = selection.toString();
  if (!text.trim() || text.length > ${SELECTION_LIMIT}) return null;
  return { text, pageUrl:location.href };
})()`;
