import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { CanvasStateError } from '@bezier/canvas-core';
import type { ProjectFile } from '@bezier/contracts';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { AppwriteClient } from '../src/storage/appwrite-client.js';
import type { ImageFileStorage } from '../src/storage/cloud-image-files.js';
import {
  CloudToolArtifactFiles,
  type ArtifactWrite,
  type CloudToolArtifactFilesOptions,
  type Scope,
} from '../src/storage/cloud-tool-artifact-files.js';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const utf8 = (text: string) => new TextEncoder().encode(text);

/** In-memory JsonStatePort double (fixture): staged writes are visible to
 * reads immediately, matching the real port contract; `slots` can be shared
 * across instances to model the durable cloud view. */
class FakeStatePort implements JsonStatePort {
  readonly ready: Promise<void> = Promise.resolve();
  flushes = 0;
  reads = 0;
  failRead: Error | undefined;
  failWrite: Error | undefined;
  failFlush: Error | undefined;
  constructor(readonly slots = new Map<string, unknown>()) {}
  read(key: string): unknown {
    this.reads += 1;
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

/** Injected ImageFileStorage fixture: (projectId, path) -> immutable bytes.
 * Rejects a different payload at an occupied path like CloudImageFiles does. */
class FakeImageStorage implements ImageFileStorage {
  writes = 0;
  reads = 0;
  failWrite: Error | undefined;
  nameOverride: string | undefined;
  constructor(readonly files = new Map<string, { bytes: Uint8Array; mime: string }>()) {}
  private key(projectId: string, path: string) {
    return `${projectId}${path}`;
  }
  private meta(path: string, size: number, mime: string): ProjectFile {
    return { name: this.nameOverride ?? path, path, type: 'file', size, mtime: 0, kind: 'image', mime };
  }
  async write(projectId: string, path: string, bytes: Uint8Array, mime: string): Promise<ProjectFile> {
    this.writes += 1;
    if (this.failWrite) throw this.failWrite;
    const existing = this.files.get(this.key(projectId, path));
    if (existing) {
      if (existing.mime !== mime || sha(existing.bytes) !== sha(bytes)) {
        throw new CanvasStateError(409, 'CANVAS_IMAGE_CONTENT_CHANGED', 'different content already occupies this path');
      }
    } else {
      this.files.set(this.key(projectId, path), { bytes: new Uint8Array(bytes), mime });
    }
    return this.meta(path, bytes.byteLength, mime);
  }
  async read(projectId: string, path: string) {
    this.reads += 1;
    const stored = this.files.get(this.key(projectId, path));
    if (!stored) return null;
    return { buffer: Buffer.from(stored.bytes), file: this.meta(path, stored.bytes.byteLength, stored.mime) };
  }
  async list(): Promise<ProjectFile[]> {
    return [];
  }
}

interface StoredIndex {
  schemaVersion: string;
  scope: Scope;
  artifact: {
    id: string;
    role: string;
    path: string;
    mime: string;
    byteLength: number;
    sha256: string;
    width?: number;
    height?: number;
  };
  fileId?: string;
  storage: string;
}

const SCOPE_A: Scope = { namespace: 'tenant-a.biz_1', projectId: 'proj-1' };
const SCOPE_B: Scope = { namespace: 'tenant-b', projectId: 'proj-1' };
const SCOPE_A2: Scope = { namespace: 'tenant-a.biz_1', projectId: 'proj-2' };

function fixture(options: {
  authorize?: (scope: Scope, mode: 'read' | 'write') => Promise<void>;
  slots?: Map<string, unknown>;
  blobs?: Map<string, Uint8Array>;
  imageFiles?: Map<string, { bytes: Uint8Array; mime: string }>;
} = {}) {
  const blobs = options.blobs ?? new Map<string, Uint8Array>();
  const client = new AppwriteClient({ endpoint: 'https://cloud.example/v1', projectId: 'p', apiKey: 'k' });
  vi.spyOn(client, 'upload').mockImplementation(async (_bucket, fileId, _name, bytes) => {
    if (blobs.has(fileId)) throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'storage file already exists');
    blobs.set(fileId, new Uint8Array(bytes));
    return { $id: fileId };
  });
  vi.spyOn(client, 'download').mockImplementation(async (path) => {
    const fileId = decodeURIComponent(path.split('/').at(-2) ?? '');
    const bytes = blobs.get(fileId);
    if (!bytes) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'storage file not found');
    return new Uint8Array(bytes);
  });
  const state = new FakeStatePort(options.slots);
  const images = new FakeImageStorage(options.imageFiles);
  const authorize = options.authorize ?? (async () => undefined);
  const store = () => new CloudToolArtifactFiles({ client, state, bucketId: 'tool-artifacts', images, authorize });
  return { client, state, images, blobs, authorize, store };
}

const rasterCache = new Map<string, Promise<Buffer>>();
function raster(format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  let cached = rasterCache.get(format);
  if (!cached) {
    cached = sharp({ create: { width: 16, height: 8, channels: 3, background: '#336699' } })[format]().toBuffer();
    rasterCache.set(format, cached);
  }
  return cached;
}
const svgBytes = () => utf8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="#36c"/></svg>');
const jsonBytes = () => utf8(JSON.stringify({ layers: [{ id: 'l1', values: [1, 2, 3] }] }));

function write(id: string, role: string, path: string, mime: string, content: Uint8Array, dims?: { width: number; height: number }): ArtifactWrite {
  const input: ArtifactWrite = { id, role: role as ArtifactWrite['role'], path, mime, content };
  if (dims) {
    input.width = dims.width;
    input.height = dims.height;
  }
  return input;
}

const slotKey = (scope: Scope, path: string) => `image-tool-file-${sha(JSON.stringify([scope.namespace, scope.projectId, path])).slice(0, 40)}`;
const blobId = (scope: Scope, path: string, sha256: string) => `tla-${sha(JSON.stringify([scope.namespace, scope.projectId, path, sha256])).slice(0, 30)}`;

describe('CloudToolArtifactFiles', () => {
  it('routes PNG/SVG through the injected image storage and JSON through the configured bucket', async () => {
    const f = fixture();
    const store = f.store();
    const png = await raster('png');
    const savedPng = await store.put(SCOPE_A, write('out-1', 'result', 'outputs/run/a.png', 'image/png', png, { width: 16, height: 8 }));
    expect(savedPng).toEqual({
      id: 'out-1', role: 'result', path: 'outputs/run/a.png', mime: 'image/png',
      byteLength: png.byteLength, sha256: sha(png), width: 16, height: 8,
    });
    expect(f.images.writes).toBe(1);
    expect(f.client.upload).not.toHaveBeenCalled();

    const svg = svgBytes();
    const savedSvg = await store.put(SCOPE_A, write('vec-1', 'vector', 'outputs/run/v.svg', 'image/svg+xml', svg));
    expect(savedSvg.mime).toBe('image/svg+xml');
    expect(f.images.writes).toBe(2);
    expect(f.client.upload).not.toHaveBeenCalled();

    const json = jsonBytes();
    const savedJson = await store.put(SCOPE_A, write('edit-1', 'edit-state', 'outputs/run/edit.json', 'application/json', json));
    expect(savedJson).toEqual({
      id: 'edit-1', role: 'edit-state', path: 'outputs/run/edit.json', mime: 'application/json',
      byteLength: json.byteLength, sha256: sha(json),
    });
    expect(f.client.upload).toHaveBeenCalledTimes(1);
    const [bucket, fileId, name, , mime] = vi.mocked(f.client.upload).mock.calls[0]!;
    expect(bucket).toBe('tool-artifacts');
    expect(fileId).toBe(blobId(SCOPE_A, 'outputs/run/edit.json', sha(json)));
    expect(fileId).toMatch(/^tla-[a-f0-9]{30}$/);
    expect(name).toBe('edit.json');
    expect(mime).toBe('application/json');

    // The state port carried every index write and flush.
    expect(f.state.flushes).toBe(3);
    expect(f.state.slots.size).toBe(3);
    const imageRecord = f.state.slots.get(slotKey(SCOPE_A, 'outputs/run/a.png')) as StoredIndex;
    expect(imageRecord).toMatchObject({ schemaVersion: 'image-tool-file/v1', scope: SCOPE_A, storage: 'image' });
    expect(imageRecord.fileId).toBeUndefined();
    expect(imageRecord.artifact).toEqual(savedPng);
    const blobRecord = f.state.slots.get(slotKey(SCOPE_A, 'outputs/run/edit.json')) as StoredIndex;
    expect(blobRecord).toMatchObject({ schemaVersion: 'image-tool-file/v1', scope: SCOPE_A, storage: 'blob', fileId });
    expect(blobRecord.artifact).toEqual(savedJson);
    const svgRecord = f.state.slots.get(slotKey(SCOPE_A, 'outputs/run/v.svg')) as StoredIndex;
    expect(svgRecord.storage).toBe('image');
    // Returned artifacts are clones: caller mutation cannot corrupt the index.
    savedJson.sha256 = 'tampered';
    const reread = await store.read(SCOPE_A, 'outputs/run/edit.json');
    expect(reread?.artifact.sha256).toBe(sha(json));
  });

  it('reads identical bytes back through a fresh adapter over the saved records (fixture durability)', async () => {
    const slots = new Map<string, unknown>();
    const blobs = new Map<string, Uint8Array>();
    const imageFiles = new Map<string, { bytes: Uint8Array; mime: string }>();
    const first = fixture({ slots, blobs, imageFiles });
    const a = first.store();
    const png = await raster('png');
    const svg = svgBytes();
    const json = jsonBytes();
    await a.put(SCOPE_A, write('p1', 'result', 'outputs/a.png', 'image/png', png, { width: 16, height: 8 }));
    await a.put(SCOPE_A, write('v1', 'vector', 'outputs/v.svg', 'image/svg+xml', svg));
    await a.put(SCOPE_A, write('e1', 'edit-state', 'outputs/e.json', 'application/json', json));

    // A fresh adapter AND a fresh state view over the same durable records.
    const second = fixture({ slots, blobs, imageFiles });
    const b = second.store();
    const readPng = await b.read(SCOPE_A, 'outputs/a.png');
    expect(readPng?.artifact).toEqual({
      id: 'p1', role: 'result', path: 'outputs/a.png', mime: 'image/png',
      byteLength: png.byteLength, sha256: sha(png), width: 16, height: 8,
    });
    expect(Buffer.from(readPng!.content).equals(png)).toBe(true);
    const readSvg = await b.read(SCOPE_A, 'outputs/v.svg');
    expect(Buffer.from(readSvg!.content).equals(svg)).toBe(true);
    const readJson = await b.read(SCOPE_A, 'outputs/e.json');
    expect(Buffer.from(readJson!.content).equals(json)).toBe(true);
    expect(await b.read(SCOPE_A, 'outputs/missing.json')).toBeNull();
  });

  it('replays identical content without re-uploading, conflicts on any change, serializes concurrent duplicates', async () => {
    const f = fixture();
    const store = f.store();
    const png = await raster('png');
    const input = write('p1', 'result', 'outputs/a.png', 'image/png', png, { width: 16, height: 8 });
    const first = await store.put(SCOPE_A, input);
    const flushes = f.state.flushes;
    const replay = await store.put(SCOPE_A, { ...input });
    expect(replay).toEqual(first);
    expect(f.images.writes).toBe(1);
    expect(f.state.flushes).toBe(flushes + 1); // replay still confirms the durability barrier

    // Concurrent duplicates of the same payload: one upload, one index write.
    const f2 = fixture();
    const s2 = f2.store();
    const [r1, r2] = await Promise.all([s2.put(SCOPE_A, input), s2.put(SCOPE_A, { ...input })]);
    expect(r1).toEqual(r2);
    expect(f2.images.writes).toBe(1);
    expect(f2.state.flushes).toBe(2); // both callers confirm durability; binary/index remains one

    // Any different bytes or metadata at the same path is a 409.
    const otherPng = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#cc2244' } }).png().toBuffer();
    await expect(store.put(SCOPE_A, write('p1', 'result', 'outputs/a.png', 'image/png', otherPng, { width: 16, height: 8 })))
      .rejects.toMatchObject({ status: 409, code: 'IMAGE_TOOL_ARTIFACT_CONFLICT' });
    await expect(store.put(SCOPE_A, write('p1', 'preview', 'outputs/a.png', 'image/png', png, { width: 16, height: 8 })))
      .rejects.toMatchObject({ status: 409 });
    await expect(store.put(SCOPE_A, write('p2', 'result', 'outputs/a.png', 'image/png', png, { width: 16, height: 8 })))
      .rejects.toMatchObject({ status: 409 });
    await expect(store.put(SCOPE_A, write('p1', 'result', 'outputs/a.png', 'image/png', png)))
      .rejects.toMatchObject({ status: 409 });

    // JSON artifacts replay without a second bucket upload.
    const json = jsonBytes();
    const jsonInput = write('j1', 'edit-state', 'outputs/e.json', 'application/json', json);
    await store.put(SCOPE_A, jsonInput);
    const uploadCalls = vi.mocked(f.client.upload).mock.calls.length;
    await store.put(SCOPE_A, { ...jsonInput });
    expect(vi.mocked(f.client.upload).mock.calls.length).toBe(uploadCalls);
    await expect(store.put(SCOPE_A, write('j1', 'edit-state', 'outputs/e.json', 'application/json', utf8('{"changed":true}'))))
      .rejects.toMatchObject({ status: 409, code: 'IMAGE_TOOL_ARTIFACT_CONFLICT' });
  });

  it('keeps scopes isolated: same paths never resolve another namespace or project index', async () => {
    const f = fixture();
    const store = f.store();
    const json = jsonBytes();
    await store.put(SCOPE_A, write('j1', 'edit-state', 'shared/e.json', 'application/json', json));
    expect(await store.read(SCOPE_B, 'shared/e.json')).toBeNull();
    expect(await store.read(SCOPE_A2, 'shared/e.json')).toBeNull();

    // Same id/path under another scope writes its own slot and blob id.
    await store.put(SCOPE_B, write('j1', 'edit-state', 'shared/e.json', 'application/json', json));
    expect(f.state.slots.size).toBe(2);
    expect(f.blobs.size).toBe(2);
    const bRead = await store.read(SCOPE_B, 'shared/e.json');
    expect(bRead?.artifact.sha256).toBe(sha(json));
    const aRead = await store.read(SCOPE_A, 'shared/e.json');
    expect(aRead?.artifact.sha256).toBe(sha(json));
    expect(f.state.slots.get(slotKey(SCOPE_A, 'shared/e.json'))).not.toBe(f.state.slots.get(slotKey(SCOPE_B, 'shared/e.json')));

    // A foreign-scope record planted under this slot key fails closed, never adopted.
    const foreign: StoredIndex = {
      schemaVersion: 'image-tool-file/v1',
      scope: SCOPE_B,
      artifact: { id: 'j1', role: 'edit-state', path: 'shared/planted.json', mime: 'application/json', byteLength: 4, sha256: sha(utf8('1234')) },
      fileId: blobId(SCOPE_B, 'shared/planted.json', sha(utf8('1234'))),
      storage: 'blob',
    };
    f.state.slots.set(slotKey(SCOPE_A, 'shared/planted.json'), foreign);
    await expect(store.read(SCOPE_A, 'shared/planted.json')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });
    await expect(store.put(SCOPE_A, write('j1', 'edit-state', 'shared/planted.json', 'application/json', json)))
      .rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });
  });

  it('requires authorization before any storage access, including replay and reads', async () => {
    const f = fixture();
    const store = f.store();
    const json = jsonBytes();
    const input = write('j1', 'edit-state', 'shared/e.json', 'application/json', json);
    await store.put(SCOPE_A, input);

    const denied = new CanvasStateError(403, 'CANVAS_FORBIDDEN', 'denied');
    const authorize = vi.fn(async (_scope: Scope, _mode: 'read' | 'write') => { throw denied; });
    const f2 = fixture({ authorize, slots: f.state.slots, blobs: f.blobs, imageFiles: f.images.files });
    const blocked = f2.store();
    const uploads = vi.mocked(f.client.upload).mock.calls.length + vi.mocked(f2.client.upload).mock.calls.length;

    // Replay of an existing index still requires authorization first.
    await expect(blocked.put(SCOPE_A, { ...input })).rejects.toMatchObject({ status: 403 });
    await expect(blocked.read(SCOPE_A, 'shared/e.json')).rejects.toMatchObject({ status: 403 });
    await expect(blocked.put(SCOPE_A, write('n1', 'result', 'fresh/x.png', 'image/png', await raster('png'))))
      .rejects.toMatchObject({ status: 403 });
    expect(authorize).toHaveBeenCalledWith(SCOPE_A, 'write');
    expect(authorize).toHaveBeenCalledWith(SCOPE_A, 'read');
    // Nothing downstream ran: no index reads, no image writes, no bucket uploads.
    expect(f2.state.reads).toBe(0);
    expect(f2.images.writes).toBe(0);
    expect(vi.mocked(f.client.upload).mock.calls.length + vi.mocked(f2.client.upload).mock.calls.length).toBe(uploads);
  });

  it('never reports success on upload failure or on post-upload index/flush failure', async () => {
    const f = fixture();
    const store = f.store();
    const png = await raster('png');
    const input = write('p1', 'result', 'outputs/a.png', 'image/png', png);

    // Binary storage failure: sanitized, no index, read stays absent.
    f.images.failWrite = new CanvasStateError(502, 'CANVAS_STORAGE_ERROR', 'provider body with embedded token abc123');
    await expect(store.put(SCOPE_A, input)).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_IO' });
    expect(f.state.slots.size).toBe(0);
    expect(await store.read(SCOPE_A, 'outputs/a.png')).toBeNull();
    f.images.failWrite = undefined;

    // Upload succeeds but the durable index flush fails: put cannot succeed.
    f.state.failFlush = new Error('flush exploded secretly');
    await expect(store.put(SCOPE_A, input)).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_IO' });
    f.state.failFlush = undefined;
    // Deterministic retry adopts the staged artifact without a second upload.
    const saved = await store.put(SCOPE_A, input);
    expect(saved.sha256).toBe(sha(png));
    expect(f.images.writes).toBe(2); // one failed upload attempt, one successful upload; replay adds none
    expect(f.images.files.size).toBe(1);

    // Same guarantee on the bucket path: upload error propagates sanitized.
    const json = jsonBytes();
    const jsonInput = write('j1', 'edit-state', 'outputs/e.json', 'application/json', json);
    vi.mocked(f.client.upload).mockRejectedValueOnce(new CanvasStateError(502, 'CANVAS_STORAGE_ERROR', 'upstream secret detail'));
    await expect(store.put(SCOPE_A, jsonInput)).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_IO' });
    expect(f.state.slots.has(slotKey(SCOPE_A, 'outputs/e.json'))).toBe(false);
    await store.put(SCOPE_A, jsonInput);
    f.state.failFlush = new Error('late flush failure');
    await expect(store.put(SCOPE_A, write('j2', 'edit-state', 'outputs/e2.json', 'application/json', json)))
      .rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_IO' });
    f.state.failFlush = undefined;

    // An image-storage result naming a different path must never be indexed.
    f.images.nameOverride = 'elsewhere.png';
    await expect(store.put(SCOPE_A, write('p9', 'result', 'outputs/renamed.png', 'image/png', png)))
      .rejects.toMatchObject({ status: 503 });
    f.images.nameOverride = undefined;
    expect(await store.read(SCOPE_A, 'outputs/renamed.png')).toBeNull();
  });

  it('adopts an identical existing blob after upload 409 and refuses mismatched ones', async () => {
    const f = fixture();
    const store = f.store();
    const json = jsonBytes();
    const jsonSha = sha(json);

    // Identical pre-existing blob: upload 409 is verified then adopted.
    f.blobs.set(blobId(SCOPE_A, 'outputs/e.json', jsonSha), new Uint8Array(json));
    const saved = await store.put(SCOPE_A, write('j1', 'edit-state', 'outputs/e.json', 'application/json', json));
    expect(saved.sha256).toBe(jsonSha);
    expect(f.state.slots.has(slotKey(SCOPE_A, 'outputs/e.json'))).toBe(true);

    // Mismatched pre-existing blob under the deterministic id: refused, no index.
    const other = utf8(JSON.stringify({ totally: 'different' }));
    const otherSha = sha(other);
    f.blobs.set(blobId(SCOPE_A, 'outputs/e2.json', otherSha), utf8('{"foreign":1}'));
    await expect(store.put(SCOPE_A, write('j2', 'edit-state', 'outputs/e2.json', 'application/json', other)))
      .rejects.toMatchObject({ status: 409, code: 'IMAGE_TOOL_ARTIFACT_CONFLICT' });
    expect(f.state.slots.has(slotKey(SCOPE_A, 'outputs/e2.json'))).toBe(false);
    expect(await store.read(SCOPE_A, 'outputs/e2.json')).toBeNull();
  });

  it('rejects missing indexed bytes, tampered payloads and corrupt index records on read', async () => {
    const f = fixture();
    const store = f.store();
    const png = await raster('png');
    await store.put(SCOPE_A, write('p1', 'result', 'outputs/a.png', 'image/png', png));

    // Indexed image bytes vanished from storage.
    const imageKey = `${SCOPE_A.projectId}${'outputs/a.png'}`;
    const kept = f.images.files.get(imageKey)!;
    f.images.files.delete(imageKey);
    await expect(store.read(SCOPE_A, 'outputs/a.png')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });
    // Tampered bytes fail the checksum verification.
    f.images.files.set(imageKey, { bytes: utf8('tampered!!'), mime: 'image/png' });
    await expect(store.read(SCOPE_A, 'outputs/a.png')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });
    // Tampered mime fails verification too.
    f.images.files.set(imageKey, { bytes: new Uint8Array(png), mime: 'image/jpeg' });
    await expect(store.read(SCOPE_A, 'outputs/a.png')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });
    f.images.files.set(imageKey, kept);
    const ok = await store.read(SCOPE_A, 'outputs/a.png');
    expect(Buffer.from(ok!.content).equals(png)).toBe(true);

    // Same for the blob path: deletion and checksum mismatch are rejections.
    const json = jsonBytes();
    await store.put(SCOPE_A, write('j1', 'edit-state', 'outputs/e.json', 'application/json', json));
    const fileId = blobId(SCOPE_A, 'outputs/e.json', sha(json));
    f.blobs.delete(fileId);
    await expect(store.read(SCOPE_A, 'outputs/e.json')).rejects.toMatchObject({ status: 503 });
    f.blobs.set(fileId, utf8('{"swapped":true}'));
    await expect(store.read(SCOPE_A, 'outputs/e.json')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });

    // Corrupt index shapes are rejected, never trusted.
    const broken: unknown[] = [
      'not-an-object',
      { schemaVersion: 'other/v9', scope: SCOPE_A, artifact: {}, storage: 'blob' },
      { schemaVersion: 'image-tool-file/v1', scope: SCOPE_A, artifact: { id: 'x', role: 'result', path: 'other.png', mime: 'image/png', byteLength: 1, sha256: sha(utf8('z')) }, storage: 'image' },
      { schemaVersion: 'image-tool-file/v1', scope: SCOPE_A, artifact: { id: 'x', role: 'result', path: 'outputs/e.json', mime: 'application/json', byteLength: 1, sha256: sha(utf8('z')) }, storage: 'blob', fileId: '../../etc/passwd' },
      { schemaVersion: 'image-tool-file/v1', scope: SCOPE_A, artifact: { id: 'x', role: 'result', path: 'outputs/e.json', mime: 'application/json', byteLength: 1, sha256: sha(utf8('z')) }, storage: 'blob' },
      { schemaVersion: 'image-tool-file/v1', scope: SCOPE_A, artifact: { id: 'x', role: 'result', path: 'outputs/e.json', mime: 'application/json', byteLength: 1, sha256: sha(utf8('z')) }, storage: 'blob', fileId: blobId(SCOPE_A, 'outputs/e.json', sha(utf8('z'))), extra: 1 },
    ];
    for (const record of broken) {
      f.state.slots.set(slotKey(SCOPE_A, 'outputs/broken.json'), record);
      await expect(store.read(SCOPE_A, 'outputs/broken.json')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_CORRUPT' });
    }
  });

  it('rejects unsafe scopes, paths, ids, mime, sizes and dimensions before storage', async () => {
    const f = fixture();
    const store = f.store();
    const png = await raster('png');
    for (const bad of [
      '../escape.png', 'a/../../b.png', '/absolute.png', 'a//b.png', './dot.png',
      'a\\b.png', 'a%2e%2e.png', 'a:b.png', 'a?b.png', 'a#b.png', 'a\u0000b.png',
      `d/${'x'.repeat(2100)}.png`, '',
    ]) {
      await expect(store.put(SCOPE_A, write('x', 'result', bad, 'image/png', png))).rejects.toMatchObject({ status: 400, code: 'IMAGE_TOOL_ARTIFACT_INVALID' });
      await expect(store.read(SCOPE_A, bad)).rejects.toMatchObject({ status: 400, code: 'IMAGE_TOOL_ARTIFACT_INVALID' });
    }
    await expect(store.put({ namespace: '../ns', projectId: 'proj-1' }, write('x', 'result', 'a.png', 'image/png', png)))
      .rejects.toMatchObject({ status: 400 });
    await expect(store.put({ namespace: 'ns', projectId: 'p/evil' }, write('x', 'result', 'a.png', 'image/png', png)))
      .rejects.toMatchObject({ status: 400 });
    await expect(store.put({ namespace: '', projectId: 'p' }, write('x', 'result', 'a.png', 'image/png', png)))
      .rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.txt', 'text/plain', png))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x'.repeat(200), 'result', 'a.png', 'image/png', png))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('bad id!', 'result', 'a.png', 'image/png', png))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'bogus', 'a.png', 'image/png', png))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', new Uint8Array(0)))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', new Uint8Array(30_000_001)))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', png, { width: 5, height: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', png, { width: 6000, height: 6000 }))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, { id: 'x', role: 'result', path: 'a.png', mime: 'image/png', content: png, width: 5 }))
      .rejects.toMatchObject({ status: 400 });
    expect(f.images.writes).toBe(0);
    expect(f.state.slots.size).toBe(0);
    expect(vi.mocked(f.client.upload)).not.toHaveBeenCalled();
  });

  it('rejects raster mime/signature mismatches before any storage write', async () => {
    const f = fixture();
    const store = f.store();
    const png = await raster('png');
    const jpeg = await raster('jpeg');
    const webp = await raster('webp');
    // Real JPEG/WebP route through correctly.
    await store.put(SCOPE_A, write('j', 'result', 'a.jpg', 'image/jpeg', jpeg, { width: 16, height: 8 }));
    await store.put(SCOPE_A, write('w', 'result', 'a.webp', 'image/webp', webp, { width: 16, height: 8 }));
    expect(f.images.writes).toBe(2);
    // Mislabeled formats, non-image bytes and an SVG under a raster mime.
    await expect(store.put(SCOPE_A, write('x', 'result', 'mismatch.jpg', 'image/jpeg', png))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', jpeg))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', utf8('not an image')))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'a.png', 'image/png', svgBytes()))).rejects.toMatchObject({ status: 400 });
    await expect(store.put(SCOPE_A, write('x', 'result', 'mismatch.webp', 'image/webp', png))).rejects.toMatchObject({ status: 400 });
    expect(f.images.writes).toBe(2);
  });

  it('enforces strict vector-only SVG and safe JSON artifact content', async () => {
    const f = fixture();
    const store = f.store();
    const badSvgs = [
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil/x.png"/><path d="M0 0h1"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1" onload="steal()"/></svg>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
      '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
      '<!ENTITY x "y"><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject><path d="M0 0h1"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(http://evil/x)" d="M0 0h1"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(data:image/png;base64,x)" d="M0 0h1"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil"><path d="M0 0h1"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="data:image/svg+xml;base64,x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="file:///etc/passwd"><path d="M0 0h1"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0h1"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>', // no vector content
      'plain text, not svg',
    ];
    for (const bad of badSvgs) {
      await expect(store.put(SCOPE_A, write('v', 'vector', 'bad.svg', 'image/svg+xml', utf8(bad))))
        .rejects.toMatchObject({ status: 400, code: 'IMAGE_TOOL_ARTIFACT_INVALID' });
    }
    await expect(store.put(SCOPE_A, write('v', 'vector', 'bad.svg', 'image/svg+xml', new Uint8Array([0xff, 0xfe, 0x3c]))))
      .rejects.toMatchObject({ status: 400 });
    // Internal references stay allowed.
    const ok = utf8('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path style="fill:url(#g)" d="M0 0h1v1z"/><use href="#g"/></svg>');
    const savedSvg = await store.put(SCOPE_A, write('v', 'vector', 'ok.svg', 'image/svg+xml', ok));
    expect(savedSvg.sha256).toBe(sha(ok));

    const badJsons = [
      '{"apiKey":"x"}',
      '{"nested":{"accessToken":"x"}}',
      '{"client_secret":"x"}',
      '{"__proto__":{"a":1}}',
      '{"constructor":"x"}',
      '{"Authorization":"Bearer y"}',
      '{"oAuth":{"token2":1}}',
      'not json at all',
      '<html><body>nope</body></html>',
      '   ',
    ];
    for (const bad of badJsons) {
      await expect(store.put(SCOPE_A, write('j', 'edit-state', 'bad.json', 'application/json', utf8(bad))))
        .rejects.toMatchObject({ status: 400, code: 'IMAGE_TOOL_ARTIFACT_INVALID' });
    }
    // Nesting deeper than 12 levels is rejected; 12 is still accepted.
    let deep = '1';
    for (let i = 0; i < 13; i += 1) deep = `{"k":${deep}}`;
    await expect(store.put(SCOPE_A, write('j', 'edit-state', 'deep.json', 'application/json', utf8(deep))))
      .rejects.toMatchObject({ status: 400 });
    let shallow = '1';
    for (let i = 0; i < 12; i += 1) shallow = `{"k":${shallow}}`;
    const savedJson = await store.put(SCOPE_A, write('j', 'edit-state', 'ok.json', 'application/json', utf8(shallow)));
    expect(savedJson.sha256).toBe(sha(utf8(shallow)));
    // Free-text values containing credential words are content, not keys.
    const freeText = utf8(JSON.stringify({ title: 'an auth token story', author: 'zz', headers: ['h1'], notes: 'password field docs' }));
    const savedText = await store.put(SCOPE_A, write('j', 'edit-state', 'text.json', 'application/json', freeText));
    expect(savedText.sha256).toBe(sha(freeText));
    // Large dense numeric arrays are fine while inside the byte bound.
    const big = utf8(JSON.stringify({ uv: Array.from({ length: 4096 }, (_, i) => i / 4096) }));
    const savedBig = await store.put(SCOPE_A, write('j', 'edit-state', 'big.json', 'application/json', big));
    expect(savedBig.byteLength).toBe(big.byteLength);
  });

  it('fails closed with 503 unavailable when the wiring is incomplete', () => {
    const f = fixture();
    const base: CloudToolArtifactFilesOptions = {
      client: f.client, state: f.state, bucketId: 'tool-artifacts', images: f.images, authorize: async () => undefined,
    };
    const attempts: Array<() => CloudToolArtifactFiles> = [
      () => new CloudToolArtifactFiles({} as unknown as CloudToolArtifactFilesOptions),
      () => new CloudToolArtifactFiles({ ...base, client: undefined } as unknown as CloudToolArtifactFilesOptions),
      () => new CloudToolArtifactFiles({ ...base, state: undefined } as unknown as CloudToolArtifactFilesOptions),
      () => new CloudToolArtifactFiles({ ...base, images: undefined } as unknown as CloudToolArtifactFilesOptions),
      () => new CloudToolArtifactFiles({ ...base, authorize: undefined } as unknown as CloudToolArtifactFilesOptions),
      () => new CloudToolArtifactFiles({ ...base, bucketId: '' }),
      () => new CloudToolArtifactFiles({ ...base, bucketId: '   ' }),
    ];
    for (const attempt of attempts) {
      let caught: unknown;
      try {
        attempt();
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_UNAVAILABLE' });
    }
  });

  it('sanitizes unexpected errors while preserving denied statuses', async () => {
    const f = fixture();
    const store = f.store();
    const json = jsonBytes();
    // A raw non-structured backend failure becomes a generic 503.
    vi.mocked(f.client.upload).mockRejectedValueOnce(new Error('raw upstream body api_key=deadbeef'));
    await expect(store.put(SCOPE_A, write('j', 'edit-state', 'e.json', 'application/json', json)))
      .rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_IO', message: 'tool artifact storage request failed' });
    // A 403 from storage keeps a denied status and leaks no provider detail.
    vi.mocked(f.client.upload).mockRejectedValueOnce(new CanvasStateError(403, 'CANVAS_FORBIDDEN', 'provider detail'));
    await expect(store.put(SCOPE_A, write('j', 'edit-state', 'e.json', 'application/json', json)))
      .rejects.toMatchObject({ status: 403, code: 'IMAGE_TOOL_ARTIFACT_DENIED', message: 'tool artifact storage access denied' });
    // A state-port failure never surfaces as success either.
    f.state.failRead = new Error('state backend exploded with secrets');
    await expect(store.read(SCOPE_A, 'e.json')).rejects.toMatchObject({ status: 503, code: 'IMAGE_TOOL_ARTIFACT_IO' });
  });
});
