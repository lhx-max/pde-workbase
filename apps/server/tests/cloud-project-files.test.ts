import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CanvasStateError } from '@bezier/canvas-core';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { AppwriteClient } from '../src/storage/appwrite-client.js';
import { CloudProjectFiles } from '../src/storage/cloud-project-files.js';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

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

/** Structural stand-in for the Appwrite REST surface the service uses:
 * documents collection with the real (canvasId, path) unique index and a
 * blob bucket keyed by immutable file id. No filesystem anywhere. */
class FakeCloud {
  readonly documents = new Map<string, Row>();
  readonly blobs = new Map<string, Uint8Array>();
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  /** Post-processes each list page before it is handed back (corruption tests). */
  pageHook?: (documents: unknown[], request: { cursor: string | null }) => unknown;
  callError: ((method: string, path: string) => Error | undefined) | undefined;
  uploadError: ((fileId: string) => Error | undefined) | undefined;
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
      const total = matched.length;
      matched = matched.sort((a, b) => (a.$id < b.$id ? -1 : a.$id > b.$id ? 1 : 0));
      let cursor: string | null = null;
      for (const query of queries) {
        if (query.method === 'cursorAfter') cursor = String((query.values as unknown[])[0]);
      }
      if (cursor !== null) matched = matched.filter((row) => row.$id > cursor);
      for (const query of queries) {
        if (query.method === 'limit') matched = matched.slice(0, Number((query.values as unknown[])[0]));
      }
      const documents: unknown = this.pageHook ? this.pageHook(matched, { cursor }) : matched;
      return { documents, total } as T;
    }
    if (method === 'GET') {
      const row = this.documents.get(decodeURIComponent(suffix.slice(1)));
      if (!row) throw missing('document not found');
      return row as T;
    }
    if (method === 'POST' && suffix === '') {
      const { documentId, data } = body as { documentId: string; data: Record<string, unknown>; permissions?: string[] };
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
    const injected = this.uploadError?.(fileId);
    if (injected) throw injected;
    if (this.blobs.has(fileId)) throw conflict('storage file already exists');
    this.blobs.set(fileId, new Uint8Array(bytes));
    return { $id: fileId };
  }

  async download(path: string): Promise<Uint8Array> {
    const fileId = decodeURIComponent(path.split('/').at(-2) ?? '');
    const injected = this.downloadError?.(fileId);
    if (injected) throw injected;
    const bytes = this.blobs.get(fileId);
    if (!bytes) throw missing('storage file not found');
    return new Uint8Array(bytes);
  }
}

/** In-memory JsonStatePort double; staged writes are visible to reads
 * immediately, matching the real port's contract. */
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

function fixture() {
  const fake = new FakeCloud();
  const client = new AppwriteClient({ endpoint: 'https://cloud.example/v1', projectId: 'p', apiKey: 'k' });
  vi.spyOn(client, 'call').mockImplementation((method, path, body) => fake.call(method, path, body) as never);
  vi.spyOn(client, 'download').mockImplementation((path) => fake.download(path));
  vi.spyOn(client, 'upload').mockImplementation((bucket, fileId, name, bytes, mime) => fake.upload(bucket, fileId, name, bytes, mime));
  const state = new FakeStatePort();
  const files = () => new CloudProjectFiles(client, 'db', 'bucket', state);
  return { fake, client, state, files };
}

function seedRow(fake: FakeCloud, projectId: string, path: string, bytes: Uint8Array, over: Partial<Row> = {}): Row {
  const fileId = `seed-${sha(bytes).slice(0, 30)}`;
  fake.blobs.set(fileId, new Uint8Array(bytes));
  const row: Row = {
    $id: `row-${sha(`${projectId}${path}${fake.documents.size}`).slice(0, 24)}`,
    canvasId: projectId,
    path,
    fileId,
    kind: 'text',
    mime: 'text/plain',
    size: bytes.byteLength,
    sha256: sha(bytes),
    createdAt: new Date('2026-10-20T00:00:00Z').toISOString(),
    ...over,
  };
  fake.documents.set(row.$id, row);
  return row;
}

const headSha = async (files: CloudProjectFiles, projectId: string, path: string) =>
  (await files.read(projectId, path))!.revision;

describe('cloud project files: canonical index + immutable blobs + version history', () => {
  it('round-trips arbitrary binary content through the canonical index', async () => {
    const { files, fake } = fixture();
    const service = files();
    const bytes = randomBytes(64 * 1024);
    const saved = await service.write('p1', 'assets/blob.bin', bytes, 'application/octet-stream');
    expect(saved).toMatchObject({ path: 'assets/blob.bin', type: 'file', kind: 'binary', size: bytes.byteLength, mime: 'application/octet-stream' });
    const row = [...fake.documents.values()][0]!;
    expect(row.$id).toMatch(/^pf-[a-f0-9]{30}$/);
    expect(row.fileId).toMatch(/^pfv-[a-f0-9]{32}$/);
    expect(row.sha256).toBe(sha(bytes));
    const result = await service.read('p1', 'assets/blob.bin');
    expect(result?.buffer.equals(Buffer.from(bytes))).toBe(true);
    expect(result?.revision).toBe(sha(bytes));
    expect((await service.list('p1'))[0]).toMatchObject({ path: 'assets/blob.bin', size: bytes.byteLength });
    expect(await service.read('p1', 'missing.bin')).toBeNull();
    // Fresh instance reconstructs purely from cloud data — no filesystem.
    const rebuilt = files();
    expect((await rebuilt.read('p1', 'assets/blob.bin'))?.buffer.equals(Buffer.from(bytes))).toBe(true);
  });

  it('enforces baseline: overwrite needs expectedRevision (428), stale is 409, createOnly is 409', async () => {
    const { files } = fixture();
    const service = files();
    await service.write('p1', 'a.txt', Buffer.from('v1'), 'text/plain');
    const r1 = await headSha(service, 'p1', 'a.txt');
    await expect(service.write('p1', 'a.txt', Buffer.from('v2'), 'text/plain')).rejects.toMatchObject({ status: 428 });
    await expect(service.write('p1', 'a.txt', Buffer.from('v2'), 'text/plain', { expectedRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(service.write('p1', 'a.txt', Buffer.from('v2'), 'text/plain', { createOnly: true })).rejects.toMatchObject({ status: 409 });
    const updated = await service.write('p1', 'a.txt', Buffer.from('v2'), 'text/plain', { expectedRevision: r1 });
    expect(updated.size).toBe(2);
    expect((await service.read('p1', 'a.txt'))?.buffer.toString()).toBe('v2');
    // A baseline for a missing head is a conflict, not a create.
    await expect(service.write('p1', 'new.txt', Buffer.from('x'), 'text/plain', { expectedRevision: r1 })).rejects.toMatchObject({ status: 409 });
    // New paths never need a baseline.
    await service.write('p1', 'new.txt', Buffer.from('x'), 'text/plain', { createOnly: true });
  });

  it('keeps version history: readVersion returns immutable bytes, restore rewinds the head', async () => {
    const { files } = fixture();
    const service = files();
    await service.write('p1', 'doc.md', Buffer.from('first'), 'text/markdown');
    const r1 = await headSha(service, 'p1', 'doc.md');
    await service.write('p1', 'doc.md', Buffer.from('second'), 'text/markdown', { expectedRevision: r1 });
    const r2 = await headSha(service, 'p1', 'doc.md');

    const versions = await service.versions('p1', 'doc.md');
    expect(versions).toHaveLength(2);
    expect(versions[0]!.source).toBe('manual');
    expect(versions[1]!.parentVersionId).toBe(versions[0]!.id);

    const old = await service.readVersion('p1', 'doc.md', versions[0]!.id);
    expect(old.buffer.toString()).toBe('first');
    await expect(service.readVersion('p1', 'doc.md', 'v-' + 'f'.repeat(32))).rejects.toMatchObject({ status: 404 });
    await expect(service.readVersion('p1', 'doc.md', '../x')).rejects.toMatchObject({ status: 400 });

    await expect(service.restore('p1', 'doc.md', versions[0]!.id, { expectedRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(service.restore('p1', 'doc.md', versions[0]!.id)).rejects.toMatchObject({ status: 428 });
    const restored = await service.restore('p1', 'doc.md', versions[0]!.id, { expectedRevision: r2 });
    expect(restored.size).toBe(5);
    expect((await service.read('p1', 'doc.md'))?.buffer.toString()).toBe('first');
    const after = await service.versions('p1', 'doc.md');
    expect(after).toHaveLength(3);
    expect(after.at(-1)).toMatchObject({ source: 'restore', parentVersionId: versions[0]!.id, fileId: versions[0]!.fileId });
  });

  it('lets two projects share original bytes; editing one never deletes storage blobs', async () => {
    const { files, fake } = fixture();
    const service = files();
    const bytes = Buffer.from('shared original bytes');
    await service.write('p1', 'shared.bin', bytes, 'application/octet-stream');
    await service.write('p2', 'shared.bin', bytes, 'application/octet-stream');
    const p1v1 = (await service.versions('p1', 'shared.bin'))[0]!;
    const p1r1 = await headSha(service, 'p1', 'shared.bin');

    await service.write('p1', 'shared.bin', Buffer.from('p1 edit'), 'application/octet-stream', { expectedRevision: p1r1 });
    expect((await service.read('p2', 'shared.bin'))?.buffer.toString()).toBe('shared original bytes');
    expect((await service.readVersion('p1', 'shared.bin', p1v1.id))?.buffer.toString()).toBe('shared original bytes');
    expect((await service.read('p1', 'shared.bin'))?.buffer.toString()).toBe('p1 edit');
    expect(fake.calls.filter((call) => call.method === 'DELETE' && call.path.startsWith('/storage/'))).toEqual([]);
  });

  it('paginates beyond one 100-row page in $id order', async () => {
    const { fake, files } = fixture();
    for (let i = 0; i < 230; i += 1) {
      seedRow(fake, 'big', `dir/file-${String(i).padStart(4, '0')}.txt`, Buffer.from(`content-${i}`), { $id: `row-${String(i).padStart(4, '0')}` });
    }
    seedRow(fake, 'other-project', 'dir/foreign.txt', Buffer.from('nope'));
    const listed = await files().list('big');
    expect(listed).toHaveLength(230);
    expect(listed[0]!.path).toBe('dir/file-0000.txt');
    expect(listed.at(-1)!.path).toBe('dir/file-0229.txt');
  });

  it.each([
    ['invalid page', (page: unknown[]) => ({ notDocuments: page })],
    ['non-array documents', () => 'broken'],
    ['duplicate row id', (page: unknown[]) => [...page, page[0]]],
    ['mismatched canvas', (page: unknown[]) => page.map((row) => ({ ...(row as Row), canvasId: 'intruder' }))],
    ['missing fields', (page: unknown[]) => [...page, { $id: 'zz-bad', canvasId: 'big' }]],
  ])('fails 503 on %s', async (_label, hook) => {
    const { fake, files } = fixture();
    for (let i = 0; i < 3; i += 1) {
      seedRow(fake, 'big', `f-${i}.txt`, Buffer.from('x'), { $id: `row-${i}` });
    }
    fake.pageHook = (documents) => hook(documents);
    await expect(files().list('big')).rejects.toMatchObject({ status: 503 });
  });

  it('fails 503 when pagination stalls', async () => {
    const { fake, files } = fixture();
    for (let i = 0; i < 150; i += 1) {
      seedRow(fake, 'big', `f-${String(i).padStart(3, '0')}.txt`, Buffer.from('x'), { $id: `row-${String(i).padStart(3, '0')}` });
    }
    const firstPage = [...fake.documents.values()].slice(0, 100);
    fake.pageHook = (_documents, request) => (request.cursor === null ? _documents : firstPage);
    await expect(files().list('big')).rejects.toMatchObject({ status: 503 });
  });

  it('verifies size and sha256 of downloaded bytes', async () => {
    const { fake, files } = fixture();
    const service = files();
    await service.write('p1', 'a.bin', Buffer.from('real bytes'), 'application/octet-stream');
    const row = [...fake.documents.values()][0]!;
    fake.blobs.set(row.fileId, Buffer.from('tampered!!'));
    await expect(service.read('p1', 'a.bin')).rejects.toMatchObject({ status: 503, code: 'CANVAS_FILES_CORRUPT' });
    fake.blobs.set(row.fileId, Buffer.from('real bytes'));
    fake.documents.set(row.$id, { ...row, size: 999 });
    await expect(service.read('p1', 'a.bin')).rejects.toMatchObject({ status: 503 });
  });

  it('treats index rows without integrity metadata as explicitly unavailable', async () => {
    const { fake, files } = fixture();
    const service = files();
    const row = seedRow(fake, 'p1', 'legacy.bin', Buffer.from('old'));
    const stripped: Partial<Row> = { ...row };
    delete stripped.sha256;
    fake.documents.set(row.$id, stripped as Row);
    await expect(service.read('p1', 'legacy.bin')).rejects.toMatchObject({ status: 503, code: 'CANVAS_FILES_UNAVAILABLE' });
  });

  it('never reports success on upload, index or state failures', async () => {
    const { fake, state, files } = fixture();
    const service = files();
    fake.uploadError = () => new CanvasStateError(502, 'CANVAS_STORAGE_ERROR', 'upload failed');
    await expect(service.write('p1', 'a.txt', Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ status: 502 });
    expect(fake.documents.size).toBe(0);

    fake.uploadError = undefined;
    fake.callError = (method, path) => (method === 'POST' && path.startsWith(fake.docsBase) ? new CanvasStateError(502, 'CANVAS_STORAGE_ERROR', 'index failed') : undefined);
    await expect(service.write('p1', 'a.txt', Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ status: 502 });
    expect(fake.documents.size).toBe(0);
    expect(await service.read('p1', 'a.txt')).toBeNull();

    fake.callError = undefined;
    state.failFlush = new Error('flush failed');
    await expect(service.write('p1', 'a.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow('flush failed');
    // The canonical head is only updated after history persistence lands.
    expect(fake.documents.size).toBe(0);
    state.failFlush = undefined;
    await service.write('p1', 'a.txt', Buffer.from('x'), 'text/plain');
    expect(fake.documents.size).toBe(1);
  });

  it('rejects traversal and malformed inputs before touching the index', async () => {
    const { files, fake } = fixture();
    const service = files();
    for (const bad of ['../escape.bin', 'a/../../b.bin', '/abs.bin', 'a//b.bin', 'a/./b.bin', '']) {
      await expect(service.write('p1', bad, Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ status: 400 });
      await expect(service.read('p1', bad)).rejects.toMatchObject({ status: 400 });
      await expect(service.delete('p1', bad)).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.write('p1', 'a.txt', new Uint8Array(30_000_001), 'text/plain')).rejects.toMatchObject({ status: 400 });
    await expect(service.write('p1', 'a.txt', Buffer.from('x'), 'not-a-mime')).rejects.toMatchObject({ status: 400 });
    expect(fake.documents.size).toBe(0);
    expect(fake.calls).toEqual([]);
  });
  it('stores a legitimate empty text file and recovers it from a new service',async()=>{
    const f=fixture();await f.files().write('p1','blank.txt',new Uint8Array(0),'text/plain');
    const reopened=await f.files().read('p1','blank.txt');expect(reopened?.buffer.length).toBe(0);expect(reopened?.file.size).toBe(0);
  });

  it('records externally changed heads into history on versions() and dedupes re-recordings', async () => {
    const { fake, state, files } = fixture();
    const service = files();
    await service.write('p1', 'a.txt', Buffer.from('ours'), 'text/plain');
    const flushes = state.flushes;
    // Another internal writer rewrote the head behind this service.
    const row = [...fake.documents.values()][0]!;
    const external = Buffer.from('external content');
    const externalFileId = `ext-${sha(external).slice(0, 30)}`;
    fake.blobs.set(externalFileId, new Uint8Array(external));
    fake.documents.set(row.$id, { ...row, fileId: externalFileId, sha256: sha(external), size: external.byteLength });

    const versions = await service.versions('p1', 'a.txt');
    expect(versions).toHaveLength(2);
    expect(versions.at(-1)!.fileId).toBe(externalFileId);
    expect(state.flushes).toBeGreaterThan(flushes);
    // Idempotent: the already-recorded head is not appended twice.
    expect((await service.versions('p1', 'a.txt'))).toHaveLength(2);
    expect((await service.readVersion('p1', 'a.txt', versions.at(-1)!.id)).buffer.toString()).toBe('external content');
  });

  it('fails closed on malformed history documents', async () => {
    const { state, files } = fixture();
    const service = files();
    await service.write('p1', 'a.txt', Buffer.from('x'), 'text/plain');
    const slot = [...state.slots.keys()][0]!;
    expect(slot).toMatch(/^file-versions:[a-f0-9]{64}$/);
    const damaged: unknown[] = [
      'text', 7, null, [], {}, { version: 2, projectId: 'p1', entries: {} },
      { version: 1, projectId: 'other', entries: {} },
      { version: 1, projectId: 'p1', entries: { 'a.txt': { versions: [{ id: 'v-x', fileId: 'f', sha256: 'x', size: 0, mime: 'text/plain', createdAt: 'now', source: 'manual' }] } } },
      { version: 1, projectId: 'p1', entries: { 'a.txt': { versions: [{ id: 'v-' + 'a'.repeat(32), fileId: 'f', sha256: 'a'.repeat(64), size: 0, mime: 'text/plain', createdAt: '2026-01-01T00:00:00.000Z', source: 'manual', credentials: 'x' }] } } },
      { version: 1, projectId: 'p1', entries: { 'a/../b': { versions: [] } } },
    ];
    for (const value of damaged) {
      state.slots.set(slot, value);
      await expect(service.versions('p1', 'a.txt')).rejects.toMatchObject({ status: 503, code: 'CANVAS_FILES_HISTORY_CORRUPT' });
    }
    state.slots.delete(slot);
    // History resets to empty, then the live index head is re-recorded once.
    const rebuilt = await service.versions('p1', 'a.txt');
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]!.source).toBe('manual');
  });

  it('moves head + history on rename and preserves history across delete', async () => {
    const { fake, files } = fixture();
    const service = files();
    await service.write('p1', 'old/a.txt', Buffer.from('v1'), 'text/plain');
    const r1 = await headSha(service, 'p1', 'old/a.txt');
    await service.write('p1', 'taken.txt', Buffer.from('other'), 'text/plain');

    await expect(service.rename('p1', 'old/a.txt', 'new/b.txt')).rejects.toMatchObject({ status: 428 });
    await expect(service.rename('p1', 'old/a.txt', 'new/b.txt', { expectedRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(service.rename('p1', 'old/a.txt', 'taken.txt', { expectedRevision: r1 })).rejects.toMatchObject({ status: 409 });

    const moved = await service.rename('p1', 'old/a.txt', 'new/b.txt', { expectedRevision: r1 });
    expect(moved.path).toBe('new/b.txt');
    expect(await service.read('p1', 'old/a.txt')).toBeNull();
    expect((await service.read('p1', 'new/b.txt'))?.buffer.toString()).toBe('v1');
    expect(await service.versions('p1', 'old/a.txt')).toHaveLength(0);
    const movedVersions = await service.versions('p1', 'new/b.txt');
    expect(movedVersions.length).toBeGreaterThanOrEqual(1);
    const versionId = movedVersions[0]!.id;
    expect((await service.readVersion('p1', 'new/b.txt', versionId)).buffer.toString()).toBe('v1');

    const head = await headSha(service, 'p1', 'new/b.txt');
    await expect(service.delete('p1', 'new/b.txt')).rejects.toMatchObject({ status: 428 });
    await expect(service.delete('p1', 'new/b.txt', { expectedRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
    await service.delete('p1', 'new/b.txt', { expectedRevision: head });
    expect(await service.read('p1', 'new/b.txt')).toBeNull();
    expect((await service.list('p1')).map((f) => f.path)).toEqual(['taken.txt']);
    // Immutable blobs survive index deletion; history still serves old bytes.
    expect((await service.readVersion('p1', 'new/b.txt', versionId)).buffer.toString()).toBe('v1');
    expect(fake.calls.filter((call) => call.method === 'DELETE' && call.path.startsWith('/storage/'))).toEqual([]);
    await expect(service.delete('p1', 'new/b.txt', { expectedRevision: head })).rejects.toMatchObject({ status: 404 });
  });

  it('serializes writes per project/path so a stale concurrent baseline fails closed', async () => {
    const { files } = fixture();
    const service = files();
    await service.write('p1', 'a.txt', Buffer.from('v1'), 'text/plain');
    const r1 = await headSha(service, 'p1', 'a.txt');
    const results = await Promise.allSettled([
      service.write('p1', 'a.txt', Buffer.from('v2'), 'text/plain', { expectedRevision: r1 }),
      service.write('p1', 'a.txt', Buffer.from('v3'), 'text/plain', { expectedRevision: r1 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ status: 409 });
    // Other projects/paths are unaffected.
    await service.write('p1', 'b.txt', Buffer.from('parallel'), 'text/plain');
    await service.write('p2', 'a.txt', Buffer.from('parallel'), 'text/plain');
  });

  it('creates explicit manual HTML snapshots whose label/prompt survive the typed codec', async () => {
    const { files } = fixture();
    const service = files();
    await service.write('p1', 'page.html', Buffer.from('<html>v1</html>'), 'text/html');
    const head = await headSha(service, 'p1', 'page.html');

    const created = await service.createVersion('p1', 'page.html', {
      label: 'Hero draft', prompt: 'make it pop', source: 'manual',
    });
    expect(created).toMatchObject({
      source: 'manual', promptSource: 'manual', label: 'Hero draft', prompt: 'make it pop',
      fileId: created.fileId, sha256: sha('<html>v1</html>'),
      size: Buffer.byteLength('<html>v1</html>'), mime: 'text/html',
    });
    expect(created.id).toMatch(/^v-[a-f0-9]{32}$/);

    // Fresh service over the same typed JSON slot sees the metadata verbatim.
    const rebuilt = files();
    const listed = await rebuilt.versions('p1', 'page.html');
    expect(listed).toHaveLength(2);
    const snapshot = listed.find((version) => version.id === created.id)!;
    expect(snapshot).toMatchObject({ label: 'Hero draft', prompt: 'make it pop', source: 'manual', promptSource: 'manual' });
    expect(listed[0]!.label).toBeUndefined();
    expect((await rebuilt.readVersion('p1', 'page.html', created.id)).buffer.toString()).toBe('<html>v1</html>');
    // Snapshotting moves no bytes — the canonical head revision is untouched.
    expect((await rebuilt.read('p1', 'page.html'))?.revision).toBe(head);
  });

  it('bounds snapshots: html-only, optional baseline, strict metadata before state write', async () => {
    const { files, state } = fixture();
    const service = files();
    await service.write('p1', 'page.html', Buffer.from('<html>v1</html>'), 'text/html');
    await service.write('p1', 'other.html', Buffer.from('<html>o</html>'), 'text/html');
    await service.write('p1', 'note.txt', Buffer.from('plain'), 'text/plain');
    const head = await headSha(service, 'p1', 'page.html');
    const foreignVersion = (await service.versions('p1', 'other.html'))[0]!;
    const slot = [...state.slots.keys()][0]!;
    const persistedBefore = JSON.stringify(state.slots.get(slot));

    // Same html-only gate as the legacy surface; missing heads are 404.
    await expect(service.createVersion('p1', 'note.txt', {})).rejects.toMatchObject({ status: 400 });
    await expect(service.createVersion('p1', 'ghost.html', {})).rejects.toMatchObject({ status: 404 });
    // Optional baseline: stale fails 409 — nothing is overwritten anyway.
    await expect(service.createVersion('p1', 'page.html', { expectedRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
    const malformed: unknown[] = [
      { label: 'x'.repeat(201) },
      { prompt: 'y'.repeat(4097) },
      { source: 'robot' },
      { promptSource: 'elsewhere' },
      { parentVersionId: 'not-a-version' },
      { expectedRevision: '' },
      { label: 7 },
      { prompt: { text: 'x' } },
      // Unknown fields are rejected — never silently adopted into history.
      { origin: 'evil' },
      { contentPath: '/tmp/x' },
    ];
    for (const options of malformed) {
      await expect(service.createVersion('p1', 'page.html', options as never)).rejects.toMatchObject({ status: 400 });
    }
    // A well-formed parent from ANOTHER path's history is crossfile lineage.
    await expect(service.createVersion('p1', 'page.html', { parentVersionId: foreignVersion.id })).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(state.slots.get(slot))).toBe(persistedBefore);

    // Same-path parent + matching baseline succeed.
    const first = (await service.versions('p1', 'page.html'))[0]!;
    const child = await service.createVersion('p1', 'page.html', { expectedRevision: head, parentVersionId: first.id });
    expect(child.parentVersionId).toBe(first.id);
    expect(child.sha256).toBe(head);
  });

  it('keeps snapshot bytes immutable across later writes, restore and rename', async () => {
    const { files } = fixture();
    const service = files();
    await service.write('p1', 'page.html', Buffer.from('<html>v1</html>'), 'text/html');
    const r1 = await headSha(service, 'p1', 'page.html');
    const snap = await service.createVersion('p1', 'page.html', { label: 'Release A' });

    await service.write('p1', 'page.html', Buffer.from('<html>v2</html>'), 'text/html', { expectedRevision: r1 });
    const r2 = await headSha(service, 'p1', 'page.html');
    const list = await service.versions('p1', 'page.html');
    await service.restore('p1', 'page.html', list[0]!.id, { expectedRevision: r2 });
    expect((await service.read('p1', 'page.html'))?.buffer.toString()).toBe('<html>v1</html>');
    expect((await service.readVersion('p1', 'page.html', snap.id)).buffer.toString()).toBe('<html>v1</html>');

    // Rename carries labels and provenance with the moved history.
    const head = await headSha(service, 'p1', 'page.html');
    await service.rename('p1', 'page.html', 'moved.html', { expectedRevision: head });
    const moved = await service.versions('p1', 'moved.html');
    expect(moved.find((version) => version.id === snap.id)).toMatchObject({ label: 'Release A' });
    expect(moved.find((version) => version.source === 'restore')).toMatchObject({ parentVersionId: list[0]!.id });
  });

  it('accepts ai provenance on snapshots while staying validated', async () => {
    const { files } = fixture();
    const service = files();
    await service.write('p1', 'page.html', Buffer.from('<html>ai</html>'), 'text/html');
    const created = await service.createVersion('p1', 'page.html', { source: 'ai', prompt: 'run output' });
    expect(created.source).toBe('ai');
    // An explicit prompt marks the checkpoint 'manual' like the legacy route.
    expect(created.promptSource).toBe('manual');
    const listed = await files().versions('p1', 'page.html');
    expect(listed.find((version) => version.id === created.id)).toMatchObject({ source: 'ai', prompt: 'run output' });
  });

  it('reports failure when the history flush fails — never a fake success', async () => {
    const { state, files } = fixture();
    const service = files();
    await service.write('p1', 'page.html', Buffer.from('<html>v1</html>'), 'text/html');
    state.failFlush = new Error('flush failed');
    await expect(service.createVersion('p1', 'page.html', { label: 'nope' })).rejects.toThrow('flush failed');
    state.failFlush = undefined;
    // The failure never moved the canonical head.
    expect((await service.read('p1', 'page.html'))?.buffer.toString()).toBe('<html>v1</html>');
  });

  it('fails closed on malformed new version metadata in stored history', async () => {
    const { state, files } = fixture();
    const service = files();
    await service.write('p1', 'page.html', Buffer.from('<html>v1</html>'), 'text/html');
    const slot = [...state.slots.keys()][0]!;
    const base = {
      id: `v-${'a'.repeat(32)}`, fileId: `pfv-${'a'.repeat(28)}`, sha256: 'a'.repeat(64),
      size: 12, mime: 'text/html', createdAt: '2026-01-01T00:00:00.000Z', source: 'manual',
    };
    const damaged: unknown[] = [
      { ...base, label: 7 },
      { ...base, label: 'x'.repeat(201) },
      { ...base, prompt: 42 },
      { ...base, promptSource: 'elsewhere' },
      { ...base, source: 'robot' },
      { ...base, unknownField: 'x' },
    ];
    for (const entry of damaged) {
      state.slots.set(slot, { version: 1, projectId: 'p1', entries: { 'page.html': { versions: [entry] } } });
      await expect(service.versions('p1', 'page.html')).rejects.toMatchObject({ status: 503, code: 'CANVAS_FILES_HISTORY_CORRUPT' });
    }
  });
});

describe('Root exact head and history map regressions',()=>{
 it('rejects a backend head response from another project or path before download',async()=>{
  for(const foreign of [{canvasId:'p2',path:'a.txt'},{canvasId:'p1',path:'b.txt'}]){
   const {files,fake,client}=fixture();const row=seedRow(fake,foreign.canvasId,foreign.path,Buffer.from('private'));
   vi.mocked(client.call).mockResolvedValue({documents:[row]} as never);const download=vi.mocked(client.download);download.mockClear();
   await expect(files().read('p1','a.txt')).rejects.toMatchObject({status:503,code:'CANVAS_FILES_CORRUPT'});expect(download).not.toHaveBeenCalled();
  }
 });
 it('round trips names inherited by ordinary object maps without losing or aliasing history',async()=>{
  const {files}=fixture();
  for(const name of ['__proto__','constructor','toString']){
   const service=files();await service.write('p1',name,Buffer.from(name),'text/plain');
   const versions=await files().versions('p1',name);expect(versions).toHaveLength(1);
   expect((await files().readVersion('p1',name,versions[0]!.id)).buffer.toString()).toBe(name);
  }
 });
});
