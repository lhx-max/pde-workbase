import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';

export type EditData = Record<string, unknown>;
type History = { undo: EditData[]; redo: EditData[] };
/**
 * 卡片只能通过 onPatch 把修改交给画布，画布负责持久化。
 * 这里如实反映「已交给画布、画布是否已回传同一份内容」，不冒充服务端保存回执。
 */
export type SaveState = 'synced' | 'pending' | 'unconfirmed' | 'external' | 'error';
export type SaveStatus = { state: SaveState; message: string };

const empty: EditData = {};
const emptyHistory: History = { undo: [], redo: [] };
const cardLimit = 256 * 1024;
/** 画布在该时间内未回传提交内容时，提示可重新提交。 */
export const CONFIRM_TIMEOUT_MS = 4_000;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
/** 画布可能合并其他字段；只要提交的每个字段都已回传即视为同步。 */
const reflects = (source: EditData, submitted: EditData) =>
  Object.entries(submitted).every(([key, value]) => value === null ? source[key] == null : same(source[key], value));

export function useCardEdits(node: CardRenderProps['node'], onPatch: CardRenderProps['onPatch']) {
  const source = node.data ?? empty;
  const previous = useRef(source);
  const current = useRef(source);
  const history = useRef(emptyHistory);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaiting = useRef(false);
  const [status, setStatus] = useState<SaveStatus>({ state: 'synced', message: '修改由画布保存' });

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!awaiting.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  useLayoutEffect(() => {
    if (source === previous.current) return;
    previous.current = source;
    if (same(source, current.current) || (awaiting.current && reflects(source, current.current))) {
      // 以画布回传的完整内容为草稿基础，保留画布合并进来的其他字段。
      current.current = source;
      if (awaiting.current) {
        awaiting.current = false;
        clearTimer();
        setStatus({ state: 'synced', message: '已保存到画布' });
      }
      return;
    }
    // 画布回传了与本地草稿不同的内容：以画布为准，避免覆盖其他窗口或 Agent 的修改。
    const interrupted = awaiting.current;
    awaiting.current = false;
    clearTimer();
    current.current = source;
    history.current = emptyHistory;
    setStatus(interrupted
      ? { state: 'external', message: '此内容在另一个窗口已修改，已载入画布的最新内容；请核对后重做未生效的修改' }
      : { state: 'external', message: '已载入画布的最新内容' });
  }, [source]);

  function send(patch: EditData) {
    onPatch({ data: patch });
    awaiting.current = true;
    clearTimer();
    setStatus({ state: 'pending', message: '保存中…' });
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!awaiting.current) return;
      setStatus({ state: 'unconfirmed', message: '画布尚未确认这次修改' });
    }, CONFIRM_TIMEOUT_MS);
  }

  function submit(data: EditData, nextHistory: History) {
    const patch = { ...data, stage: 'edit' };
    if (new TextEncoder().encode(JSON.stringify({ ...node, data: patch })).byteLength > cardLimit) {
      const message = '卡片内容超出 256 KB。请缩短台词或拆分为多张卡。';
      setStatus({ state: 'error', message: `修改未应用：${message}` });
      throw new Error(message);
    }
    current.current = patch;
    history.current = nextHistory;
    send(patch);
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

  /** 画布未确认时重新提交当前草稿，不改变撤销历史。 */
  function retry() {
    if (status.state !== 'unconfirmed') return;
    send(current.current);
  }

  return { status, message: status.message, patch, moveHistory, retry, history: history.current, draftData: () => current.current };
}
