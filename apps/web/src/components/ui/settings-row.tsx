/**
 * Settings layout primitives — the one row/group geometry every Settings
 * section consumes.
 *
 * Why this exists: before this file, General settings carried competing row
 * implementations (`.settings-general-field` for the language row,
 * `.settings-control-row` for notification switches, and
 * `.project-location-card` for locations). Each picked
 * its own label size, min-height and hint treatment, so the page had no
 * vertical rhythm and the group headings ended up visually weaker than the
 * rows they were supposed to own.
 *
 * The primitives here own only geometry and typographic hierarchy:
 *
 *   SettingsGroup   — a titled block of related rows + its divider rhythm
 *   SettingsRow     — one `label + hint … control` line
 *   SettingsRowText — the copy column, when a row needs custom control markup
 *
 * They deliberately do NOT own control visuals (Switch, DropdownMenu,
 * SegmentedControl keep their own component skins) and they do NOT own
 * business state. A section that needs a different *control* still uses this
 * row; a section that needs a different *rhythm* is a design decision, not a
 * local override.
 */

import type { ReactNode } from 'react';
import { cn } from '@/src/lib/utils';

export interface SettingsGroupProps {
  /** Group heading. Omit for a single unlabelled block (e.g. the language row). */
  title?: ReactNode;
  /** Optional supporting copy under the heading. */
  description?: ReactNode;
  /**
   * Trailing control on the heading line — group-level actions such as
   * "add folder" belong here, not pinned to an arbitrary row inside the group.
   */
  action?: ReactNode;
  /** Drop the bottom hairline. The last group on a page sets this. */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

export function SettingsGroup({
  title,
  description,
  action,
  flush,
  className,
  children,
}: SettingsGroupProps) {
  const hasHead = title != null || description != null || action != null;
  return (
    <div
      className={cn('settings-group', flush && 'settings-group--flush', className)}
      data-ui-settings-group=""
    >
      {hasHead ? (
        <div className="settings-group__head">
          <div className="settings-group__heading">
            {title != null ? <h3 className="settings-group__title">{title}</h3> : null}
            {description != null ? (
              <p className="settings-group__description">{description}</p>
            ) : null}
          </div>
          {action != null ? <div className="settings-group__action">{action}</div> : null}
        </div>
      ) : null}
      {children != null ? <div className="settings-group__rows">{children}</div> : null}
    </div>
  );
}

export interface SettingsRowTextProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Associate the copy with a control via htmlFor; renders a real <label>. */
  htmlFor?: string;
  className?: string;
}

export function SettingsRowText({ label, hint, htmlFor, className }: SettingsRowTextProps) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <span className={cn('settings-row__text', className)}>
      <Label className="settings-row__label" {...(htmlFor ? { htmlFor } : {})}>
        {label}
      </Label>
      {hint != null ? <span className="settings-row__hint">{hint}</span> : null}
    </span>
  );
}

export interface SettingsRowProps extends Omit<SettingsRowTextProps, 'className'> {
  /** The control rail on the right (Switch, DropdownMenu trigger, buttons…). */
  control?: ReactNode;
  /**
   * Conditional content that belongs to this row but needs its own line —
   * sound pickers under the sound switch, permission notes, test actions.
   * Rendered indented under the row so it reads as owned by the row, not as
   * a sibling setting.
   */
  children?: ReactNode;
  /**
   * Top-align the control with the first copy line. Rows whose hint runs to
   * several lines set this so the control doesn't float to the vertical
   * middle of a tall paragraph.
   */
  alignStart?: boolean;
  className?: string;
}

export function SettingsRow({
  label,
  hint,
  htmlFor,
  control,
  children,
  alignStart,
  className,
}: SettingsRowProps) {
  return (
    <div className={cn('settings-row', className)} data-ui-settings-row="">
      <div className={cn('settings-row__main', alignStart && 'settings-row__main--start')}>
        <SettingsRowText label={label} hint={hint} {...(htmlFor ? { htmlFor } : {})} />
        {control != null ? <div className="settings-row__control">{control}</div> : null}
      </div>
      {children != null ? <div className="settings-row__detail">{children}</div> : null}
    </div>
  );
}
