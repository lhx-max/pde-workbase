// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_TIMEOUT_MS, useCardEdits } from '../src/director/use-card-edits';

type Node = { id: string; kind: string; data?: Record<string, unknown> };

function setup(initial: Record<string, unknown> = { rewriteLines: [], stage: 'edit' }) {
  const onPatch = vi.fn();
  let node: Node = { id: 'card-1', kind: 'card.drama.audio', data: initial };
  const hook = renderHook(({ current }: { current: Node }) => useCardEdits(current as never, onPatch), { initialProps: { current: node } });
  /** 模拟画布把提交的 data 回传给卡片。 */
  const echo = (data = onPatch.mock.lastCall?.[0]?.data as Record<string, unknown>) => {
    node = { ...node, data: { ...data } };
    hook.rerender({ current: node });
  };
  const external = (data: Record<string, unknown>) => {
    node = { ...node, data };
    hook.rerender({ current: node });
  };
  return { hook, onPatch, echo, external };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('卡片保存状态', () => {
  it('提交后显示保存中，画布回传同一份内容后显示已保存', () => {
    const { hook, onPatch, echo } = setup();
    expect(hook.result.current.status.state).toBe('synced');
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    expect(onPatch).toHaveBeenCalledWith({ data: { rewriteLines: [], stage: 'edit', masterGain: 0.5 } });
    expect(hook.result.current.status).toEqual({ state: 'pending', message: '保存中…' });
    act(() => echo());
    expect(hook.result.current.status).toEqual({ state: 'synced', message: '已保存到画布' });
    act(() => { vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS * 2); });
    expect(hook.result.current.status.state).toBe('synced');
  });

  it('画布合并了其他字段时仍按已提交字段判定同步', () => {
    const { hook, onPatch, echo } = setup();
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    const submitted = onPatch.mock.lastCall?.[0]?.data as Record<string, unknown>;
    act(() => echo({ ...submitted, hostField: 1 }));
    expect(hook.result.current.status.state).toBe('synced');
  });

  it('画布超时未回传时提示未确认，重新提交不改变撤销历史', () => {
    const { hook, onPatch, echo } = setup();
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    act(() => { vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS); });
    expect(hook.result.current.status).toEqual({ state: 'unconfirmed', message: '画布尚未确认这次修改' });
    const undoDepth = hook.result.current.history.undo.length;
    act(() => hook.result.current.retry());
    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(onPatch.mock.calls[1]?.[0]).toEqual(onPatch.mock.calls[0]?.[0]);
    expect(hook.result.current.status.state).toBe('pending');
    expect(hook.result.current.history.undo).toHaveLength(undoDepth);
    act(() => echo());
    expect(hook.result.current.status.state).toBe('synced');
  });

  it('未处于未确认状态时重新提交无效', () => {
    const { hook, onPatch } = setup();
    act(() => hook.result.current.retry());
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('等待确认期间画布回传他处修改时以画布为准并清空历史', () => {
    const { hook, external } = setup();
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    act(() => external({ rewriteLines: [{ id: 'x' }], stage: 'edit' }));
    expect(hook.result.current.status.state).toBe('external');
    expect(hook.result.current.status.message).toContain('另一个窗口已修改');
    expect(hook.result.current.draftData()).toEqual({ rewriteLines: [{ id: 'x' }], stage: 'edit' });
    expect(hook.result.current.history.undo).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS * 2); });
    expect(hook.result.current.status.state).toBe('external');
  });

  it('空闲时收到画布新增字段只提示已载入，后续提交保留该字段', () => {
    const { hook, onPatch, external } = setup();
    act(() => external({ rewriteLines: [], stage: 'edit', masterGain: 2 }));
    expect(hook.result.current.status).toEqual({ state: 'external', message: '已载入画布的最新内容' });
    act(() => hook.result.current.patch({ voiceInstruction: '沉稳男声' }));
    expect(onPatch.mock.lastCall?.[0]?.data).toMatchObject({ masterGain: 2, voiceInstruction: '沉稳男声' });
  });

  it('等待确认时画布回传含其他字段的结果，草稿采用画布内容', () => {
    const { hook, onPatch, echo } = setup();
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    const submitted = onPatch.mock.lastCall?.[0]?.data as Record<string, unknown>;
    act(() => echo({ ...submitted, hostField: 1 }));
    act(() => hook.result.current.patch({ masterGain: 1 }));
    expect(onPatch.mock.lastCall?.[0]?.data).toMatchObject({ hostField: 1, masterGain: 1 });
  });

  it('超出卡片容量时不提交并显示错误', () => {
    const { hook, onPatch } = setup();
    let failure: unknown;
    act(() => { try { hook.result.current.patch({ blob: 'x'.repeat(300 * 1024) }); } catch (error) { failure = error; } });
    expect(String(failure)).toContain('256 KB');
    expect(onPatch).not.toHaveBeenCalled();
    expect(hook.result.current.status.state).toBe('error');
    expect(hook.result.current.draftData()).toEqual({ rewriteLines: [], stage: 'edit' });
  });

  it('撤销清除之后新增的字段，重做恢复', () => {
    const { hook, onPatch, echo } = setup();
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    act(() => echo());
    act(() => hook.result.current.moveHistory('undo'));
    expect(onPatch.mock.lastCall?.[0]).toEqual({ data: { rewriteLines: [], stage: 'edit', masterGain: null } });
    act(() => echo());
    expect(hook.result.current.status.state).toBe('synced');
    expect(hook.result.current.history.redo).toHaveLength(1);
    act(() => hook.result.current.moveHistory('redo'));
    expect(onPatch.mock.lastCall?.[0]?.data).toMatchObject({ masterGain: 0.5 });
  });

  it('等待确认时离开页面会提示', () => {
    const { hook, echo } = setup();
    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    act(() => hook.result.current.patch({ masterGain: 0.5 }));
    const busy = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
    act(() => echo());
    const done = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(done);
    expect(done.defaultPrevented).toBe(false);
  });
  it('画布回传较早的提交时保留之后的本地编辑，全部回传后才显示已保存', () => {
    const { hook, onPatch, echo } = setup();
    act(() => hook.result.current.patch({ script: 'A' }));
    const first = onPatch.mock.lastCall?.[0]?.data as Record<string, unknown>;
    act(() => hook.result.current.patch({ script: 'AB' }));
    act(() => hook.result.current.patch({ script: 'ABC' }));
    act(() => echo(first));
    expect(hook.result.current.draftData().script).toBe('ABC');
    expect(hook.result.current.status.state).toBe('pending');
    expect(hook.result.current.history.undo).toHaveLength(3);
    act(() => echo());
    expect(hook.result.current.draftData().script).toBe('ABC');
    expect(hook.result.current.status.state).toBe('synced');
  });

  it('在途时回传与任何提交都不同的内容，仍按外部修改处理', () => {
    const { hook, external } = setup();
    act(() => hook.result.current.patch({ script: 'A' }));
    act(() => hook.result.current.patch({ script: 'AB' }));
    act(() => external({ rewriteLines: [], stage: 'edit', script: '另一个窗口' }));
    expect(hook.result.current.draftData().script).toBe('另一个窗口');
    expect(hook.result.current.status.state).toBe('external');
    expect(hook.result.current.history.undo).toHaveLength(0);
  });
});
