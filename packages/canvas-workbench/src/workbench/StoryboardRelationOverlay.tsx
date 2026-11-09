'use client';
import React from 'react';
import { getBezierPath, Position } from '@xyflow/react';
import type { StoryboardAsset } from '@bezier/contracts';
import type { StoryboardShot } from './storyboard-card';
import type { StoryboardRelationFocus } from './storyboard-relations';
import { storyboardRelationGalleryLinks, type StoryboardGallery } from './storyboard-gallery';

type RelationLine = { key: string; path: string; sx: number; sy: number; tx: number; ty: number; clipped: boolean; active: boolean };

/** Read-only in-group relation preview. The persistent group-to-script wires are React Flow edges. */
export function StoryboardRelationOverlay({ hostRef, focus, shots, assets, galleries }: {
  hostRef: React.RefObject<HTMLElement | null>; focus?: StoryboardRelationFocus; shots: StoryboardShot[]; assets: StoryboardAsset[]; galleries: StoryboardGallery[];
}) {
  const [lines, setLines] = React.useState<RelationLine[]>([]);
  const cameraGroup = React.useRef<SVGGElement>(null);
  const maskRef = React.useRef<SVGMaskElement>(null);
  const maskBackground = React.useRef<SVGRectElement>(null);
  const maskId = React.useId().replace(/:/g, '');
  const [surfaces, setSurfaces] = React.useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) { setLines([]); return; }
    let frame = 0;
    const observed = new Set<Element>();
    const worldRects = new Map<Element, { x: number; y: number; width: number; height: number }>();
    const dirtyNodes = new Set<Element>();
    let dirtyAll = true;
    const invalidate = (target: Element) => {
      const node = target.closest('.react-flow__node');
      if (node) dirtyNodes.add(node); else dirtyAll = true;
    };
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) invalidate(entry.target);
      schedule();
    });
    let hostWidth = 1, hostHeight = 1, flowOffsetX = 0, flowOffsetY = 0;
    const syncCamera = () => {
      const viewport = host.querySelector<HTMLElement>('.react-flow__viewport');
      const transform = viewport?.style.transform || 'none';
      const matrix = transform !== 'none' ? new DOMMatrixReadOnly(transform) : { a: 1, b: 0, e: 0, f: 0 };
      const scale = Math.hypot(matrix.a, matrix.b) || 1;
      const x = matrix.e + flowOffsetX, y = matrix.f + flowOffsetY;
      cameraGroup.current?.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
      // Move only the SVG camera and its mask region. Node geometry stays in
      // world coordinates: panning never queries rows or reads their layout.
      for (const element of [maskRef.current, maskBackground.current]) {
        element?.setAttribute('x', String(-x / scale));
        element?.setAttribute('y', String(-y / scale));
        element?.setAttribute('width', String(hostWidth / scale));
        element?.setAttribute('height', String(hostHeight / scale));
      }
      return { scale, x, y };
    };
    const measure = () => {
      frame = 0;
      const hostBounds = host.getBoundingClientRect();
      const flowBounds = host.querySelector('.react-flow')?.getBoundingClientRect() ?? hostBounds;
      hostWidth = hostBounds.width; hostHeight = hostBounds.height;
      flowOffsetX = flowBounds.left - hostBounds.left; flowOffsetY = flowBounds.top - hostBounds.top;
      const { scale, x, y } = syncCamera();
      const bounds = { left: hostBounds.left + x, top: hostBounds.top + y };
      if (dirtyAll) worldRects.clear();
      const rects = new Map<Element, DOMRect>();
      const rectOf = (element: Element) => {
        let rect = rects.get(element);
        if (!rect) {
          const cached = worldRects.get(element);
          const node = element.closest('.react-flow__node');
          if (cached && (!node || !dirtyNodes.has(node))) {
            const left = bounds.left + cached.x * scale, top = bounds.top + cached.y * scale;
            const width = cached.width * scale, height = cached.height * scale;
            rect = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect;
          } else {
            rect = element.getBoundingClientRect();
            worldRects.set(element, { x: (rect.left - bounds.left) / scale, y: (rect.top - bounds.top) / scale, width: rect.width / scale, height: rect.height / scale });
          }
          rects.set(element, rect);
        }
        return rect;
      };
      const nodeById = new Map(Array.from(host.querySelectorAll<HTMLElement>('.react-flow__node')).map(node => [node.dataset.id, node]));
      const resizeTargets = new Set<Element>([host, ...nodeById.values(), ...host.querySelectorAll('[data-storyboard-scope]')]);
      for (const element of observed) if (!resizeTargets.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of resizeTargets) if (!observed.has(element)) { observed.add(element); resize.observe(element); }
      const wirePath = (sx: number, sy: number, tx: number, ty: number, reversed: boolean) => getBezierPath({ curvature: .32, sourceX: sx / scale, sourceY: sy / scale, targetX: tx / scale, targetY: ty / scale, sourcePosition: reversed ? Position.Left : Position.Right, targetPosition: reversed ? Position.Right : Position.Left })[0];
      // These controls live inside transformed React Flow nodes, while wires
      // are drawn in host coordinates. Cut out their actual visible bounds.
      const nextSurfaces = Array.from(host.querySelectorAll<HTMLElement>('.react-flow__node:not(.react-flow__node-storyboardGallery):not(.react-flow__node-organizationGroup):not(.react-flow__node-imageGroup), .image-asset-frame, .storyboard-stack-cover, .storyboard-stack-pages, .storyboard-stack-empty, .storyboard-stack-generation, .minimax-image-composer, .image-action-capsule, .canvas-action-surface, .storyboard-assets-popover')).map(rectOf).filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({ x: (rect.left - bounds.left) / scale, y: (rect.top - bounds.top) / scale, width: rect.width / scale, height: rect.height / scale }));
      setSurfaces(current => JSON.stringify(current) === JSON.stringify(nextSurfaces) ? current : nextSurfaces);
      const scopes = Array.from(host.querySelectorAll<HTMLElement>('[data-storyboard-scope]'));
      const next: RelationLine[] = [];
      const selected = storyboardRelationGalleryLinks(galleries.filter(gallery => gallery.storyboardId === focus?.storyboardId), shots, assets, focus);
      const links = galleries.filter(gallery => gallery.kind !== 'shot').flatMap(gallery => gallery.members.filter(member => member.assetId).map(member => ({ storyboardId: gallery.storyboardId, assetId: member.assetId!, variantId: member.variantId, memberId: member.id })));
      for (const link of links) {
        // Asset IDs are URL-encoded Chinese strings. Compare dataset values
        // directly instead of composing a fragile escaped CSS selector.
        const group = scopes.find(el => el.dataset.storyboardScope === link.storyboardId && el.classList.contains('storyboard-asset-group') && Array.from(el.querySelectorAll<HTMLElement>('[data-asset-id]')).some(tile => tile.dataset.assetId === link.assetId));
        const tile = Array.from(group?.querySelectorAll<HTMLElement>('[data-asset-id]') || []).find(item => item.dataset.assetId === link.assetId);
        const grid = group?.querySelector<HTMLElement>('.storyboard-asset-group-grid');
        const target = nodeById.get(link.memberId);
        if (!tile || !grid || !target) continue;
        const tileRect = rectOf(tile);
        const gridRect = rectOf(grid);
        const targetRect = rectOf(target);
        const rawY = (tileRect.top + tileRect.bottom) / 2;
        const sy = Math.max(gridRect.top + 4, Math.min(gridRect.bottom - 4, rawY)) - bounds.top;
        const reversed = targetRect.left < tileRect.left;
        const sx = (reversed ? tileRect.left : tileRect.right) - bounds.left;
        const tx = (reversed ? targetRect.right + 4 : targetRect.left - 4) - bounds.left;
        const ty = (targetRect.top + targetRect.bottom) / 2 - bounds.top;
        const path = wirePath(sx, sy, tx, ty, reversed);
        next.push({ key: `${link.storyboardId}:${link.assetId}:${link.variantId || 'default'}:${link.memberId}`, path, sx, sy, tx, ty, clipped: rawY < gridRect.top || rawY > gridRect.bottom, active: selected.some(item => item.assetId === link.assetId && item.memberId === link.memberId) });
      }
      for (const gallery of galleries.filter(item => item.kind === 'shot')) {
        const scope = scopes.find(el => el.dataset.storyboardScope === gallery.storyboardId && el.classList.contains('storyboard-node-body'));
        if (!scope) continue;
        for (const member of gallery.members.filter(item => item.shotId)) {
          const row = Array.from(scope.querySelectorAll<HTMLElement>('[data-shot-id]')).find(el => el.dataset.shotId === member.shotId);
          const target = nodeById.get(member.id);
          if (!row || !target) continue;
          const r = rectOf(row), t = rectOf(target);
          let top = r.top, bottom = r.bottom;
          for (let parent = row.parentElement; parent && parent !== host; parent = parent.parentElement) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
              const clip = rectOf(parent); top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
            }
          }
          if (bottom <= top) continue;
          const reversed = t.left < r.left;
          const sx = (reversed ? r.left : r.right) - bounds.left, sy = (top + bottom) / 2 - bounds.top;
          const tx = (reversed ? t.right + 4 : t.left - 4) - bounds.left, ty = (t.top + t.bottom) / 2 - bounds.top;
          const path = wirePath(sx, sy, tx, ty, reversed);
          next.push({ key: `shot:${gallery.storyboardId}:${member.shotId}:${member.id}`, path, sx, sy, tx, ty, clipped: top !== r.top || bottom !== r.bottom, active: focus?.storyboardId === gallery.storyboardId && focus.kind === 'shot' && focus.id === member.shotId });
        }
      }
      setLines(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      dirtyNodes.clear(); dirtyAll = false;
      for (const element of worldRects.keys()) if (!host.contains(element)) worldRects.delete(element);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(records => {
      let geometryChanged = false, cameraChanged = false;
      for (const record of records) {
        const target = record.target as Element;
        if (target.closest?.('.storyboard-relation-overlay')) continue;
        if (record.type === 'attributes' && target.classList?.contains('react-flow__viewport')) cameraChanged = true;
        else if (target.closest?.('.react-flow__node') || record.type === 'childList') {
          invalidate(target);
          // Parent transforms move all grouped descendants too.
          if (target.classList?.contains('react-flow__node')) {
            for (const child of target.querySelectorAll('.react-flow__node')) dirtyNodes.add(child);
          }
          geometryChanged = true;
        }
      }
      if (cameraChanged) syncCamera();
      if (geometryChanged) schedule();
    });
    mutations.observe(host, { subtree: true, attributes: true, attributeFilter: ['style', 'class'], childList: true });
    const onScroll = (event: Event) => { if (event.target instanceof Element) invalidate(event.target); schedule(); };
    const onResize = () => { dirtyAll = true; schedule(); };
    host.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    measure();
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); host.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [hostRef, focus, shots, assets, galleries]);
  return <svg className="storyboard-relation-overlay" aria-hidden="true"><defs><marker id={`${maskId}-arrow`} viewBox="-10 -10 20 20" refX="0" refY="0" markerWidth="11" markerHeight="11" orient="auto-start-reverse" markerUnits="strokeWidth"><polyline points="-5,-4 0,0 -5,4 -5,-4" stroke="var(--canvas-edge-color)" fill="var(--canvas-edge-color)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" /></marker><mask ref={maskRef} id={maskId} maskUnits="userSpaceOnUse"><rect ref={maskBackground} fill="white" />{surfaces.map((surface, index) => <rect key={index} {...surface} fill="black" />)}</mask></defs><g ref={cameraGroup} mask={`url(#${maskId})`}>{lines.map(line => <g key={line.key} data-relation-id={line.key} data-active={line.active} data-clipped={line.clipped} opacity={line.active ? 1 : focus ? .25 : 1}>
    <path className="storyboard-relation-wire" d={line.path} markerEnd={`url(#${maskId}-arrow)`} />
  </g>)}</g></svg>;
}
