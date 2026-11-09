import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/src/lib/utils';

// ─── Variant / Size definitions ──────────────────────────────────────────────
//
// Design decisions map directly to tokens.css. Legacy semantic class names are
// temporarily scoped to `[data-ui-button]` in primitives.css while consumers
// finish moving from `className="primary"` to the variant prop.
//
//  variant
//    default      — bordered, transparent fill (the existing global `button`)
//    primary      — filled text-strong bg, same radius as the default button
//    primary-ghost — subtle bg, no border (secondary CTA)
//    ghost        — no border, no bg (in-context action)
//    subtle       — bg-subtle fill, no border (toolbar items)
//    icon         — square icon-only button (alias: size="icon" still works)
//
//  size
//    xs   20–24px — nav rail tiny actions, copy/feedback buttons
//    sm   28–30px — chat-footer actions, plugin cards, filter tags
//    md   32–34px — most panel CTAs, the most common override target
//    default 36px — standard button (matches the global primitive)
//    lg   40–42px — marketplace CTAs, onboarding fields
//    xl   44–52px — large tab buttons, memory source connectors
//    icon 36px    — square icon-only (kept for @bezier/components compat)
//
// The component owns the complete base treatment. primitives.css only retains
// scoped legacy semantic class compatibility until callers use variant props.

const buttonVariants = cva(
  // Base — mirrors `button { }` in primitives.css exactly
  [
    'inline-flex items-center justify-center gap-2',
    'font-[inherit] font-medium leading-none whitespace-nowrap',
    'text-text bg-transparent',
    'border border-border rounded-[var(--radius-button)]',
    'cursor-pointer select-none',
    'transition-[background-color,border-color,color,transform,box-shadow]',
    'duration-[var(--duration-ultra-fast)] ease-[var(--curve-easy-ease)]',
    'hover:not-disabled:bg-bg-subtle hover:not-disabled:border-border-strong',
    'active:not-disabled:translate-y-px',
    'focus-visible:outline focus-visible:outline-[length:var(--stroke-thin)] focus-visible:outline-border-selected focus-visible:outline-offset-2',
    'disabled:bg-bg-subtle disabled:border-transparent disabled:text-text-faint disabled:cursor-not-allowed disabled:translate-y-0',
    'aria-pressed:border-border-selected',
  ],
  {
    variants: {
      variant: {
        default: '',
        primary: [
          'bg-text-strong border-text-strong text-bg',
          'hover:not-disabled:bg-[#353535] hover:not-disabled:border-[#353535]',
          'active:not-disabled:bg-text active:not-disabled:border-text',
        ],
        'primary-ghost': [
          'bg-bg-subtle border-transparent text-text-strong',
          'hover:not-disabled:bg-bg-muted',
          'active:not-disabled:bg-border-strong',
        ],
        ghost: [
          'bg-transparent border-transparent text-text',
          'hover:not-disabled:bg-bg-subtle hover:not-disabled:border-transparent',
          'active:not-disabled:bg-bg-muted',
        ],
        subtle: [
          'bg-bg-subtle border-transparent text-text-strong',
          'hover:not-disabled:bg-bg-muted',
          'active:not-disabled:bg-border-strong',
        ],
        // icon variant — square, no label (same as size="icon" for compat)
        icon: [
          'bg-transparent border-transparent',
          'rounded-[var(--radius-medium)]',
        ],
      },
      size: {
        xs: 'h-6 min-w-6 px-0 text-[12px]',      // 24px — copy/feedback/nav-rail tiny
        sm: 'h-7 px-[9px] text-[12px]',           // 28px — chat-footer, plugin cards
        md: 'h-8 px-[11px] text-[13px]',          // 32px — most panel CTAs (highest frequency)
        default: 'h-9 px-4 text-[14px]',          // 36px — standard (matches global primitive)
        lg: 'h-10 px-4 text-[13px]',              // 40px — marketplace CTAs
        xl: 'h-[52px] px-4 text-[14px]',          // 52px — large tab / memory source
        icon: 'h-9 min-w-9 w-9 p-0 rounded-[var(--radius-medium)]', // 36×36 icon-only
      },
    },
    // Compound: icon variant always gets icon size layout regardless of `size`
    compoundVariants: [
      {
        variant: 'icon',
        size: 'default',
        class: 'h-9 min-w-9 w-9 p-0',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Shorthand to put the button into "active / selected" state without having
   * to pass aria-pressed manually from consumers.
   */
  isSelected?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    type = 'button',
    variant = 'default',
    size = 'default',
    isSelected,
    'aria-pressed': ariaPressedProp,
    ...props
  },
  ref,
) {
  const ariaPressed = ariaPressedProp ?? (isSelected ? true : undefined);

  return (
    <button
      ref={ref}
      type={type}
      data-ui-button=""
      aria-pressed={ariaPressed}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

Button.displayName = 'Button';

// ─── Exports ──────────────────────────────────────────────────────────────────

export { buttonVariants };
