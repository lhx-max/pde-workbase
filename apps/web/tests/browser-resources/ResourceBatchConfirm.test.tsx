// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSONAL_ASSET_CHANGED_EVENT, type PersonalAsset } from '@bezier/contracts';
import { ResourceBatchConfirm, type ResourceBatchConfirmProps } from '../../src/browser-resources/ResourceBatchConfirm';

const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<{ assets: PersonalAsset[] }>>(),
  spaces: [{ id: 'default-project', name: 'Personal' }, { id: 'project-space', name: 'Project' }, { id: 'other-space', name: 'Other' }],
  projectSpaces: { project: 'project-space' } as Record<string, string>,
  ready: true, analysis: true,
}));
vi.mock('../../src/providers/asset-library', () => ({ personalAssets: { list: mocks.list } }));
vi.mock('../../src/components/asset-library/use-asset-library-capabilities', () => ({ useAssetLibraryCapabilities: () => ({ analysis: mocks.analysis }) }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../src/components/asset-library/use-picker-spaces', () => ({
  usePickerSpaces: () => {
    const [space, setSpace] = useState('default-project');
    return { space, setSpace, folders: mocks.spaces, projectSpaces: mocks.projectSpaces, projectsReady: mocks.ready };
  },
}));
function folder(id: string, spaceId = 'project-space', patch: Partial<PersonalAsset> = {}): PersonalAsset {
  return { id, name: id, kind: 'folder', spaceId, owner: 'local-personal', parentId: null,
    description: '', tags: [], favorite: false, source: {}, versions: [], createdAt: 0, updatedAt: 0,
    deletedAt: null, revision: 1, ...patch };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const onCancel = vi.fn();
const onConfirm = vi.fn();
const view = (props: Partial<ResourceBatchConfirmProps> = {}) => <ResourceBatchConfirm count={3} imageCount={2} projectId="project" onCancel={onCancel} onConfirm={onConfirm} {...props} />;
const spacePicker = () => screen.getByRole('combobox', { name: 'asset.meta.space' });
const folderPicker = () => screen.getByRole('combobox', { name: 'browserResources.folder' });
const save = () => screen.getByRole('button', { name: 'browserResources.submit' });
async function renderReady(props: Partial<ResourceBatchConfirmProps> = {}) {
  const result = render(view(props));
  await act(async () => { await mocks.list.mock.results.at(-1)?.value; });
  return result;
}

beforeEach(() => {
  mocks.spaces = [{ id: 'default-project', name: 'Personal' }, { id: 'project-space', name: 'Project' }, { id: 'other-space', name: 'Other' }];
  mocks.projectSpaces = { project: 'project-space' };
  mocks.ready = true; mocks.analysis = true;
  mocks.list.mockReset().mockResolvedValue({ assets: [folder('References'), folder('Other folder', 'other-space')] });
  onCancel.mockReset(); onConfirm.mockReset();
});
afterEach(cleanup);

describe('ResourceBatchConfirm', () => {
  it('retains manual saves while disabling unavailable analysis', async () => {
    mocks.analysis = false; await renderReady();
    expect(screen.getByRole('switch', { name: 'asset.meta.aiFill' })).toBeDisabled();
    fireEvent.click(save()); expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ aiFill: false }));
  });
  it('uses one shared dialog title, defaults to project root, and never opts into AI implicitly', async () => {
    await renderReady();
    const dialog = screen.getByRole('dialog', { name: 'browserResources.confirmTitle' });
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getAllByRole('heading', { name: 'browserResources.confirmTitle' })).toHaveLength(1);
    expect(spacePicker()).toHaveValue('project-space');
    expect(folderPicker()).toHaveValue('');
    expect(screen.getByRole('switch', { name: 'asset.meta.aiFill' })).not.toBeChecked();
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ spaceId: 'project-space', parentId: null, aiFill: false, tags: [], prefix: '' });
  });

  it('requires explicit AI opt-in and submits trimmed optional metadata', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('switch', { name: 'asset.meta.aiFill' }));
    expect(screen.getByRole('switch', { name: 'asset.meta.aiFill' })).toBeChecked();
    fireEvent.click(screen.getByText('browserResources.optionalDetails'));
    fireEvent.change(screen.getByLabelText('browserResources.tags'), { target: { value: ' logo, hero，logo ' } });
    fireEvent.change(screen.getByLabelText('browserResources.filenamePrefix'), { target: { value: ' landing- ' } });
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ aiFill: true, tags: ['logo', 'hero'], prefix: 'landing-' }));
  });

  it('disables AI for non-image batches', async () => {
    await renderReady({ imageCount: 0 });
    expect(screen.getByRole('switch', { name: 'asset.meta.aiFill' })).toBeDisabled();
    expect(screen.getByText('browserResources.aiFillUnavailable')).toBeVisible();
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ aiFill: false }));
  });

  it('filters folders by kind, deletion, and space and resets the folder on space change', async () => {
    mocks.list.mockResolvedValue({ assets: [folder('References'), folder('Deleted', 'project-space', { deletedAt: 1 }),
      folder('Image', 'project-space', { kind: 'image' }), folder('Other folder', 'other-space')] });
    await renderReady();
    expect(within(folderPicker()).getAllByRole('option').map(option => option.textContent)).toEqual(['browserResources.rootFolder', 'References']);
    fireEvent.change(folderPicker(), { target: { value: 'References' } });
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ spaceId: 'project-space', parentId: 'References' }));
    fireEvent.change(spacePicker(), { target: { value: 'other-space' } });
    expect(folderPicker()).toHaveValue('');
    fireEvent.change(folderPicker(), { target: { value: 'Other folder' } });
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ spaceId: 'other-space', parentId: 'Other folder' }));
  });

  it('labels nested folders by their ancestor path to distinguish duplicate names', async () => {
    mocks.list.mockResolvedValue({ assets: [folder('References'), folder('Designs'),
      folder('reference-ui', 'project-space', { name: 'UI', parentId: 'References' }),
      folder('design-ui', 'project-space', { name: 'UI', parentId: 'Designs' }),
      folder('icons', 'project-space', { name: 'Icons', parentId: 'reference-ui' })] });
    await renderReady();
    expect(within(folderPicker()).getByRole('option', { name: 'References / UI' })).toHaveValue('reference-ui');
    expect(within(folderPicker()).getByRole('option', { name: 'Designs / UI' })).toHaveValue('design-ui');
    expect(within(folderPicker()).getByRole('option', { name: 'References / UI / Icons' })).toHaveValue('icons');
    fireEvent.change(folderPicker(), { target: { value: 'reference-ui' } });
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'reference-ui' }));
  });

  it('bounds folder paths at cycles, unavailable ancestors, and selected-space boundaries', async () => {
    mocks.list.mockResolvedValue({ assets: [
      folder('A', 'project-space', { parentId: 'B' }), folder('B', 'project-space', { parentId: 'A' }),
      folder('Self', 'project-space', { parentId: 'Self' }),
      folder('Outside', 'other-space'), folder('Local', 'project-space', { parentId: 'Outside' }),
      folder('Deleted', 'project-space', { deletedAt: 1 }), folder('Orphan', 'project-space', { parentId: 'Deleted' }),
    ] });
    await renderReady();
    expect(within(folderPicker()).getAllByRole('option').map(option => option.textContent)).toEqual([
      'browserResources.rootFolder', 'B / A', 'A / B', 'Self', 'Local', 'Orphan',
    ]);
  });

  it('applies a late project default only before a user chooses a destination', async () => {
    mocks.ready = false;
    const result = await renderReady();
    expect(spacePicker()).toHaveValue('default-project');
    fireEvent.change(spacePicker(), { target: { value: 'other-space' } });
    mocks.ready = true;
    result.rerender(view());
    expect(spacePicker()).toHaveValue('other-space');
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'other-space' }));
  });

  it('initializes the project space when its async mapping arrives untouched', async () => {
    mocks.ready = false;
    const result = await renderReady();
    mocks.ready = true;
    result.rerender(view());
    expect(spacePicker()).toHaveValue('project-space');
  });

  it('allows explicit root saving while optional folder and project lookups are pending', async () => {
    mocks.ready = false;
    const pending = deferred<{ assets: PersonalAsset[] }>();
    mocks.list.mockReturnValue(pending.promise);
    render(view());
    expect(folderPicker()).toBeDisabled();
    expect(screen.getByText('browserResources.projectSpacePending')).toBeVisible();
    expect(screen.getByText('browserResources.foldersLoading')).toBeVisible();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'default-project', parentId: null }));
    await act(async () => { pending.resolve({ assets: [] }); });
  });

  it('blocks an invalidated folder, including during reload, rather than silently changing destination', async () => {
    await renderReady();
    fireEvent.change(folderPicker(), { target: { value: 'References' } });
    const pending = deferred<{ assets: PersonalAsset[] }>();
    mocks.list.mockReturnValue(pending.promise);
    act(() => { window.dispatchEvent(new Event(PERSONAL_ASSET_CHANGED_EVENT)); });
    expect(folderPicker()).toBeDisabled();
    expect(save()).toBeDisabled();
    await act(async () => { pending.resolve({ assets: [folder('References', 'other-space')] }); });
    expect(save()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('browserResources.invalidFolder');
    fireEvent.click(save());
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(folderPicker(), { target: { value: '' } });
    expect(save()).toBeEnabled();
  });

  it('shows folder failures, permits root saving, and retries the folder lookup', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    render(view());
    await act(async () => { await mocks.list.mock.results[0]?.value.catch(() => {}); });
    expect(screen.getByRole('alert')).toHaveTextContent('browserResources.foldersError');
    expect(folderPicker()).toBeDisabled();
    expect(save()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await act(async () => { await mocks.list.mock.results[1]?.value; });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(folderPicker()).toBeEnabled();
  });

  it('does not silently redirect a chosen space when it disappears', async () => {
    const result = await renderReady();
    fireEvent.change(spacePicker(), { target: { value: 'other-space' } });
    mocks.spaces = mocks.spaces.filter(space => space.id !== 'other-space');
    result.rerender(view());
    expect(save()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('browserResources.destinationUnavailable');
    fireEvent.click(save());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not enable saving without an available destination', async () => {
    mocks.spaces = [];
    await renderReady();
    expect(save()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('browserResources.destinationUnavailable');
  });

  it.each(['cancel', 'close', 'escape'])('cancels via %s without submitting metadata', async method => {
    await renderReady();
    if (method === 'escape') fireEvent.keyDown(spacePicker(), { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: method === 'close' ? 'common.close' : 'browserResources.cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
