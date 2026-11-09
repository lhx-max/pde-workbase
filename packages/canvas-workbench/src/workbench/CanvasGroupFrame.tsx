import type { HTMLAttributes } from 'react';

/** Shared group surface; business adapters retain ownership of their children. */
export function CanvasGroupFrame({ selected, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { selected?: boolean }) {
  return <div {...props} className={`image-group-node ${selected ? 'is-selected' : ''} ${className}`} />;
}
