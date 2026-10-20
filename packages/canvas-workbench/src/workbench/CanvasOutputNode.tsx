'use client';

import React from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { CanvasNodeOverlayPortalProvider } from '../platform/ui-host';
import type { ImageConnectedNodeKind, ImageConnectedNodeOrigin } from './ImageAssetNode';
import { CanvasNodeSourceHandle } from './CanvasNodeSourceHandle';
import { CanvasNodeActions } from './CanvasNodeActions';
import type { CanvasNodeCreationKind } from './canvas-node-catalog';
import { cr } from '../locales/canvas-remainder';

export type CanvasOutputState = 'empty' | 'generating' | 'failed' | 'preview';

export function CanvasOutputFrame({
  children,
  state,
}: {
  children: React.ReactNode;
  state: CanvasOutputState;
}) {
  return (
    <div className="basic-output-frame node-drag-surface" data-state={state}>
      {children}
    </div>
  );
}

export function CanvasOutputStatus({
  detail = cr().taskContinuesBg,
}: {
  detail?: string;
}) {
  return (
    <div className="basic-output-state nodrag nopan" role="status">
      <span className="basic-output-spinner" aria-hidden="true" />
      <strong>{cr().generating}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function CanvasOutputNode({
  children,
  className = '',
  excludedNodeKinds,
  icon,
  keepAspectRatio = false,
  maxHeight,
  minHeight,
  minWidth,
  onAddConnectedNode,
  onRemove,
  onDuplicate,
  onDownload,
  downloadLabel,
  onResizeEnd,
  selected = false,
  sourceOrigin,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  excludedNodeKinds?: readonly CanvasNodeCreationKind[];
  icon: React.ReactNode;
  keepAspectRatio?: boolean;
  maxHeight?: number;
  minHeight: number;
  minWidth: number;
  onAddConnectedNode: (kind: ImageConnectedNodeKind, origin: ImageConnectedNodeOrigin) => void;
  onRemove: () => void;
  /** 省略则不显示复制按钮。 */
  onDuplicate?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  onResizeEnd: (width: number, height: number) => void;
  selected?: boolean;
  sourceOrigin: ImageConnectedNodeOrigin;
  title: string;
}) {
  const [overlayPortalContainer, setOverlayPortalContainer] = React.useState<HTMLDivElement | null>(null);

  return (
    <CanvasNodeOverlayPortalProvider container={overlayPortalContainer}>
      <article
        data-canvas-node-surface
        className={`basic-output-generator${className ? ` ${className}` : ''}${selected ? ' is-selected' : ''}`}
        tabIndex={0}
        onKeyDown={event => {
          if ((event.key === 'Backspace' || event.key === 'Delete') && event.target === event.currentTarget) {
            event.preventDefault();
            onRemove();
          }
        }}
      >
        <NodeResizer
          isVisible={selected}
          maxHeight={maxHeight}
          minWidth={minWidth}
          minHeight={minHeight}
          keepAspectRatio={keepAspectRatio}
          lineClassName="basic-node-resizer-line"
          handleClassName="basic-node-resizer-handle"
          onResizeEnd={(_, value) => onResizeEnd(value.width, value.height)}
        />
        <div className="basic-output-title node-drag-surface">
          <span className="basic-output-title-icon">{icon}</span>
          <span className="basic-output-title-label">{title}</span>
          <CanvasNodeActions
            onDuplicate={onDuplicate}
            onDownload={onDownload}
            downloadLabel={downloadLabel}
            onRemove={onRemove}
            duplicateLabel={cr().duplicateTitle(title)}
            removeLabel={cr().deleteTitle(title)}
          />
        </div>
        {children}
        <div ref={setOverlayPortalContainer} className="canvas-node-overlay-portal" />
        <Handle type="target" position={Position.Left} className="minimax-image-target-handle" />
        <CanvasNodeSourceHandle
          excludedKinds={excludedNodeKinds}
          onAddNode={kind => onAddConnectedNode(kind, sourceOrigin)}
        />
      </article>
    </CanvasNodeOverlayPortalProvider>
  );
}
