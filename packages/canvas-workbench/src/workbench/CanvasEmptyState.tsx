import { MousePointer2 } from 'lucide-react';
import { xy } from '../locales/xyflow-canvas';
import styles from './CanvasEmptyState.module.css';

/** Viewport-level guidance: stays fixed while the empty canvas pans or zooms. */
export function CanvasEmptyState({ canDropFiles }: { canDropFiles: boolean }) {
  const copy = xy();
  return (
    <div className={styles.empty} data-testid="canvas-empty-state">
      <div className={styles.instruction}>
        <span>{canDropFiles ? copy.dropFiles : copy.addContent}</span>
        <span className={styles.gesture} aria-hidden="true">
          <span className={styles.ripple} />
          <MousePointer2 className={styles.pointer} size={30} strokeWidth={1.5} />
        </span>
        <span>{copy.startCreating}</span>
      </div>
      <p className={styles.hint}>{copy.emptyHint}</p>
    </div>
  );
}
