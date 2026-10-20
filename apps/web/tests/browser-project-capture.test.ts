import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const library = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../src/providers/asset-library', () => ({ personalAssets: library }));
import { saveBrowserCaptureFile } from '../src/browser-resources/project-capture';
import { resourceCliCommand, safeResourceFilename, saveResourceBatch } from '../src/browser-resources/client';
import type { BrowserResourceItem, BrowserResourceRead } from '@bezier/contracts';
import { parseBrowserPreferences } from '../src/browser-resources/browser-preferences';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { vi.clearAllMocks(); library.upload.mockResolvedValue({ asset: { id: 'asset-a', name: 'Selection' } }); });
describe('browser capture unified library persistence', () => {
  it('rejects malformed local preferences instead of overwriting the catalogue', () => {
    expect(parseBrowserPreferences(null)).toEqual({});
    expect(() => parseBrowserPreferences('{"browserBookmarks":{}}')).toThrow();
    expect(() => parseBrowserPreferences('{"browserReferences":{"hiddenUrls":[],"customSites":[{"title":"Bad","url":"javascript:1"}]}}')).toThrow();
  });
  it('sends original bytes, source and chosen metadata destination to the canonical library once', async () => {
    const result = await saveBrowserCaptureFile(new File(['hello'], '../../selection.txt', { type: 'text/plain' }),
      { projectId: 'project-a', url: 'https://example.com' }, { tags: ['reference'], captureId: 'stable-id' }, undefined, { parentId: 'folder', spaceId: 'space' });
    expect(result.asset.id).toBe('asset-a'); expect(library.upload).toHaveBeenCalledOnce();
    const [file, parent, source, space, metadata] = library.upload.mock.calls[0]!;
    expect(file.name).not.toContain('/'); expect(await file.text()).toBe('hello');
    expect(parent).toBe('folder'); expect(space).toBe('space');
    expect(source).toEqual({ projectId: 'project-a', url: 'https://example.com' });
    expect(metadata).toMatchObject({ tags: ['reference'], captureId: 'stable-id' });
  });
  it('does not hide library failures or pretend unconfigured AI succeeded', async () => {
    library.upload.mockRejectedValue(new Error('Analysis adapter unavailable'));
    await expect(saveBrowserCaptureFile(new File(['x'], 'a.txt'), { projectId: 'p' }, { aiFill: true })).rejects.toThrow('Analysis adapter unavailable');
    expect(library.upload.mock.calls[0]?.[4]).toMatchObject({ aiFill: true });
  });
  it('requires source project identity before opening library writes', async () => {
    await expect(saveBrowserCaptureFile(new File(['x'], 'a.txt'), {})).rejects.toThrow('project');
    expect(library.upload).not.toHaveBeenCalled();
  });
  it('copies the independent CLI command using the current server origin', () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:19999' } });
    const command = resourceCliCommand('project', { sessionId: 'session', accessToken: "a'b" });
    expect(command).toContain("CANVAS_SERVER_URL='http://127.0.0.1:19999'");
    expect(command).toContain('CANVAS_BROWSER_RESOURCE_TOKEN='); expect(command).toContain('canvas-server browser resources list');
  });
  it('keeps batch navigation attestation and never uploads stale bytes', async () => {
    const item = { id: 'image-a', readable: true, kind: 'image' } as BrowserResourceItem;
    const upload = vi.fn(); const onProgress = vi.fn();
    await saveResourceBatch({ items: [item], navigationId: 10, projectId: 'p', metadata: { spaceId: 'p', tags: [], prefix: '' }, shouldStop: () => false,
      read: async () => ({ resourceId: 'image-a', navigationId: 11 } as BrowserResourceRead), upload, onProgress });
    expect(upload).not.toHaveBeenCalled(); expect(onProgress).toHaveBeenLastCalledWith({ id: 'image-a', state: 'failed', error: 'stale-document' });
  });
  it('does no work after batch cancellation and sanitizes filenames', async () => {
    const read = vi.fn(); const upload = vi.fn();
    await saveResourceBatch({ items: [{ id: 'a' } as BrowserResourceItem], navigationId: 1, projectId: 'p', metadata: { spaceId: 'p', tags: [], prefix: '' }, shouldStop: () => true, read, upload, onProgress: vi.fn() });
    expect(read).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled(); expect(safeResourceFilename('../a\\b\u0000.png')).not.toContain('/');
  });
});
