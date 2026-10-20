import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const writes = vi.hoisted(() => ({ binary: vi.fn(), text: vi.fn() }));
vi.mock('../src/providers/registry', () => ({ writeProjectBase64File: writes.binary, writeProjectTextFile: writes.text }));
import { saveBrowserCaptureFile } from '../src/browser-resources/project-capture';
import { resourceCliCommand, safeResourceFilename, saveResourceBatch } from '../src/browser-resources/client';
import type { BrowserResourceItem, BrowserResourceRead } from '@bezier/contracts';
import { parseBrowserPreferences } from '../src/browser-resources/browser-preferences';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  writes.binary.mockImplementation(async (_project: string, name: string) => ({ name }));
  writes.text.mockImplementation(async (_project: string, name: string) => ({ name }));
});
describe('browser capture project persistence', () => {
  it('rejects malformed local preferences instead of overwriting the catalogue', () => {
    expect(parseBrowserPreferences(null)).toEqual({});
    expect(() => parseBrowserPreferences('{"browserBookmarks":{}}')).toThrow();
    expect(() => parseBrowserPreferences('{"browserReferences":{"hiddenUrls":[],"customSites":[{"title":"Bad","url":"javascript:1"}]}}')).toThrow();
    expect(parseBrowserPreferences('{"browserBookmarks":[{"title":"Reference","url":"https://example.com/"}]}').browserBookmarks).toHaveLength(1);
  });
  it('writes bounded source names and metadata only through the owning project', async () => {
    const { asset } = await saveBrowserCaptureFile(new File(['hello'], '../../selection.txt', { type: 'text/plain' }), { projectId: 'project-a', url: 'https://example.com' }, { tags: ['reference'] });
    expect(writes.binary).toHaveBeenCalledOnce();
    expect(writes.binary.mock.calls[0]?.[0]).toBe('project-a');
    expect(writes.binary.mock.calls[0]?.[2]).toBe('aGVsbG8=');
    expect(asset.id).toContain('collected/browser/');
    expect(asset.id).not.toContain('../');
    expect(writes.text.mock.calls[0]?.[1]).toBe(`${asset.id}.source.json`);
    expect(JSON.parse(writes.text.mock.calls[0]?.[2])).toMatchObject({ projectId: 'project-a', url: 'https://example.com', tags: ['reference'] });
  });
  it('does not claim success when content or metadata persistence fails', async () => {
    writes.binary.mockResolvedValueOnce(null);
    await expect(saveBrowserCaptureFile(new File(['x'], 'a.txt'), { projectId: 'p' })).rejects.toThrow('could not be saved');
    expect(writes.text).not.toHaveBeenCalled();
    writes.text.mockResolvedValueOnce(null);
    await expect(saveBrowserCaptureFile(new File(['x'], 'a.txt'), { projectId: 'p' })).rejects.toThrow('metadata could not be saved');
  });
  it('reports thrown provenance failures, refreshes persisted bytes, and reuses the capture path on retry', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const file = new File(['hello'], 'capture.txt');
    writes.text.mockRejectedValueOnce(new Error('Disk full'));
    await expect(saveBrowserCaptureFile(file, { projectId: 'p' }, { captureId: 'retry-identity' })).rejects.toThrow('Capture saved as inputs/collected/browser/retry-identity-capture.txt, but metadata could not be saved.');
    expect(dispatchEvent).toHaveBeenCalledOnce();
    await saveBrowserCaptureFile(file, { projectId: 'p' }, { captureId: 'retry-identity' });
    expect(writes.binary.mock.calls[0]?.[1]).toBe(writes.binary.mock.calls[1]?.[1]);
  });
  it('copies the independent CLI command using the current server origin', () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:19999' } });
    const command = resourceCliCommand('project', { sessionId: 'session', accessToken: "a'b" });
    expect(command).toContain("CANVAS_SERVER_URL='http://127.0.0.1:19999'");
    expect(command).toContain('CANVAS_BROWSER_RESOURCE_TOKEN=');
    expect(command).toContain('canvas-server browser resources list');
    expect(command).not.toContain('LOOM_BROWSER_RESOURCE_TOKEN');
  });
  it('requires explicit project and rejects unconfigured AI without writing', async () => {
    await expect(saveBrowserCaptureFile(new File(['x'], 'a.txt'), {})).rejects.toThrow('project');
    await expect(saveBrowserCaptureFile(new File(['x'], 'a.txt'), { projectId: 'p' }, { aiFill: true })).rejects.toThrow('Agent adapter');
    expect(writes.binary).not.toHaveBeenCalled();
  });
  it('keeps batch navigation attestation and never uploads stale bytes', async () => {
    const item = { id: 'image-a', readable: true, kind: 'image' } as BrowserResourceItem;
    const upload = vi.fn(); const onProgress = vi.fn();
    await saveResourceBatch({ items: [item], navigationId: 10, projectId: 'p', metadata: { spaceId: 'p', tags: [], prefix: '' }, shouldStop: () => false,
      read: async () => ({ resourceId: 'image-a', navigationId: 11 } as BrowserResourceRead), upload, onProgress });
    expect(upload).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith({ id: 'image-a', state: 'failed', error: 'stale-document' });
  });
  it('does no work after batch cancellation and sanitizes filenames', async () => {
    const read = vi.fn(); const upload = vi.fn();
    await saveResourceBatch({ items: [{ id: 'a' } as BrowserResourceItem], navigationId: 1, projectId: 'p', metadata: { spaceId: 'p', tags: [], prefix: '' }, shouldStop: () => true, read, upload, onProgress: vi.fn() });
    expect(read).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
    expect(safeResourceFilename('../a\\b\u0000.png')).not.toContain('/');
  });
});
