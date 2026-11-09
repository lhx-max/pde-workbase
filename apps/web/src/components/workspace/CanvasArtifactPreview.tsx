import React from 'react';
import { useT } from '../../i18n';
import { captureHostIframeSnapshot } from '../../runtime/exports';
import { useThumbnailLoadSlot } from '../../lib/thumbnail-load-gate';
import { parseDeckThumbnails } from '../../runtime/deck-thumbnail-parser';
import { deckPreviewFit } from '../../runtime/deck-preview-fit';

export type CanvasArtifactPreviewProps = {
  src: string; title: string; presentation: boolean; detail: boolean; nearby: boolean;
  onFrameReady: (frame: HTMLIFrameElement) => void;
};
// Compositor captures only: never reconstruct HTML or replace it with a summary.
type Position = { x: number; y: number; hash: string };
type Design = { designWidth: number; designHeight: number };
function readDesign(html = '', baseHref?: string): Design {
  const { designWidth, designHeight } = parseDeckThumbnails(html, baseHref);
  return { designWidth, designHeight };
}
// Use FileViewer's parser fallback even before onLoad: never boot a deck at a
// card-sized/mobile viewport. Parsed thumbnails are NOT used to render content.
const defaultDesign = readDesign();
const WEB_CARD_VIEWPORT = { designWidth: 1920, designHeight: 1080 };
const pictures = new Map<string, { image: string; position: Position; design: Design }>();
let capturing = false;

export function CanvasArtifactPreview({ src, title, presentation, detail, nearby, onFrameReady }: CanvasArtifactPreviewProps) {
  const t = useT();
  const container = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [design, setDesign] = React.useState(() => pictures.get(src)?.design ?? (presentation ? defaultDesign : WEB_CARD_VIEWPORT));
  const [canvas, setCanvas] = React.useState<{ width: number; height: number } | null>(null);
  const fit = React.useMemo(() => deckPreviewFit(canvas, design), [canvas, design]);
  const committedFit = React.useRef(fit);
  React.useLayoutEffect(() => { committedFit.current = fit; }, [fit]);
  React.useLayoutEffect(() => {
    const target = container.current;
    if (!target) return;
    const measure = (width: number, height: number) => setCanvas(previous =>
      previous?.width === width && previous.height === height ? previous : { width, height });
    // ReactFlow transforms getBoundingClientRect; using it here would apply
    // canvas zoom twice. These are the untransformed content-box dimensions.
    measure(target.clientWidth, target.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries.find(item => item.target === target);
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const position = React.useRef(pictures.get(src)?.position ?? { x: 0, y: 0, hash: '' });
  const readyCallback = React.useRef(onFrameReady);
  readyCallback.current = onFrameReady;
  const [picture, setPicture] = React.useState(() => pictures.get(src)?.image);
  const [loaded, setLoaded] = React.useState(false);
  const [sleeping, setSleeping] = React.useState(Boolean(picture));
  const wanted = (nearby || detail) && (detail || !sleeping);
  const { canLoad, settle } = useThumbnailLoadSlot(wanted, true, false);
  const live = wanted && canLoad;

  React.useEffect(() => { if (!live) setLoaded(false); }, [live]);
  React.useEffect(() => { if (detail) setSleeping(false); }, [detail]);
  React.useEffect(() => {
    if (detail || !live || !loaded || !fit) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const capture = async () => {
      const target = frame.current;
      if (!target || cancelled || document.hidden) return;
      const geometryIsCurrent = () => committedFit.current === fit && !!canvas && !!container.current
        && Math.abs(container.current.clientWidth - canvas.width) < 1
        && Math.abs(container.current.clientHeight - canvas.height) < 1;
      if (!geometryIsCurrent()) return;
      if (capturing || target.closest('.is-interacting')) {
        if (++attempts < 8) timer = setTimeout(capture, 500);
        return;
      }
      const rect = target.getBoundingClientRect();
      // Never cache a clipped page. On capture failure the original stays put.
      if (rect.width < 8 || rect.height < 8 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return;
      const bounds = target.closest('.react-flow')?.getBoundingClientRect();
      if (bounds && (rect.left < bounds.left || rect.top < bounds.top || rect.right > bounds.right || rect.bottom > bounds.bottom)) return;
      capturing = true;
      try {
        const captured = await captureHostIframeSnapshot(target);
        if (!captured || cancelled || !target.isConnected || !geometryIsCurrent()) return;
        const after = target.getBoundingClientRect();
        if (Math.abs(after.left - rect.left) + Math.abs(after.top - rect.top) + Math.abs(after.width - rect.width) + Math.abs(after.height - rect.height) > 1) return;
        if (captured.dataUrl.length > 2_000_000) return;
        const image = new Image(); image.src = captured.dataUrl; await image.decode();
        if (cancelled || !geometryIsCurrent() || target.closest('.is-interacting')) return;
        const win = target.contentWindow;
        if (win) position.current = { x: win.scrollX, y: win.scrollY, hash: win.location.hash };
        pictures.delete(src); pictures.set(src, { image: captured.dataUrl, position: position.current, design });
        while (pictures.size > 12) pictures.delete(pictures.keys().next().value!);
        setPicture(captured.dataUrl); setSleeping(true); settle();
      } catch { /* Unsupported host or capture failure: retain the actual page. */ }
      finally { capturing = false; }
    };
    timer = setTimeout(capture, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [detail, live, loaded, src, settle, presentation, fit, canvas, design]);

  return <div ref={container} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} data-canvas-artifact-preview={sleeping && !detail ? 'snapshot' : 'live'}>
    {live && <iframe ref={frame} src={src + position.current.hash} title={presentation ? t('canvas.artifactPreview.ppt') : t('canvas.artifactPreview.web')}
      className="basic-output-live-preview nodrag nopan" sandbox="allow-scripts allow-same-origin"
      style={{
        position: 'absolute', width: design.designWidth, height: design.designHeight,
        maxWidth: 'none', maxHeight: 'none', border: 0,
        left: fit?.left ?? 0, top: fit?.top ?? 0,
        transform: `scale(${fit?.scale ?? 1})`, transformOrigin: 'top left',
        visibility: fit ? 'visible' : 'hidden',
      }}
      onLoad={async event => {
        const target = event.currentTarget;
        setLoaded(false);
        if (presentation) {
          try {
            const html = target.contentDocument?.documentElement?.outerHTML;
            if (html) {
              const next = readDesign(html, target.src);
              setDesign(previous => previous.designWidth === next.designWidth && previous.designHeight === next.designHeight ? previous : next);
            }
          } catch { /* Cross-origin: keep the shared fallback/cached geometry. */ }
        }
        readyCallback.current(target);
        try {
          await Promise.race([target.contentDocument?.fonts?.ready, new Promise(resolve => setTimeout(resolve, 3000))]);
          target.contentWindow?.scrollTo(position.current.x, position.current.y);
        } catch { /* cross-origin */ }
        if (target.isConnected && target === frame.current) { setLoaded(true); settle(); }
      }} onError={settle} />}
    {picture && (!live || !loaded) && <img src={picture} alt={title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />}
  </div>;
}
