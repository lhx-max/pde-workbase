import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { CanvasStateError } from '@bezier/canvas-core';
import type { Project, ProjectFile, ProjectFileVersion, ProjectFileVersionsResponse, RenameProjectFileResponse } from '@bezier/contracts';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { AppwriteClient } from '../src/storage/appwrite-client.js';
import { CloudProjectFiles } from '../src/storage/cloud-project-files.js';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { registerCloudProjectFileRoutes, type RegisterCloudProjectFileRoutesDeps } from '../src/routes/cloud-project-files.js';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

type Row = {
  $id: string;
  canvasId: string;
  path: string;
  fileId: string;
  kind: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
  [key: string]: unknown;
};

const conflict = (message: string) => new CanvasStateError(409, 'CANVAS_CONFLICT', message);
const missing = (message: string) => new CanvasStateError(404, 'CANVAS_NOT_FOUND', message);

/** In-memory stand-in for the Appwrite REST surface the storage class uses:
 * a documents collection with the real (canvasId, path) unique constraint and
 * a blob bucket keyed by immutable file id. No filesystem, no network. */
class FakeCloud {
  readonly documents = new Map<string, Row>();
  readonly blobs = new Map<string, Uint8Array>();
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  callError: ((method: string, path: string) => Error | undefined) | undefined;
  downloadError: ((fileId: string) => Error | undefined) | undefined;

  readonly docsBase = '/databases/db/collections/canvas_files/documents';

  docsPath(databaseId: string, collection: string): string {
    return `/databases/${databaseId}/collections/${collection}/documents`;
  }

  async call<T>(method: string, rawPath: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path: rawPath, body });
    const injected = this.callError?.(method, rawPath);
    if (injected) throw injected;
    const [pathname, queryString] = rawPath.split('?', 2);
    if (pathname === undefined || !pathname.startsWith(this.docsBase)) {
      throw new Error(`unexpected cloud path ${rawPath}`);
    }
    const suffix = pathname.slice(this.docsBase.length);
    if (method === 'GET' && suffix === '') {
      const queries = new URLSearchParams(queryString ?? '').getAll('queries[]').map((entry) => JSON.parse(entry) as {
        method: string; attribute?: string; values?: unknown[];
      });
      let matched = [...this.documents.values()];
      for (const query of queries) {
        if (query.method === 'equal' && typeof query.attribute === 'string') {
          matched = matched.filter((row) => row[query.attribute!] === (query.values as unknown[])[0]);
        }
      }
      matched = matched.sort((a, b) => (a.$id < b.$id ? -1 : a.$id > b.$id ? 1 : 0));
      let cursor: string | null = null;
      for (const query of queries) {
        if (query.method === 'cursorAfter') cursor = String((query.values as unknown[])[0]);
      }
      if (cursor !== null) matched = matched.filter((row) => row.$id > cursor);
      for (const query of queries) {
        if (query.method === 'limit') matched = matched.slice(0, Number((query.values as unknown[])[0]));
      }
      return { documents: matched, total: matched.length } as T;
    }
    if (method === 'GET') {
      const row = this.documents.get(decodeURIComponent(suffix.slice(1)));
      if (!row) throw missing('document not found');
      return row as T;
    }
    if (method === 'POST' && suffix === '') {
      const { documentId, data } = body as { documentId: string; data: Record<string, unknown> };
      if (this.documents.has(documentId)) throw conflict('document id already exists');
      for (const row of this.documents.values()) {
        if (row.canvasId === data.canvasId && row.path === data.path) throw conflict('canvas path already indexed');
      }
      const row = { $id: documentId, ...data } as Row;
      this.documents.set(documentId, row);
      return row as T;
    }
    if (method === 'PATCH') {
      const id = decodeURIComponent(suffix.slice(1));
      const row = this.documents.get(id);
      if (!row) throw missing('document not found');
      const { data } = body as { data: Record<string, unknown> };
      for (const other of this.documents.values()) {
        if (other.$id !== id && other.canvasId === data.canvasId && other.path === data.path) {
          throw conflict('canvas path already indexed');
        }
      }
      this.documents.set(id, { ...row, ...data });
      return this.documents.get(id) as T;
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(suffix.slice(1));
      if (!this.documents.delete(id)) throw missing('document not found');
      return undefined as T;
    }
    throw new Error(`unhandled ${method} ${rawPath}`);
  }

  async upload(_bucket: string, fileId: string, _name: string, bytes: Uint8Array, _mime: string): Promise<{ $id: string }> {
    if (this.blobs.has(fileId)) throw conflict('storage file already exists');
    this.blobs.set(fileId, new Uint8Array(bytes));
    return { $id: fileId };
  }

  async download(pathName: string): Promise<Uint8Array> {
    const fileId = decodeURIComponent(pathName.split('/').at(-2) ?? '');
    const injected = this.downloadError?.(fileId);
    if (injected) throw injected;
    const bytes = this.blobs.get(fileId);
    if (!bytes) throw missing('storage file not found');
    return new Uint8Array(bytes);
  }
}

class FakeStatePort implements JsonStatePort {
  readonly ready: Promise<void> = Promise.resolve();
  readonly slots = new Map<string, unknown>();
  failFlush: Error | undefined = undefined;
  read(key: string): unknown {
    const value = this.slots.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  write(key: string, value: unknown): void {
    this.slots.set(key, JSON.parse(JSON.stringify(value)));
  }
  async flush(): Promise<void> {
    if (this.failFlush) throw this.failFlush;
  }
}

interface Harness {
  url: string;
  files: CloudProjectFiles;
  fake: FakeCloud;
  state: FakeStatePort;
  projectId: string;
  json: (route: string, body: unknown, method?: string, headers?: Record<string, string>) => Promise<Response>;
}

async function withServer(
  fn: (h: Harness) => Promise<void>,
  options: Partial<RegisterCloudProjectFileRoutesDeps> & { registry?: Pick<ReturnType<typeof createProjectRegistry>, 'get'> } = {},
) {
  const fake = new FakeCloud();
  const client = new AppwriteClient({ endpoint: 'https://cloud.example/v1', projectId: 'p', apiKey: 'k' });
  vi.spyOn(client, 'call').mockImplementation((method, routePath, body) => fake.call(method, routePath, body) as never);
  vi.spyOn(client, 'download').mockImplementation((routePath) => fake.download(routePath));
  vi.spyOn(client, 'upload').mockImplementation((bucket, fileId, name, bytes, mime) => fake.upload(bucket, fileId, name, bytes, mime));
  const state = new FakeStatePort();
  const files = new CloudProjectFiles(client, 'db', 'bucket', state);
  const project = { id: 'p1', name: 'Cloud Files', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 1 } as Project;
  const { registry: registryOption, authorize, ...rest } = options;
  const registry = registryOption ?? { get: (id: string): Project | null => (id === project.id ? project : null) };
  const app = express();
  app.use(express.json({ limit: '64mb' }));
  registerCloudProjectFileRoutes(app, { files, registry, authorize: authorize ?? (async () => true), ...rest });
  // Sentinel "other surface" handlers registered AFTER the cloud registrar:
  // they must survive the unsupported-surface guard untouched.
  app.get('/api/projects/:id/canvas/state', (_req, res) => res.json({ ok: 'canvas' }));
  app.get('/api/projects/:id/events', (_req, res) => res.json({ ok: 'events' }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const url = `http://127.0.0.1:${address.port}`;
  const json = (route: string, body: unknown, method = 'POST', headers: Record<string, string> = {}) =>
    fetch(url + route, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    await fn({ url, files, fake, state, projectId: project.id, json });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const revisionOf = async (files: CloudProjectFiles, projectId: string, filePath: string) =>
  (await files.read(projectId, filePath))!.revision;

describe('cloud project file routes', () => {
  it('serves multipart uploads, listing and archive bytes from cloud only', async () => {
    await withServer(async ({ url, projectId, fake, json }) => {
      const payload = Buffer.from('binary \x00\xff payload');
      const form = new FormData();
      form.append('dir', 'docs/kit');
      form.append('files', new Blob([payload]), 'blob.bin');
      form.append('files', new Blob([payload]), 'blob.bin');
      const uploaded = await fetch(`${url}/api/projects/${projectId}/upload`, { method: 'POST', body: form });
      expect(uploaded.status).toBe(200);
      const names = ((await uploaded.json()) as { files: { name: string; originalName: string }[] }).files;
      expect(names.map((file) => file.name)).toEqual(['docs/kit/blob.bin', 'docs/kit/blob-1.bin']);
      expect(names[0]!.originalName).toBe('blob.bin');

      const raw = await fetch(`${url}/api/projects/${projectId}/raw/docs/kit/blob.bin`);
      expect(raw.status).toBe(200);
      expect(Buffer.from(await raw.arrayBuffer()).equals(payload)).toBe(true);
      expect(raw.headers.get('x-content-revision')).toBe(sha(payload));

      const listed = await (await fetch(`${url}/api/projects/${projectId}/files`)).json() as { files: ProjectFile[] };
      expect(listed.files.map((file) => file.name).sort()).toEqual(['docs/kit/blob-1.bin', 'docs/kit/blob.bin']);

      const archive = await fetch(`${url}/api/projects/${projectId}/archive`);
      expect(archive.status).toBe(200);
      const zip = await JSZip.loadAsync(await archive.arrayBuffer());
      expect(await zip.file('docs/kit/blob.bin')!.async('uint8array')).toEqual(new Uint8Array(payload));
      const scoped = await fetch(`${url}/api/projects/${projectId}/archive?root=docs%2Fkit`);
      const scopedZip = await JSZip.loadAsync(await scoped.arrayBuffer());
      expect(await scopedZip.file('blob.bin')!.async('uint8array')).toEqual(new Uint8Array(payload));
      expect(scopedZip.file('docs/kit/blob.bin')).toBeNull();

      expect(fake.calls.every((call) => call.path.startsWith(fake.docsBase))).toBe(true);
      await json(`/api/projects/${projectId}/files`, { name: 'note.txt', content: 'plain' });
      const again = await (await fetch(`${url}/api/projects/${projectId}/archive`)).arrayBuffer();
      const zipAgain = await JSZip.loadAsync(again);
      expect(await zipAgain.file('note.txt')!.async('string')).toBe('plain');
    });
  });

  it('enforces the content-hash baseline on overwrite: missing 428, stale 409', async () => {
    await withServer(async ({ projectId, json }) => {
      const created = await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'v1' });
      expect(created.status).toBe(200);
      const first = (await created.json()) as { file: ProjectFile; revision: string };
      expect(first.revision).toBe(sha('v1'));

      const missingBaseline = await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'v2' });
      expect(missingBaseline.status).toBe(428);
      expect(((await missingBaseline.json()) as { error: { code: string } }).error.code).toBe('CANVAS_PRECONDITION_REQUIRED');

      const stale = await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'v2', expectedRevision: 'stale' });
      expect(stale.status).toBe(409);

      const overwriteFlagAlone = await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'v2', overwrite: true });
      expect(overwriteFlagAlone.status).toBe(428);

      const viaHeader = await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'v2' }, 'POST', { 'if-match': `"${first.revision}"` });
      expect(viaHeader.status).toBe(200);
      expect(((await viaHeader.json()) as { revision: string }).revision).toBe(sha('v2'));

      const createOnly = await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'v3', overwrite: false, expectedRevision: first.revision });
      expect(createOnly.status).toBe(409);
    });
  });

  it('renames with a baseline, rolls back on canvas-reference failure, deletes with history retained', async () => {
    await withServer(async ({ url, projectId, files, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'doc.md', content: 'first' });
      const r1 = await revisionOf(files, projectId, 'doc.md');
      await json(`/api/projects/${projectId}/files`, { name: 'doc.md', content: 'second', expectedRevision: r1 });
      const r2 = await revisionOf(files, projectId, 'doc.md');

      const noBaseline = await json(`/api/projects/${projectId}/files/rename`, { from: 'doc.md', to: 'moved.md' });
      expect(noBaseline.status).toBe(428);
      const renamed = await json(`/api/projects/${projectId}/files/rename`, { from: 'doc.md', to: 'moved.md', expectedRevision: r2 });
      expect(renamed.status).toBe(200);
      const renameBody = (await renamed.json()) as RenameProjectFileResponse;
      expect(renameBody).toMatchObject({ oldName: 'doc.md', newName: 'moved.md' });
      expect(renameBody.file.name).toBe('moved.md');
      expect((await fetch(`${url}/api/projects/${projectId}/raw/doc.md`)).status).toBe(404);
      expect(await (await fetch(`${url}/api/projects/${projectId}/raw/moved.md`)).text()).toBe('second');

      const conflictRename = await json(`/api/projects/${projectId}/files/rename`, { from: 'moved.md', to: 'moved.md', expectedRevision: r2 });
      expect(conflictRename.status).toBe(400);

      const versions = await (await fetch(`${url}/api/projects/${projectId}/files/moved.md/versions`)).json() as ProjectFileVersionsResponse;
      expect(versions.versions).toHaveLength(2);
      const restored = await json(`/api/projects/${projectId}/files/moved.md/versions/${versions.versions[0]!.id}/restore`, { expectedRevision: await revisionOf(files, projectId, 'moved.md') });
      expect(restored.status).toBe(200);
      expect(await (await fetch(`${url}/api/projects/${projectId}/raw/moved.md`)).text()).toBe('first');

      const noBaselineDelete = await fetch(`${url}/api/projects/${projectId}/files/moved.md`, { method: 'DELETE' });
      expect(noBaselineDelete.status).toBe(428);
      const deleted = await fetch(`${url}/api/projects/${projectId}/raw/moved.md`, { method: 'DELETE', headers: { 'if-match': await revisionOf(files, projectId, 'moved.md') } });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ ok: true });
      expect((await fetch(`${url}/api/projects/${projectId}/raw/moved.md`)).status).toBe(404);
      const after = await (await fetch(`${url}/api/projects/${projectId}/files/moved.md/versions`)).json() as ProjectFileVersionsResponse;
      expect(after.versions.length).toBeGreaterThanOrEqual(3);
      const oldBytes = await fetch(`${url}/api/projects/${projectId}/files/moved.md/versions/${versions.versions[1]!.id}`);
      expect(oldBytes.status).toBe(200);
      expect(await oldBytes.text()).toBe('second');
    });
  });

  it('rolls back the cloud rename when the canvas reference update fails', async () => {
    await withServer(async ({ url, projectId, files, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'card.png', content: PNG_1PX.toString('base64'), encoding: 'base64' });
      const revision = await revisionOf(files, projectId, 'card.png');
      const response = await json(`/api/projects/${projectId}/files/rename`, { from: 'card.png', to: 'renamed.png', expectedRevision: revision });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('CLOUD_FILE_OPERATION_UNAVAILABLE');
      expect(Buffer.from(await (await fetch(`${url}/api/projects/${projectId}/raw/card.png`)).arrayBuffer()).equals(PNG_1PX)).toBe(true);
      expect((await fetch(`${url}/api/projects/${projectId}/raw/renamed.png`)).status).toBe(404);
    }, { canvasFiles: { renameSketchFile: async () => { throw new Error('canvas persistence failed'); } } });
  });

  it('denies readers and unknown projects before any storage call', async () => {
    await withServer(async ({ url, projectId, fake, files, json }) => {
      await files.write(projectId, 'ok.txt', Buffer.from('x'), 'text/plain');
      const documentsBefore = fake.documents.size;
      const blobsBefore = fake.blobs.size;
      expect((await json(`/api/projects/${projectId}/files`, { name: 'denied.txt', content: 'x' })).status).toBe(403);
      const form = new FormData();
      form.append('files', new Blob(['x']), 'denied.txt');
      expect((await fetch(`${url}/api/projects/${projectId}/upload`, { method: 'POST', body: form })).status).toBe(403);
      expect((await fetch(`${url}/api/projects/${projectId}/raw/ok.txt`, { method: 'DELETE' })).status).toBe(403);
      expect((await json(`/api/projects/${projectId}/files/rename`, { from: 'ok.txt', to: 'b.txt' })).status).toBe(403);
      expect((await fetch(`${url}/api/projects/${projectId}/files/ok.txt/versions/v-${'0'.repeat(32)}/restore`, { method: 'POST' })).status).toBe(403);
      expect((await fetch(`${url}/api/projects/${projectId}/archive`)).status).toBe(200);
      expect((await fetch(`${url}/api/projects/ghost/files`)).status).toBe(404);
      expect((await json('/api/projects/ghost/files', { name: 'x.txt', content: 'x' })).status).toBe(404);
      expect(fake.documents.size).toBe(documentsBefore);
      expect(fake.blobs.size).toBe(blobsBefore);
    }, { authorize: async (_req, _res, _id, options) => options.mode === 'read' });
  });

  it('never falls back to local filesystem ghosts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'canvas-cloud-files-'));
    try {
      const registry = createProjectRegistry(root);
      const project = registry.create({ name: 'Ghost' });
      await writeFile(path.join(registry.resolveProjectRoot(project.id), 'ghost.txt'), 'local ghost bytes');
      const fake = new FakeCloud();
      const client = new AppwriteClient({ endpoint: 'https://cloud.example/v1', projectId: 'p', apiKey: 'k' });
      vi.spyOn(client, 'call').mockImplementation((method, routePath, body) => fake.call(method, routePath, body) as never);
      vi.spyOn(client, 'download').mockImplementation((routePath) => fake.download(routePath));
      vi.spyOn(client, 'upload').mockImplementation((bucket, fileId, name, bytes, mime) => fake.upload(bucket, fileId, name, bytes, mime));
      const files = new CloudProjectFiles(client, 'db', 'bucket', new FakeStatePort());
      const app = express();
      app.use(express.json());
      registerCloudProjectFileRoutes(app, { files, registry, authorize: async () => true });
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      const url = `http://127.0.0.1:${(address as { port: number }).port}`;
      try {
        // Bytes exist only on local disk — the cloud route must NOT see them.
        expect((await fetch(`${url}/api/projects/${project.id}/raw/ghost.txt`)).status).toBe(404);
        const list = await (await fetch(`${url}/api/projects/${project.id}/files`)).json() as { files: ProjectFile[] };
        expect(list.files).toEqual([]);
        // And a cloud write does not appear on disk.
        await fetch(`${url}/api/projects/${project.id}/files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'cloud.txt', content: 'cloud only' }) });
        expect(await readdir(registry.resolveProjectRoot(project.id))).toEqual(['ghost.txt']);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal, hidden and internal version paths', async () => {
    await withServer(async ({ url, projectId, fake, json }) => {
      for (const bad of ['a%2F..%2F..%2Fsecret.txt', '%2e%2e%2F..%2Fsecret.txt', 'a%2F%2Fb.txt', 'a%2F.%2Fb.txt', '.file-versions%2Fx', '.bezierdesign%2F.file-versions%2Fx']) {
        const response = await fetch(`${url}/api/projects/${projectId}/raw/${bad}`);
        expect([400, 404]).toContain(response.status);
      }
      expect((await json(`/api/projects/${projectId}/files`, { name: '../outside.txt', content: 'bad' })).status).toBe(400);
      expect((await json(`/api/projects/${projectId}/files`, { name: '.file-versions/evil', content: 'bad' })).status).toBe(404);
      expect((await json(`/api/projects/${projectId}/files/rename`, { from: '.file-versions/a', to: 'b.txt', expectedRevision: 'x' })).status).toBe(404);
      expect(fake.calls).toEqual([]);
    });
  });

  it('serves HTML under the strict opaque-origin sandbox CSP with revision validators', async () => {
    await withServer(async ({ url, projectId, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'page.html', content: '<html><body>hello canvas</body></html>' });
      const response = await fetch(`${url}/api/projects/${projectId}/raw/page.html`);
      expect(response.status).toBe(200);
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain('sandbox allow-scripts allow-forms');
      expect(csp).not.toContain('allow-same-origin');
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-type')).toContain('text/html');
      const etag = response.headers.get('etag')!;
      expect(etag).toBe(`"${sha('<html><body>hello canvas</body></html>')}"`);
      expect((await fetch(`${url}/api/projects/${projectId}/raw/page.html`, { headers: { 'if-none-match': etag } })).status).toBe(304);
      const range = await fetch(`${url}/api/projects/${projectId}/files/page.html`, { headers: { range: 'bytes=0-4' } });
      expect(range.status).toBe(206);
      expect(await range.text()).toBe('<html');
      const staleRange = await fetch(`${url}/api/projects/${projectId}/files/page.html`, { headers: { range: 'bytes=0-4', 'if-range': '"deadbeef"' } });
      expect(staleRange.status).toBe(200);
      const unsatisfiable = await fetch(`${url}/api/projects/${projectId}/files/page.html`, { headers: { range: 'bytes=9999-' } });
      expect(unsatisfiable.status).toBe(416);
      const viaFilesRoute = await fetch(`${url}/api/projects/${projectId}/files/page.html`);
      expect(viaFilesRoute.headers.get('content-security-policy')).toContain('sandbox');
    });
  });

  it('rejects malformed base64 and garbage image bytes', async () => {
    await withServer(async ({ url, projectId, json }) => {
      expect((await json(`/api/projects/${projectId}/files`, { name: 'x.bin', content: '%%%not-base64%%%', encoding: 'base64' })).status).toBe(400);
      expect((await json(`/api/projects/${projectId}/files`, { name: 'x.bin', content: 'Zg==\n', encoding: 'base64' })).status).toBe(400);
      expect((await json(`/api/projects/${projectId}/files`, { name: 'fake.png', content: Buffer.from('not an image').toString('base64'), encoding: 'base64' })).status).toBe(400);
      expect((await json(`/api/projects/${projectId}/files`, { name: 'real.png', content: PNG_1PX.toString('base64'), encoding: 'base64' })).status).toBe(200);
      // `.png` extension wins over any claimed mime and the bytes are verified.
      const form = new FormData();
      form.append('files', new Blob(['not an image'], { type: 'image/png' }), 'bogus.png');
      expect((await fetch(`${url}/api/projects/${projectId}/upload`, { method: 'POST', body: form })).status).toBe(400);
    });
  });

  it('fails the whole archive 503 on a storage read failure — never a partial zip', async () => {
    await withServer(async ({ url, projectId, fake, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'a.txt', content: 'aaa' });
      await json(`/api/projects/${projectId}/files`, { name: 'b.txt', content: 'bbb' });
      fake.downloadError = () => new Error('transport boom — must not leak');
      const response = await fetch(`${url}/api/projects/${projectId}/archive`);
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('CLOUD_STORAGE_UNAVAILABLE');
      expect(body.error.message).not.toContain('boom');
      const raw = await fetch(`${url}/api/projects/${projectId}/raw/a.txt`);
      expect(raw.status).toBe(503);
      expect(((await raw.json()) as { error: { message: string } }).error.message).not.toContain('boom');
    });
  });

  it('blocks artifact publication instead of skipping the guard', async () => {
    await withServer(async ({ projectId, json, fake }) => {
      expect(((await (await json(`/api/projects/${projectId}/files`, { name: 'a.html', content: '<html/>', artifact: true })).json()) as { error: { code: string } }).error.code).toBe('CLOUD_ARTIFACT_PUBLICATION_UNAVAILABLE');
      const manifestAttempt = await json(`/api/projects/${projectId}/files`, { name: 'b.html', content: '<html/>', artifactManifest: { entry: 'b.html' } });
      expect(manifestAttempt.status).toBe(503);
      expect(fake.documents.size).toBe(0);
    });
  });

  it('answers 503 CLOUD_FILE_OPERATION_UNAVAILABLE for unimplemented legacy surfaces', async () => {
    await withServer(async ({ url, projectId, json }) => {
      const cases: [string, string][] = [
        ['GET', `/api/projects/${projectId}/folders`],
        ['POST', `/api/projects/${projectId}/folders`],
        ['DELETE', `/api/projects/${projectId}/folders`],
        ['GET', `/api/projects/${projectId}/search?q=x`],
        ['GET', `/api/projects/${projectId}/text-preview/a.txt`],
        ['GET', `/api/projects/${projectId}/preview-url?file=a.html`],
        ['GET', `/api/projects/${projectId}/preview/scope1234/a.html`],
        ['GET', `/api/projects/${projectId}/powered/a.html`],
        ['POST', `/api/projects/${projectId}/archive/batch`],
        ['GET', `/api/projects/${projectId}/files/a.png/preview`],
        ['GET', `/api/projects/${projectId}/archive?includeInternalState=true`],
      ];
      for (const [method, route] of cases) {
        const response = await fetch(url + route, method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(response.status, route).toBe(503);
        expect(((await response.json()) as { error: { code: string } }).error.code, route).toBe('CLOUD_FILE_OPERATION_UNAVAILABLE');
      }
      const derived = await fetch(`${url}/api/projects/${projectId}/raw/none.png?odThumbnailWidth=128`);
      expect(derived.status).toBe(503);
      expect(((await derived.json()) as { error: { code: string } }).error.code).toBe('CLOUD_FILE_OPERATION_UNAVAILABLE');
      // POST /files/:path/versions is implemented now — a missing file yields
      // the real 404, not the retired CLOUD_FILE_OPERATION_UNAVAILABLE guard.
      const snapshotMissing = await fetch(`${url}/api/projects/${projectId}/files/ghost.html/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(snapshotMissing.status).toBe(404);
      // Unrelated project surfaces stay untouched.
      expect((await fetch(`${url}/api/projects/${projectId}/canvas/state`)).status).toBe(200);
      expect((await fetch(`${url}/api/projects/${projectId}/events`)).status).toBe(200);
      await json(`/api/projects/${projectId}/files`, { name: 'kept.txt', content: 'ok' });
      expect(await (await fetch(`${url}/api/projects/${projectId}/raw/kept.txt`)).text()).toBe('ok');
    });
  });

  it('defers sketch paths to the injected sketch authority and refuses unverifiable writes', async () => {
    const scene = JSON.stringify({ elements: [] });
    const store = new Map<string, string>([['cards/c1.sketch.json', scene]]);
    const sketchDocuments = {
      read: async (p: string) => (store.has(p) ? store.get(p)! : p === 'absent.sketch.json' ? null : undefined),
      write: async (p: string, content: string) => {
        store.set(p, content);
        return { name: p, path: p, type: 'file', size: content.length, mtime: 2, kind: 'sketch', mime: 'application/json' } as ProjectFile;
      },
      listed: async () => [{ name: 'cards/c1.sketch.json', path: 'cards/c1.sketch.json', type: 'file', size: scene.length, mtime: 2, kind: 'sketch', mime: 'application/json' } as ProjectFile],
    };
    await withServer(async ({ url, projectId, json }) => {
      const read = await fetch(`${url}/api/projects/${projectId}/raw/cards/c1.sketch.json`);
      expect(await read.text()).toBe(scene);
      expect((await fetch(`${url}/api/projects/${projectId}/raw/absent.sketch.json`)).status).toBe(404);
      const list = await (await fetch(`${url}/api/projects/${projectId}/files`)).json() as { files: ProjectFile[] };
      expect(list.files.some((file) => file.name === 'cards/c1.sketch.json')).toBe(true);
      const wrote = await json(`/api/projects/${projectId}/files`, { name: 'cards/new.sketch.json', content: '{}' });
      expect(wrote.status).toBe(200);
      expect(store.get('cards/new.sketch.json')).toBe('{}');
      const baselineWrite = await json(`/api/projects/${projectId}/files`, { name: 'cards/new.sketch.json', content: '{}', expectedRevision: 'abc' });
      expect(baselineWrite.status).toBe(503);
      const renamed = await json(`/api/projects/${projectId}/files/rename`, { from: 'cards/c1.sketch.json', to: 'cards/c2.sketch.json', expectedRevision: 'abc' });
      expect(renamed.status).toBe(503);
      expect(((await renamed.json()) as { error: { code: string } }).error.code).toBe('CLOUD_FILE_OPERATION_UNAVAILABLE');
      expect((await fetch(`${url}/api/projects/${projectId}/raw/cards/c1.sketch.json`, { method: 'DELETE', headers: { 'if-match': 'x' } })).status).toBe(503);
    }, { sketchDocuments });
  });

  it('applies legacy since/scope list semantics over the cloud index', async () => {
    await withServer(async ({ url, projectId, files }) => {
      await files.write(projectId, 'visible.txt', Buffer.from('v'), 'text/plain');
      await files.write(projectId, '.bezierdesign/state.json', Buffer.from('internal'), 'application/json');
      await files.write(projectId, 'dir/x.artifact.json', Buffer.from('{}'), 'application/json');
      const listed = await (await fetch(`${url}/api/projects/${projectId}/files`)).json() as { files: ProjectFile[] };
      expect(listed.files.map((file) => file.name)).toEqual(['visible.txt']);
      const all = await (await fetch(`${url}/api/projects/${projectId}/files?scope=all`)).json() as { files: ProjectFile[] };
      expect(all.files).toHaveLength(3);
      const future = await (await fetch(`${url}/api/projects/${projectId}/files?since=${Date.now() + 60_000}`)).json() as { files: ProjectFile[] };
      expect(future.files).toEqual([]);
    });
  });

  it('creates manual HTML version snapshots carrying label/prompt over the wire', async () => {
    await withServer(async ({ url, projectId, files, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'page.html', content: '<html>v1</html>' });
      const head = await revisionOf(files, projectId, 'page.html');
      await json(`/api/projects/${projectId}/files`, { name: 'note.txt', content: 'plain' });

      expect((await json(`/api/projects/${projectId}/files/ghost.html/versions`, {})).status).toBe(404);
      expect((await json(`/api/projects/${projectId}/files/note.txt/versions`, {})).status).toBe(400);
      expect((await json(`/api/projects/${projectId}/files/page.html/versions`, { expectedRevision: 'stale' })).status).toBe(409);

      const created = await json(`/api/projects/${projectId}/files/page.html/versions`, { label: 'Launch', prompt: 'brief it', source: 'manual' });
      expect(created.status).toBe(200);
      const body = (await created.json()) as { version: ProjectFileVersion };
      expect(body.version).toMatchObject({
        fileName: 'page.html', label: 'Launch', prompt: 'brief it', source: 'manual',
        promptSource: 'manual', current: true, contentDigest: sha('<html>v1</html>'),
        kind: 'html', mime: 'text/html; charset=utf-8',
      });

      const listed = await (await fetch(`${url}/api/projects/${projectId}/files/page.html/versions`)).json() as ProjectFileVersionsResponse;
      expect(listed.versions.at(-1)).toMatchObject({ id: body.version.id, label: 'Launch', prompt: 'brief it', version: listed.versions.length });
      // The snapshot only references bytes — the head revision never moved.
      expect(await revisionOf(files, projectId, 'page.html')).toBe(head);
      const bytes = await fetch(`${url}/api/projects/${projectId}/files/page.html/versions/${body.version.id}`);
      expect(await bytes.text()).toBe('<html>v1</html>');
    });
  });

  it('rejects malformed snapshot requests before any cloud or state write', async () => {
    await withServer(async ({ url, projectId, fake, state, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'page.html', content: '<html>v1</html>' });
      const callsBefore = fake.calls.length;
      const persistedBefore = JSON.stringify([...state.slots.entries()]);

      const malformed: unknown[] = [
        [], { expectedRevision: 123 }, { expectedRevision: '' }, { expectedRevision: null },
        { source: 'robot' },
        { promptSource: 'elsewhere' },
        { label: 'x'.repeat(201) },
        { prompt: 'y'.repeat(4097) },
        { parentVersionId: 'nope' },
        { expectedRevision: 123 },
        { label: 7 },
        { unknownField: true },
      ];
      for (const body of malformed) {
        const response = await json(`/api/projects/${projectId}/files/page.html/versions`, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
      expect(fake.calls.length).toBe(callsBefore);
      expect(JSON.stringify([...state.slots.entries()])).toBe(persistedBefore);

      // A well-formed version id from another file's history is crossfile lineage.
      await json(`/api/projects/${projectId}/files`, { name: 'other.html', content: '<html>o</html>' });
      const otherVersions = await (await fetch(`${url}/api/projects/${projectId}/files/other.html/versions`)).json() as ProjectFileVersionsResponse;
      const cross = await json(`/api/projects/${projectId}/files/page.html/versions`, { parentVersionId: otherVersions.versions[0]!.id });
      expect(cross.status).toBe(404);

      const ok = await json(`/api/projects/${projectId}/files/page.html/versions`, { label: 'ok' });
      expect(ok.status).toBe(200);
    });
  });

  it('denies version snapshots to readers and foreign projects before any cloud call', async () => {
    await withServer(async ({ url, projectId, files, fake }) => {
      await files.write(projectId, 'page.html', Buffer.from('<html/>'), 'text/html');
      const callsBefore = fake.calls.length;
      const denied = await fetch(`${url}/api/projects/${projectId}/files/page.html/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(denied.status).toBe(403);
      const foreign = await fetch(`${url}/api/projects/ghost/files/page.html/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(foreign.status).toBe(404);
      expect(fake.calls.length).toBe(callsBefore);
    }, { authorize: async (_req, _res, _id, options) => options.mode === 'read' });
  });

  it('fails the snapshot request when history persistence fails', async () => {
    await withServer(async ({ url, projectId, state, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'page.html', content: '<html>v1</html>' });
      state.failFlush = new Error('flush failed');
      const response = await json(`/api/projects/${projectId}/files/page.html/versions`, { label: 'nope' });
      expect(response.status).toBe(503);
      state.failFlush = undefined;
    });
  });

  it('surfaces restore provenance and labels like the legacy version list', async () => {
    await withServer(async ({ url, projectId, files, json }) => {
      await json(`/api/projects/${projectId}/files`, { name: 'page.html', content: '<html>v1</html>' });
      const r1 = await revisionOf(files, projectId, 'page.html');
      await json(`/api/projects/${projectId}/files`, { name: 'page.html', content: '<html>v2</html>', expectedRevision: r1 });
      const list = await (await fetch(`${url}/api/projects/${projectId}/files/page.html/versions`)).json() as ProjectFileVersionsResponse;
      const restored = await json(`/api/projects/${projectId}/files/page.html/versions/${list.versions[0]!.id}/restore`, { expectedRevision: await revisionOf(files, projectId, 'page.html') });
      expect(restored.status).toBe(200);
      const body = await restored.json() as { version: ProjectFileVersion };
      expect(body.version).toMatchObject({ source: 'restore', restoreFromVersionId: list.versions[0]!.id, label: 'Version 3 · restored from v1' });
      const after = await (await fetch(`${url}/api/projects/${projectId}/files/page.html/versions`)).json() as ProjectFileVersionsResponse;
      expect(after.versions.at(-1)).toMatchObject({ source: 'restore', parentVersionId: list.versions[0]!.id });
    });
  });
});

it('marks current history from the authoritative head, including an external reversion and deletion',async()=>{
 await withServer(async({url,projectId,files,json,fake})=>{
  await json(`/api/projects/${projectId}/files`,{name:'page.html',content:'<html>old</html>'});
  const original={...[...fake.documents.values()].find(r=>r.path==='page.html')!};
  const baseline=await revisionOf(files,projectId,'page.html');
  await files.write(projectId,'page.html',Buffer.from('<html>new</html>'),'text/html',{expectedRevision:baseline});
  fake.documents.set(original.$id,original);
  const response=await fetch(`${url}/api/projects/${projectId}/files/page.html/versions`);
  const body=await response.json() as ProjectFileVersionsResponse;
  expect(body.versions.filter(v=>v.current).map(v=>v.contentDigest)).toEqual([sha('<html>old</html>')]);
  await files.delete(projectId,'page.html',{expectedRevision:sha('<html>old</html>')});
  const deleted=await(await fetch(`${url}/api/projects/${projectId}/files/page.html/versions`)).json() as ProjectFileVersionsResponse;
  expect(deleted.versions.some(v=>v.current)).toBe(false);
 });
});
