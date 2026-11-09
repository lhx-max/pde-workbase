import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { FileViewerProps } from '../src/components/FileViewer';
import type { HtmlViewerProps } from '../src/components/HtmlViewer';
import { createManualEditRetention, settleManualEditExit, settleManualEditFiles } from '../src/components/html-viewer/manual-edit-retention';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('original manual-edit shell retention contract', () => {
  it('preserves all HtmlViewer host props through the file router type', () => {
    expectTypeOf<FileViewerProps>().toExtend<HtmlViewerProps>();
    expectTypeOf<FileViewerProps['onManualEditExitHandlerChange']>().toEqualTypeOf<HtmlViewerProps['onManualEditExitHandlerChange']>();
    expectTypeOf<FileViewerProps['onRetainActivityChange']>().toEqualTypeOf<HtmlViewerProps['onRetainActivityChange']>();
  });

  it('fails closed when a save rejects or explicitly vetoes navigation', async () => {
    await expect(settleManualEditExit(async () => { throw new Error('Write failed'); })).resolves.toBe(false);
    await expect(settleManualEditExit(async () => false)).resolves.toBe(false);
    await expect(settleManualEditExit(async () => true)).resolves.toBe(true);
  });

  it('deduplicates repeated save/close/navigation requests for one file', async () => {
    const registry = createManualEditRetention();
    const completion = deferred<boolean>();
    const save = vi.fn(() => completion.promise);
    registry.onManualEditExitHandlerChange('a.html', save);
    const first = registry.settle('a.html');
    const second = registry.settle('a.html');
    expect(first).toBe(second);
    expect(save).toHaveBeenCalledTimes(1);
    completion.resolve(true);
    await expect(first).resolves.toBe(true);
  });

  it('retains pending save authority even if a viewer unregisters its handler', async () => {
    const registry = createManualEditRetention();
    const completion = deferred<boolean>();
    registry.onRetainActivityChange('a.html', true);
    registry.onManualEditExitHandlerChange('a.html', () => completion.promise);
    const saving = registry.settle('a.html');
    registry.onRetainActivityChange('a.html', false);
    registry.onManualEditExitHandlerChange('a.html', null);
    expect(registry.isProtected('a.html')).toBe(true);
    expect(registry.settle('a.html')).toBe(saving);
    const all = registry.settleAll();
    completion.resolve(false);
    await expect(all).resolves.toBe(false);
    expect(registry.isProtected('a.html')).toBe(false);
  });

  it('settles hidden protected viewers as well as the active file', async () => {
    const registry = createManualEditRetention();
    const hiddenSave = vi.fn(async () => false);
    registry.onManualEditExitHandlerChange('active.html', async () => true);
    registry.onRetainActivityChange('hidden.html', true);
    registry.onManualEditExitHandlerChange('hidden.html', hiddenSave);
    expect([...registry.protectedFiles()].sort()).toEqual(['active.html', 'hidden.html']);
    await expect(registry.settleAll()).resolves.toBe(false);
    expect(hiddenSave).toHaveBeenCalledTimes(1);
  });

  it('deduplicates aggregate names and isolates separate workspace instances', async () => {
    const settle = vi.fn(async () => true);
    await expect(settleManualEditFiles(['a', 'a', 'b'], settle)).resolves.toBe(true);
    expect(settle).toHaveBeenCalledTimes(2);
    const first = createManualEditRetention();
    const second = createManualEditRetention();
    first.onRetainActivityChange('shared.html', true);
    expect(first.isProtected('shared.html')).toBe(true);
    expect(second.isProtected('shared.html')).toBe(false);
  });
});
