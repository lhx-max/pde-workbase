'use client';

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react';
import { Button } from '@bezier/components';
import { cr } from '../locales/canvas-remainder';
import { canvasEdgeAnchor } from './canvas-edge-geometry';

export const CanvasEdgeActions = React.createContext<(id: string) => void>(() => {});

/** Shared directed reference/provenance edge. Motion is one-shot, never a run indicator. */
export const CanvasReferenceEdge = React.memo(function CanvasReferenceEdge(props: EdgeProps) {
  const source = useInternalNode(props.source);
  const target = useInternalNode(props.target);
  const start = canvasEdgeAnchor(source, props.sourceHandleId, props.sourcePosition, { x: props.sourceX, y: props.sourceY });
  const end = canvasEdgeAnchor(target, props.targetHandleId, props.targetPosition, { x: props.targetX, y: props.targetY });
  const [path, x, y] = getBezierPath({ ...props, sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y, curvature: .32 });
  const disconnect = React.useContext(CanvasEdgeActions);
  const flash = typeof props.data?.connectedAt === 'number' && Date.now() - props.data.connectedAt < 800;
  return <>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={24} />
    {props.sourceHandleId?.startsWith('result-item:') && <g className="workflow-edge-source-dot" pointerEvents="none" aria-hidden="true">
      <circle cx={start.x} cy={start.y} r={4} fill="var(--bg-panel, white)" stroke="var(--canvas-port-border)" strokeWidth={1} />
      <circle cx={start.x} cy={start.y} r={2} fill="var(--canvas-edge-color)" />
    </g>}
    {flash && <g key={String(props.data?.connectedAt)}>
      <path d={path} pathLength={1} className="canvas-edge-pulse canvas-edge-pulse-halo" />
      <path d={path} pathLength={1} className="canvas-edge-pulse" />
      <circle cx={end.x} cy={end.y} r={5} className="canvas-edge-arrival" />
    </g>}
    {props.selected && <EdgeLabelRenderer>
      <div className="canvas-edge-actions nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
        onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <span>{props.data?.storyboardRelation ? cr().autoStoryboardLink : props.data?.generated ? cr().autoGenSource : cr().assetReference}</span>
        {typeof props.data?.sourceTitle === 'string' && typeof props.data?.targetTitle === 'string'
          && <span className="canvas-edge-endpoints" title={`${props.data.sourceTitle} → ${props.data.targetTitle}`}>{props.data.sourceTitle} → {props.data.targetTitle}</span>}
        {!props.data?.generated && <Button type="button" variant="ghost" onClick={() => disconnect(props.id)} aria-label={cr().disconnectKeep}>{cr().disconnect}</Button>}
      </div>
    </EdgeLabelRenderer>}
  </>;
});

/** Drag preview and saved edges use the same anchor contract. */
export function CanvasConnectionLine(props: ConnectionLineComponentProps) {
  const start = canvasEdgeAnchor(props.fromNode, props.fromHandle.id, props.fromPosition, { x: props.fromX, y: props.fromY });
  const end = canvasEdgeAnchor(props.toNode ?? undefined, props.toHandle?.id, props.toPosition, { x: props.toX, y: props.toY });
  const [path] = getBezierPath({ sourceX: start.x, sourceY: start.y, sourcePosition: props.fromPosition, targetX: end.x, targetY: end.y, targetPosition: props.toPosition, curvature: .32 });
  return <path className="react-flow__connection-path" d={path} fill="none" style={props.connectionLineStyle} />;
}
