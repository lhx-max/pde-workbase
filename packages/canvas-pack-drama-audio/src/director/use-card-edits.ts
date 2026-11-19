import { useLayoutEffect, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';

export type EditData = Record<string, unknown>;
type History = { undo: EditData[]; redo: EditData[] };
const empty: EditData = {};
const emptyHistory: History = { undo: [], redo: [] };
const cardLimit = 256 * 1024;
const same = (left: EditData, right: EditData) => JSON.stringify(left) === JSON.stringify(right);

export function useCardEdits(node: CardRenderProps['node'], onPatch: CardRenderProps['onPatch']) {
  const source = node.data ?? empty;
  const previous = useRef(source);
  const current = useRef(source);
  const history = useRef(emptyHistory);
  const [message, setMessage] = useState('修改交由画布保存');

  useLayoutEffect(() => {
    if (source === previous.current) return;
    previous.current = source;
    if (!same(source, current.current)) {
      current.current = source;
      history.current = emptyHistory;
      setMessage('已读取画布的最新内容');
    }
  }, [source]);

  function submit(data: EditData, nextHistory: History) {
    const patch = { ...data, stage: 'edit' };
    if (new TextEncoder().encode(JSON.stringify({ ...node, data: patch })).byteLength > cardLimit) {
      throw new Error('卡片内容超出 256 KB。请缩短台词或拆分为多张卡。');
    }
    onPatch({ data: patch });
    current.current = patch;
    history.current = nextHistory;
    setMessage('已提交给画布保存');
  }

  function patch(changes: EditData) {
    const before = current.current;
    const next = { ...before, ...changes, stage: 'edit' };
    if (same(before, next)) return;
    submit(next, { undo: [...history.current.undo.slice(-49), before], redo: [] });
  }

  function moveHistory(direction: 'undo' | 'redo') {
    const before = current.current;
    const { undo, redo } = history.current;
    const next = history.current[direction].at(-1);
    if (!next) return;
    // Card data is merged by the host. Clear keys introduced after the recalled snapshot.
    const restored = { ...Object.fromEntries(Object.keys(before).map(key => [key, null])), ...next };
    submit(restored, direction === 'undo'
      ? { undo: undo.slice(0, -1), redo: [...redo, before] }
      : { undo: [...undo, before], redo: redo.slice(0, -1) });
  }

  return { message, patch, moveHistory, history: history.current, draftData: () => current.current };
}
