/**
 * ConfirmDialog — the one destructive-confirmation surface.
 *
 * Why this exists: Settings still reached for the browser's native
 * `window.confirm()` in two places (clearing a media provider key, clearing
 * memory extraction history). Native confirm renders OS chrome that ignores
 * every DA token, cannot be styled, blocks the main thread, and — most
 * importantly — is invisible to the component boundary checks, so those two
 * destructive paths were the only ones in the app not using the shared
 * `role="alertdialog"` pattern that `MoveToTeamConfirmDialog`,
 * `DesignSystemsTab` and `NewProjectPanel` already share.
 *
 * This component owns only the confirmation shell (alertdialog role, title,
 * body copy, cancel/confirm rail, Escape + backdrop close). Callers keep their
 * own business state and decide what "confirm" does. It intentionally does not
 * manage its own open state: render it conditionally, exactly like the
 * existing alertdialog consumers do.
 */

import { useId, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from './dialog';

export interface ConfirmDialogProps {
  title: ReactNode;
  /** Consequence copy. Keep it about what is lost, not about the button. */
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  /**
   * Paint the confirm action as destructive. Defaults to true because every
   * current consumer is a delete/clear; pass false for neutral confirmations.
   */
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <Dialog
      className="modal-confirm"
      role="alertdialog"
      onClose={onCancel}
      closeOnEscape
      ariaLabelledBy={titleId}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {description != null ? <DialogDescription>{description}</DialogDescription> : null}
      <DialogFooter className="row">
        <Button type="button" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant="primary"
          {...(destructive ? { className: 'danger' } : {})}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
