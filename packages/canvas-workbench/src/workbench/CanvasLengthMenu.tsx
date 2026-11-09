import { Button } from '@bezier/components';
import { AlignLeft } from 'lucide-react';
import { requireCanvasMenuRenderer, useCanvasUiHost } from '../platform/ui-host';
import { cr } from '../locales/canvas-remainder';
import styles from './CanvasLengthMenu.module.css';

type LengthOption<Value extends string> = { value: Value; label: string; detail: string };

/** Shared, single-line length choices. Like image model menus, the popup uses
 * the host's screen-space typography rather than shrinking with the canvas. */
export function CanvasLengthMenu<Value extends string>({ open, onOpenChange, value, triggerLabel, options, onChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Value;
  triggerLabel: string;
  options: readonly LengthOption<Value>[];
  onChange: (value: Value) => void;
}) {
  const renderMenu = requireCanvasMenuRenderer(useCanvasUiHost());
  return renderMenu({
    open, onOpenChange,
    ariaLabel: cr().textLengthAuto,
    side: 'top',
    contentClassName: styles.menu,
    selectedValue: value,
    onSelectedValueChange: next => { const option = options.find(item => item.value === next); if (option) onChange(option.value); },
    trigger: <Button variant="ghost" className="minimax-image-chip basic-output-option-chip"><AlignLeft size={15} /><span>{triggerLabel}</span></Button>,
    items: options.map(option => ({
      id: option.value,
      value: option.value,
      className: styles.item,
      content: <><span className={styles.label}>{option.label}</span><span className={styles.detail} title={option.detail}>{option.detail}</span></>,
    })),
  });
}
