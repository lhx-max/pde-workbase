import type { ReactNode } from 'react';
import { cr } from '../locales/canvas-remainder';
import styles from './CanvasErrorNotice.module.css';

/** Keep provider diagnostics available without letting them take over a composer. */
export function CanvasErrorNotice({ error, title, message, children, placement }: {
  error: string;
  placement?: 'card';
  title?: string;
  message?: string;
  children?: ReactNode;
}) {
  const copy = cr();
  return <div className={`nodrag nopan nowheel ${styles.notice}${placement === 'card' ? ` ${styles.card}` : ''}`} role="alert" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <div className={styles.header}>
      <strong>{title || copy.operationFailed}</strong>
      {children && <div className={styles.actions}>{children}</div>}
    </div>
    {message && <span>{message}</span>}
    <details><summary>{copy.errorDetails}</summary><pre>{error}</pre></details>
  </div>;
}
