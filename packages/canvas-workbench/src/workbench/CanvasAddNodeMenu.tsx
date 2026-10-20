'use client';

import React from 'react';
import { requireCanvasMenuRenderer, useCanvasUiHost, type CanvasMenuRenderProps } from '../platform/ui-host';
import { useCanvasLocale } from '../platform/canvas-locale';
import { canvasAddNodeChrome } from '../locales/node-catalog';
import { Icon } from '../ui/Icon';
import { CANVAS_NODE_MENU_GROUPS, canvasNodeCreationOptions, type CanvasNodeCreationKind, type CanvasNodeCreationOption } from './canvas-node-catalog';
import { useCanvasKindAvailability } from '../platform/kind-availability';
import styles from './CanvasAddNodeMenu.module.css';

function addNodeMenuItems(
  options: readonly CanvasNodeCreationOption[],
  excludedKinds: readonly CanvasNodeCreationKind[],
  onAddNode: (kind: CanvasNodeCreationKind) => void,
) {
  const visible = new Map(
    options.filter(option => !excludedKinds.includes(option.kind)).map(option => [option.kind, option]),
  );
  const groups = CANVAS_NODE_MENU_GROUPS
    .map(kinds => kinds.flatMap(kind => {
      const option = visible.get(kind);
      return option ? [option] : [];
    }))
    .filter(group => group.length > 0);
  return groups.flatMap((group, groupIndex) => {
    const rows = group.map(option => ({
      id: option.kind,
      disabled: option.disabled,
      className: styles.item,
      content: <>
        <span className={styles.icon} aria-hidden="true"><Icon name={option.icon} size={18} strokeWidth={1.7} /></span>
        <span className={styles.label}>{option.label}</span>
      </>,
      onSelect: () => { if (!option.disabled) onAddNode(option.kind); },
    }));
    if (groupIndex === 0) return rows;
    return [{ id: `separator-${group[0]!.kind}`, kind: 'separator' as const }, ...rows];
  });
}

/** Shared by the dock, empty canvas, node ports and group ports. */
export function CanvasAddNodeMenu({ open, onOpenChange, trigger, onAddNode, excludedKinds = [], side = 'top', scale }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  onAddNode: (kind: CanvasNodeCreationKind) => void;
  excludedKinds?: readonly CanvasNodeCreationKind[];
  side?: CanvasMenuRenderProps['side'];
  scale?: number;
}) {
  const renderMenu = requireCanvasMenuRenderer(useCanvasUiHost());
  const locale = useCanvasLocale();
  const chrome = canvasAddNodeChrome(locale);
  const kindAvailable = useCanvasKindAvailability();
  const options = canvasNodeCreationOptions(locale).filter(option => kindAvailable(option.kind));
  return renderMenu({
    open,
    onOpenChange,
    trigger,
    ariaLabel: chrome.addNode,
    contentClassName: styles.menu,
    side,
    scale,
    align: 'start',
    items: addNodeMenuItems(options, excludedKinds, onAddNode),
  });
}
