import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { api, createProject, projectText } from '@/api';
import { useToolsDev } from '@/vitest/suite';
import { repositoryRoot } from '@/tools-dev/runtime';
// One synthetic 1px PNG; this CLI test has no browser fixture dependency.
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e8AAAAASUVORK5CYII=', 'base64');

const exec = promisify(execFile);
describe('real CLI and canonical asset-library HTTP closure', () => {
  const runtime = useToolsDev();
  async function cli(...args: string[]) {
    const result = await exec(process.execPath, [path.join(repositoryRoot, 'apps/server/dist/cli.js'), ...args, '--server-url', runtime().serverUrl, '--json'], { env: { ...process.env, CANVAS_AUTH_TOKEN: '' }, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  }
  async function json(name: string, value: unknown) {
    const file = path.join(runtime().root, name); await writeFile(file, JSON.stringify(value)); return file;
  }
  it('uses real local spaces, text, favorites, versions and project import/save without another database', async () => {
    const active = runtime(), projectId = await createProject(active, 'CLI asset owner');
    expect((await cli('assets', 'info')).source.kind).toBe('builtin');
    await cli('assets', 'spaces', '--body-file', await json('spaces.json', { upsert: [{ id: 'cli-space', name: 'CLI space', createdAt: Date.now() }], remove: [] }));
    const text = path.join(active.root, 'note.md'); await writeFile(text, '# CLI original\nExact source content.');
    const { asset } = await cli('assets', 'create', '--name', 'CLI reference', '--kind', 'text', '--text-file', text, '--body-file', await json('metadata.json', { spaceId: 'cli-space' }));
    expect(asset.spaceId).toBe('cli-space');
    await cli('assets', 'patch', asset.id, '--body-file', await json('favorite.json', { revision: asset.revision, favorite: true }));
    expect((await api<{ asset: { favorite: boolean } }>(active, `/api/asset-library/${asset.id}`)).asset.favorite).toBe(true);
    const { files } = await cli('assets', 'import', asset.id, '--project', projectId);
    expect(await projectText(active, projectId, files[0].name)).toBe('# CLI original\nExact source content.');
    const { asset: copy } = await cli('assets', 'save', '--project', projectId, '--filename', files[0].name, '--name', 'Saved from project');
    expect(copy.id).not.toBe(asset.id);
    const { uses } = await cli('assets', 'uses', asset.id);
    expect(uses.some((use: { projectId: string }) => use.projectId === projectId)).toBe(true);
    expect((await cli('assets', 'versions', asset.id)).versions).toHaveLength(1);
    await cli('assets', 'spaces', '--body-file', await json('remove-space.json', { upsert: [], remove: ['cli-space'], removeContents: false }));
    expect((await cli('assets', 'get', asset.id)).asset.spaceId).toBe('default-project');
    expect((await cli('assets', 'list')).assets.some((item: { id: string }) => item.id === asset.id)).toBe(true);
  });
  it('uploads exact multipart bytes with durable capture replay and create-only binary output', async () => {
    const active = runtime(), image = path.join(active.root, 'capture.png'); await writeFile(image, pngBytes);
    const metadata = await json('capture.json', { captureId: 'cli-capture-1', name: 'CLI capture', kind: 'image' });
    const { asset } = await cli('assets', 'upload', '--file', image, '--mime', 'image/png', '--body-file', metadata);
    expect((await cli('assets', 'upload', '--file', image, '--mime', 'image/png', '--body-file', metadata)).asset.id).toBe(asset.id);
    const output = path.join(active.root, 'downloaded.png');
    const downloaded = await cli('assets', 'content', asset.id, '--output', output);
    expect(downloaded.bytes).toBe(pngBytes.length);
    expect((await readFile(output)).equals(pngBytes)).toBe(true);
    await expect(cli('assets', 'content', asset.id, '--output', output)).rejects.toMatchObject({ code: 1 });
    expect((await readFile(output)).equals(pngBytes)).toBe(true);
    const archive = path.join(active.root, 'assets.zip');
    await cli('assets', 'export', '--ids', asset.id, '--output', archive);
    expect((await readFile(archive)).subarray(0, 2).toString()).toBe('PK');
    await expect(cli('assets', 'upload', '--file', image, '--mime', 'image/png', '--body-file', await json('conflicting-capture.json', { captureId: 'cli-capture-1', name: 'Different request', kind: 'image' }))).rejects.toMatchObject({ code: 1 });
  });
  it('shares browser preference revisions with Web and rejects stale writes', async () => {
    const before = await cli('browser', 'preferences');
    const patch = await json('preferences.json', { revision: before.revision, patch: { browserBookmarks: [{ title: 'Local reference', url: 'https://example.com/' }] } });
    const updated = await cli('browser', 'preferences', '--body-file', patch);
    expect(updated.revision).toBe(before.revision + 1);
    expect((await api<{ preferences: { browserBookmarks: Array<{ title: string }> } }>(runtime(), '/api/browser-preferences')).preferences.browserBookmarks[0]!.title).toBe('Local reference');
    await expect(cli('browser', 'preferences', '--body-file', patch)).rejects.toMatchObject({ code: 1 });
  });
});
