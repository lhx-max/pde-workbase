import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/src/lib/utils';

// ─── Shared control base ─────────────────────────────────────────────────────
//
// Mirrors `input, select, textarea { }` in primitives.css.
// Values deliberately read from CSS tokens so dark-mode / theme switching works
// without JS.

const controlBase = [
  'w-full min-w-0',
  'px-[10px] py-2',                          // padding: 8px 10px
  'text-[13px] leading-[1.4]',
  // The explicit CSS property keeps Tailwind Merge from treating Select's
  // background-image caret as a competing background utility.
  'text-text [background-color:var(--bg-panel)]',
  'border border-border rounded-[var(--radius-sm)]',
  'font-[inherit]',
  'outline-none',
  'transition-[border-color,box-shadow]',
  'duration-[var(--duration-ultra-fast)] ease-[var(--curve-easy-ease)]',
  'focus-visible:border-border-selected focus-visible:ring-1 focus-visible:ring-border-selected',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'placeholder:text-text-faint',
];

// ─── Input ────────────────────────────────────────────────────────────────────

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(controlBase, 'h-9', className)}   // min-height 36px
      {...props}
    />
  );
});

Input.displayName = 'Input';

// ─── Textarea ─────────────────────────────────────────────────────────────────

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum height in rows (defaults to 3). */
  rows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        controlBase,
        'min-h-[80px] resize-y',        // matches primitives.css textarea
        'pt-[7px]',                      // +1px top pad for first line visual balance
        className,
      )}
      {...props}
    />
  );
});

Textarea.displayName = 'Textarea';

// ─── Select ───────────────────────────────────────────────────────────────────

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        controlBase,
        'h-9',
        // Custom caret — matches the inline SVG in primitives.css
        'appearance-none',
        'bg-[image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 12 12\' fill=\'none\' stroke=\'%2374716b\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'3 5 6 8 9 5\'/%3E%3C/svg%3E")]',
        'bg-no-repeat bg-[right_10px_center] bg-[length:12px_12px]',
        'pr-8',
        className,
      )}
      {...props}
    />
  );
});

Select.displayName = 'Select';

// ─── Size variants for future extension ──────────────────────────────────────
// Currently all controls default to h-9 (36px). If specific contexts need
// a different height, pass className="h-8" or wrap with a size CVA later.
