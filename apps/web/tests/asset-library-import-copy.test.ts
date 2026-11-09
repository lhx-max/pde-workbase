// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonalAsset } from '@bezier/contracts';
import { createHttpAssetLibrary } from '../src/providers/asset-library';

vi.mock('../src/state/save-asset', () => ({ requestSaveAsset: vi.fn() }));

const asset: PersonalAsset = {
  id: 'published-doc', owner: 'local-personal', kind: 'text', name: 'Published note',
  parentId: null, description: '', tags: [], favorite: false,
  source: { projectId: 'author-project', filename: 'author.md' },
  versions: [{ id: 'v1', hash: 'hash', filename: 'note.md', mime: 'text/markdown', size: 8, createdAt: 1 }],
  createdAt: 1, updatedAt: 1, deletedAt: null, revision: 1,
};
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('asset import creates editable copies, not shared references', () => {
  it('materializes the selected external version on every use without consulting previous uses', async () => {
    const files = new Map<string, string>([['previous.md', 'edited by previous consumer']]);
    const uses: Array<{ projectId: string; versionId: string; filename: string }> = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://source.example/library/published-doc') return json({ asset });
      if (input === 'https://source.example/library/published-doc/content?version=v1') return new Response('snapshot');
      if (input === '/api/projects/consumer/files' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.encoding).toBe('base64');
        expect(files.has(body.name)).toBe(false);
        files.set(body.name, atob(body.content));
        return json({ file: { name: body.name, kind: 'text', mime: 'text/markdown', size: 8, mtime: 1 } });
      }
      if (input === 'https://source.example/library/published-doc/uses' && init?.method === 'POST') {
        uses.push(JSON.parse(String(init.body)));
        return json({ ok: true });
      }
      throw new Error(`Unexpected request (old uses must not be reused): ${init?.method ?? 'GET'} ${input}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const adapter = createHttpAssetLibrary('https://source.example/library');
    const first = await adapter.importIntoProject('consumer', asset.id, 'v1');
    const firstPath = first.files[0]!.name;
    files.set(firstPath, 'first consumer edit');
    const second = await adapter.importIntoProject('consumer', asset.id, 'v1');
    const secondPath = second.files[0]!.name;
    expect(secondPath).not.toBe(firstPath);
    expect(firstPath).toMatch(/^asset-[\w-]+-note\.md$/);
    expect(files.get(firstPath)).toBe('first consumer edit');
    expect(files.get(secondPath)).toBe('snapshot');
    expect(files.get('previous.md')).toBe('edited by previous consumer');
    expect(uses).toEqual([
      { projectId: 'consumer', versionId: 'v1', filename: firstPath },
      { projectId: 'consumer', versionId: 'v1', filename: secondPath },
    ]);
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/content?'))).toHaveLength(2);
  });

  it('delegates built-in copies to the authorized project import endpoint without carrying source identity', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => json({ asset, version: asset.versions[0], files: [{ name: 'new-copy.md' }] }));
    vi.stubGlobal('fetch', fetcher);
    await createHttpAssetLibrary().importIntoProject('consumer', asset.id, 'v1');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/projects/consumer/asset-library/import');
    expect(JSON.parse(String(init?.body))).toEqual({ assetId: asset.id, versionId: 'v1' });
  });
});
