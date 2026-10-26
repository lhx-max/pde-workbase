'use client';
// Adapted from MarioDesign-FT/design-canvas CanvasOverview, commit 996622df6194.
// Original SVG structure, styling and pointer navigation; React Flow data adapter below.
import React from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { canvasPreviewUrl } from './CanvasPreviewImage';
import { imageFileUrl, resolveImageSrc, type ImageAssetData } from './ImageAssetNode';
import { overviewLayout, overviewRect, OVERVIEW_WIDTH, OVERVIEW_HEIGHT, type OverviewBounds } from './canvas-overview-geometry';
import './canvas-overview.css';

export function CanvasOverview() {
  const [expanded, setExpanded] = React.useState(true);
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ id: number; x: number; y: number; layout: ReturnType<typeof overviewLayout> } | null>(null);
  const transform = useStore(state => state.transform);
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const lookup = useStore(state => state.nodeLookup);
  const nodes = useStore(state => state.nodes);
  const { setViewport } = useReactFlow();
  const [x, y, zoom] = transform;
  const viewport: OverviewBounds = [-x / zoom, -y / zoom, (width - x) / zoom, (height - y) / zoom];
  const items = React.useMemo(() => Array.from(lookup.values()).filter(node => !node.hidden).map(node => {
    const position = node.internals.positionAbsolute;
    const w = node.measured.width ?? node.width ?? 200;
    const h = node.measured.height ?? node.height ?? 150;
    const image = node.type === 'imageAsset' ? (node.data as ImageAssetData).image : undefined;
    const source = image ? resolveImageSrc(image.src) || (image.path ? imageFileUrl(image.path) : '') : '';
    return { id: node.id, selected: node.selected, bounds: [position.x, position.y, position.x + w, position.y + h] as OverviewBounds,
      source: source ? canvasPreviewUrl(source, 'image', 128) : '' };
  }), [lookup, nodes]);
  const layout = overviewLayout(items.map(item => item.bounds), viewport);
  const viewportRect = overviewRect(viewport, layout);
  const point = (event: React.PointerEvent<SVGSVGElement>, mapping = layout) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: mapping.bounds[0] + ((event.clientX - rect.left) * OVERVIEW_WIDTH / rect.width - mapping.x) / mapping.scale,
      y: mapping.bounds[1] + ((event.clientY - rect.top) * OVERVIEW_HEIGHT / rect.height - mapping.y) / mapping.scale };
  };
  const pan = (center: { x: number; y: number }) => {
    void setViewport({ x: width / 2 - center.x * zoom, y: height / 2 - center.y * zoom, zoom });
  };
  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!items.length) return null;
  if (!expanded) return <div className="canvas-overview-toggle-wrap nopan nodrag nowheel"><button type="button" className="canvas-overview-toggle" aria-label="展开画布总览" title="展开画布总览" onClick={() => setExpanded(true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>
  </button></div>;
  return <aside className={`canvas-overview nopan nodrag nowheel${dragging ? ' is-dragging' : ''}`} aria-label="画布总览导航" onPointerDown={event => event.stopPropagation()}>
    <button type="button" className="canvas-overview-collapse" aria-label="收起画布总览" title="收起" onClick={() => setExpanded(false)}>×</button>
    <svg viewBox={`0 0 ${OVERVIEW_WIDTH} ${OVERVIEW_HEIGHT}`} role="img" tabIndex={0} aria-label="全部画布元素与当前视窗位置"
      onKeyDown={event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault(); event.stopPropagation();
        pan({ x: (width / 2 - x) / zoom + direction[0] * width / zoom / 10, y: (height / 2 - y) / zoom + direction[1] * height / zoom / 10 });
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const center = point(event);
        const inside = event.target instanceof Element && event.target.hasAttribute('data-overview-viewport');
        drag.current = { id: event.pointerId, layout, x: inside ? center.x - (viewport[0] + viewport[2]) / 2 : 0, y: inside ? center.y - (viewport[1] + viewport[3]) / 2 : 0 };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
        if (!inside) pan(center);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const center = point(event, current.layout);
        pan({ x: center.x - current.x, y: center.y - current.y });
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      {items.map(item => {
        const rect = overviewRect(item.bounds, layout);
        const className = `canvas-overview-element${item.selected ? ' is-selected' : ''}`;
        return item.source && rect.width >= 12 && rect.height >= 12
          ? <image key={item.id} {...rect} className={className} href={item.source} preserveAspectRatio="xMidYMid slice" />
          : <rect key={item.id} {...rect} className={className} rx={2} />;
      })}
      <rect {...viewportRect} data-overview-viewport="true" className="canvas-overview-viewport" rx={2}/>
    </svg>
  </aside>;
}
