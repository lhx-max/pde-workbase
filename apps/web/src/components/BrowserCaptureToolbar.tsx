import { Button } from '@bezier/components';
import type { EmbeddedCaptureHint } from '../browser-capture/embedded-capture-tools';
import { Icon } from './Icon';
import { ProductLogo } from './ProductLogo';
import styles from './BrowserAssetCapture.module.css';

interface Props {
  hint: EmbeddedCaptureHint;
  viewport: { width: number; height: number };
  labels: { toolbar: string; save: string; saveShort?: string; chat: string };
  onSave: () => void;
  onAddToChat?: () => void;
  onRetain: () => void;
  onDismiss: () => void;
}

/** Plugin-style brand badge and optional chat badge, with labels on intent.
 * CSS anchors the actual translated width, including expanded/localized text. */
export function BrowserCaptureToolbar({ hint, viewport, labels, onSave, onAddToChat, onRetain, onDismiss }: Props) {
  const image = hint.kind === 'image';
  const height = 40;
  const left = Math.max(8, Math.min(image ? hint.x + hint.width - 8 : hint.x, viewport.width - 8));
  const below = hint.y + hint.height + 8;
  const preferredTop = image ? hint.y + 8 : below + height <= viewport.height - 8 ? below : hint.y - height - 8;
  const top = Math.max(8, Math.min(preferredTop, viewport.height - height - 8));
  const transform = image
    ? `translateX(max(${8 - left}px, -100%))`
    : `translateX(min(0px, calc(${viewport.width - left - 8}px - 100%)))`;

  return <div className={styles.toolbar} style={{ left, top, transform }} data-capture-kind={hint.kind}
    role="toolbar" aria-label={labels.toolbar}
    onPointerEnter={onRetain} onPointerLeave={onDismiss} onFocusCapture={onRetain}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDismiss(); }}
    onMouseDown={event => event.preventDefault()}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onDismiss(); } }}
  >
    <Button variant="ghost" className={styles.action} aria-label={labels.save} onClick={onSave}>
      <ProductLogo className={styles.brand} decorative />
      <span className={styles.label} aria-hidden="true">{labels.saveShort ?? labels.save}</span>
    </Button>
    {image && onAddToChat && <Button variant="ghost" className={styles.action} aria-label={labels.chat} onClick={onAddToChat}>
      <span className={styles.chatMark}><Icon name="comment" size={17} /></span>
      <span className={styles.label} aria-hidden="true">{labels.chat}</span>
    </Button>}
  </div>;
}
