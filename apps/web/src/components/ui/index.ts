/**
 * @/src/components/ui/index.ts
 *
 * Barrel export for the DA unified component library.
 * All new UI components go through `apps/web/src/components/ui/` —
 * never add raw <button> / <input> / <select> / <textarea> directly.
 *
 * Migration status:
 *   ✅ Button   — replaces @bezier/components Button + 138 raw <button> usages
 *   ✅ Input    — replaces @bezier/components Input + raw <input>
 *   ✅ Textarea — replaces @bezier/components Textarea + raw <textarea>
 *   ✅ Select   — replaces @bezier/components Select + raw <select>
 *   ✅ Dialog  — public compatibility entry; behavior migration remains incremental
 *   ✅ Popover — Animate UI behavior through this public entry
 *   ✅ Sidebar — Animate UI behavior through this public entry
 *   ✅ Highlight — Animate UI motion through this public entry
 *   ✅ Tabs    — Animate UI motion through this public entry
 */

export { Button, buttonVariants } from './button';
export { anchoredOverlaySurfaceClassName } from './overlay-surface';
export type { ButtonProps, ButtonSize, ButtonVariant } from './button';

export { CodeBlock } from './code-block';
export type { CodeBlockProps } from './code-block';

export {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './dialog';
export type { DialogProps } from './dialog';

export { Input, Select, Textarea } from './input';
export type { InputProps, SelectProps, TextareaProps } from './input';

export { ConfirmDialog } from './confirm-dialog';
export type { ConfirmDialogProps } from './confirm-dialog';

export { Switch } from './switch';
export type { SwitchProps } from './switch';

export { Checkbox } from './checkbox';
export type { CheckboxProps } from './checkbox';

export { SegmentedControl, SegmentedControlItem } from './segmented-control';
export type { SegmentedControlProps, SegmentedControlItemProps } from './segmented-control';

export { SettingsGroup, SettingsRow, SettingsRowText } from './settings-row';
export type {
  SettingsGroupProps,
  SettingsRowProps,
  SettingsRowTextProps,
} from './settings-row';

export { SettingsDisclosure } from './settings-disclosure';
export type { SettingsDisclosureProps } from './settings-disclosure';

export { VisuallyHidden } from './visually-hidden';
export type { VisuallyHiddenProps } from './visually-hidden';

export { BubbleBackground } from './bubble-background';
export type { BubbleBackgroundProps, BubbleColors } from './bubble-background';

export * from './popover';
export * from './sidebar';
export * from './highlight';
export * from './tabs';
export * from './animated-dialog';
export * from './dropdown-menu';
export * from './radio-group';
export * from './hover-card';
