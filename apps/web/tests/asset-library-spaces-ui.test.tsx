// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { AssetLibrarySpacePicker } from '../src/components/AssetLibrarySpacePicker';
import { configureAssetLibraryAdapter, createHttpAssetLibrary } from '../src/providers/asset-library';
import { PROJECT_FOLDERS_CHANGED_EVENT } from '../src/state/project-folders';

const initial = [{ id: 'default-project', name: 'Default space', createdAt: 0 }, { id: 'brand', name: 'Brand', createdAt: 1 }];
let folders = initial.slice(1);
const read = vi.fn();
const patch = vi.fn();
const changed = vi.fn();
const refreshed = vi.fn();
let restore: () => void;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function show(value = 'brand', viewerOnly = false) {
  return render(<I18nProvider initial="en"><AssetLibrarySpacePicker scope="local" value={value} spaces={initial} onChange={changed} onRefresh={refreshed} viewerOnly={viewerOnly}/></I18nProvider>);
}
async function menu(name: string) {
  fireEvent.keyDown(await screen.findByRole('button', { name: 'Choose asset space' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
beforeEach(() => {
  folders = initial.slice(1); changed.mockReset(); refreshed.mockReset(); localStorage.clear();
  read.mockReset().mockImplementation(async () => ({ folders, initialized: true }));
  patch.mockReset().mockImplementation(async (_scope, change) => {
    folders = folders.filter(row => !change.remove.includes(row.id));
    for (const row of change.upsert) folders = [...folders.filter(item => item.id !== row.id), row];
    return { folders, initialized: true };
  });
  restore = configureAssetLibraryAdapter({ ...createHttpAssetLibrary(), spaces: read, patchSpaces: patch,
    info: vi.fn().mockResolvedValue({ source: { kind: 'builtin', id: 'space-test' }, capabilities: { spaces: true } }),
  });
});
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); });

it('creates only after confirmation and refreshes the acknowledged source cache', async () => {
  const events = vi.fn(); window.addEventListener(PROJECT_FOLDERS_CHANGED_EVENT, events);
  show(); await menu('＋ New space');
  fireEvent.change(screen.getByRole('textbox', { name: 'space name' }), { target: { value: 'Campaign' } });
  expect(patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create space' }));
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce());
  expect(read).toHaveBeenCalledWith('local');
  expect(patch).toHaveBeenCalledWith('local', { upsert: [{ id: expect.any(String), name: 'Campaign', createdAt: expect.any(Number) }], remove: [] });
  expect(changed).toHaveBeenCalledWith(patch.mock.calls[0][1].upsert[0].id);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(events).toHaveBeenCalled();
  window.removeEventListener(PROJECT_FOLDERS_CHANGED_EVENT, events);
});

it('keeps create/rename drafts and errors until the mutation is acknowledged', async () => {
  patch.mockRejectedValueOnce(new Error('permission denied'));
  show(); await menu('Rename space Brand');
  fireEvent.change(screen.getByRole('textbox', { name: 'space name' }), { target: { value: 'Brand revised' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('permission denied');
  expect((screen.getByRole('textbox', { name: 'space name' }) as HTMLInputElement).value).toBe('Brand revised');
  expect(changed).not.toHaveBeenCalled(); expect(refreshed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce());
  expect(patch.mock.calls[1]).toEqual(['local', { upsert: [{ id: 'brand', name: 'Brand revised', createdAt: 1 }], remove: [] }]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('cancel create/delete never writes or changes selection', async () => {
  show(); await menu('＋ New space');
  fireEvent.change(screen.getByRole('textbox', { name: 'space name' }), { target: { value: 'Cancelled' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await menu('Delete space Brand');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(patch).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});

it('defaults to moving assets when removing a space, never deleting projects', async () => {
  show(); await menu('Delete space Brand');
  expect(screen.getByRole('checkbox', { name: 'Move' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Assets stay. Only this space is removed.')).toBeTruthy();
  expect(screen.queryByText(/projects/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce());
  expect(patch).toHaveBeenCalledWith('local', { upsert: [], remove: ['brand'], removeContents: false, targetSpaceId: 'default-project' });
  expect(changed).toHaveBeenCalledWith('default-project');
});

it('permanent removal requires opting out of move and explicit confirmation', async () => {
  show(); await menu('Delete space Brand');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Move' }));
  expect(screen.getByText('All assets and folders in this space will be permanently deleted. This cannot be undone.')).toBeTruthy();
  expect(patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce());
  expect(patch.mock.calls[0][1].removeContents).toBe(true);
});

it('failed removal retains its confirmation and does not navigate away', async () => {
  patch.mockRejectedValueOnce(new Error('space changed'));
  show(); await menu('Delete space Brand');
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect((await screen.findByRole('alert')).textContent).toContain('space changed');
  expect(screen.getByRole('dialog')).toBeTruthy(); expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: 'Move' }).getAttribute('aria-checked')).toBe('true');
});

it('protects the virtual default and keeps read-only selection available', async () => {
  const view = show('default-project');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose asset space' }), { key: 'ArrowDown' });
  expect(await screen.findByRole('menuitem', { name: '＋ New space' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /Delete space/ })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: /Rename space/ })).toBeNull();
  view.unmount(); show('brand', true);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose asset space' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Default space' }));
  expect(changed).toHaveBeenCalledWith('default-project'); expect(patch).not.toHaveBeenCalled();
});

it('does not apply a stale mutation when the source switches during authoritative read', async () => {
  const pending = deferred<{ folders: typeof folders; initialized: boolean }>();
  read.mockReturnValueOnce(pending.promise);
  show(); await menu('＋ New space');
  fireEvent.change(screen.getByRole('textbox', { name: 'space name' }), { target: { value: 'Old source draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create space' }));
  let restoreOther!: () => void;
  act(() => { restoreOther = configureAssetLibraryAdapter(createHttpAssetLibrary('/other')); });
  await act(async () => { pending.resolve({ folders, initialized: true }); });
  expect(patch).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => restoreOther());
});
