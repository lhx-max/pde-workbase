import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * cn() — merge Tailwind classes, resolving conflicts correctly.
 *
 * Uses clsx for conditional class composition and tailwind-merge to
 * deduplicate conflicting Tailwind utilities (e.g. `p-4 p-2` → `p-2`).
 *
 * @example
 *   cn('px-4 py-2', isActive && 'bg-bg-subtle', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
