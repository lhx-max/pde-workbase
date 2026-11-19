'use client';
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export type WorkspaceLayout = { left: number; right: number; timeline: number; trackHeight: number };
const DEFAULT: WorkspaceLayout = { left: 230, right: 350, timeline: 390, trackHeight: 56 };
const bounds = { left: [190, 340], right: [300, 480], timeline: [310, 640], trackHeight: [42, 84] } as const;
function clamp(key: keyof WorkspaceLayout, value: number) { return Math.max(bounds[key][0], Math.min(bounds[key][1], value)); }
export function useWorkbenchLayout() {
  const [layout, setLayout] = useState(DEFAULT);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: 'left' | 'right' | 'timeline'; pointer: number; from: number; initial: WorkspaceLayout } | null>(null);
  const save = setLayout;
  function bounded(key: 'left' | 'right' | 'timeline', value: number) {
    const rect = grid.current?.getBoundingClientRect();
    const max = key === 'timeline' ? (rect?.height ?? 900) - 180 : (rect?.width ?? 1600) - 360 - (key === 'left' ? layoutRef.current.right : layoutRef.current.left) - 20;
    return clamp(key, Math.min(value, max));
  }
  function separator(key: 'left' | 'right' | 'timeline') {
    const horizontal = key === 'timeline';
    return {
      role: 'separator' as const, tabIndex: 0,
      'aria-label': key === 'left' ? '调整素材面板宽度' : key === 'right' ? '调整属性面板宽度' : '调整时间轴高度',
      'aria-orientation': horizontal ? 'horizontal' as const : 'vertical' as const,
      'aria-valuenow': layout[key], 'aria-valuemin': bounds[key][0], 'aria-valuemax': bounds[key][1],
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { key, pointer: event.pointerId, from: horizontal ? event.clientY : event.clientX, initial: layoutRef.current };
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const state = drag.current;
        if (!state || state.pointer !== event.pointerId) return;
        const delta = ((horizontal ? event.clientY : event.clientX) - state.from) * (key === 'right' ? -1 : 1);
        setLayout({ ...state.initial, [key]: bounded(key, state.initial[key] + delta) });
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) { if (drag.current?.pointer === event.pointerId) { drag.current = null; save(layoutRef.current); } },
      onPointerCancel() { if (drag.current) setLayout(drag.current.initial); drag.current = null; },
      onLostPointerCapture() { if (drag.current) setLayout(drag.current.initial); drag.current = null; },
      onDoubleClick() { save({ ...layoutRef.current, [key]: DEFAULT[key] }); },
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const direction = horizontal ? (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) : (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * (key === 'right' ? -1 : 1);
        if (direction) { event.preventDefault(); save({ ...layoutRef.current, [key]: bounded(key, layoutRef.current[key] + direction * 16) }); }
        else if (event.key === 'Home') { event.preventDefault(); save({ ...layoutRef.current, [key]: DEFAULT[key] }); }
      },
    };
  }
  return { layout, grid, separator, setTrackHeight: (trackHeight: number) => save({ ...layout, trackHeight: clamp('trackHeight', trackHeight) }),
    preset: (mode: 'script' | 'audio' | 'mix') => save({ ...DEFAULT, timeline: mode === 'script' ? 330 : mode === 'audio' ? 470 : 420, trackHeight: mode === 'audio' ? 72 : 56 }), reset: () => save(DEFAULT) };
}
