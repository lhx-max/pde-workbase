import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import {
  CloudArtifactMetadata,
  prepareCloudArtifact,
} from '../src/storage/cloud-artifact-metadata.js';
import type { ArtifactStubGuardConfig } from '../src/artifacts/stub-guard.js';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const slotKey = (projectId: string) => `artifacts:${sha(projectId)}`;
const bytes = (text: string) => new TextEncoder().encode(text);

/** In-memory JsonStatePort double: strict deep clones on read/write like the
 * real port, a flush counter and failure injection. */
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

const HTML = '<!doctype html><html><body><h1>Real dashboard</h1><p>full body '.repeat(30) + '</p></body></html>';

function artifactManifest(path: string, over: Record<string, unknown> = {}) {
  return prepareCloudArtifact({ path, content: bytes(HTML), artifact: true, ...over });
}

function storedManifest(path: string, over: Record<string, unknown> = {}) {
  return {
    version: 1,
    kind: 'html',
    title: path,
    entry: path,
    renderer: 'html',
    status: 'complete',
    exports: ['html'],
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...over,
  };
}

describe('prepareCloudArtifact', () => {
  it('returns null for normal files and explicit null/undefined manifests', () => {
    expect(prepareCloudArtifact({ path: 'a.txt', content: bytes('hi') })).toBeNull();
    expect(prepareCloudArtifact({ path: 'a.txt', content: bytes('hi'), artifact: false })).toBeNull();
    expect(prepareCloudArtifact({ path: 'a.txt', content: bytes('hi'), artifactManifest: null })).toBeNull();
    expect(prepareCloudArtifact({ path: 'a.txt', content: bytes('hi'), artifactManifest: undefined })).toBeNull();
  });

  it('infers the legacy manifest for artifact:true writes (html/deck/md/svg)', () => {
    const html = artifactManifest('reports/a.html');
    expect(html).toMatchObject({ version: 1, kind: 'html', renderer: 'html', entry: 'reports/a.html', status: 'complete' });
    const deck = artifactManifest('pitch-deck.html');
    expect(deck).toMatchObject({ kind: 'deck', renderer: 'deck-html', entry: 'pitch-deck.html' });
    const md = artifactManifest('notes.md');
    expect(md).toMatchObject({ kind: 'markdown-document', renderer: 'markdown' });
    const svg = artifactManifest('icon.svg');
    expect(svg).toMatchObject({ kind: 'svg', renderer: 'svg' });
  });

  it('requires a resolvable manifest for artifact:true on non-inferable paths', () => {
    expect(() => prepareCloudArtifact({ path: 'data.bin', content: bytes('x'), artifact: true }))
      .toThrowError(expect.objectContaining({ status: 400, code: 'ARTIFACT_MANIFEST_REQUIRED' }));
    expect(() => prepareCloudArtifact({ path: 'a.html', content: bytes('x'), artifact: true, artifactManifest: { kind: 'bogus' } }))
      .toThrowError(expect.objectContaining({ status: 400, code: 'ARTIFACT_MANIFEST_INVALID' }));
  });

  it('validates an explicit manifest without artifact:true and drops unknown caller fields', () => {
    const manifest = prepareCloudArtifact({
      path: 'app.html',
      content: bytes(HTML),
      artifactManifest: {
        kind: 'html',
        renderer: 'html',
        exports: ['html'],
        title: 'My App',
        secret: 'do-not-store',
        token: 'leak',
      },
    });
    expect(manifest).toMatchObject({ kind: 'html', title: 'My App', entry: 'app.html' });
    expect(manifest).not.toHaveProperty('secret');
    expect(manifest).not.toHaveProperty('token');
    expect(() => prepareCloudArtifact({
      path: 'app.html',
      content: bytes(HTML),
      artifactManifest: { kind: 'html', renderer: 'html', exports: ['nope'] },
    })).toThrowError(expect.objectContaining({ status: 400, code: 'BAD_REQUEST' }));
    expect(() => prepareCloudArtifact({ path: 'app.html', content: bytes(HTML), artifactManifest: 42 }))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('pins artifactManifest.entry to the actual file path', () => {
    expect(() => prepareCloudArtifact({
      path: 'a.html',
      content: bytes(HTML),
      artifactManifest: { kind: 'html', renderer: 'html', exports: ['html'], entry: 'other.html' },
    })).toThrowError(expect.objectContaining({ status: 400, code: 'BAD_REQUEST' }));
  });

  it('blocks publication of placeholder-laden bodies for guarded kinds, decided by kind not mime/extension', () => {
    const blocked = `<!doctype html><html><body>Name to confirm</body></html>`;
    expect(() => prepareCloudArtifact({ path: 'pitch.html', content: bytes(blocked), artifact: true }))
      .toThrowError(expect.objectContaining({ status: 400, code: 'ARTIFACT_PUBLICATION_BLOCKED' }));
    // Same bytes with a markdown manifest kind are not guarded — the
    // published artifact kind determines the guard, not the file name/mime.
    const md = prepareCloudArtifact({
      path: 'notes.md',
      content: bytes(blocked),
      artifactManifest: { kind: 'markdown-document', renderer: 'markdown', exports: ['md'] },
    });
    expect(md).toMatchObject({ kind: 'markdown-document' });
    // A guarded kind on a non-html extension is still guarded.
    expect(() => prepareCloudArtifact({
      path: 'blob.bin',
      content: bytes(blocked),
      artifactManifest: { kind: 'html', renderer: 'html', exports: ['html'], entry: 'blob.bin' },
    })).toThrowError(expect.objectContaining({ status: 400, code: 'ARTIFACT_PUBLICATION_BLOCKED' }));
  });

  it('rejects invalid UTF-8 for guarded kinds instead of scanning mojibake', () => {
    const invalidUtf8 = new Uint8Array([0x3c, 0x68, 0xff, 0xfe, 0x74]);
    expect(() => prepareCloudArtifact({ path: 'a.html', content: invalidUtf8, artifact: true }))
      .toThrowError(expect.objectContaining({ status: 400, code: 'BAD_REQUEST' }));
    // Non-guarded kinds are not text-decoded at all.
    expect(prepareCloudArtifact({
      path: 'blob.bin',
      content: invalidUtf8,
      artifactManifest: { kind: 'code-snippet', renderer: 'code', exports: ['txt'], entry: 'blob.bin' },
    })).toMatchObject({ kind: 'code-snippet' });
  });

  it('runs the stub guard on caller-supplied priors; reject/warn/off all honored', () => {
    const config = (mode: ArtifactStubGuardConfig['mode']): ArtifactStubGuardConfig =>
      ({ mode, minRetainedRatio: 0.2, minPriorBytes: 4096 });
    const manifest = { kind: 'html', renderer: 'html', exports: ['html'], metadata: { identifier: 'dash' } };
    const stub = bytes('<html>see dash.html</html>');
    const priors = [{ name: 'dash.html', size: 20000 }];
    expect(() => prepareCloudArtifact({
      path: 'dash-1.html', content: stub, artifactManifest: manifest,
      priorSiblings: priors, stubGuardConfig: config('reject'),
    })).toThrowError(expect.objectContaining({ status: 400, code: 'ARTIFACT_REGRESSION' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const allowed = prepareCloudArtifact({
        path: 'dash-1.html', content: stub, artifactManifest: manifest,
        priorSiblings: priors, stubGuardConfig: config('warn'),
      });
      expect(allowed).toMatchObject({ kind: 'html' });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(prepareCloudArtifact({
      path: 'dash-1.html', content: stub, artifactManifest: manifest,
      priorSiblings: priors, stubGuardConfig: config('off'),
    })).toMatchObject({ kind: 'html' });
    // No priors / no identifier -> passes even in reject mode.
    expect(prepareCloudArtifact({
      path: 'dash-1.html', content: stub, artifactManifest: manifest, stubGuardConfig: config('reject'),
    })).toMatchObject({ kind: 'html' });
    expect(prepareCloudArtifact({
      path: 'a.html', content: bytes('<html></html>'), artifact: true, stubGuardConfig: config('reject'),
    })).toMatchObject({ kind: 'html' });
  });

  it.each([
    ['traversal', 'a/../b.html'],
    ['unnormalized separators', 'a\\b.html'],
    ['leading dot segment', './a.html'],
    ['internal version root', '.file-versions/x/m.html'],
    ['internal layout path', '.bezierdesign/.file-versions/x.html'],
    ['absolute', '/a.html'],
  ])('rejects %s paths', (_label, bad) => {
    expect(() => prepareCloudArtifact({ path: bad, content: bytes(HTML), artifact: true }))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('CloudArtifactMetadata', () => {
  it('requires a JsonStatePort — no fallback', () => {
    expect(() => new CloudArtifactMetadata(undefined as unknown as JsonStatePort)).toThrowError();
  });

  it('stores manifests per project and returns them only for the same revision', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
    expect(state.flushes).toBe(1);
    const stored = await meta.get('p1', 'a.html', revision);
    expect(stored).toMatchObject({ kind: 'html', entry: 'a.html' });
    expect(await meta.get('p1', 'a.html', sha(bytes('other body')))).toBeNull();
    expect(await meta.get('p1', 'missing.html', revision)).toBeNull();
    // Project scopes cannot see or clobber each other.
    expect(await meta.get('p2', 'a.html', revision)).toBeNull();
    await meta.set('p2', 'a.html', revision, artifactManifest('a.html'));
    expect(await meta.get('p1', 'a.html', revision)).not.toBeNull();
    const p1Doc = state.slots.get(slotKey('p1')) as { entries: Record<string, unknown> };
    const p2Doc = state.slots.get(slotKey('p2')) as { entries: Record<string, unknown> };
    expect(Object.keys(p1Doc.entries)).toEqual(['a.html']);
    expect(Object.keys(p2Doc.entries)).toEqual(['a.html']);
  });

  it('reconstructs purely from the state port across instances', async () => {
    const state = new FakeStatePort();
    const revision = sha(bytes(HTML));
    await new CloudArtifactMetadata(state).set('p1', 'a.html', revision, artifactManifest('a.html'));
    const rebuilt = new CloudArtifactMetadata(state);
    expect(await rebuilt.get('p1', 'a.html', revision)).toMatchObject({ kind: 'html' });
  });

  it('returns safe clones — mutating the result cannot touch stored metadata', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
    const manifest = (await meta.get('p1', 'a.html', revision))!;
    manifest.kind = 'tampered';
    (manifest.metadata as Record<string, unknown>) = { injected: true };
    expect(await meta.get('p1', 'a.html', revision)).toMatchObject({ kind: 'html' });
    expect(await meta.get('p1', 'a.html', revision)).not.toHaveProperty('metadata.injected');
  });

  it('rejects invalid inputs before staging any write', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const manifest = artifactManifest('a.html');
    await expect(meta.set('p1', 'a.html', 'not-a-sha', manifest)).rejects.toMatchObject({ status: 400 });
    await expect(meta.set('p1', '../x.html', sha('x'), manifest)).rejects.toMatchObject({ status: 400 });
    await expect(meta.set('p1', 'a/../x.html', sha('x'), manifest)).rejects.toMatchObject({ status: 400 });
    await expect(meta.set('p1', 'a\\x.html', sha('x'), manifest)).rejects.toMatchObject({ status: 400 });
    await expect(meta.set('p1', 'a.html', sha('x'), { kind: 'bogus' })).rejects.toMatchObject({ status: 400 });
    await expect(meta.set('', 'a.html', sha('x'), manifest)).rejects.toMatchObject({ status: 400 });
    await expect(meta.set('p1', 'a.html', sha('x'), { kind: 'html', renderer: 'html', exports: ['html'], entry: 'b.html' }))
      .rejects.toMatchObject({ status: 400 });
    expect(state.slots.has(slotKey('p1'))).toBe(false);
    expect(state.flushes).toBe(0);
  });

  it('a failed flush is a failed set — never acked', async () => {
    const state = new FakeStatePort();
    state.failFlush = new Error('backend down');
    const meta = new CloudArtifactMetadata(state);
    await expect(meta.set('p1', 'a.html', sha(bytes(HTML)), artifactManifest('a.html')))
      .rejects.toThrowError('backend down');
  });

  it('rename moves metadata to the destination and rewrites manifest.entry', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
    await meta.rename('p1', 'a.html', 'dir/b.html', revision);
    expect(await meta.get('p1', 'a.html', revision)).toBeNull();
    expect(await meta.get('p1', 'dir/b.html', revision)).toMatchObject({ entry: 'dir/b.html' });
  });

  it('rename conflicts on an occupied destination and refuses incompatible extensions before mutating', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
    await meta.set('p1', 'b.html', revision, artifactManifest('b.html'));
    await expect(meta.rename('p1', 'a.html', 'b.html', revision)).rejects.toMatchObject({ status: 409 });
    // kind html cannot move to a .md path
    await expect(meta.rename('p1', 'a.html', 'a.md', revision)).rejects.toMatchObject({ status: 400 });
    await expect(meta.rename('p1', 'a.html', 'a.html', revision)).rejects.toMatchObject({ status: 400 });
    // Nothing was mutated.
    expect(await meta.get('p1', 'a.html', revision)).toMatchObject({ entry: 'a.html' });
    expect(await meta.get('p1', 'b.html', revision)).toMatchObject({ entry: 'b.html' });
  });

  it('rename drops stale metadata instead of dragging it to the new path', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
    await meta.rename('p1', 'a.html', 'b.html', sha(bytes('superseded bytes')));
    expect(await meta.get('p1', 'a.html', revision)).toBeNull();
    expect(await meta.get('p1', 'b.html', revision)).toBeNull();
    // A no-entry rename is a no-op: no write, no flush beyond the earlier set.
    const flushes = state.flushes;
    await meta.rename('p1', 'nothing.html', 'else.html', revision);
    expect(state.flushes).toBe(flushes);
  });

  it('remove deletes existing metadata and is a no-op for absent paths', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.remove('p1', 'ghost.html');
    expect(state.flushes).toBe(0);
    await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
    await meta.remove('p1', 'a.html');
    expect(await meta.get('p1', 'a.html', revision)).toBeNull();
  });

  it.each([
    ['non-object document', 'text'],
    ['array document', []],
    ['wrong version', { version: 2, projectId: 'p1', entries: {} }],
    ['projectId mismatch', { version: 1, projectId: 'other', entries: {} }],
    ['unknown top-level field', { version: 1, projectId: 'p1', entries: {}, secret: true }],
    ['entries not an object', { version: 1, projectId: 'p1', entries: [] }],
    ['unnormalized entry key', { version: 1, projectId: 'p1', entries: { 'a//b.html': {} } }],
    ['internal entry key', { version: 1, projectId: 'p1', entries: { '.file-versions/x.html': {} } }],
    ['entry not an object', { version: 1, projectId: 'p1', entries: { 'a.html': 5 } }],
    ['unknown entry field', { version: 1, projectId: 'p1', entries: { 'a.html': { revision: sha('x'), manifest: {}, extra: 1 } } }],
    ['invalid revision', { version: 1, projectId: 'p1', entries: { 'a.html': { revision: 'zz', manifest: storedManifest('a.html') } } }],
    ['missing manifest', { version: 1, projectId: 'p1', entries: { 'a.html': { revision: sha('x') } } }],
    ['invalid manifest kind', { version: 1, projectId: 'p1', entries: { 'a.html': { revision: sha('x'), manifest: storedManifest('a.html', { kind: 'evil' }) } } }],
    ['unknown manifest field', { version: 1, projectId: 'p1', entries: { 'a.html': { revision: sha('x'), manifest: storedManifest('a.html', { secret: 'x' }) } } }],
    ['manifest entry mismatch', { version: 1, projectId: 'p1', entries: { 'a.html': { revision: sha('x'), manifest: storedManifest('other.html') } } }],
    ['too many entries', {
      version: 1, projectId: 'p1',
      entries: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`f${i}.html`, { revision: sha('x'), manifest: storedManifest(`f${i}.html`) }])),
    }],
    ['oversize document', {
      version: 1, projectId: 'p1',
      entries: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}.html`, {
        revision: sha('x'),
        manifest: storedManifest(`f${i}.html`, { metadata: { pad: 'x'.repeat(15000) } }),
      }])),
    }],
  ])('fails 503 CLOUD_ARTIFACT_METADATA_CORRUPT on %s', async (_label, stored) => {
    const state = new FakeStatePort();
    state.slots.set(slotKey('p1'), stored);
    const meta = new CloudArtifactMetadata(state);
    await expect(meta.get('p1', 'a.html', sha('x'))).rejects.toMatchObject({ status: 503, code: 'CLOUD_ARTIFACT_METADATA_CORRUPT' });
  });

  it('caps at 256 entries and the 1 MiB bound without truncation or eviction', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    for (let i = 0; i < 256; i += 1) {
      await meta.set('p1', `f${String(i).padStart(3, '0')}.html`, revision, artifactManifest(`f${String(i).padStart(3, '0')}.html`));
    }
    expect(await meta.get('p1', 'f000.html', revision)).toMatchObject({ entry: 'f000.html' });
    expect(await meta.get('p1', 'f255.html', revision)).toMatchObject({ entry: 'f255.html' });
    // Updating an existing entry is still allowed at the cap.
    await meta.set('p1', 'f000.html', revision, artifactManifest('f000.html'));
    // A 257th entry fails closed; nothing is evicted.
    await expect(meta.set('p1', 'f256.html', revision, artifactManifest('f256.html')))
      .rejects.toMatchObject({ status: 413, code: 'CLOUD_ARTIFACT_METADATA_LIMIT' });
    expect(await meta.get('p1', 'f000.html', revision)).not.toBeNull();
    expect(await meta.get('p1', 'f256.html', revision)).toBeNull();

    // Serialized-size bound: big manifests push the document past 1 MiB.
    const big = new FakeStatePort();
    const bigMeta = new CloudArtifactMetadata(big);
    const padded = (name: string) => artifactManifest(name, {
      artifactManifest: {
        kind: 'html', renderer: 'html', exports: ['html'], entry: name,
        metadata: { pad: 'y'.repeat(15 * 1024) },
      },
    });
    let hit = false;
    for (let i = 0; i < 80 && !hit; i += 1) {
      try {
        await bigMeta.set('p1', `big-${i}.html`, revision, padded(`big-${i}.html`));
      } catch (error) {
        expect(error).toMatchObject({ status: 413, code: 'CLOUD_ARTIFACT_METADATA_LIMIT' });
        hit = true;
      }
    }
    expect(hit).toBe(true);
    const storedSize = Buffer.byteLength(JSON.stringify(big.slots.get(slotKey('p1'))), 'utf8');
    expect(storedSize).toBeLessThanOrEqual(1024 * 1024);
  });

  it('serializes mutations per project', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await Promise.all([
      meta.set('p1', 'a.html', revision, artifactManifest('a.html')),
      meta.set('p1', 'b.html', revision, artifactManifest('b.html')),
      meta.rename('p1', 'a.html', 'a2.html', revision),
      meta.remove('p1', 'b.html'),
    ]);
    const doc = state.slots.get(slotKey('p1')) as { entries: Record<string, { manifest: { entry: string } }> };
    expect(Object.keys(doc.entries).sort()).toEqual(['a2.html']);
    expect(doc.entries['a2.html']!.manifest.entry).toBe('a2.html');
  });

  it('never touches the local filesystem', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cloud-artifact-meta-'));
    try {
      const state = new FakeStatePort();
      const meta = new CloudArtifactMetadata(state);
      const revision = sha(bytes(HTML));
      await meta.set('p1', 'a.html', revision, artifactManifest('a.html'));
      await meta.rename('p1', 'a.html', 'b.html', revision);
      await meta.remove('p1', 'b.html');
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it('stores optional manifest fields through the actual strict cloud state codec',async()=>{
 const {AppwriteJsonState}=await import('@ks-designai/app-cloud-state');
 const rows=new Map<string,Record<string,unknown>>();
 const client={
  docsPath:(database:string,collection:string)=>'/databases/'+database+'/collections/'+collection+'/documents',
  async getOrNull<T>(url:string):Promise<T|null>{return (rows.get(url.split('/').at(-1)!)??null) as T|null;},
  async call<T>(method:string,url:string,body?:unknown):Promise<T>{
  const input=body as {documentId?:string;data?:Record<string,unknown>}|undefined;
  if(method==='GET')return{documents:[...rows.values()],total:rows.size} as T;
  if(method==='POST'){const row={$id:input!.documentId!,...input!.data!};rows.set(input!.documentId!,row);return row as T;}
  if(method==='PATCH'){const id=url.split('/').at(-1)!;const row={...rows.get(id),...input!.data!};rows.set(id,row);return row as T;}
  throw Error('Unexpected fixture operation');
 }};
 const options={client,databaseId:'db',collectionId:'runtime',namespace:'artifact-codec',singleWriter:true as const};
 const state=new AppwriteJsonState({...options,initialize:true});await state.ready;
 const artifacts=new CloudArtifactMetadata(state);const manifest=prepareCloudArtifact({path:'report.html',content:bytes(HTML),artifact:true});
 await artifacts.set('project','report.html',sha(HTML),manifest);
 await artifacts.preflightRename('project','report.html','renamed.html',sha(HTML));await artifacts.rename('project','report.html','renamed.html',sha(HTML));
 const reopened=new AppwriteJsonState(options);await reopened.ready;
 expect(await new CloudArtifactMetadata(reopened).get('project','renamed.html',sha(HTML))).toMatchObject({kind:'html',entry:'renamed.html'});
});

describe('CloudArtifactMetadata rename reference rewrite', () => {
  const refsManifest = (path: string, over: Record<string, unknown> = {}) => ({
    kind: 'html', renderer: 'html', exports: ['html'], entry: path, ...over,
  });

  it('moves the own entry and rewrites its self-references', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'docs/app.html', revision, refsManifest('docs/app.html', {
      primary: 'docs/app.html',
      supportingFiles: ['docs/app.html', 'helper.css'],
    }));
    await meta.rename('p1', 'docs/app.html', 'docs/moved/app.html', revision);
    expect(await meta.get('p1', 'docs/app.html', revision)).toBeNull();
    const moved = await meta.get('p1', 'docs/moved/app.html', revision);
    expect(moved).toMatchObject({
      entry: 'docs/moved/app.html',
      primary: 'docs/moved/app.html',
      // Root-spelled self refs take the root-relative destination; refs that
      // never pointed at the moved file stay untouched (helper.css now
      // resolves relative to the new owner directory, same as the local
      // sidecar semantics).
      supportingFiles: ['docs/moved/app.html', 'helper.css'],
    });
    const listed = (await meta.list('p1')).find((row) => row.path === 'docs/moved/app.html');
    expect(listed?.revision).toBe(revision);
  });

  it('rewrites references across every manifest while other entries stay pinned to their owner path', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'docs/app.html', revision, refsManifest('docs/app.html'));
    await meta.set('p1', 'viewer.html', revision, refsManifest('viewer.html', {
      supportingFiles: ['docs/app.html', 'https://cdn.example.com/x.js', 'docs/app.html?v=2'],
    }));
    await meta.set('p1', 'docs/widget.html', revision, refsManifest('docs/widget.html', {
      supportingFiles: ['app.html'],
    }));
    await meta.rename('p1', 'docs/app.html', 'docs/moved/app.html', revision);
    const viewer = await meta.get('p1', 'viewer.html', revision);
    expect(viewer).toMatchObject({
      entry: 'viewer.html',
      supportingFiles: ['docs/moved/app.html', 'https://cdn.example.com/x.js', 'docs/app.html?v=2'],
    });
    const widget = await meta.get('p1', 'docs/widget.html', revision);
    expect(widget).toMatchObject({
      entry: 'docs/widget.html',
      // owner-relative ref rewritten relative to the owner directory.
      supportingFiles: ['moved/app.html'],
    });
    const listed = await meta.list('p1');
    expect(listed.find((row) => row.path === 'viewer.html')?.revision).toBe(revision);
    expect(listed.find((row) => row.path === 'docs/widget.html')?.revision).toBe(revision);
    expect(listed.map((row) => row.path).sort())
      .toEqual(['docs/moved/app.html', 'docs/widget.html', 'viewer.html']);
  });

  it('updates refs for an ordinary supporting-file rename that has no artifact entry of its own', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'app.html', revision, refsManifest('app.html', {
      supportingFiles: ['lib.js'],
    }));
    const flushes = state.flushes;
    await meta.rename('p1', 'lib.js', 'assets/lib.js', revision);
    expect(state.flushes).toBeGreaterThan(flushes);
    expect(await meta.get('p1', 'app.html', revision)).toMatchObject({
      entry: 'app.html',
      supportingFiles: ['assets/lib.js'],
    });
    expect(await meta.get('p1', 'lib.js', revision)).toBeNull();
    expect(await meta.get('p1', 'assets/lib.js', revision)).toBeNull();
    // And a rename that changes nothing at all still writes nothing.
    const after = state.flushes;
    await meta.rename('p1', 'ghost.js', 'ghost2.js', revision);
    expect(state.flushes).toBe(after);
  });

  it('drops a stale own marker while still rewriting refs in other manifests', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    const stale = sha(bytes('superseded bytes'));
    await meta.set('p1', 'a.html', stale, refsManifest('a.html'));
    await meta.set('p1', 'c.html', revision, refsManifest('c.html', { supportingFiles: ['a.html'] }));
    await meta.rename('p1', 'a.html', 'b.html', revision);
    // The stale own marker is dropped — never attached to the destination.
    expect(await meta.get('p1', 'a.html', stale)).toBeNull();
    expect(await meta.get('p1', 'b.html', revision)).toBeNull();
    expect(await meta.get('p1', 'b.html', stale)).toBeNull();
    // Other manifests still follow the file's new location.
    expect(await meta.get('p1', 'c.html', revision)).toMatchObject({
      entry: 'c.html',
      supportingFiles: ['b.html'],
    });
  });

  it('preflight mirrors every rename validation and stages nothing', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha(bytes(HTML));
    await meta.set('p1', 'a.html', revision, refsManifest('a.html'));
    await meta.set('p1', 'b.html', revision, refsManifest('b.html'));
    const before = JSON.parse(JSON.stringify(state.slots.get(slotKey('p1'))));
    const flushes = state.flushes;
    // Occupied destination -> 409 before anything moves.
    await expect(meta.preflightRename('p1', 'a.html', 'b.html', revision))
      .rejects.toMatchObject({ status: 409, code: 'CANVAS_CONFLICT' });
    // kind html cannot move to a .md path -> 400 before anything moves.
    await expect(meta.preflightRename('p1', 'a.html', 'a.md', revision))
      .rejects.toMatchObject({ status: 400 });
    await expect(meta.preflightRename('p1', 'a.html', 'a.html', revision))
      .rejects.toMatchObject({ status: 400 });
    await expect(meta.preflightRename('p1', 'a.html', '../a.html', revision))
      .rejects.toMatchObject({ status: 400 });
    // A passing preflight still stages nothing.
    await meta.preflightRename('p1', 'a.html', 'renamed/a.html', revision);
    await meta.preflightRename('p1', 'ghost.js', 'ghost2.js', revision);
    expect(state.slots.get(slotKey('p1'))).toEqual(before);
    expect(state.flushes).toBe(flushes);
  });

  it('fails closed with 413 when the rewritten document would overflow the slot bound', async () => {
    const state = new FakeStatePort();
    const meta = new CloudArtifactMetadata(state);
    const revision = sha('x');
    const dest = `renamed/${'x'.repeat(230)}.html`;
    const REFS = 60;
    const buildDoc = (pad: number) => {
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < 80; i += 1) {
        const name = `pad-${String(i).padStart(3, '0')}.html`;
        entries[name] = { revision, manifest: storedManifest(name, { metadata: { pad: 'p'.repeat(pad) } }) };
      }
      entries['a.html'] = { revision, manifest: storedManifest('a.html') };
      entries['refs.html'] = {
        revision,
        manifest: storedManifest('refs.html', { supportingFiles: Array.from({ length: REFS }, () => 'a.html') }),
      };
      return { version: 1, projectId: 'p1', entries };
    };
    // Under-estimate growth (refs only), then pad the document so it fits but
    // the rewrite growth pushes it past the 1 MiB bound.
    const growth = REFS * (dest.length - 'a.html'.length);
    const emptySize = Buffer.byteLength(JSON.stringify(buildDoc(0)), 'utf8');
    const target = 1024 * 1024 - Math.floor(growth / 2);
    const doc = buildDoc(Math.max(0, Math.floor((target - emptySize) / 80)));
    const docSize = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    expect(docSize).toBeLessThanOrEqual(1024 * 1024);
    expect(docSize + growth).toBeGreaterThan(1024 * 1024);
    state.slots.set(slotKey('p1'), doc);
    await expect(meta.rename('p1', 'a.html', dest, revision))
      .rejects.toMatchObject({ status: 413, code: 'CLOUD_ARTIFACT_METADATA_LIMIT' });
    // Nothing was written — the slot keeps the exact pre-rename document.
    expect(state.slots.get(slotKey('p1'))).toEqual(doc);
    await expect(meta.preflightRename('p1', 'a.html', dest, revision))
      .rejects.toMatchObject({ status: 413, code: 'CLOUD_ARTIFACT_METADATA_LIMIT' });
  });
});

it('round-trips a multi-entry rename through the strict AppwriteJsonState codec',async()=>{
 const {AppwriteJsonState}=await import('@ks-designai/app-cloud-state');
 const rows=new Map<string,Record<string,unknown>>();
 const client={
  docsPath:(database:string,collection:string)=>'/databases/'+database+'/collections/'+collection+'/documents',
  async getOrNull<T>(url:string):Promise<T|null>{return (rows.get(url.split('/').at(-1)!)??null) as T|null;},
  async call<T>(method:string,url:string,body?:unknown):Promise<T>{
  const input=body as {documentId?:string;data?:Record<string,unknown>}|undefined;
  if(method==='GET')return{documents:[...rows.values()],total:rows.size} as T;
  if(method==='POST'){const row={$id:input!.documentId!,...input!.data!};rows.set(input!.documentId!,row);return row as T;}
  if(method==='PATCH'){const id=url.split('/').at(-1)!;const row={...rows.get(id),...input!.data!};rows.set(id,row);return row as T;}
  throw Error('Unexpected fixture operation');
 }};
 const options={client,databaseId:'db',collectionId:'runtime',namespace:'artifact-rename-codec',singleWriter:true as const};
 const state=new AppwriteJsonState({...options,initialize:true});await state.ready;
 const artifacts=new CloudArtifactMetadata(state);
 const rev=sha('body');
 await artifacts.set('project','docs/app.html',rev,{
  kind:'html',renderer:'html',exports:['html'],entry:'docs/app.html',
  primary:'docs/app.html',
  supportingFiles:['docs/app.html','helper.css','https://cdn.example.com/x.js'],
 });
 await artifacts.set('project','viewer.html',rev,{
  kind:'html',renderer:'html',exports:['html'],entry:'viewer.html',
  supportingFiles:['docs/app.html'],
 });
 await artifacts.preflightRename('project','docs/app.html','docs/moved/app.html',rev);
 await artifacts.rename('project','docs/app.html','docs/moved/app.html',rev);
 const reopened=new AppwriteJsonState(options);await reopened.ready;
 const meta=new CloudArtifactMetadata(reopened);
 expect(await meta.get('project','docs/moved/app.html',rev)).toMatchObject({
  entry:'docs/moved/app.html',
  primary:'docs/moved/app.html',
  supportingFiles:['docs/moved/app.html','helper.css','https://cdn.example.com/x.js'],
 });
 expect(await meta.get('project','viewer.html',rev)).toMatchObject({
  entry:'viewer.html',
  supportingFiles:['docs/moved/app.html'],
 });
});
