/**
 * SettingsDisclosure — the one collapsible block Settings sections consume.
 *
 * Why this exists: three Settings surfaces (Memory index, Memory tree, Media
 * "coming soon") each hand-rolled `<details className="library-group ...">` +
 * `<summary className="memory-details-summary">` + an optional count span.
 * They shared CSS by copying class names that live in the *memory* stylesheet,
 * so the Media page silently depended on `viewer/memory.css` — rename that
 * file's selectors and an unrelated page loses its caret.
 *
 * This primitive owns only the disclosure shell: caret, summary rhythm, count
 * badge slot, focus ring and the card surface. It does NOT own the body
 * content or any business state — callers render their own children.
 *
 * It is deliberately built on native <details>/<summary> rather than a Radix
 * collapsible: the existing behaviour (no animation, native keyboard/AT
 * semantics, no controlled state) is already correct, and swapping in a JS
 * disclosure would add state for zero user-visible gain.
 */

import type { ReactNode } from 'react';
import { cn } from '@/src/lib/utils';

export interface SettingsDisclosureProps {
  /** Summary label. */
  title: ReactNode;
  /** Optional trailing count rendered as the muted badge next to the title. */
  count?: ReactNode;
  /** Open on first render. Uncontrolled — native <details> owns the state. */
  defaultOpen?: boolean;
  /** Extra class on the <details> shell. */
  className?: string;
  /** Extra class on the <summary> row. */
  summaryClassName?: string;
  children?: ReactNode;
}

export function SettingsDisclosure({
  title,
  count,
  defaultOpen,
  className,
  summaryClassName,
  children,
}: SettingsDisclosureProps) {
  return (
    <details
      className={cn('settings-disclosure', className)}
      data-ui-settings-disclosure=""
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className={cn('settings-disclosure__summary', summaryClassName)}>
        <span className="settings-disclosure__title">{title}</span>
        {count != null ? (
          <span className="settings-disclosure__count">{count}</span>
        ) : null}
      </summary>
      {children}
    </details>
  );
}
