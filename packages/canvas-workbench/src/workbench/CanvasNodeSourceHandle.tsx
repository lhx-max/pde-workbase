'use client';

import React from 'react';
import { Handle, Position, useNodeId, useStore } from '@xyflow/react';
import type { CanvasNodeCreationKind } from './canvas-node-catalog';
import { CanvasAddNodeMenu } from './CanvasAddNodeMenu';
import { useCanvasLocale } from '../platform/canvas-locale';
import { canvasAddNodeChrome } from '../locales/node-catalog';
import { Icon } from '../ui/Icon';

export const CanvasSourceMenuRequest = React.createContext<{ nodeId: string; nonce: number } | null>(null);

export function CanvasNodeAddGlyph() {
  return (
    <span className="canvas-node-add-glyph" aria-hidden="true"><Icon name="plus" size={14} /></span>
  );
}

/** Shared add/connect port for text, image, video, presentation and webpage cards. */
export function CanvasNodeSourceHandle({
  excludedKinds = [],
  onAddNode,
  level = 'card',
}: {
  level?: 'card' | 'group';
  excludedKinds?: readonly CanvasNodeCreationKind[];
  onAddNode: (kind: CanvasNodeCreationKind) => void;
}) {
  const locale = useCanvasLocale();
  const chrome = canvasAddNodeChrome(locale);
  const [open, setOpen] = React.useState(false);
  const menuScale = useStore(state => open ? state.transform[2] : 1);
  const nodeId = useNodeId();
  const menuRequest = React.useContext(CanvasSourceMenuRequest);
  React.useEffect(() => {
    if (menuRequest?.nodeId === nodeId) setOpen(true);
  }, [menuRequest, nodeId]);
  const handleRef = React.useRef<HTMLDivElement>(null);
  const gestureRef = React.useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  return <CanvasAddNodeMenu
    open={open}
    onOpenChange={setOpen}
    onAddNode={onAddNode}
    excludedKinds={excludedKinds}
    side="right"
    scale={menuScale}
    trigger={<Handle
      // Radix's generated trigger id must not become a persisted XYFlow port.
      // Empty explicitly selects React Flow's default (unnamed) output.
      id=""
      ref={handleRef}
      type="source"
      data-level={level}
      position={Position.Right}
      className={`canvas-node-source-handle image-connect-handle${open ? ' is-open' : ''}`}
      aria-label={chrome.addNode}
      title={chrome.addNodeHint}
      onPointerDownCapture={event => {
        // Radix opens on pointerdown and prevents the compatibility mousedown
        // that React Flow needs to start connecting. Stop only propagation:
        // preserve native mouse/touch defaults and open the menu on click.
        event.stopPropagation();
        gestureRef.current = { x: event.clientX, y: event.clientY, dragged: false };
      }}
      onPointerMove={event => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.dragged) return;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
          gesture.dragged = true;
          setOpen(false);
        }
      }}
      onPointerUp={() => {
        if (!gestureRef.current?.dragged) gestureRef.current = null;
      }}
      onPointerCancel={() => {
        gestureRef.current = null;
      }}
      onClick={event => {
        event.stopPropagation();
        if (gestureRef.current?.dragged) event.preventDefault();
        else setOpen(value => !value);
        gestureRef.current = null;
      }}
    >
      <CanvasNodeAddGlyph />
    </Handle>}
  />;
}
