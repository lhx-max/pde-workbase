import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceCollabContext } from '@bezier/contracts';
import { getBezierHost } from '@bezier/host';
import { useT } from '../i18n';
import { requestSaveAsset } from '../state/save-asset';
import { BrowserCaptureToolbar } from './BrowserCaptureToolbar';
import {
  captureHttpUrl, EMBEDDED_CAPTURE_HINT_PREFIX, embeddedCaptureObserverScript,
  parseEmbeddedCaptureHint, READ_EMBEDDED_SELECTION_SCRIPT, SELECTION_LIMIT,
  stopEmbeddedCaptureObserverScript, type EmbeddedCaptureHint,
} from '../browser-capture/embedded-capture-tools';

export interface CaptureWebview extends HTMLElement {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getWebContentsId(): number;
}

async function readSelection(node: CaptureWebview, message: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      node.executeJavaScript(READ_EMBEDDED_SELECTION_SCRIPT),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

type ImageAction = { x: number; y: number; width: number; height: number; alt?: string; src?: string };
type Options = {
  node: CaptureWebview | null;
  currentUrl: string;
  projectId: string;
  workspaceContext?: WorkspaceCollabContext | null;
  enabled: boolean;
  selectionOverlayEnabled?: boolean;
  imageOverlayEnabled?: boolean;
  onNotice: (message: string) => void;
  onAddImageToChat?: (image: ImageAction) => void;
};

/** Native browser capture uses the same product dialog and asset API as canvas
 * saves. Guest hints only reveal a host-owned action; they cannot start reads,
 * downloads, saves, or AI. A captured draft is immutable across navigation. */
export function useBrowserAssetCapture({ node, currentUrl, projectId, workspaceContext, enabled, selectionOverlayEnabled = true, imageOverlayEnabled = true, onNotice, onAddImageToChat }: Options) {
  const t = useT();
  const [hint, setHint] = useState<EmbeddedCaptureHint | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const hoverRef = useRef(false);
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const imageReader = getBezierHost()?.browser.readImage;
  const readable = enabled && !!node && !!captureHttpUrl(currentUrl);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; epochRef.current++; }; }, []);

  useEffect(() => {
    setHint(null);
    epochRef.current++;
    if (!node || !readable) return;
    const id = crypto.randomUUID();
    const prefix = `${EMBEDDED_CAPTURE_HINT_PREFIX}${id}:`;
    let alive = true;
    const inject = () => {
      if (!alive || (!selectionOverlayEnabled && !imageOverlayEnabled)) return;
      try { void node.executeJavaScript(embeddedCaptureObserverScript(id, currentUrl, !!imageReader && imageOverlayEnabled, selectionOverlayEnabled)).catch(() => undefined); } catch { /* Await dom-ready. */ }
    };
    const observe = (event: Event) => {
      const message = (event as Event & { message?: string }).message;
      if (!alive || typeof message !== 'string' || !message.startsWith(prefix) || message.length > 12_000) return;
      try {
        const next = parseEmbeddedCaptureHint(JSON.parse(message.slice(prefix.length)));
        if (next && !(next.kind === 'selection' ? selectionOverlayEnabled : imageOverlayEnabled && !!imageReader)) return;
        if (next || !hoverRef.current) setHint(next);
      } catch { /* Malformed page output never acts. */ }
    };
    const clear = () => { epochRef.current++; hoverRef.current = false; setHint(null); if (busyRef.current) onNotice(''); };
    const navigation = (event: Event) => { if ((event as Event & { isMainFrame?: boolean }).isMainFrame !== false) clear(); };
    node.addEventListener('console-message', observe);
    node.addEventListener('dom-ready', inject);
    node.addEventListener('did-start-navigation', navigation);
    node.addEventListener('context-menu', clear);
    inject();
    return () => {
      alive = false; epochRef.current++;
      node.removeEventListener('console-message', observe);
      node.removeEventListener('dom-ready', inject);
      node.removeEventListener('did-start-navigation', navigation);
      node.removeEventListener('context-menu', clear);
      try { void node.executeJavaScript(stopEmbeddedCaptureObserverScript(id)).catch(() => undefined); } catch { /* Guest closed. */ }
    };
  }, [node, readable, currentUrl, imageReader, selectionOverlayEnabled, imageOverlayEnabled]);

  const run = useCallback(async (kind: 'selection' | 'image', value?: string, alt?: string) => {
    if (!node || !readable || busyRef.current) return;
    const epoch = epochRef.current;
    const valid = () => mountedRef.current && epochRef.current === epoch;
    busyRef.current = true; setBusy(true); setHint(null); onNotice('');
    let objectUrl: string | undefined;
    try {
      const source = { url: currentUrl, projectId };
      if (kind === 'selection') {
        let text = value;
        // Context-menu text comes from native Chromium. Floating buttons re-read
        // the live selection; the untrusted observer never supplies its content.
        if (text === undefined) {
          const selection = await readSelection(node, t('browserCapture.native.failed')) as { text?: unknown; pageUrl?: unknown } | null;
          if (!valid()) return;
          if (selection?.pageUrl !== currentUrl || typeof selection.text !== 'string') throw new Error(t('browserCapture.native.emptySelection'));
          text = selection.text;
        }
        if (!text.trim() || text.length > SELECTION_LIMIT) throw new Error(t('browserCapture.native.emptySelection'));
        if (!valid()) return;
        const asset = await requestSaveAsset({
          name: text.trim().replace(/\s+/g, ' ').slice(0, 80), filename: 'selection.txt',
          mime: 'text/plain', kind: 'text', text, source, workspaceContext, inspectAfterSave: true,
        });
        if (asset && mountedRef.current) onNotice(t('browserCapture.native.saved'));
      } else {
        if (!imageReader) throw new Error(t('browserCapture.native.restartRequired'));
        const url = captureHttpUrl(value);
        if (!url) throw new Error(t('browserCapture.native.invalidImage'));
        onNotice(t('browserCapture.native.readingImage'));
        const image = await imageReader(node.getWebContentsId(), url);
        if (!valid()) return;
        if (image.pageUrl !== currentUrl || image.url !== url) throw new Error(t('browserCapture.native.pageChanged'));
        const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
        const ext = extensions[image.mime];
        if (!ext || !image.base64 || image.base64.length > 70 * 1024 * 1024) throw new Error(t('browserCapture.native.invalidImage'));
        const bytes = Uint8Array.from(atob(image.base64), character => character.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
        onNotice('');
        const asset = await requestSaveAsset({
          name: (alt?.trim() || image.title || t('browserCapture.defaultImageName')).slice(0, 240),
          filename: `web-image.${ext}`, mime: image.mime, kind: 'image', url: objectUrl,
          source, workspaceContext, inspectAfterSave: true,
        });
        if (asset && mountedRef.current) onNotice(t('browserCapture.native.saved'));
      }
    } catch (error) {
      if (valid()) onNotice(error instanceof Error ? error.message : t('browserCapture.native.failed'));
    } finally {
      // SaveAssetDialog owns a frozen draft while open. Keep its local bytes
      // until save/cancel settles, even if the originating tab is closed.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [node, readable, currentUrl, projectId, workspaceContext, imageReader, onNotice, t]);

  const dismiss = () => { hoverRef.current = false; setHint(null); };
  const width = node?.clientWidth || 1024;
  const height = node?.clientHeight || 768;
  const showHint = hint && (hint.kind === 'selection' ? selectionOverlayEnabled : imageOverlayEnabled && !!imageReader);
  const toolbar = readable && hint && showHint && !busy ? <BrowserCaptureToolbar
    hint={hint} viewport={{ width, height }}
    labels={{ toolbar: t('browserCapture.native.toolbar'), saveShort: t('browserCapture.native.saveShort'),
      save: t(hint.kind === 'image' ? 'browserCapture.native.saveImage' : 'browserCapture.native.saveSelection'),
      chat: t('designBrowser.addImageToChatButton') }}
    onRetain={() => { hoverRef.current = true; }} onDismiss={dismiss}
    onSave={() => void run(hint.kind, hint.kind === 'image' ? hint.url : undefined, hint.kind === 'image' ? hint.alt : undefined)}
    onAddToChat={hint.kind === 'image' && onAddImageToChat ? () => {
      const image = hint; dismiss(); onAddImageToChat({ ...image, src: image.url });
    } : undefined}
  /> : null;
  return { toolbar, busy, dismiss, saveSelection: (text?: string) => run('selection', text), saveImage: (url: string, alt?: string) => run('image', url, alt) };
}
