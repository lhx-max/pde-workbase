import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { cn } from '@/src/lib/utils';

/**
 * VisuallyHidden — renders content that is invisible but accessible to screen
 * readers. Equivalent to Tailwind's `sr-only` class.
 *
 * Use this instead of `display:none` when content must be announced by
 * assistive technology but not seen on screen.
 */

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

export const VisuallyHidden = forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
  function VisuallyHidden({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(
          'absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap',
          '[clip:rect(0,0,0,0)] border-0',
          className,
        )}
        {...props}
      />
    );
  },
);

VisuallyHidden.displayName = 'VisuallyHidden';
