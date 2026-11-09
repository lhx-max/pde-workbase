import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

type DialogLayer = { panel: RefObject<HTMLElement>; zIndex: number | undefined };

/** Shared by the compatibility shell and the portalled Radix surface. */
export const DialogLayerContext = createContext<DialogLayer | null>(null);

function highestAncestorLayer(element: HTMLElement | null): number {
  let highest = 0;
  for (let node = element; node; node = node.parentElement) {
    const value = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(value)) highest = Math.max(highest, value);
  }
  return highest;
}

export function useDialogLayer() {
  const parent = useContext(DialogLayerContext);
  const panel = useRef<HTMLElement | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const setPanel = useCallback((node: HTMLElement | null) => {
    panel.current = node;
    if (node) {
      // A closed DialogSurface may stay mounted across multiple opens.
      // Read the trigger on portal mount, before Radix transfers focus.
      const triggerDialog = document.activeElement?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
      if (!triggerDialog || !node.contains(triggerDialog)) setOpener(triggerDialog);
    }
    setElement(node);
  }, []);
  const [zIndex, setZIndex] = useState<number>();
  useLayoutEffect(() => {
    const parentPanel = parent?.panel.current ?? (opener?.isConnected ? opener : null);
    if (!element) return;
    if (!parentPanel || parentPanel === element) {
      setZIndex(undefined);
      return;
    }
    // Read the real parent, including legacy CSS overrides and stacking
    // ancestors. Reserve one level for the child scrim and one for its panel.
    setZIndex(Math.max(highestAncestorLayer(parentPanel), parent?.zIndex ?? 0) + 2);
  }, [parent, opener, element]);
  const context = useMemo(() => ({ panel, zIndex }), [zIndex]);
  return { panel, setPanel, zIndex, context };
}
