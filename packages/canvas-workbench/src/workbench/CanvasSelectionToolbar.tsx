'use client';

import { NodeToolbar, Position, type Node } from '@xyflow/react';
import { Button } from '@bezier/components';
import { Icon } from '../ui/Icon';
import { canvasSelectionChrome } from '../locales/chrome';
import { useCanvasLocale } from '../platform/canvas-locale';

/** A selection owns one toolbar. React Flow owns viewport-relative placement. */
export function CanvasSelectionToolbar({ nodes, onGroup, onClear, groupLabel, onRemoveMembers }: {
  nodes: Node[];
  onGroup: () => void;
  onClear: () => void;
  groupLabel?: string;
  onRemoveMembers?: () => void;
}) {
  const chrome = canvasSelectionChrome(useCanvasLocale());
  const resolvedGroupLabel = groupLabel ?? chrome.group;
  if (nodes.length < 2 && !onRemoveMembers) return null;
  return (
    <NodeToolbar nodeId={nodes.map(node => node.id)} isVisible position={Position.Top} offset={14}
      className="canvas-action-surface selection-group-capsule nodrag nopan" role="group" aria-label={chrome.actions}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}>
      <span className="selection-group-count">{chrome.selected(nodes.length)}</span>
      {!onRemoveMembers && <Button variant="ghost" aria-label={resolvedGroupLabel} onClick={onGroup}><Icon name="layers" size={16} /><span>{resolvedGroupLabel}</span></Button>}
      {onRemoveMembers && <Button variant="ghost" onClick={onRemoveMembers}>{chrome.removeFromGroup}</Button>}
      <span className="selection-group-divider" aria-hidden="true" />
      <Button variant="ghost" size="icon" className="selection-group-dismiss" aria-label={chrome.clear} title={chrome.clear} onClick={onClear}><Icon name="close" size={14} /></Button>
    </NodeToolbar>
  );
}
