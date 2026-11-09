import {
  useEffect,
  forwardRef,
  type ComponentPropsWithoutRef,
  type FormEventHandler,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/src/lib/utils';
import { DialogLayerContext, useDialogLayer } from './dialog-layer';

// ─── Types ────────────────────────────────────────────────────────────────────

type DialogTag = 'div' | 'form';
type DialogLayout = 'default' | 'sectioned';

export interface DialogProps {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  backdropClassName?: string;
  /** Static by default; preserves positioning, focus and dismissal behavior. */
  disableAnimation?: boolean;
  /**
   * When true (default), applies the `.modal` and `.modal-backdrop` class names
   * that business CSS layers depend on for scoped overrides.
   * Set to false only for embedded/inline usage where the backdrop chrome
   * should not be rendered.
   */
  includeChromeClassName?: boolean;
  id?: string;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  /** Close when the backdrop is clicked (default: true). */
  closeOnBackdrop?: boolean;
  /** Close on Escape key press (default: false). */
  closeOnEscape?: boolean;
  layout?: DialogLayout;
  as?: DialogTag;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  [key: `data-${string}`]: string | number | undefined;
}

type DialogSectionProps = ComponentPropsWithoutRef<'div'>;
type DialogHeadingProps = ComponentPropsWithoutRef<'h2'>;
type DialogDescriptionProps = ComponentPropsWithoutRef<'p'>;

// ─── Dialog ──────────────────────────────────────────────────────────────────

/**
 * Dialog — static modal panel and backdrop by default.
 *
 * Drop-in replacement for `@bezier/components` Dialog.
 * Preserves `.modal` and `.modal-backdrop` class names that many BEM CSS
 * layers use for scoped overrides — do not remove them.
 *
 * @example
 *   <Dialog onClose={close} closeOnEscape>
 *     <DialogTitle>Confirm</DialogTitle>
 *     <DialogBody>Are you sure?</DialogBody>
 *     <DialogFooter>
 *       <Button variant="ghost" onClick={close}>Cancel</Button>
 *       <Button variant="primary" onClick={confirm}>OK</Button>
 *     </DialogFooter>
 *   </Dialog>
 */
export function Dialog({
  children,
  onClose,
  className,
  backdropClassName,
  disableAnimation = true,
  includeChromeClassName = true,
  id,
  role = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  closeOnBackdrop = true,
  closeOnEscape = false,
  layout = 'default',
  as = 'div',
  onSubmit,
  ...dataAttributes
}: DialogProps) {
  const layer = useDialogLayer();
  useEffect(() => {
    if (!onClose || !closeOnEscape) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      const targetDialog = target instanceof Element ? target.closest('[role="dialog"], [role="alertdialog"]') : null;
      if (targetDialog && targetDialog !== layer.panel.current) return;
      event.preventDefault();
      onClose?.();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, onClose]);

  const panelClassName = cn(
    // IMPORTANT: .modal must be preserved — many CSS files scope their
    // overrides under `.modal .xxx` (mention-home.css, tools.css, etc.)
    includeChromeClassName && 'modal',
    includeChromeClassName && dialogPanelBase,
    includeChromeClassName && layout === 'sectioned' && dialogSectionedBase,
    className,
  );

  const sharedProps = {
    id,
    className: panelClassName,
    style: disableAnimation ? { animation: 'none', transition: 'none' } : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    role,
    'aria-modal': 'true' as const,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    ...dataAttributes,
  };

  return (
    <DialogLayerContext.Provider value={layer.context}>
    <div
      style={{ ...(layer.zIndex === undefined ? {} : { zIndex: layer.zIndex }), ...(disableAnimation ? { animation: 'none', transition: 'none' } : {}) }}
      className={cn(
        // IMPORTANT: .modal-backdrop must be preserved — CSS files depend on it
        includeChromeClassName && 'modal-backdrop',
        includeChromeClassName && backdropBase,
        backdropClassName,
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      {as === 'form' ? (
        <form {...sharedProps} ref={layer.setPanel} onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div {...sharedProps} ref={layer.setPanel}>{children}</div>
      )}
    </div>
    </DialogLayerContext.Provider>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

export function DialogHeader({ className, ...props }: DialogSectionProps) {
  return <div className={cn(dialogHeaderBase, className)} {...props} />;
}

export function DialogBody({ className, ...props }: DialogSectionProps) {
  return <div className={cn(dialogBodyBase, className)} {...props} />;
}

export function DialogFooter({ className, ...props }: DialogSectionProps) {
  return <div className={cn(dialogFooterBase, className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogHeadingProps) {
  return <h2 className={cn(dialogTitleBase, className)} {...props} />;
}

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <p className={cn(dialogDescriptionBase, className)} {...props} />;
}

// ─── Style constants (mirrors dialog.module.css exactly) ─────────────────────
//
// Using string constants rather than Tailwind utilities for the animation
// keyframes — those remain in the CSS module file which is still imported by
// @bezier/components.  The structural styles here use tokens directly.

const backdropBase = [
  'fixed inset-0',
  'flex items-center justify-center',
  'bg-[color-mix(in_srgb,#202020_42%,transparent)]',
  'backdrop-blur-[4px]',
  '[-webkit-backdrop-filter:blur(4px)]',
  '[-webkit-app-region:no-drag]',
  'z-[100]',
].join(' ');

const dialogPanelBase = [
  'bg-bg-elevated',
  '[-webkit-app-region:no-drag]',
  'rounded-[var(--radius-lg)]',
  'p-[22px]',
  'w-[520px] max-w-[calc(100vw-32px)]',
  'flex flex-col gap-3',
  'shadow-[var(--shadow-lg)]',
].join(' ');

const dialogSectionedBase = 'p-0 gap-0';

const dialogHeaderBase = 'flex flex-col gap-1';

const dialogBodyBase = 'flex flex-col gap-3';

const dialogFooterBase = 'flex justify-end gap-2';

const dialogTitleBase = 'm-0 text-[20px] font-semibold tracking-normal text-text';

const dialogDescriptionBase = 'm-0 text-[13px] leading-[125%] text-text-muted';
