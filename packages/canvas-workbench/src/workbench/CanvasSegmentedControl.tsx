'use client';
import { CanvasSelectionItem } from './CanvasSelectionItem';

/** Shared canvas option selector; same surface as camera speed/shot controls. */
export function CanvasSegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (value: T) => void;
}) {
  return <div className="canvas-segmented-control" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(option => <CanvasSelectionItem key={option.id} className="canvas-segmented-option" selected={value === option.id} onClick={() => onChange(option.id)}>{option.label}</CanvasSelectionItem>)}
  </div>;
}
