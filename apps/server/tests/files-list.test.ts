import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import JSZip from 'jszip';
import { buildProjectArchive, listFiles } from '../src/projects.js';

const tempRoots: string[] = [];

async function makeProjectsRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'bezier-project-files-'));
  tempRoots.push(root);
  return path.join(root, 'projects');
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('listFiles', () => {
  it('inventories internal JSON, sidecars, hidden and build files only in all scope, without following links', async () => {
    const root = await makeProjectsRoot();
    const dir = path.join(root, 'inventory');
    const names = ['src/main.js', '整理/canvas-state.json', 'page.artifact.json', '.config/options.json', 'dist/output.html'];
    for (const name of names) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), '{}');
    }
    await symlink(path.join(dir, 'src'), path.join(dir, 'linked'));
    expect((await listFiles(root, 'inventory')).map(file => file.name)).toEqual(['src/main.js']);
    expect((await listFiles(root, 'inventory', { scope: 'all' })).map(file => file.name).sort()).toEqual([...names].sort());
    await expect(listFiles(root, 'inventory', { scope: 'all', metadata: { baseDir: dir } })).rejects.toThrow('host adapter');
  });
  it('includes the absolute local path for each visible project file', async () => {
    const projectsRoot = await makeProjectsRoot();
    const projectId = 'project-1';
    const projectDir = path.join(projectsRoot, projectId);
    const filePath = path.join(projectDir, 'alpha.html');
    await mkdir(projectDir, { recursive: true });
    await writeFile(filePath, '<!doctype html>');

    const files = await listFiles(projectsRoot, projectId);

    expect(files).toEqual([
      expect.objectContaining({
        name: 'alpha.html',
        path: 'alpha.html',
        localPath: filePath,
      }),
    ]);
  });

  it('keeps canvas state out of project resources and normal project archives', async () => {
    const projectsRoot = await makeProjectsRoot();
    const projectId = 'project-1';
    const projectDir = path.join(projectsRoot, projectId);
    await mkdir(path.join(projectDir, '整理'), { recursive: true });
    await mkdir(path.join(projectDir, '整理', 'workflows', 'flow-1', 'runtime'), { recursive: true });
    await writeFile(path.join(projectDir, 'screen.html'), '<!doctype html>');
    await writeFile(path.join(projectDir, '整理', 'canvas-state.json'), '{"viewport":{}}');
    await writeFile(path.join(projectDir, '整理', 'workflows', 'flow-1', 'runtime', 'events.jsonl'), '{}\n');
    await writeFile(path.join(projectDir, '整理', 'workflows', 'flow-1', 'runtime', 'snapshot.json'), '{}');

    const files = await listFiles(projectsRoot, projectId);
    expect(files.map((file) => file.name)).toEqual(['screen.html']);

    const archive = await buildProjectArchive(projectsRoot, projectId, '');
    const zip = await JSZip.loadAsync(archive.buffer);
    expect(zip.file('整理/canvas-state.json')).toBeNull();
    expect(zip.file('整理/workflows/flow-1/runtime/events.jsonl')).toBeNull();
    expect(zip.file('整理/workflows/flow-1/runtime/snapshot.json')).toBeNull();
    expect(zip.file('screen.html')).not.toBeNull();
  });
});
