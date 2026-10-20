/** Shared keyboard boundaries for the project canvas and its inline editors. */
export const CANVAS_INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="textbox"]';
export const CANVAS_OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Leave typing, not the durable editor mode. The next Escape may clear selection. */
export function releaseCanvasInputFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.closest(CANVAS_OVERLAY_SELECTOR)) return false;
  if (!target.closest(CANVAS_INPUT_SELECTOR)) return false;
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  const owner = target.closest<HTMLElement>('.react-flow__node, [data-canvas-node-surface]')
    ?? target.closest<HTMLElement>('.xy-flow-host');
  owner?.focus({ preventScroll: true });
  return true;
}
