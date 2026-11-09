import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { CanvasStateError } from '@bezier/canvas-core';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import type { Project } from '@bezier/contracts';
import { AppwriteClient } from '../src/storage/appwrite-client.js';
import { CloudProjectFiles } from '../src/storage/cloud-project-files.js';
import { registerCloudProjectFileViews } from '../src/routes/cloud-project-file-views.js';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

type Row = {
  $id: string; canvasId: string; path: string; fileId: string;
  kind: string; mime: string; size: number; sha256: string; createdAt: string;
  [key: string]: unknown;
};

const conflict = (message: string) => new CanvasStateError(409, 'CANVAS_CONFLICT', message);
const missing = (message: string) => new CanvasStateError(404, 'CANVAS_NOT_FOUND', message);

class FakeCloud {
  readonly documents = new Map<string, Row>();
  readonly blobs = new Map<string, Uint8Array>();
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  callError: ((method: string, path: string) => Error | undefined) | undefined;

  readonly docsBase = '/databases/db/collections/canvas_files/documents';

  docsPath(databaseId: string, collection: string): string {
    return `/databases/${databaseId}/collections/${collection}/documents`;
  }

  async call<T>(method: string, rawPath: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path: rawPath, body });
    const injected = this.callError?.(method, rawPath);
    if (injected) throw injected;
    const [pathname, queryString] = rawPath.split('?', 2);
    if (pathname === undefined || !pathname.startsWith(this.docsBase)) throw new Error(`unexpected cloud path ${rawPath}`);
    const suffix = pathname.slice(this.docsBase.length);
    if (method === 'GET' && suffix === '') {
      const queries = new URLSearchParams(queryString ?? '').getAll('queries[]').map((entry) => JSON.parse(entry) as { method: string; attribute?: string; values?: unknown[] });
      let matched = [...this.documents.values()];
      for (const query of queries) {
        if (query.method === 'equal' && typeof query.attribute === 'string') {
          matched = matched.filter((row) => row[query.attribute!] === (query.values as unknown[])[0]);
        }
      }
      const total = matched.length;
      matched = matched.sort((a, b) => (a.$id < b.$id ? -1 : a.$id > b.$id ? 1 : 0));
      for (const query of queries) {
        if (query.method === 'cursorAfter') matched = matched.filter((row) => row.$id > String((query.values as unknown[])[0]));
        if (query.method === 'limit') matched = matched.slice(0, Number((query.values as unknown[])[0]));
      }
      return { documents: matched, total } as T;
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
        if (other.$id !== id && other.canvasId === data.canvasId && other.path === data.path) throw conflict('canvas path already indexed');
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

  async download(path: string): Promise<Uint8Array> {
    const bytes = this.blobs.get(decodeURIComponent(path.split('/').at(-2) ?? ''));
    if (!bytes) throw missing('storage file not found');
    return new Uint8Array(bytes);
  }
}

class FakeStatePort implements JsonStatePort {
  readonly ready: Promise<void> = Promise.resolve();
  readonly slots = new Map<string, unknown>();
  flushes = 0;
  failRead: Error | undefined = undefined;
  failWrite: Error | undefined = undefined;
  failFlush: Error | undefined = undefined;
  read(key: string): unknown {
    if (this.failRead) throw this.failRead;
    const value = this.slots.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  write(key: string, value: unknown): void {
    if (this.failWrite) throw this.failWrite;
    this.slots.set(key, JSON.parse(JSON.stringify(value)));
  }
  async flush(): Promise<void> {
    this.flushes += 1;
    if (this.failFlush) throw this.failFlush;
  }
}

const project: Project = { id: 'p1', name: 'Cloud project', skillId: null, designSystemId: null, createdAt: 0, updatedAt: 0 };

interface Harness {
  url: string;
  files: CloudProjectFiles;
  state: FakeStatePort;
  fake: FakeCloud;
  dataRoot: string;
  server: ReturnType<express.Express['listen']>;
}

async function withViews(
  fn: (h: Harness) => Promise<void>,
  options: { authorize?: Parameters<typeof registerCloudProjectFileViews>[1]['authorize']; project?: Project | null } = {},
) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'cloud-views-'));
  const fake = new FakeCloud();
  const client = new AppwriteClient({ endpoint: 'https://cloud.example/v1', projectId: 'p', apiKey: 'k' });
  vi.spyOn(client, 'call').mockImplementation((method, p, body) => fake.call(method, p, body) as never);
  vi.spyOn(client, 'download').mockImplementation((p) => fake.download(p));
  vi.spyOn(client, 'upload').mockImplementation((bucket, fileId, name, bytes, mime) => fake.upload(bucket, fileId, name, bytes, mime));
  const state = new FakeStatePort();
  const files = new CloudProjectFiles(client, 'db', 'bucket', state);
  const current = options.project === undefined ? project : options.project;
  const registry = { get: (id: string) => (current && id === current.id ? current : null) };
  const authorize = options.authorize ?? (async () => true);
  const app = express();
  app.use(express.json({ limit: '16mb' }));
  registerCloudProjectFileViews(app, { files, state, dataRoot, registry, authorize });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  try {
    await fn({ url: `http://127.0.0.1:${address.port}`, files, state, fake, dataRoot, server });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataRoot, { recursive: true, force: true });
  }
}

const folderSlotKey = (projectId: string) => `file-folders:${sha(projectId)}`;

describe('cloud project file views', () => {
  it('creates, lists, reconstructs and deletes empty folders via the cloud slot only', async () => {
    await withViews(async ({ url, state, dataRoot }) => {
      expect((await (await fetch(`${url}/api/projects/p1/folders`)).json() as { folders: unknown[] }).folders).toEqual([]);
      const created = await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'docs' }) });
      expect(created.status).toBe(200);
      const { folder } = await created.json() as { folder: { name: string; path: string; type: string; size: number; mtime: number } };
      expect(folder).toMatchObject({ name: 'docs', path: 'docs', type: 'dir', size: 0 });
      expect(state.slots.has(folderSlotKey('p1'))).toBe(true);
      // Nested create materializes logical parents, existing names conflict.
      await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'assets/icons' }) });
      const listed = (await (await fetch(`${url}/api/projects/p1/folders`)).json() as { folders: { name: string }[] }).folders.map((f) => f.name);
      expect(listed).toEqual(['assets', 'assets/icons', 'docs']);
      const dupe = await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'docs' }) });
      expect(dupe.status).toBe(409);
      // Restarted view over the same port data still lists them; nothing local.
      const removed = await fetch(`${url}/api/projects/p1/folders`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'docs' }) });
      expect(removed.status).toBe(200);
      expect((await (await fetch(`${url}/api/projects/p1/folders`)).json() as { folders: { name: string }[] }).folders.map((f) => f.name)).toEqual(['assets', 'assets/icons']);
      expect(await readdir(dataRoot)).toEqual([]);
    });
  });

  it('derives implicit parents from cloud files and refuses non-empty deletes', async () => {
    await withViews(async ({ url, files }) => {
      await files.write('p1', 'deep/nested/note.txt', Buffer.from('hello'), 'text/plain');
      const listed = (await (await fetch(`${url}/api/projects/p1/folders`)).json() as { folders: { name: string }[] }).folders.map((f) => f.name);
      expect(listed).toEqual(['deep', 'deep/nested']);
      const blocked = await fetch(`${url}/api/projects/p1/folders`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'deep' }) });
      expect(blocked.status).toBe(409);
      const blockedNested = await fetch(`${url}/api/projects/p1/folders`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'deep/nested' }) });
      expect(blockedNested.status).toBe(409);
      // Creating an already-implicit folder conflicts without resetting anything.
      const dupe = await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'deep' }) });
      expect(dupe.status).toBe(409);
      const gone = await fetch(`${url}/api/projects/p1/folders`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'missing' }) });
      expect(gone.status).toBe(404);
      // Once the file head is deleted the implicit folder stops existing —
      // there is nothing explicit left to delete.
      const revision = (await files.read('p1', 'deep/nested/note.txt'))!.revision;
      await files.delete('p1', 'deep/nested/note.txt', { expectedRevision: revision });
      const removed = await fetch(`${url}/api/projects/p1/folders`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'deep/nested' }) });
      expect(removed.status).toBe(404);
      expect((await (await fetch(`${url}/api/projects/p1/folders`)).json() as { folders: { name: string }[] }).folders).toEqual([]);
      // An explicit folder created after the files are gone deletes cleanly.
      await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'empty/dir' }) });
      const removedExplicit = await fetch(`${url}/api/projects/p1/folders`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'empty/dir' }) });
      expect(removedExplicit.status).toBe(200);
      expect((await (await fetch(`${url}/api/projects/p1/folders`)).json() as { folders: { name: string }[] }).folders.map((f) => f.name)).toEqual(['empty']);
    });
  });

  it('denies foreign/reader requests before any file detail or cloud call', async () => {
    await withViews(async ({ url, fake }) => {
      const callsBefore = fake.calls.length;
      expect((await fetch(`${url}/api/projects/missing/folders`)).status).toBe(404);
      expect((await fetch(`${url}/api/projects/p1/folders`)).status).toBe(403);
      expect((await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })).status).toBe(403);
      expect((await fetch(`${url}/api/projects/p1/search?q=x`)).status).toBe(403);
      expect((await fetch(`${url}/api/projects/p1/text-preview/a.txt`)).status).toBe(403);
      expect((await fetch(`${url}/api/projects/p1/preview-url`)).status).toBe(403);
      expect(fake.calls.length).toBe(callsBefore);
    }, { authorize: async () => false });
    await withViews(async ({ url, fake }) => {
      const callsBefore = fake.calls.length;
      const denied = await fetch(`${url}/api/projects/p1/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
      expect(denied.status).toBe(403);
      expect(fake.calls.length).toBe(callsBefore);
    }, { authorize: async (_req, _res, _id, options) => options.mode === 'read' });
  });

  it('refuses malformed folder metadata instead of resetting it', async () => {
    await withViews(async ({ url, state }) => {
      const damaged: unknown[] = [
        'text', 7, null, [], {}, { version: 2, projectId: 'p1', folders: [] },
        { version: 1, projectId: 'other', folders: [] },
        { version: 1, projectId: 'p1', folders: [{ path: 'a', createdAt: 'now', token: 'x' }] },
        { version: 1, projectId: 'p1', folders: [{ path: 'a/../b', createdAt: 'now' }] },
        { version: 1, projectId: 'p1', folders: [{ path: 'dup', createdAt: 'n' }, { path: 'dup', createdAt: 'n' }] },
      ];
      for (const value of damaged) {
        state.slots.set(folderSlotKey('p1'), value);
        const response = await fetch(`${url}/api/projects/p1/folders`);
        expect(response.status).toBe(503);
        expect((await response.json() as { error: { code: string } }).error.code).toBe('CLOUD_FOLDERS_CORRUPT');
      }
      state.slots.delete(folderSlotKey('p1'));
      expect((await fetch(`${url}/api/projects/p1/folders`)).status).toBe(200);
    });
  });

  it('searches cloud text bytes with query/pattern/max bounds and an explicit scan bound', async () => {
    await withViews(async ({ url, files, fake }) => {
      await files.write('p1', 'notes/a.txt', Buffer.from('alpha\nbeta canvas\ngamma'), 'text/plain');
      await files.write('p1', 'notes/b.md', Buffer.from('canvas again'), 'text/markdown');
      await files.write('p1', 'notes/blob.bin', Buffer.from('canvas binary'), 'application/octet-stream');
      expect((await fetch(`${url}/api/projects/p1/search`)).status).toBe(400);
      const found = await (await fetch(`${url}/api/projects/p1/search?q=canvas`)).json() as { query: string; matches: { file: string; line: number; snippet: string }[] };
      expect(found.query).toBe('canvas');
      expect(found.matches.map((m) => `${m.file}:${m.line}`)).toEqual(['notes/a.txt:2', 'notes/b.md:1']);
      expect(found.matches[0]!.snippet).toBe('beta canvas');
      const patterned = await (await fetch(`${url}/api/projects/p1/search?q=canvas&pattern=${encodeURIComponent('*.txt')}`)).json() as { matches: { file: string }[] };
      expect(patterned.matches.map((m) => m.file)).toEqual(['notes/a.txt']);
      const capped = await (await fetch(`${url}/api/projects/p1/search?q=canvas&max=1`)).json() as { matches: unknown[] };
      expect(capped.matches).toHaveLength(1);
      // A file whose index row claims more than the bound fails explicitly.
      const row = [...fake.documents.values()].find((r) => r.path === 'notes/blob.bin')!;
      fake.documents.set(row.$id, { ...row, mime: 'text/plain', size: 300 * 1024 * 1024 });
      const tooBig = await fetch(`${url}/api/projects/p1/search?q=canvas`);
      expect(tooBig.status).toBe(413);
    });
  });

  it('serves bounded text previews from cloud bytes with no-store and internal-path blocks', async () => {
    await withViews(async ({ url, files, dataRoot }) => {
      const content = '0123456789'.repeat(300);
      await files.write('p1', 'docs/long.txt', Buffer.from(content), 'text/plain');
      const preview = await (await fetch(`${url}/api/projects/p1/text-preview/docs/long.txt?limit=1024`)).json() as { text: string; truncated: boolean; size: number; limit: number; poweredPreview: { required: boolean } };
      expect(preview.truncated).toBe(true);
      expect(preview.limit).toBe(1024);
      expect(preview.size).toBe(3000);
      expect(preview.text).toHaveLength(1024);
      expect(preview.poweredPreview.required).toBe(false);
      const raw = await fetch(`${url}/api/projects/p1/text-preview/docs/long.txt`);
      expect(raw.headers.get('cache-control')).toBe('no-store');
      expect((await fetch(`${url}/api/projects/p1/text-preview/.file-versions/x/manifest.json`)).status).toBe(404);
      expect((await fetch(`${url}/api/projects/p1/text-preview/missing.txt`)).status).toBe(404);
      await files.write('p1', 'app.html', Buffer.from('<html><script>new Worker("w.js")</script></html>'), 'text/html');
      const html = await (await fetch(`${url}/api/projects/p1/text-preview/app.html`)).json() as { poweredPreview: { required: boolean; complete: boolean } };
      expect(html.poweredPreview.required).toBe(true);
      expect(html.poweredPreview.complete).toBe(true);
      expect(await readdir(dataRoot)).toEqual([]);
    });
  });

  it('renders real DOCX preview text through the existing bounded helper', async () => {
    await withViews(async ({ url, files }) => {
      const zip = new JSZip();
      zip.file('word/document.xml', '<w:document><w:p><w:r><w:t>Cloud document preview</w:t></w:r></w:p></w:document>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await files.write('p1', 'docs/report.docx', buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const response = await fetch(`${url}/api/projects/p1/files/${encodeURIComponent('docs/report.docx')}/preview`);
      expect(response.status).toBe(200);
      const preview = await response.json() as { kind: string; sections: { title: string; lines: string[] }[] };
      expect(preview.kind).toBe('document');
      expect(preview.sections[0]!.lines).toContain('Cloud document preview');
      const missing = await fetch(`${url}/api/projects/p1/files/nope.docx/preview`);
      expect(missing.status).toBe(404);
      await files.write('p1', 'plain.txt', Buffer.from('text'), 'text/plain');
      const unsupported = await fetch(`${url}/api/projects/p1/files/plain.txt/preview`);
      expect(unsupported.status).toBe(415);
    });
  });

  it('fails PDF preview explicitly 503 when the native binary cannot extract', async () => {
    await withViews(async ({ url, files }) => {
      await files.write('p1', 'doc.pdf', Buffer.from('%PDF-1.4 fake pdf bytes'), 'application/pdf');
      const response = await fetch(`${url}/api/projects/p1/files/doc.pdf/preview`);
      expect(response.status).toBe(503);
      expect((await response.json() as { error: { code: string } }).error.code).toBe('PREVIEW_UNAVAILABLE');
    });
  });

  it('serves image previews from ephemeral cloud-buffer temp files and honors ETag revalidation', async () => {
    await withViews(async ({ url, files, dataRoot }) => {
      const sharp = (await import('sharp')).default;
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#336699' } }).png().toBuffer();
      await files.write('p1', 'img/photo.png', png, 'image/png');
      const response = await fetch(`${url}/api/projects/p1/preview/image/img/photo.png?odPreviewWidth=256`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('cache-control')).toBe('private, no-cache');
      const body = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(body).metadata();
      expect([meta.format, meta.width]).toEqual(['webp', 256]);
      const etag = response.headers.get('etag')!;
      expect(etag).toContain('cloud-v1-image-256-');
      const revalidated = await fetch(`${url}/api/projects/p1/preview/image/img/photo.png?odPreviewWidth=256`, { headers: { 'if-none-match': etag } });
      expect(revalidated.status).toBe(304);
      // Ephemeral request dirs are unlinked in the handler's finally, which
      // may still be running when the response arrives — poll it away.
      for (let attempt = 0; attempt < 50 && (await readdir(dataRoot)).length > 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await readdir(dataRoot)).toEqual([]);
      const badWidth = await fetch(`${url}/api/projects/p1/preview/image/img/photo.png?odPreviewWidth=333`);
      expect(badWidth.status).toBe(400);
      const wrongKind = await fetch(`${url}/api/projects/p1/preview/video/img/photo.png`);
      expect(wrongKind.status).toBe(415);
    });
  });

  it('reports missing native video tooling explicitly 503, never empty success', async () => {
    await withViews(async ({ url, files }) => {
      await files.write('p1', 'clip.mp4', Buffer.from('not a real mp4'), 'video/mp4');
      const response = await fetch(`${url}/api/projects/p1/preview/poster/clip.mp4`);
      expect(response.status).toBe(503);
      expect((await response.json() as { error: { code: string } }).error.code).toBe('PREVIEW_UNAVAILABLE');
    });
  });

  it('keeps failures sanitized and rejects a preview request without an explicit path', async () => {
    await withViews(async ({ url, fake, state }) => {
      const urlResponse = await fetch(`${url}/api/projects/p1/preview-url`);
      expect(urlResponse.status).toBe(400);
      fake.callError = () => new Error('raw upstream detail with secrets');
      const response = await fetch(`${url}/api/projects/p1/folders`);
      expect(response.status).toBe(502);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.message).not.toContain('secrets');
      fake.callError = undefined;
      state.failRead = new Error('state down');
      expect((await fetch(`${url}/api/projects/p1/folders`)).status).toBe(502);
      state.failRead = undefined;
    });
  });
  it('serves cloud HTML through an opaque preview scope and rechecks revoked authorization',async()=>{
    let allowed=true;
    await withViews(async({url,files})=>{
      await files.write('p1','page.html',Buffer.from('<html><body>Cloud page</body></html>'),'text/html');
      const created=await fetch(`${url}/api/projects/p1/preview-url?file=page.html`);expect(created.status).toBe(200);
      const preview=await created.json() as {url:string;iframeSandbox:string;opaqueOrigin:boolean};
      expect(preview.opaqueOrigin).toBe(true);expect(preview.iframeSandbox).not.toContain('allow-same-origin');
      const page=await fetch(url+preview.url);expect(page.status).toBe(200);expect(await page.text()).toContain('Cloud page');
      expect(page.headers.get('content-security-policy')).toContain("connect-src 'none'");expect(page.headers.get('cache-control')).toBe('private, no-cache');
      allowed=false;expect((await fetch(url+preview.url)).status).toBe(403);
    },{authorize:async()=>allowed});
  });
});
