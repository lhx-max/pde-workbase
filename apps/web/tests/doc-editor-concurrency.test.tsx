// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentEditorPane, I18nProvider, type DocDocumentApi, type DocSnapshot, type DocWriteSnapshot } from '@doc/surface';

const meta = { id: 'd', name: 'Document', path: 'd.md', size: 1, updatedAt: '' };
const snap = (content: string, revision = content): DocWriteSnapshot => ({ content, revision, meta });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
async function setup(api: DocDocumentApi) {
  let flush!: () => Promise<boolean>;
  const dirty = vi.fn();
  render(<I18nProvider><DocumentEditorPane api={api} document={meta} onDirtyChange={dirty} registerFlush={next => { flush = next; }} /></I18nProvider>);
  await settle();
  fireEvent.click(screen.getAllByRole('tab')[0]!);
  return { editor: screen.getByRole('textbox') as HTMLTextAreaElement, dirty, flush: () => flush() };
}
function apiFor(readSnapshot: () => Promise<DocSnapshot>, writeSnapshot: NonNullable<DocDocumentApi['writeSnapshot']>): DocDocumentApi {
  return { read: vi.fn().mockRejectedValue(new Error('legacy read must not run')), write: vi.fn().mockRejectedValue(new Error('legacy write must not run')), readSnapshot, writeSnapshot };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('adopts merged canonical content and clears dirty after a successful save', async () => {
  const write = vi.fn().mockResolvedValue(snap('local + remote', 'r2'));
  const { editor, dirty, flush } = await setup(apiFor(async () => snap('base', 'r1'), write));
  fireEvent.change(editor, { target: { value: 'local' } });
  await act(async () => { expect(await flush()).toBe(true); });
  expect(editor.value).toBe('local + remote');
  expect(write).toHaveBeenCalledWith('local', { expectedRevision: 'r1', baseContent: 'base' });
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it('preserves new typing during a merged save and pauses subsequent automatic writes', async () => {
  let resolve!: (value: DocWriteSnapshot) => void;
  const write = vi.fn(() => new Promise<DocWriteSnapshot>(done => { resolve = done; }));
  const { editor, dirty, flush } = await setup(apiFor(async () => snap('base', 'r1'), write));
  vi.useFakeTimers();
  fireEvent.change(editor, { target: { value: 'submitted' } });
  let saving!: Promise<boolean>;
  act(() => { saving = flush(); });
  fireEvent.change(editor, { target: { value: 'new typing' } });
  await act(async () => { resolve(snap('submitted + remote', 'r2')); expect(await saving).toBe(false); });
  expect(editor.value).toBe('new typing');
  expect(screen.getByText('submitted + remote')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(write).toHaveBeenCalledTimes(1);
  expect(dirty).toHaveBeenLastCalledWith(true);
  await act(async () => { expect(await flush()).toBe(false); });
});

it('follows remote updates when clean but retains dirty draft and shows the remote version', async () => {
  let current = snap('base', 'r1');
  const write = vi.fn().mockResolvedValue(snap('unused'));
  const { editor, flush } = await setup(apiFor(async () => current, write));
  current = snap('remote clean', 'r2');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(editor.value).toBe('remote clean');
  fireEvent.change(editor, { target: { value: 'my draft' } });
  current = snap('remote dirty', 'r3');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(editor.value).toBe('my draft');
  expect(screen.getByText('remote dirty')).toBeTruthy();
  await act(async () => { expect(await flush()).toBe(false); });
  expect(write).not.toHaveBeenCalled();
});

it('keeps conflict draft and retries only on explicit choice using the original baseline', async () => {
  const conflict = Object.assign(new Error('conflict'), { details: { currentContent: 'theirs', currentRevision: 'r2' } });
  const write = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(snap('merged', 'r3'));
  const { editor, flush } = await setup(apiFor(async () => snap('base', 'r1'), write));
  fireEvent.change(editor, { target: { value: 'mine' } });
  await act(async () => { expect(await flush()).toBe(false); });
  expect(editor.value).toBe('mine');
  expect(screen.getByText('theirs')).toBeTruthy();
  await act(async () => { expect(await flush()).toBe(false); });
  expect(write).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('保留草稿并重试合并'));
  await settle();
  expect(write).toHaveBeenLastCalledWith('mine', { expectedRevision: 'r1', baseContent: 'base' });
  expect(editor.value).toBe('merged');
});

it('saves newer typing after an ordinary in-flight save without losing the queued edit', async () => {
  let resolve!: (value: DocWriteSnapshot) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<DocWriteSnapshot>(done => { resolve = done; }))
    .mockResolvedValueOnce(snap('newer', 'r3'));
  const { editor, dirty, flush } = await setup(apiFor(async () => snap('base', 'r1'), write));
  vi.useFakeTimers();
  fireEvent.change(editor, { target: { value: 'first' } });
  let saving!: Promise<boolean>;
  act(() => { saving = flush(); });
  fireEvent.change(editor, { target: { value: 'newer' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(snap('first', 'r2')); expect(await saving).toBe(false); });
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(write).toHaveBeenLastCalledWith('newer', { baseContent: 'first', expectedRevision: 'r2' });
  expect(editor.value).toBe('newer');
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it('requires explicit confirmation before replacing a reviewed remote conflict', async () => {
  const conflict = Object.assign(new Error('conflict'), { details: { currentContent: 'theirs', currentRevision: 'r2' } });
  const write = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(snap('mine', 'r3'));
  const { editor, flush } = await setup(apiFor(async () => snap('base', 'r1'), write));
  fireEvent.change(editor, { target: { value: 'mine' } });
  await act(async () => { await flush(); });
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  fireEvent.click(screen.getByText('确认以当前草稿替换此远端版本'));
  await settle();
  expect(write).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('确认以当前草稿替换此远端版本'));
  await settle();
  expect(write).toHaveBeenLastCalledWith('mine', { baseContent: 'theirs', expectedRevision: 'r2' });
});

it('never writes an empty document after a failed initial load', async () => {
  const write = vi.fn();
  const api = apiFor(async () => { throw new Error('read forbidden'); }, write);
  let flush!: () => Promise<boolean>;
  render(<I18nProvider><DocumentEditorPane api={api} document={meta} registerFlush={next => { flush = next; }} /></I18nProvider>);
  await settle();
  expect(screen.getByRole('alert').textContent).toContain('read forbidden');
  expect(await flush()).toBe(false);
  expect(write).not.toHaveBeenCalled();
});
