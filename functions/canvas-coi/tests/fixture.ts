/** In-memory Appwrite REST + MA authority fixture for function tests.
 * Implements the exact surface the app's AppwriteClient and the MA read
 * contract use: collection metadata, document CRUD with the serialized
 * Query form, bucket/file upload-download, and the MA function transport.
 * Not a business mock — it is a storage emulation with real status codes. */

interface StoredFile { bytes: Uint8Array; name: string; mime: string; permissions: unknown[] }

export interface MaActorProfile {
  /** userId for /me; must be active. */
  userId: string;
  /** instances keyed by applicationInstanceId. */
  instances: Record<string, { bizId: string; applicationId: string; providerInstanceId: string; status?: string }>;
  /** Return 401 on /me (revoked credential). */
  revoked?: boolean;
}

export interface FixtureOptions {
  apiKey: string;
  maEndpoint?: string;
  /** MA SSO credential header value (e.g. 'Bearer sso-1') → actor profile. */
  actors?: Record<string, MaActorProfile>;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface ParsedQuery { method: string; attribute?: string; values?: unknown[] }

export function createAppwriteFixture(options: FixtureOptions) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  const buckets = new Map<string, Map<string, StoredFile>>();
  const actors = options.actors ?? {};
  let failing = false;
  /** Emulates an ambiguous write: the document is stored, then the response
   * fails — the caller cannot prove whether it landed. */
  let storeThenFailNextDoc = false;
  /** Metadata overrides per collection id for preflight failure tests. */
  const collectionMeta = new Map<string, { permissions?: unknown[]; documentSecurity?: boolean }>();
  const bucketMeta = new Map<string, { permissions?: unknown[]; fileSecurity?: boolean }>();

  const collPath = /^\/?databases\/([^/]+)\/collections\/([^/]+?)(?:\/(.*))?$/;
  const filePath = /^\/?storage\/buckets\/([^/]+)\/files(?:\/([^/]+?))?(?:\/(download|view|preview))?$/;
  const bucketPath = /^\/?storage\/buckets\/([^/]+)$/;

  const coll = (db: string, col: string) => {
    const key = `${db}/${col}`;
    let map = collections.get(key);
    if (!map) { map = new Map(); collections.set(key, map); }
    return map;
  };
  const bucket = (id: string) => {
    let map = buckets.get(id);
    if (!map) { map = new Map(); buckets.set(id, map); }
    return map;
  };

  const listDocuments = (map: Map<string, Record<string, unknown>>, url: URL): Response => {
    let rows = [...map.values()];
    let orderKey: string | undefined;
    let limit = 5000;
    let offset = 0;
    let cursorAfter: string | undefined;
    for (const raw of url.searchParams.getAll('queries[]')) {
      let q: ParsedQuery;
      try { q = JSON.parse(raw); } catch { return json(400, { message: 'bad query' }); }
      if (q.method === 'equal' && typeof q.attribute === 'string')
        rows = rows.filter(r => (r as Record<string, unknown>)[q.attribute!] === q.values?.[0]);
      else if (q.method === 'orderAsc') orderKey = typeof q.attribute === 'string' ? q.attribute : '$id';
      else if (q.method === 'orderDesc') { /* tests do not need desc */ }
      else if (q.method === 'limit') limit = Number(q.values?.[0]) || limit;
      else if (q.method === 'offset') offset = Number(q.values?.[0]) || 0;
      else if (q.method === 'cursorAfter') cursorAfter = String(q.values?.[0]);
    }
    if (orderKey) rows.sort((a, b) => String(a[orderKey!] ?? '').localeCompare(String(b[orderKey!] ?? '')));
    if (cursorAfter !== undefined) rows = rows.filter(r => String(r.$id) > cursorAfter!);
    const total = rows.length;
    return json(200, { total, documents: rows.slice(offset, offset + limit) });
  };

  async function handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (failing) return json(503, { message: 'fixture outage' });
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/v1(?=\/)/, '');

    // ── MA function transport: POST {endpoint} with {path:'/api/ma-v/v1/…'} ──
    if (options.maEndpoint && url.origin + '/v1' === options.maEndpoint && method === 'POST') {
      const outer = JSON.parse(String(init?.body ?? '{}')) as { path?: string; method?: string; headers?: Record<string, string> };
      const inner = outer.path ?? '';
      const reply = (status: number, data: unknown) =>
        json(200, { status: 'completed', responseStatusCode: status, responseBody: JSON.stringify({ data }) });
      const credential = outer.headers?.['authorization'] ?? '';
      const profile = actors[credential];
      if (!profile || profile.revoked) return reply(401, { message: 'rejected' });
      if (inner === '/api/ma-v/v1/me')
        return reply(200, { userId: profile.userId, status: 'active' });
      const inst = /^\/api\/ma-v\/v1\/application-instances\/([^/]+)$/.exec(inner);
      if (inst) {
        const record = profile.instances[decodeURIComponent(inst[1]!)];
        if (!record) return reply(403, { message: 'forbidden' });
        return reply(200, {
          applicationInstanceId: decodeURIComponent(inst[1]!), status: record.status ?? 'active',
          bizId: record.bizId, applicationId: record.applicationId, providerInstanceId: record.providerInstanceId,
        });
      }
      return reply(404, { message: 'unknown route' });
    }

    // Every Appwrite API call must carry the platform key the function resolved.
    if (headers.get('x-appwrite-key') !== options.apiKey) return json(401, { message: 'missing key' });

    const bm = bucketPath.exec(path);
    if (bm && method === 'GET') {
      const meta = bucketMeta.get(bm[1]!);
      return json(200, { $id: bm[1], $permissions: meta?.permissions ?? [], fileSecurity: meta?.fileSecurity ?? true });
    }

    const fm = filePath.exec(path);
    if (fm) {
      const [, bucketId, fileId, op] = fm;
      const files = bucket(bucketId!);
      if (!fileId && method === 'GET' && op === undefined) return json(200, { files: [], total: 0 });
      if (fileId === undefined && method === 'GET') return json(200, { $id: bucketId, $permissions: [], fileSecurity: true });
      if (fileId === undefined && method === 'POST') {
        const form = init?.body as FormData;
        const id = String(form.get('fileId'));
        const file = form.get('file') as File | null;
        if (files.has(id)) return json(409, { message: 'file exists' });
        files.set(id, { bytes: new Uint8Array(await file!.arrayBuffer()), name: file!.name, mime: file!.type, permissions: [] });
        return json(201, { $id: id });
      }
      const stored = fileId ? files.get(fileId) : undefined;
      if (!stored && method !== 'PUT') return json(404, { message: 'file not found' });
      if (method === 'GET' && (op === 'download' || op === 'view' || op === 'preview')) {
        return new Response(stored!.bytes.slice().buffer, { status: 200, headers: { 'content-type': stored!.mime || 'application/octet-stream' } });
      }
      if (method === 'GET') return json(200, { $id: fileId, name: stored!.name, mimeType: stored!.mime, $permissions: stored!.permissions });
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { permissions?: unknown[] };
        stored!.permissions = Array.isArray(body.permissions) ? body.permissions : stored!.permissions;
        return json(200, { $id: fileId, $permissions: stored!.permissions });
      }
      if (method === 'DELETE') { files.delete(fileId!); return new Response(null, { status: 204 }); }
      return json(400, { message: 'unsupported file op' });
    }

    const cm = collPath.exec(path);
    if (cm) {
      const db = cm[1]!, col = cm[2]!, rest = cm[3];
      if (rest === undefined && method === 'GET' && !url.searchParams.get('queries[]')) {
        const meta = collectionMeta.get(col);
        return json(200, { $id: col, $permissions: meta?.permissions ?? [], documentSecurity: meta?.documentSecurity ?? true });
      }
      if (rest === 'documents' && method === 'GET') return listDocuments(coll(db, col), url);
      if (rest === 'documents' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { documentId: string; data?: Record<string, unknown>; permissions?: unknown[] };
        const map = coll(db!, col!);
        if (map.has(body.documentId)) return json(409, { message: 'document exists' });
        if (storeThenFailNextDoc) {
          storeThenFailNextDoc = false;
          map.set(body.documentId, { ...(body.data ?? {}), $id: body.documentId, $createdAt: new Date().toISOString(), $updatedAt: new Date().toISOString(), $permissions: body.permissions ?? [] });
          return json(503, { message: 'ambiguous create landed but response failed' });
        }
        const now = new Date().toISOString();
        const doc = { ...(body.data ?? {}), $id: body.documentId, $createdAt: now, $updatedAt: now, $permissions: body.permissions ?? [] };
        map.set(body.documentId, doc);
        return json(201, doc);
      }
      const dm = /^documents\/(.+)$/.exec(rest ?? '');
      if (dm) {
        const id = decodeURIComponent(dm[1]!);
        const map = coll(db!, col!);
        const doc = map.get(id);
        if (method === 'GET') return doc ? json(200, doc) : json(404, { message: 'not found' });
        if (!doc) return json(404, { message: 'not found' });
        if (method === 'PATCH' || method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { data?: Record<string, unknown> };
          Object.assign(doc, body.data ?? {}, { $updatedAt: new Date().toISOString() });
          return json(200, doc);
        }
        if (method === 'DELETE') { map.delete(id); return new Response(null, { status: 204 }); }
      }
      return json(404, { message: `unhandled collection route ${method} ${path}` });
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  }

  return {
    fetch: handle as typeof fetch,
    collections,
    buckets,
    /** Test hook: every subsequent call fails with 503 until cleared. */
    setFailing(value: boolean) { failing = value; },
    /** Test hook: next document POST lands the row, then fails the response —
     * the caller cannot prove whether the write succeeded. */
    landAndFailNextDocument() { storeThenFailNextDoc = true; },
    /** Preflight control: override a collection's metadata privacy. */
    setCollectionMeta(col: string, meta: { permissions?: unknown[]; documentSecurity?: boolean } | undefined) {
      if (meta) collectionMeta.set(col, meta); else collectionMeta.delete(col);
    },
    setBucketMeta(bucket: string, meta: { permissions?: unknown[]; fileSecurity?: boolean } | undefined) {
      if (meta) bucketMeta.set(bucket, meta); else bucketMeta.delete(bucket);
    },
    doc(db: string, col: string, id: string) { return coll(db, col).get(id); },
  };
}

export type AppwriteFixture = ReturnType<typeof createAppwriteFixture>;
