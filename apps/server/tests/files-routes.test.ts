import type { ProjectResponse, ProjectsResponse, ProjectTabsState, ProjectFileResponse, ProjectFileVersion, ProjectFilesResponse, ProjectFoldersResponse, RenameProjectFileResponse, ProjectFileVersionsResponse, ProjectFileTextPreviewResponse, ProjectPreviewUrlResponse } from '@bezier/contracts';
type FileWithVersion = ProjectFileResponse & { version: ProjectFileVersion };

import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { registerProjectFileRoutes, type RegisterProjectFileRoutesDeps } from '../src/routes/files.js';
import { _resetForTests } from '../src/project-watchers.js';

async function withFiles(fn: (h: { url: string; id: string; root: string; registry: ReturnType<typeof createProjectRegistry>; json: (route: string, body: unknown, method?: string) => Promise<Response> }) => Promise<void>, options: Partial<RegisterProjectFileRoutesDeps> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'canvas-files-'));
  const registry = createProjectRegistry(root);
  const id = registry.create({ name: 'Original canvas assets' }).id;
  const app = express();
  app.use(express.json({ limit: '16mb' }));
  registerProjectFileRoutes(app, { ...options, registry });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const url = `http://127.0.0.1:${address.port}`;
  const json = (route: string, body: unknown, method = 'POST') => fetch(url + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try { await fn({ url, id, root, registry, json }); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await _resetForTests(); await rm(root, { recursive: true, force: true }); }
}

describe('independent original project files protocol', () => {
  it('persists original project and browser/file tab DTOs across registry reopen', async () => {
    await withFiles(async ({ url, id, root, json }) => {
      expect((await (await fetch(url + '/api/projects')).json() as ProjectsResponse).projects[0]!.id).toBe(id);
      expect((await (await fetch(`${url}/api/projects/${id}`)).json() as ProjectResponse).project.skillId).toBeNull();
      expect(await (await fetch(`${url}/api/projects/${id}/tabs`)).json()).toEqual({ tabs: [], active: null, hasSavedState: false });
      const saved = await json(`/api/projects/${id}/tabs`, { tabs: ['nested/sketch.excalidraw'], active: 'browser-1', browserTabs: [{ id: 'browser-1', label: 'Browser', url: 'https://example.com', insertAfter: null }] }, 'PUT');
      expect(saved.status).toBe(200);
      const tabs = await saved.json() as ProjectTabsState;
      expect(tabs.hasSavedState).toBe(true);
      expect(createProjectRegistry(root).getTabs(id)).toEqual(tabs);
      expect((await json(`/api/projects/${id}/tabs`, { tabs: [4] }, 'PUT')).status).toBe(400);
    });
  });
  it('round-trips nested JSON/base64 files, folders, search, range and rename/delete', async () => {
    await withFiles(async ({ url, id, json }) => {
      expect((await json(`/api/projects/${id}/folders`, { name: 'nested' })).status).toBe(200);
      const saved = await json(`/api/projects/${id}/files`, { name: 'nested/note.txt', content: Buffer.from('hello canvas').toString('base64'), encoding: 'base64' });
      expect(saved.status).toBe(200);
      expect((await saved.json() as ProjectFileResponse).file.name).toBe('nested/note.txt');
      expect((await (await fetch(`${url}/api/projects/${id}/files`)).json() as ProjectFilesResponse).files[0]!.name).toBe('nested/note.txt');
      expect((await (await fetch(`${url}/api/projects/${id}/folders`)).json() as ProjectFoldersResponse).folders[0]!.name).toBe('nested');
      expect((await (await fetch(`${url}/api/projects/${id}/search?q=canvas`)).json() as { matches: unknown[] }).matches.length).toBeGreaterThan(0);
      const range = await fetch(`${url}/api/projects/${id}/files/${encodeURIComponent('nested/note.txt')}`, { headers: { range: 'bytes=0-4' } });
      expect(range.status).toBe(206); expect(await range.text()).toBe('hello');
      const rename = await json(`/api/projects/${id}/files/rename`, { from: 'nested/note.txt', to: 'nested/final.txt' });
      expect((await rename.json() as RenameProjectFileResponse).newName).toBe('nested/final.txt');
      expect(await (await fetch(`${url}/api/projects/${id}/files/${encodeURIComponent('nested/final.txt')}`)).text()).toBe('hello canvas');
      expect((await fetch(`${url}/api/projects/${id}/raw/nested/final.txt`, { method: 'DELETE' })).status).toBe(200);
      expect((await json(`/api/projects/${id}/folders`, { path: 'nested' }, 'DELETE')).status).toBe(200);
    });
  });
  it('preserves original multipart Unicode names, layout and collision suffixes', async () => {
    await withFiles(async ({ url, id }) => {
      const form = new FormData();
      for (const text of ['first', 'second']) form.append('files', new Blob([text]), '设计.html');
      const response = await fetch(`${url}/api/projects/${id}/upload`, { method: 'POST', body: form });
      expect(response.status).toBe(200);
      expect((await response.json() as ProjectFilesResponse).files.map((f: {name:string}) => f.name)).toEqual(['inputs/uploads/设计.html', 'inputs/uploads/设计-1.html']);
      const nested = new FormData(); nested.append('dir', 'assets/icons'); nested.append('files', new Blob(['icon']), 'logo.svg');
      const uploaded = await fetch(`${url}/api/projects/${id}/upload`, { method: 'POST', body: nested });
      expect((await uploaded.json() as ProjectFilesResponse).files[0]!.name).toBe('assets/icons/logo.svg');
    });
  });
  it('retains HTML history through restore, delete, rename and storage restart', async () => {
    await withFiles(async ({ url, id, json, root }) => {
      const first = await (await json(`/api/projects/${id}/files`, { name: 'page.html', content: '<html><body>First</body></html>' })).json() as FileWithVersion;
      expect(first.version.source).toBe('manual');
      const second = await json(`/api/projects/${id}/files`, { name: 'page.html', content: '<html><body>Second</body></html>', parentVersionId: first.version.id });
      expect(second.status).toBe(200);
      expect((await (await fetch(`${url}/api/projects/${id}/files/page.html/versions`)).json() as ProjectFileVersionsResponse).versions).toHaveLength(2);
      const restored = await json(`/api/projects/${id}/files/page.html/versions/${first.version.id}/restore`, {});
      expect((await restored.json() as FileWithVersion).version.source).toBe('restore');
      expect((await json(`/api/projects/${id}/files/rename`, { from: 'page.html', to: 'archive/page.html' })).status).toBe(200);
      expect((await fetch(`${url}/api/projects/${id}/raw/archive/page.html`, { method: 'DELETE' })).status).toBe(200);
      const history = await (await fetch(`${url}/api/projects/${id}/files/archive/page.html/versions`)).json() as ProjectFileVersionsResponse;
      expect(history.versions).toHaveLength(3);
      expect(createProjectRegistry(root).resolveProjectRoot(id)).toBe(path.join(root, 'projects', id));
      expect((await json(`/api/projects/${id}/files/archive/page.html/versions/${first.version.id}/restore`, {})).status).toBe(200);
      expect(await (await fetch(`${url}/api/projects/${id}/raw/archive/page.html`)).text()).toContain('First');
    });
  });
  it('preserves manifest publication guards and no-overwrite conflict responses', async () => {
    await withFiles(async ({ id, json }) => {
      const saved = await json(`/api/projects/${id}/files`, { name: 'page.html', content: '<html><body>Finished</body></html>', artifact: true });
      expect(saved.status).toBe(200);
      expect((await saved.json() as ProjectFileResponse).file.artifactManifest!.entry).toBe('page.html');
      expect((await json(`/api/projects/${id}/files`, { name: 'page.html', content: 'no', overwrite: false })).status).toBe(409);
      const blocked = await json(`/api/projects/${id}/files`, { name: 'pitch.html', content: '<html>Name to confirm</html>', artifact: true });
      expect(blocked.status).toBe(422);
      expect((await blocked.json() as { error: { code: string } }).error.code).toBe('ARTIFACT_PUBLICATION_BLOCKED');
    });
  });
  it('blocks path traversal, internal version reads, symlink escapes and unknown-project writes', async () => {
    await withFiles(async ({ url, id, root, registry, json }) => {
      expect((await json(`/api/projects/${id}/files`, { name: '../outside.txt', content: 'bad' })).ok).toBe(false);
      expect((await json('/api/projects/missing/files', { name: 'bad.txt', content: 'bad' })).status).toBe(404);
      expect((await fetch(`${url}/api/projects/${id}/raw/.file-versions/secret`)).status).toBe(404);
      const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'secret');
      await symlink(outside, path.join(registry.resolveProjectRoot(id), 'escape'));
      expect((await fetch(`${url}/api/projects/${id}/raw/escape/secret.txt`)).ok).toBe(false);
      expect((await json(`/api/projects/${id}/files`, { name: 'escape/write.txt', content: 'bad' })).ok).toBe(false);
      expect(await readdir(outside)).toEqual(['secret.txt']);
      expect(() => registry.create({ name: 'External', metadata: { kind: 'prototype', baseDir: outside } })).toThrow('host adapter');
    });
  });
  it('enforces injected write authority before multipart parsing or filesystem effects', async () => {
    await withFiles(async ({ url, id, root, registry, json }) => {
      expect((await fetch(`${url}/api/projects/${id}/files`)).status).toBe(200);
      expect((await json(`/api/projects/${id}/files`, { name: 'denied.txt', content: 'bad' })).status).toBe(403);
      const form = new FormData(); form.append('files', new Blob(['bad']), 'denied.txt');
      expect((await fetch(`${url}/api/projects/${id}/upload`, { method: 'POST', body: form })).status).toBe(403);
      expect(await readdir(registry.resolveProjectRoot(id))).toEqual([]);
      expect(await readdir(path.join(root, 'uploads'))).toEqual([]);
    }, { authorize: (_req, _res, _id, options) => options.mode === 'read' });
  });
  it('keeps text preview bounds, sandboxed scopes, bridges and raw revalidation', async () => {
    await withFiles(async ({ url, id, json }) => {
      await json(`/api/projects/${id}/files`, { name: 'page.html', content: '<html><head><title>Canvas</title></head><body>' + 'x'.repeat(5000) + '</body></html>' });
      const preview = await (await fetch(`${url}/api/projects/${id}/text-preview/page.html?limit=1024`)).json() as ProjectFileTextPreviewResponse;
      expect(preview.truncated).toBe(true); expect(preview.limit).toBe(1024);
      const minted = await (await fetch(`${url}/api/projects/${id}/preview-url?file=page.html`)).json() as ProjectPreviewUrlResponse;
      expect(minted.opaqueOrigin).toBe(true);
      const scoped = await fetch(url + minted.url); expect(scoped.status).toBe(200);
      expect(scoped.headers.get('content-security-policy')).toContain('sandbox allow-scripts allow-forms');
      expect((await fetch(`${url}/api/projects/${id}/preview/not-a-scope/page.html`)).status).toBe(404);
      const bridged = await fetch(`${url}/api/projects/${id}/raw/page.html?odPreviewBridge=scroll,selection,snapshot,observability`);
      const text = await bridged.text(); expect(text).toContain('data-bezier-url-scroll-bridge'); expect(text).toContain('data-bezier-url-selection-bridge'); expect(text).toContain('data-bezier-url-snapshot-bridge');
      const raw = await fetch(`${url}/api/projects/${id}/raw/page.html`);
      expect((await fetch(`${url}/api/projects/${id}/raw/page.html`, { headers: { 'if-none-match': raw.headers.get('etag')! } })).status).toBe(304);
    });
  });
  it('reads actual Office ZIP content and exports original project organization', async () => {
    await withFiles(async ({ url, id, json }) => {
      const zip = new JSZip(); zip.file('word/document.xml', '<w:document><w:p><w:r><w:t>Canvas document</w:t></w:r></w:p></w:document>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      expect((await json(`/api/projects/${id}/files`, { name: 'docs/report.docx', content: buffer.toString('base64'), encoding: 'base64' })).status).toBe(200);
      const preview = await (await fetch(`${url}/api/projects/${id}/files/${encodeURIComponent('docs/report.docx')}/preview`)).json() as { sections: Array<{ lines: string[] }> };
      expect(preview.sections[0]!.lines).toContain('Canvas document');
      const archive = await fetch(`${url}/api/projects/${id}/archive`);
      expect(archive.status).toBe(200);
      expect((await JSZip.loadAsync(await archive.arrayBuffer())).file('docs/report.docx')).not.toBeNull();
    });
  });
  it('rolls back file and version renames when canvas reference persistence fails', async () => {
    await withFiles(async ({ url, id, json }) => {
      const saved = await (await json(`/api/projects/${id}/files`, { name: 'original.html', content: '<html>Original</html>' })).json() as FileWithVersion;
      const response = await json(`/api/projects/${id}/files/rename`, { from: 'original.html', to: 'renamed.html' });
      expect(response.status).toBe(400);
      expect(await (await fetch(`${url}/api/projects/${id}/raw/original.html`)).text()).toBe('<html>Original</html>');
      expect((await fetch(`${url}/api/projects/${id}/raw/renamed.html`)).status).toBe(404);
      const history = await (await fetch(`${url}/api/projects/${id}/files/original.html/versions`)).json() as ProjectFileVersionsResponse;
      expect(history.versions[0]!.id).toBe(saved.version.id);
    }, { canvasFiles: { renameSketchFile: async () => { throw new Error('canvas persistence failed'); } } });
  });
  it('does not manufacture a checkpoint for a read-only history request', async () => {
    await withFiles(async ({ url, id, registry }) => {
      await writeFile(path.join(registry.resolveProjectRoot(id), 'external.html'), '<html>External</html>');
      const response = await fetch(`${url}/api/projects/${id}/files/external.html/versions`);
      expect(response.status).toBe(200);
      expect((await response.json() as ProjectFileVersionsResponse).versions).toEqual([]);
      expect(await readdir(registry.resolveProjectRoot(id))).toEqual(['external.html']);
    }, { authorize: (_req, _res, _id, options) => options.mode === 'read' });
  });
  it('streams real file changes only after watcher readiness and releases on disconnect', async () => {
    await withFiles(async ({ url, id, registry }) => {
      const abort = new AbortController();
      const response = await fetch(`${url}/api/projects/${id}/events`, { signal: abort.signal });
      const reader = response.body!.getReader(); const decoder = new TextDecoder(); let received = '';
      while (!received.includes('event: ready')) received += decoder.decode((await reader.read()).value);
      await writeFile(path.join(registry.resolveProjectRoot(id), 'external.txt'), 'external edit');
      while (!received.includes('external.txt')) received += decoder.decode((await reader.read()).value);
      expect(received).toContain('event: file-changed'); expect(received).toContain('"kind":"add"');
      abort.abort(); await reader.cancel().catch(() => {});
    });
  });
});
