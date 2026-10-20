/** Public DA adapter for the Animate UI checkbox primitive. */
import {
  Checkbox as CheckboxPrimitive,
  CheckboxIndicator,
  type CheckboxProps as CheckboxPrimitiveProps,
} from '@/src/components/animate-ui/primitives/radix/checkbox';
import { cn } from '@/src/lib/utils';

export type CheckboxProps = CheckboxPrimitiveProps;

export function Checkbox({ className, children, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-bg-panel text-bg-panel outline-none transition-[background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-text data-[state=checked]:bg-text data-[state=indeterminate]:border-text data-[state=indeterminate]:bg-text',
        className,
      )}
      {...props}
    >
      {children ?? <CheckboxIndicator className="size-3 stroke-[2.5]" />}
    </CheckboxPrimitive>
  );
}
