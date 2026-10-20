import { useEffect, useState, type RefObject } from 'react';
import { CanvasViewToolbar } from '@bezier/components';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useI18n } from '../i18n';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;

interface Props {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  disabled?: boolean;
}

/** Reuse the board's chrome, while Excalidraw remains the only history owner.
 * Its public API does not expose undo/redo. Activate its own disabled-aware
 * buttons instead of keeping a competing history or synthesizing shortcuts.
 */
export function SketchViewControls({ apiRef, canvasRef, zoom, disabled }: Props) {
  const { t } = useI18n();
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const nativeHistoryButton = (action: 'undo' | 'redo') =>
    canvasRef.current?.querySelector<HTMLButtonElement>(`.excalidraw [data-testid="button-${action}"]`);

  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const sync = () => {
      const undo = root.querySelector<HTMLButtonElement>('.excalidraw [data-testid="button-undo"]');
      const redo = root.querySelector<HTMLButtonElement>('.excalidraw [data-testid="button-redo"]');
      const next = { canUndo: Boolean(undo && !undo.disabled), canRedo: Boolean(redo && !redo.disabled) };
      setHistory(previous => previous.canUndo === next.canUndo && previous.canRedo === next.canRedo ? previous : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, [canvasRef]);

  const focusCanvas = () => canvasRef.current?.querySelector<HTMLElement>('.excalidraw')?.focus({ preventScroll: true });
  const zoomTo = (requested: number) => {
    const api = apiRef.current;
    if (!api || disabled) return;
    const state = api.getAppState();
    const value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requested));
    const previous = state.zoom.value;
    // Preserve the scene point under the viewport centre, not the top-left.
    api.updateScene({
      appState: {
        zoom: { value: value as AppState['zoom']['value'] },
        scrollX: state.scrollX + state.width / 2 * (1 / value - 1 / previous),
        scrollY: state.scrollY + state.height / 2 * (1 / value - 1 / previous),
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    focusCanvas();
  };
  const historyAction = (action: 'undo' | 'redo') => {
    if (disabled) return;
    const button = nativeHistoryButton(action);
    if (button && !button.disabled) { button.click(); focusCanvas(); }
  };

  return <CanvasViewToolbar
    ariaLabel={t('sketch.viewControls')}
    zoom={zoom} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} disabled={disabled}
    onZoomOut={() => zoomTo((apiRef.current?.getAppState().zoom.value ?? zoom) / 1.2)}
    onZoomIn={() => zoomTo((apiRef.current?.getAppState().zoom.value ?? zoom) * 1.2)}
    onZoomTo={zoomTo}
    onFitView={() => { if (!disabled) { apiRef.current?.scrollToContent(undefined, { fitToContent: true }); focusCanvas(); } }}
    history={{ ...history, onUndo: () => historyAction('undo'), onRedo: () => historyAction('redo') }}
    labels={{ zoomOut: t('fileViewer.zoomOut'), zoomIn: t('fileViewer.zoomIn'),
      zoomOptions: t('sketch.zoomOptions'), fitView: t('sketch.fitView'),
      undo: t('sketch.undo'), redo: t('sketch.redo'),
      zoomValue: percent => t('sketch.zoomValue', { percent }),
    }}
  />;
}
