// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { AssetLibraryPanel } from '../src/components/AssetLibraryPanel';
import { configureAssetLibraryAdapter, createHttpAssetLibrary } from '../src/providers/asset-library';
import { syncProjectFolders, writeSelectedProjectFolderId } from '../src/state/project-folders';
vi.mock('../src/components/PersonalAssetLibrary', () => ({ PersonalAssetLibrary: ({ spaceId }: { spaceId: string }) => <output data-testid="active-space">{spaceId}</output> }));
const info = { source: { kind: 'builtin', id: 'restore-test', name: 'Local' }, capabilities: { analysis: false, catalogue: false } };
const spaces = [{ id: 'brand', name: 'Brand', createdAt: 1 }, { id: 'other', name: 'Other', createdAt: 2 }];
let restore: () => void;
let ready: () => void;
function adapter() { return { ...createHttpAssetLibrary(), info: vi.fn().mockResolvedValue(info), spaces: vi.fn().mockResolvedValue({ folders: spaces, initialized: true }) }; }
beforeEach(async () => {
  localStorage.clear();
  const seed = configureAssetLibraryAdapter(adapter());
  await syncProjectFolders('local'); writeSelectedProjectFolderId('local', 'brand'); seed();
  const pending = new Promise(resolve => { ready = () => resolve(info); });
  restore = configureAssetLibraryAdapter({ ...adapter(), info: vi.fn().mockReturnValue(pending) });
});
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); });
function show(explicit?: string) { return render(<I18nProvider initial="en"><AssetLibraryPanel projectId="p" openRequest={explicit ? { spaceId: explicit, kind: 'image' } : undefined}/></I18nProvider>); }
async function settle() { await act(async () => { ready(); }); }

it('restores the persisted space after first authoritative source identity resolution', async () => {
  show(); expect(screen.getByTestId('active-space').textContent).toBe('default-project');
  await settle();
  await waitFor(() => expect(screen.getByTestId('active-space').textContent).toBe('brand'));
});
it('does not override an explicit open-request space with the persisted selection', async () => {
  show('other'); await settle();
  await waitFor(() => expect(screen.getByTestId('active-space').textContent).toBe('other'));
});
it('does not override a choice made while source identity was resolving', async () => {
  show();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose asset space' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Default space' }));
  await settle();
  expect(screen.getByTestId('active-space').textContent).toBe('default-project');
});
it('restores only once, not after every focus refresh', async () => {
  show(); await settle();
  await waitFor(() => expect(screen.getByTestId('active-space').textContent).toBe('brand'));
  writeSelectedProjectFolderId('local', 'other');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByTestId('active-space').textContent).toBe('brand');
});
