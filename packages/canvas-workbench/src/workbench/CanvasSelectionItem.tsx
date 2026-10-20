'use client';

import React from 'react';

export type CanvasSelectionSemantics = 'pressed' | 'selected' | 'checked';

export interface CanvasSelectionItemProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-checked' | 'aria-pressed' | 'aria-selected' | 'type'
> {
  selected: boolean;
  semantics?: CanvasSelectionSemantics;
  selectedClassName?: string;
}

/**
 * Canvas-domain selection primitive.
 *
 * Selection cards, visual swatches and option chips are not generic actions,
 * so they intentionally do not use the public Button skin. This component
 * centralizes their native button semantics and selected-state contract while
 * leaving geometry and content with the owning canvas feature.
 */
export const CanvasSelectionItem = React.forwardRef<
  HTMLButtonElement,
  CanvasSelectionItemProps
>(function CanvasSelectionItem({
  selected,
  semantics = 'pressed',
  selectedClassName = 'is-active',
  className,
  ...props
}, ref) {
  const stateProps = semantics === 'selected'
    ? { 'aria-selected': selected }
    : semantics === 'checked'
      ? { 'aria-checked': selected }
      : { 'aria-pressed': selected };

  return (
    <button
      ref={ref}
      type="button"
      className={[className, selected ? selectedClassName : ''].filter(Boolean).join(' ')}
      {...stateProps}
      {...props}
    />
  );
});
