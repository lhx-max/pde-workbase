'use client';

import React from 'react';
import { useStore } from '@xyflow/react';
import { CanvasIdleWorkContext, useCanvasIdleWork } from '../platform/canvas-idle-work';

const OverviewContext = React.createContext(false);
const PreviewScaleContext = React.createContext(1);
export function useCanvasPreviewScale() { return React.useContext(PreviewScaleContext); }
const ActiveDetailOwnerContext = React.createContext<string | null | undefined>(undefined);
const DetailContext = React.createContext({ detail: true, nearby: true });

/** Hysteresis prevents repeated mounts around the overview boundary. */
export function canvasOverviewAtZoom(zoom: number, wasOverview: boolean): boolean {
  return zoom < (wasOverview ? .45 : .35);
}

export function CanvasRenderPolicyProvider({ children, activeNodeId }: { children: React.ReactNode; activeNodeId?: string | null }) {
  const idleWork = useCanvasIdleWork();
  // Start cheap while React Flow restores its persisted camera. Starting in
  // detail would briefly mount every iframe before the first layout effect.
  const [overview, setOverview] = React.useState(true);
  const bucket = useStore(state => state.transform[2] <= .25 ? .25 : state.transform[2] <= .5 ? .5 : state.transform[2] <= 1 ? 1 : state.transform[2] <= 2 ? 2 : state.transform[2] <= 4 ? 4 : 8);
  const [scale, setScale] = React.useState(.25);
  React.useEffect(() => idleWork.schedule(() => setScale(bucket)), [bucket, idleWork]);
  // A boolean subscription, never the changing viewport tuple or nodes array.
  const target = useStore(state => canvasOverviewAtZoom(state.transform[2], overview));
  React.useEffect(() => {
    return idleWork.schedule(() => setOverview(target));
  }, [target, idleWork]);
  return <CanvasIdleWorkContext.Provider value={idleWork}><PreviewScaleContext.Provider value={scale}><ActiveDetailOwnerContext.Provider value={activeNodeId}><OverviewContext.Provider value={overview}>{children}</OverviewContext.Provider></ActiveDetailOwnerContext.Provider></PreviewScaleContext.Provider></CanvasIdleWorkContext.Provider>;
}

type Listener = (visible: boolean) => void;
const observers = new WeakMap<Element, { observer: IntersectionObserver; listeners: Map<Element, Listener> }>();
function observeNode(node: Element, listener: Listener) {
  const root = node.closest('.react-flow');
  if (!root || typeof IntersectionObserver === 'undefined') return () => {};
  let entry = observers.get(root);
  if (!entry) {
    const listeners = new Map<Element, Listener>();
    const observer = new IntersectionObserver(records => {
      for (const record of records) listeners.get(record.target)?.(record.isIntersecting);
    }, { root, rootMargin: '400px', threshold: 0 });
    entry = { observer, listeners };
    observers.set(root, entry);
  }
  entry.listeners.set(node, listener);
  entry.observer.observe(node);
  return () => {
    entry.listeners.delete(node);
    entry.observer.unobserve(node);
    if (!entry.listeners.size) { entry.observer.disconnect(); observers.delete(root); }
  };
}

/** Only presentation sleeps: generation, drafts, handles and geometry stay mounted. */
export function CanvasNodeRenderBoundary({ selected, nodeId, children }: { selected?: boolean; nodeId?: string; children: React.ReactNode }) {
  const overview = React.useContext(OverviewContext);
  const activeOwner = React.useContext(ActiveDetailOwnerContext);
  const idleWork = useCanvasIdleWork();
  const anchor = React.useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = React.useState(true);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    const node = anchor.current?.closest('.react-flow__node');
    if (!node) return;
    let cancel: (() => void) | undefined;
    const stop = observeNode(node, visible => {
      cancel?.();
      cancel = idleWork.schedule(() => setNearby(visible));
    });
    return () => { cancel?.(); stop(); };
  }, [idleWork]);
  // Multi-select is a geometry operation, not a request to wake 300 editors.
  const pinned = Boolean(selected) && (activeOwner === undefined || activeOwner === nodeId);
  const [settledDetail, setSettledDetail] = React.useState(!overview);
  React.useEffect(() => {
    if (settledDetail === !overview) return;
    return idleWork.schedule(() => setSettledDetail(!overview), 0);
  }, [overview, settledDetail, idleWork]);
  const value = React.useMemo(() => ({ nearby, detail: focused || pinned || (nearby && settledDetail) }), [nearby, settledDetail, pinned, focused]);
  return <DetailContext.Provider value={value}>
    <div ref={anchor} style={{ display: 'contents' }} onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setFocused(false);
    }}>{children}</div>
  </DetailContext.Provider>;
}

export function useCanvasRenderDetail() { return React.useContext(DetailContext); }
