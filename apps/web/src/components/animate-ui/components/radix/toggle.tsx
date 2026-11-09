import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

// Source: Animate UI, components/radix/toggle.
// Geometry and interaction are upstream; semantic colors map to DA tokens.

import {
  Toggle as TogglePrimitive,
  ToggleHighlight as ToggleHighlightPrimitive,
  ToggleItem as ToggleItemPrimitive,
  type ToggleItemProps as ToggleItemPrimitiveProps,
  type ToggleProps as TogglePrimitiveProps,
} from '@/src/components/animate-ui/primitives/radix/toggle';
import { cn } from '@/src/lib/utils';

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-bg-subtle/40 hover:text-text-muted disabled:pointer-events-none disabled:opacity-50 data-[state=on]:text-text-strong [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:border-border-selected focus-visible:ring-border-selected/20 focus-visible:ring-[3px] outline-none transition-[color,background-color,box-shadow] duration-200 ease-in-out whitespace-nowrap",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-border bg-transparent shadow-xs hover:bg-bg-subtle/40 hover:text-text-strong',
      },
      size: {
        default: 'h-9 px-2 min-w-9',
        sm: 'h-8 px-1.5 min-w-8',
        lg: 'h-10 px-2.5 min-w-10',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ToggleProps = TogglePrimitiveProps &
  ToggleItemPrimitiveProps &
  VariantProps<typeof toggleVariants>;

function Toggle({
  className,
  variant,
  size,
  pressed,
  defaultPressed,
  onPressedChange,
  disabled,
  ...props
}: ToggleProps) {
  return (
    <TogglePrimitive
      pressed={pressed}
      defaultPressed={defaultPressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      className="relative"
    >
      <ToggleHighlightPrimitive className="rounded-md bg-bg-subtle" />
      <ToggleItemPrimitive
        className={cn(toggleVariants({ variant, size, className }))}
        {...props}
      />
    </TogglePrimitive>
  );
}

export { Toggle, toggleVariants, type ToggleProps };
