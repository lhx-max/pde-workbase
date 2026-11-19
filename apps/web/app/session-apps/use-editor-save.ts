import { useCallback, useEffect, useRef, useState } from 'react';
import { demoProjectOf, readDubbingListSource, patchDubbingListSource } from './demo-adapter';
import { assertUnlocked } from './director-edits';

export type EditorNode = { id: string; kind: string; title?: string; data?: Record<string, unknown> };

type Data = Record<string, unknown>;
type History = { undo: Data[]; redo: Data[] };
type Status = { state: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; message: string };

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(before: Data, next: Data) {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => !same(before[key], value)));
}

export function useEditorSave() {
  const [node, setNode] = useState<EditorNode | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle', message: '' });
  const [history, setHistory] = useState<History>({ undo: [], redo: [] });
  const saved = useRef<EditorNode | null>(null);
  const draft = useRef<EditorNode | null>(null);
  const queue = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef<Promise<boolean> | null>(null);
  const checkpoint = useRef(true);
  const historyRef = useRef(history);
  const latestRead = useRef(0);

  function updateHistory(next: History) {
    historyRef.current = next;
    setHistory(next);
  }

  const read = useCallback(async (projectId: string, activeProject: () => string) => {
    const version = ++latestRead.current;
    const response = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`, { cache: 'no-store' });
    const body = await response.json().catch(() => null) as { data?: { state?: { workbenchBasicNodes?: EditorNode[] } } } | null;
    if (!response.ok || !Array.isArray(body?.data?.state?.workbenchBasicNodes)) throw new Error('画布状态读取失败');
    if (version !== latestRead.current || projectId !== activeProject() || active.current || draft.current !== saved.current) return;
    const next = body.data.state.workbenchBasicNodes.find(item => item.kind === 'card.drama.audio' && item.data?.stage === 'edit') ?? null;
    if (same(next, saved.current)) return;
    if (saved.current && (!same(next?.data, saved.current.data) || next?.id !== saved.current.id)) {
      updateHistory({ undo: [], redo: [] });
    }
    saved.current = draft.current = next;
    setNode(next);
  }, []);

  const flush = useCallback(async function flush(): Promise<boolean> {
    if (queue.current) clearTimeout(queue.current);
    queue.current = null;
    if (active.current) {
      if (!await active.current) return false;
      return flush();
    }
    const before = saved.current;
    const target = draft.current;
    if (!before || !target || target === before) return true;
    const project = demoProjectOf(target);
    if (!project || !before.data || !target.data) {
      setStatus({ state: 'error', message: '此项目的配音编辑仅支持本地 demo，草稿已保留。' });
      return false;
    }
    const expectedData = before.data;
    const nextData = target.data;
    setStatus({ state: 'saving', message: '保存中…' });
    checkpoint.current = true;
    const write = (async () => {
      try {
        const signal = AbortSignal.timeout(12_000);
        const current = await readDubbingListSource(project, target.id, signal) as EditorNode;
        if (!current.data) throw new Error('配音编辑卡已不可用');
        const changes = changedFields(expectedData, nextData);
        for (const [field, value] of Object.entries(changes)) {
          if (!same(current.data[field], expectedData[field]) && !same(current.data[field], value)) {
            throw new Error('此内容在另一个窗口已修改');
          }
        }
        assertUnlocked(current.data, changes);
        const merged = { ...current.data, ...changes };
        if (!same(current.data, merged)) await patchDubbingListSource(project, target.id, current.data, merged, signal);
        const stored = await readDubbingListSource(project, target.id, signal) as EditorNode;
        if (!stored.data || !same(stored.data, merged)) throw new Error('保存读回与草稿不一致');
        if (!same(current.data, expectedData)) updateHistory({ undo: [current.data], redo: [] });
        const newer = draft.current === target ? null : draft.current?.data;
        saved.current = stored;
        draft.current = newer ? { ...stored, data: { ...stored.data, ...changedFields(nextData, newer) } } : stored;
        setNode(draft.current);
        setStatus(newer ? { state: 'pending', message: '待保存' } : { state: 'saved', message: '已保存' });
        return true;
      } catch (error) {
        setStatus({ state: 'error', message: `${error instanceof Error ? error.message : '保存失败'}。草稿已保留。` });
        return false;
      }
    })();
    active.current = write;
    const ok = await write;
    active.current = null;
    return ok && (draft.current === saved.current || await flush());
  }, []);

  function stage(data: Data, remember: boolean) {
    const current = draft.current;
    if (!current?.data || same(current.data, data)) return;
    if (remember && checkpoint.current) {
      updateHistory({ undo: [...historyRef.current.undo.slice(-49), current.data], redo: [] });
      checkpoint.current = false;
    }
    draft.current = { ...current, data };
    setNode(draft.current);
    setStatus({ state: 'pending', message: '待保存' });
    if (queue.current) clearTimeout(queue.current);
    queue.current = setTimeout(() => { void flush(); }, 360);
  }

  function patch(data: Data) {
    if (draft.current?.data) stage({ ...draft.current.data, ...data }, true);
  }

  function moveHistory(direction: 'undo' | 'redo') {
    const current = draft.current?.data;
    const { undo, redo } = historyRef.current;
    const stack = direction === 'undo' ? undo : redo;
    const target = stack.at(-1);
    if (!current || !target) return;
    updateHistory(direction === 'undo'
      ? { undo: undo.slice(0, -1), redo: [...redo, current] }
      : { undo: [...undo, current], redo: redo.slice(0, -1) });
    checkpoint.current = true;
    stage(target, false);
  }

  function reset() {
    ++latestRead.current;
    if (queue.current) clearTimeout(queue.current);
    queue.current = null;
    saved.current = draft.current = null;
    checkpoint.current = true;
    updateHistory({ undo: [], redo: [] });
    setNode(null);
    setStatus({ state: 'idle', message: '' });
  }

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (draft.current === saved.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  return { node, status, read, patch, flush, reset, moveHistory, history,
    draftData: () => draft.current?.data };
}
