import { xy } from '../locales/xyflow-canvas';
import styles from './CanvasEmptyState.module.css';

/** Viewport-level guidance: stays fixed while the empty canvas pans or zooms. */
export function CanvasEmptyState(_props: { canDropFiles: boolean }) {
  const copy = xy();
  return (
    <div className={styles.empty} data-testid="canvas-empty-state">
      <p className={styles.hint}>{copy.emptyHint}</p>
    </div>
  );
}
