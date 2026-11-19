// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditorSave, type EditorNode } from '../app/session-apps/use-editor-save';

const adapter = vi.hoisted(() => ({ read: vi.fn(), patch: vi.fn() }));
vi.mock('../app/session-apps/demo-adapter', () => ({
  demoProjectOf: () => 'demo',
  readDubbingListSource: adapter.read,
  patchDubbingListSource: adapter.patch,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function fixture() {
  let remote: EditorNode = { id: 'a', kind: 'card.drama.audio', data: { stage: 'edit', script: '原稿', masterGain: 1 } };
  adapter.read.mockImplementation(async () => structuredClone(remote));
  adapter.patch.mockImplementation(async (_project, _id, expected, data) => {
    expect(expected).toEqual(remote.data);
    remote = { ...remote, data: structuredClone(data) };
  });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { state: { workbenchBasicNodes: [remote] } } })));
  return { data: () => remote.data!, external: (changes: Record<string, unknown>) => { remote.data = { ...remote.data, ...changes }; } };
}

it('saves a burst as one draft, then undoes and redoes the saved text', async () => {
  const remote = fixture();
  const { result } = renderHook(() => useEditorSave());
  await act(async () => { await result.current.read('demo', () => 'demo'); });
  act(() => {
    result.current.patch({ script: 'A' });
    result.current.patch({ script: 'AB' });
    result.current.patch({ script: 'ABCDE' });
  });
  expect(result.current.node?.data?.script).toBe('ABCDE');
  await act(async () => { expect(await result.current.flush()).toBe(true); });
  expect(adapter.patch).toHaveBeenCalledTimes(1);
  expect(remote.data().script).toBe('ABCDE');
  act(() => result.current.moveHistory('undo'));
  await act(async () => { await result.current.flush(); });
  expect(remote.data().script).toBe('原稿');
  act(() => result.current.moveHistory('redo'));
  await act(async () => { await result.current.flush(); });
  expect(remote.data().script).toBe('ABCDE');
});

it('keeps local drafts when the same field changed elsewhere', async () => {
  const remote = fixture();
  const { result } = renderHook(() => useEditorSave());
  await act(async () => { await result.current.read('demo', () => 'demo'); });
  act(() => result.current.patch({ script: '本地版本' }));
  remote.external({ script: '另一个窗口' });
  await act(async () => { expect(await result.current.flush()).toBe(false); });
  expect(adapter.patch).not.toHaveBeenCalled();
  expect(result.current.status.state).toBe('error');
  expect(result.current.node?.data?.script).toBe('本地版本');
  expect(remote.data().script).toBe('另一个窗口');
});
