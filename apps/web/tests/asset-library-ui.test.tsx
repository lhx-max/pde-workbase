// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PersonalAsset } from '@bezier/contracts';
import { I18nProvider } from '../src/i18n';
import { SaveAssetDialog, SaveAssetDialogHost } from '../src/components/SaveAssetDialog';
import { SavedAssetDialog } from '../src/components/SavedAssetDialog';
import { PersonalAssetLibrary } from '../src/components/PersonalAssetLibrary';
import { configureAssetLibraryAdapter, createHttpAssetLibrary, PersonalAssetRequestError } from '../src/providers/asset-library';
import { requestSaveAsset, type SaveAssetDraft } from '../src/state/save-asset';

vi.mock('../src/components/asset-library/use-picker-spaces', () => ({ usePickerSpaces: () => ({ space: 'brand', setSpace: vi.fn(), folders: [{ id: 'brand', name: 'Brand' }], projectSpaces: {}, projectsReady: true }) }));
const saved: PersonalAsset = { id: 'saved', name: 'Capture', kind: 'image', description: '', tags: [], source: {}, revision: 1, parentId: null, owner: 'local-personal', createdAt: 1, updatedAt: 1, deletedAt: null, favorite: false, versions: [{ id: 'v1', filename: 'capture.png', mime: 'image/png', hash: 'h', size: 5, createdAt: 1 }] };
const draft: SaveAssetDraft = { name: 'Capture', filename: 'capture.png', mime: 'image/png', text: 'bytes', kind: 'image' };
const upload = vi.fn();
const patch = vi.fn();
const list = vi.fn();
const analyze = vi.fn();
const info = vi.fn();
let restore: () => void;
function show(ui: React.ReactNode) { return render(<I18nProvider initial="en">{ui}</I18nProvider>); }
function request(extra: Partial<SaveAssetDraft> = {}) {
  let result!: Promise<PersonalAsset | null>;
  act(() => { result = requestSaveAsset({ ...draft, ...extra }); });
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  upload.mockReset().mockResolvedValue({ asset: saved });
  patch.mockReset().mockResolvedValue({ asset: { ...saved, revision: 2 } });
  list.mockReset().mockResolvedValue({ assets: [saved] });
  analyze.mockReset();
  info.mockReset().mockResolvedValue({ capabilities: { analysis: false, catalogue: false, imageMetadata: false } });
  const base = createHttpAssetLibrary();
  restore = configureAssetLibraryAdapter({ ...base, upload, patch, list, analyze,
    info,
    promptStatus: vi.fn().mockResolvedValue({ status: 'idle', prompt: null }),
  });
});
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens the original metadata controls without creating; local AI stays disabled', async () => {
  const finish = vi.fn();
  show(<SaveAssetDialog draft={draft} onFinish={finish}/>);
  await waitFor(() => expect(list).toHaveBeenCalled());
  expect(screen.getByRole('checkbox', { name: 'AI fill' }).getAttribute('aria-checked')).toBe('false');
  expect((screen.getByRole('checkbox', { name: 'AI fill' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText('Name')).toBeTruthy();
  expect(screen.getByLabelText('Style')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(finish).toHaveBeenCalledWith(null);
  expect(upload).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
});

it('allows AI metadata fill only after the active adapter advertises analysis', async () => {
  info.mockResolvedValue({ capabilities: { analysis: true, catalogue: false } });
  show(<SaveAssetDialog draft={draft} onFinish={vi.fn()}/>);
  const checkbox = screen.getByRole('checkbox', { name: 'AI fill' });
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(upload).toHaveBeenCalledOnce());
  expect(upload.mock.calls[0][4].aiFill).toBe(true);
});

it('saves edited metadata and rating atomically with explicit kind and AI false', async () => {
  const finish = vi.fn();
  show(<SaveAssetDialog draft={{ ...draft, kind: 'slides', filename: 'deck.html' }} onFinish={finish}/>);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited deck' } });
  fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'Minimal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rate 4 stars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(finish).toHaveBeenCalledWith(saved));
  expect(upload).toHaveBeenCalledWith(expect.any(File), null, undefined, 'brand', expect.objectContaining({ name: 'Edited deck', style: 'Minimal', rating: 4, kind: 'slides', aiFill: false }));
});

it.each([undefined, 'explicit-project'])('preserves project association with explicit source precedence: %s', async projectId => {
  show(<SaveAssetDialog draft={{ ...draft, projectId: 'current-project', source: projectId ? { projectId, url: 'https://example.test' } : undefined }} onFinish={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(upload).toHaveBeenCalledOnce());
  expect(upload.mock.calls[0][2]).toEqual(projectId ? { projectId, url: 'https://example.test' } : { projectId: 'current-project' });
});

it('fresh readers run only at Save, and text retains precedence over readers', async () => {
  const readContent = vi.fn().mockResolvedValue(new Blob(['fresh'], { type: 'image/webp' }));
  const finish = vi.fn();
  const view = show(<SaveAssetDialog draft={{ ...draft, text: undefined, readContent }} onFinish={finish}/>);
  expect(readContent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(finish).toHaveBeenCalledWith(saved));
  expect(readContent).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(upload.mock.calls[0][0].type).toBe('image/webp');
  view.unmount(); readContent.mockClear(); upload.mockClear();
  show(<SaveAssetDialog draft={{ ...draft, readContent }} onFinish={finish}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(upload).toHaveBeenCalledOnce());
  expect(readContent).not.toHaveBeenCalled();
});

it('retains edited metadata after a failed upload and retries only on explicit Save', async () => {
  upload.mockRejectedValueOnce(new Error('disk unavailable'));
  const finish = vi.fn();
  show(<SaveAssetDialog draft={draft} onFinish={finish}/>);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Keep me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk unavailable');
  expect(finish).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Keep me');
  expect(upload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(finish).toHaveBeenCalledWith(saved));
  expect(upload).toHaveBeenCalledTimes(2);
});

it('reuses the capture identity after a lost upload response and isolates new save intents', async () => {
  upload.mockRejectedValueOnce(new TypeError('network response lost'));
  show(<SaveAssetDialogHost/>);
  const first = request();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('network response lost');
  const id = upload.mock.calls[0][4].captureId;
  expect(id).toMatch(/^[a-f0-9-]{36}$/i);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Still the same save' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { expect(await first).toEqual(saved); });
  expect(upload.mock.calls[1][4].captureId).toBe(id);
  const second = request();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { await second; });
  expect(upload.mock.calls[2][4].captureId).not.toBe(id);
  const supplied = request({ captureId: 'browser-capture-stable-id' });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { await supplied; });
  expect(upload.mock.calls[3][4].captureId).toBe('browser-capture-stable-id');
});

it('host resolves at save, keeps one inspector, and reserves it against overlap', async () => {
  show(<SaveAssetDialogHost/>);
  const result = request({ inspectAfterSave: true });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { expect(await result).toEqual(saved); });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByLabelText('Name')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Analyze' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/No AI analysis adapter is configured/)).toBeTruthy();
  await expect(request()).resolves.toBeNull();
  expect(upload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const next = request();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await expect(next).resolves.toBeNull();
});

it('unmount aborts content reads, settles cancellation, and ignores late bytes', async () => {
  const read = deferred<Blob>();
  let signal!: AbortSignal;
  const host = show(<SaveAssetDialogHost/>);
  const result = request({ text: undefined, readContent: next => { signal = next; return read.promise; } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  host.unmount();
  await expect(result).resolves.toBeNull();
  expect(signal.aborted).toBe(true);
  await act(async () => { read.resolve(new Blob(['late'])); });
  expect(upload).not.toHaveBeenCalled();
  await expect(requestSaveAsset(draft)).rejects.toThrow();
});

it('saved editor preserves its draft revision on conflict instead of overwriting', async () => {
  patch.mockRejectedValueOnce(new PersonalAssetRequestError('conflict', 409));
  list.mockResolvedValue({ assets: [{ ...saved, name: 'Remote', revision: 2 }] });
  show(<SavedAssetDialog asset={saved} onClose={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Local' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Local');
  expect(patch).toHaveBeenCalledWith('saved', { name: 'Local', revision: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1][1].revision).toBe(1);
});

it('catalogue preserves folder navigation, breadcrumbs and name search', async () => {
  const folder = { ...saved, id: 'folder', name: 'Folder', kind: 'folder' as const, versions: [] };
  list.mockResolvedValue({ assets: [folder, { ...saved, parentId: 'folder' }] });
  show(<PersonalAssetLibrary/>);
  await screen.findByRole('button', { name: 'Open Folder' });
  expect(screen.queryByRole('button', { name: 'Open Capture' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Folder' }));
  await screen.findByRole('button', { name: 'Open Capture' });
  expect(screen.getByRole('navigation')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search personal assets' }), { target: { value: 'missing' } });
  expect(screen.queryByRole('button', { name: 'Open Capture' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search personal assets' }), { target: { value: 'Capture' } });
  expect(screen.getByRole('button', { name: 'Open Capture' })).toBeTruthy();
});

it('edits YAML without AI and refuses malformed YAML without discarding it', async () => {
  show(<SaveAssetDialog draft={draft} onFinish={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'Original style' } });
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'YAML' }), { button: 0, ctrlKey: false });
  const yaml = screen.getByLabelText('Asset YAML') as HTMLTextAreaElement;
  expect(yaml.value).toContain('Original style');
  fireEvent.change(yaml, { target: { value: 'name: [' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(upload).not.toHaveBeenCalled();
  expect(yaml.value).toBe('name: [');
  expect(analyze).not.toHaveBeenCalled();
});

it('catalogue favorites through the original overflow menu with revision protection', async () => {
  show(<PersonalAssetLibrary/>);
  fireEvent.keyDown(await screen.findByRole('button', { name: 'More actions for Capture' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Favorite' }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('saved', { favorite: true, revision: 1 }));
});
