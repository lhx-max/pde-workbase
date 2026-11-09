import { forwardRef, useCallback } from 'react';
import { DialogContent, type DialogContentProps } from '@/src/components/animate-ui/components/radix/dialog';
import { DialogLayerContext, useDialogLayer } from './dialog-layer';

/** Layering belongs to this adapter, never to individual confirmation forms. */
export const DialogSurface = forwardRef<HTMLDivElement, DialogContentProps>(function DialogSurface(
  { style, overlayStyle, onEscapeKeyDown, ...props }, ref,
) {
  const layer = useDialogLayer();
  const setPanel = layer.setPanel;
  const composedRef = useCallback((node: HTMLDivElement | null) => {
    setPanel(node);
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [setPanel, ref]);
  return <DialogLayerContext.Provider value={layer.context}>
    <DialogContent {...props}
      ref={composedRef}
      style={{ ...style, ...(layer.zIndex === undefined ? {} : { zIndex: layer.zIndex }) }}
      overlayStyle={{ ...overlayStyle, ...(layer.zIndex === undefined ? {} : { zIndex: layer.zIndex - 1 }) }}
      onEscapeKeyDown={(event) => {
        onEscapeKeyDown?.(event);
        // Radix still owns dismissal (including preventDefault for busy forms).
        // Do not let legacy document bubble listeners close the parent too.
        event.stopPropagation();
      }}
    />
  </DialogLayerContext.Provider>;
});
