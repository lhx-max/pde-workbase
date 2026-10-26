/** Strict in-memory Appwrite + MA authority protocol fixture for the
 * four-container acceptance probe. Never a real cloud or formal MA result.
 *
 * Everything here validates before accepting state: collection attributes,
 * required fields, types, unknown keys, unique indexes, private permissions,
 * serialized Appwrite queries and exact file bytes. Any unrecognized upstream
 * path fails explicitly and is counted as an unexpected external request. */
import { PRIVATE_STORAGE_SCHEMAS, type AttributeSpec, type CollectionSpec } from '../../tools/provision/src/schemas.js';
import type { ProvisionClient } from '../../tools/provision/src/private-storage.js';

export interface FixtureReply {
  status: number;
  json?: unknown;
  bytes?: Uint8Array;
  mime?: string;
}

const reply = (status: number, body: unknown): FixtureReply => ({ status, json: body });
const refuse = (status: number, message: string): FixtureReply => reply(status, { message, type: 'fixture_error', code: `FIXTURE_${status}` });

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

interface CollectionRow {
  $id: string;
  name: string;
  enabled: boolean;
  documentSecurity: boolean;
  $permissions: unknown[];
  attributes: Row[];
  indexes: Row[];
}

interface FileRecord {
  fileId: string;
  bucketId: string;
  mime: string;
  name: string;
  permissions: unknown[];
  total: number;
  chunksTotal: number;
  parts: Map<number, Uint8Array>;
  createdAt: string;
}

export interface MaInstance {
  applicationInstanceId: string;
  status: 'active';
  bizId: string;
  applicationId: string;
  providerInstanceId: string;
}

const QUERY_METHODS = new Set(['equal', 'orderAsc', 'orderDesc', 'limit', 'offset', 'cursorAfter']);
const APPWRITE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,35}$/;

/** Deterministic ordering matches what the runtime adapters assume: rows are
 * always emitted in ascending $id order unless an explicit order query runs. */
const compareId = (a: Row, b: Row) => String(a.$id).localeCompare(String(b.$id));

export class PrivateAppwriteFixture {
  readonly projectId: string;
  readonly apiKey: string;
  /** One business space/team for the whole probe. */
  readonly teamId: string;
  private readonly databases = new Map<string, Row>();
  private readonly collections = new Map<string, CollectionRow>();
  private readonly documents = new Map<string, Row>();
  private readonly buckets = new Map<string, Row>();
  private readonly files = new Map<string, FileRecord>();
  /** MA directory: token -> userId; userId -> member instance ids. */
  private readonly users = new Map<string, string>();
  private readonly instances = new Map<string, MaInstance>();
  private readonly memberships = new Map<string, Set<string>>();
  private readonly revoked = new Set<string>();
  authorityReads = 0;
  appwriteRequests = 0;
  /** Any upstream request the fixture could not classify: each is a failure. */
  readonly unexpected: string[] = [];

  constructor(options: { projectId: string; apiKey: string; teamId: string }) {
    this.projectId = options.projectId;
    this.apiKey = options.apiKey;
    this.teamId = options.teamId;
  }

  /* ---------------- MA authority directory ---------------- */

  addUser(token: string, userId: string, memberInstances: readonly string[]): void {
    this.users.set(token, userId);
    this.memberships.set(userId, new Set(memberInstances));
  }
  addInstance(instance: MaInstance): void {
    this.instances.set(instance.applicationInstanceId, instance);
  }
  revoke(tokenOrUser: string): void { this.revoked.add(tokenOrUser); }
  unrevoke(tokenOrUser: string): void { this.revoked.delete(tokenOrUser); }

  /** MA published read contract: GET /api/ma-v/v1/me and
   * GET /api/ma-v/v1/application-instances/{id}. The same SSO + tenant must
   * succeed on both; membership is owned here, never by caller headers. */
  ma(pathname: string, headers: { get(name: string): string | null }): FixtureReply {
    this.authorityReads += 1;
    const route = pathname.replace(/^\/api\/ma-v\/v1/, '');
    const authorization = headers.get('authorization') ?? '';
    const credential = /^Bearer [A-Za-z0-9\-._~+/]+=*$/i.test(authorization) ? authorization : null;
    const token = credential?.slice('Bearer '.length) ?? '';
    if (headers.get('x-mav-tenant') !== this.teamId) return refuse(403, 'MA tenant rejected');
    if (!credential || !this.users.has(token) || this.revoked.has(token)) return refuse(401, 'SSO credential rejected');
    const userId = this.users.get(token)!;
    if (route === '/me') return reply(200, { data: { userId, status: 'active' } });
    const match = /^\/application-instances\/([^/]+)$/.exec(route);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      const instance = this.instances.get(id);
      if (!instance || !this.memberships.get(userId)?.has(id)) return refuse(403, 'MA application instance is not accessible');
      return reply(200, { data: { ...instance } });
    }
    this.unexpected.push(`MA ${pathname}`);
    return refuse(404, 'Unknown MA authority route');
  }

  /* ---------------- Appwrite protocol ---------------- */

  private authStorage(headers: { get(name: string): string | null }): FixtureReply | null {
    if (headers.get('x-appwrite-key') !== this.apiKey) return refuse(401, 'Appwrite credential rejected');
    if (headers.get('x-appwrite-project') !== this.projectId) return refuse(403, 'Appwrite project rejected');
    return null;
  }

  /** Handle one Appwrite REST request. `route` is the path after `/v1`
   * (query string allowed). `body` is a parsed JSON value or a FormData. */
  appwrite(method: string, route: string, headers: { get(name: string): string | null }, body?: unknown): FixtureReply {
    this.appwriteRequests += 1;
    const denied = this.authStorage(headers);
    if (denied) return denied;
    try {
      return this.handle(method, route, body);
    } catch (error) {
      const status = Number((error as { status?: unknown }).status ?? 500);
      return refuse(Number.isInteger(status) && status >= 400 && status < 600 ? status : 500,
        error instanceof Error ? error.message : 'fixture rejected the request');
    }
  }

  private fail(status: number, message: string): never {
    throw Object.assign(new Error(message), { status });
  }

  private collectionKey(db: string, coll: string) { return `${db}/${coll}`; }
  private docKey(db: string, coll: string, id: string) { return `${db}/${coll}/${id}`; }
  private fileKey(bucket: string, id: string) { return `${bucket}/${id}`; }

  private collection(db: string, coll: string): CollectionRow {
    const row = this.collections.get(this.collectionKey(db, coll));
    if (!row) this.fail(404, 'Collection does not exist');
    return row!;
  }

  /** Collection specs repeat across apps (notably app_runtime_state with
   * different sizes), so the schema is scoped by the owning database's app
   * prefix — `canvas_probe_private` selects the canvas spec. */
  private specFor(db: string, coll: string): CollectionSpec | undefined {
    const app = Object.keys(PRIVATE_STORAGE_SCHEMAS).find(name => db.startsWith(`${name}_`));
    return app ? PRIVATE_STORAGE_SCHEMAS[app]!.collections.find(c => c.id === coll) : undefined;
  }

  private checkData(spec: CollectionSpec | undefined, coll: CollectionRow, data: unknown, patch: boolean): Row {
    if (!isRow(data)) this.fail(400, 'document data must be an object');
    const attrs = spec ? spec.attributes : coll.attributes.map(a => ({
      key: String(a.key), type: String(a.type), required: a.required === true,
      ...(a.size !== undefined ? { size: Number(a.size) } : {}),
      ...(a.min !== undefined ? { min: Number(a.min) } : {}),
      ...(a.max !== undefined ? { max: Number(a.max) } : {}),
    })) as AttributeSpec[];
    const known = new Set(attrs.map(a => a.key));
    for (const key of Object.keys(data)) {
      if (key.startsWith('$')) this.fail(400, `document field ${key} is reserved`);
      if (!known.has(key)) this.fail(400, `unknown attribute ${key}`);
    }
    const out: Row = {};
    for (const attr of attrs) {
      const has = Object.hasOwn(data, attr.key);
      const value = (data as Row)[attr.key];
      if (!has) {
        if (!patch && attr.required) this.fail(400, `required attribute ${attr.key} is missing`);
        continue;
      }
      if (value === null) {
        if (attr.required) this.fail(400, `required attribute ${attr.key} cannot be null`);
        continue; // null clears an optional attribute
      }
      if (attr.type === 'string') {
        if (typeof value !== 'string') this.fail(400, `attribute ${attr.key} must be a string`);
        if (attr.size !== undefined && value.length > attr.size) this.fail(400, `attribute ${attr.key} exceeds size ${attr.size}`);
      } else {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) this.fail(400, `attribute ${attr.key} must be an integer`);
        if (attr.min !== undefined && value < attr.min) this.fail(400, `attribute ${attr.key} below minimum`);
        if (attr.max !== undefined && value > attr.max) this.fail(400, `attribute ${attr.key} above maximum`);
      }
      out[attr.key] = value;
    }
    return out;
  }

  private enforceUnique(db: string, collId: string, spec: CollectionSpec | undefined, candidate: Row, selfId: string): void {
    const indexes = spec ? spec.indexes.filter(i => i.type === 'unique') : [];
    for (const index of indexes) {
      const tuple = index.attributes.map(attr => candidate[attr] ?? null);
      if (tuple.every(v => v === null)) continue; // absent optional tuple never conflicts
      for (const [key, row] of this.documents) {
        if (!key.startsWith(`${db}/${collId}/`) || row.$id === selfId) continue;
        if (index.attributes.every((attr, i) => (row[attr] ?? null) === tuple[i])) {
          this.fail(409, `unique index ${index.key} conflict`);
        }
      }
    }
  }

  private listDocuments(db: string, coll: CollectionRow, query: string): FixtureReply {
    const collId = coll.$id;
    const params = new URLSearchParams(query);
    const parsed: Row[] = [];
    for (const raw of params.getAll('queries[]')) {
      let q: unknown;
      try { q = JSON.parse(raw); } catch { this.fail(400, 'malformed serialized query'); }
      if (!isRow(q) || typeof q.method !== 'string' || !QUERY_METHODS.has(q.method)) {
        this.fail(400, `unsupported query method ${isRow(q) ? String(q.method) : 'invalid'}`);
      }
      if (['equal','orderAsc','orderDesc'].includes(String(q.method))) {
        const attribute=String(q.attribute);
        if(!['$id','$createdAt','$updatedAt'].includes(attribute)&&!coll.attributes.some(a=>a.key===attribute))this.fail(400,'query attribute is not declared');
      }
      if(q.method==='equal'&&(!Array.isArray(q.values)||q.values.length===0))this.fail(400,'equality values required');
      if(['limit','offset'].includes(String(q.method))&&(!Array.isArray(q.values)||!Number.isSafeInteger(q.values[0])||Number(q.values[0])<(q.method==='limit'?1:0)))this.fail(400,'invalid pagination bound');
      parsed.push(q);
    }
    const prefix = `${db}/${collId}/`;
    let rows = [...this.documents.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([, row]) => structuredClone(row));
    for (const q of parsed) {
      if (q.method === 'equal') {
        const values = Array.isArray(q.values) ? q.values : [];
        rows = rows.filter(r => values.includes(r[String(q.attribute)]));
      }
    }
    const order = parsed.find(q => q.method === 'orderAsc' || q.method === 'orderDesc');
    if (order) {
      const attr = String(order.attribute), dir = order.method === 'orderDesc' ? -1 : 1;
      rows.sort((a, b) => {
        const av = a[attr], bv = b[attr];
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return cmp * dir;
      });
    } else {
      rows.sort(compareId);
    }
    const total = rows.length;
    // Appwrite pagination is semantic, independent of query-array order:
    // filters/order -> cursor -> offset -> limit. Applying limit before cursor
    // loses every later page when the cursor sits at the previous page's end.
    const cursor=parsed.find(q=>q.method==='cursorAfter');if(cursor){const index=rows.findIndex(r=>String(r.$id)===String((cursor.values as unknown[])?.[0]));if(index<0)this.fail(400,'cursor does not belong to this query');rows=rows.slice(index+1);}
    const offset=parsed.find(q=>q.method==='offset');if(offset)rows=rows.slice(Number((offset.values as unknown[])[0]));
    const limit=parsed.find(q=>q.method==='limit');rows=rows.slice(0,limit?Number((limit.values as unknown[])[0]):25);
    return reply(200, { total, documents: rows });
  }

  private fileRecord(bucket: string, fileId: string): FileRecord {
    const row = this.files.get(this.fileKey(bucket, fileId));
    if (!row || !this.buckets.has(bucket)) this.fail(404, 'file does not exist');
    return row!;
  }

  private filePublic(row: FileRecord): Row {
    const uploaded = row.parts.size;
    return {
      $id: row.fileId, bucketId: row.bucketId, $permissions: [...row.permissions],
      name: row.name, mimeOriginal: row.mime, sizeOriginal: row.total,
      chunksTotal: row.chunksTotal, chunksUploaded: uploaded, $createdAt: row.createdAt, $updatedAt: row.createdAt,
    };
  }

  private fileBytes(row: FileRecord): Uint8Array {
    if (row.parts.size !== row.chunksTotal) this.fail(404, 'file upload is incomplete');
    const out = new Uint8Array(row.total);
    let offset = 0;
    for (let index = 0; index < row.chunksTotal; index++) {
      const part = row.parts.get(index)!;
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  private handle(method: string, route: string, body: unknown): FixtureReply {
    const [rawPath, query = ''] = route.split('?', 2);
    const path = decodeURIComponent(rawPath!);
    const m = (re: RegExp) => re.exec(path);

    /* ---- provisioning + metadata surface ---- */
    let match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})$/);
    if (match && method === 'GET') {
      const db = this.databases.get(match[1]!);
      if (!db) this.fail(404, 'database does not exist');
      return reply(200, db);
    }
    match = m(/^\/databases$/);
    if (match && method === 'POST') {
      const b = body as Row;
      if (!isRow(b) || typeof b.databaseId !== 'string' || typeof b.name !== 'string' || b.enabled !== true) this.fail(400, 'invalid database create');
      const key = b.databaseId;
      if (this.databases.has(key)) this.fail(409, 'database exists');
      const row = { $id: key, name: b.name, enabled: true };
      this.databases.set(key, row);
      return reply(201, row);
    }
    match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/collections$/);
    if (match && method === 'POST') {
      const b = body as Row;
      if (!this.databases.has(match[1]!)) this.fail(404, 'database does not exist');
      if (!isRow(b) || typeof b.collectionId !== 'string' || typeof b.name !== 'string'
        || !Array.isArray(b.permissions) || b.permissions.length !== 0 || b.documentSecurity !== true || b.enabled !== true) {
        this.fail(400, 'invalid private collection create');
      }
      const key = this.collectionKey(match[1]!, b.collectionId as string);
      if (this.collections.has(key)) this.fail(409, 'collection exists');
      const row: CollectionRow = { $id: b.collectionId as string, name: b.name, enabled: true, documentSecurity: true, $permissions: [], attributes: [], indexes: [] };
      this.collections.set(key, row);
      return reply(201, row);
    }
    match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/collections\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/attributes\/(string|integer)$/);
    if (match && method === 'POST') {
      const coll = this.collection(match[1]!, match[2]!);
      const b = body as Row;
      if (!isRow(b) || typeof b.key !== 'string' || typeof b.required !== 'boolean' || b.array === true) this.fail(400, 'invalid attribute create');
      if (coll.attributes.some(a => a.key === b.key)) this.fail(409, 'attribute exists');
      const spec = this.specFor(match[1]!, match[2]!)?.attributes.find(a => a.key === b.key);
      if (spec && (spec.type !== match[3] || spec.required !== b.required
        || (spec.type === 'string' && spec.size !== b.size) || spec.min !== undefined && spec.min !== b.min || spec.max !== undefined && spec.max !== b.max)) {
        this.fail(400, `attribute ${String(b.key)} differs from the private schema contract`);
      }
      const row = { ...structuredClone(b), type: match[3], status: 'available' };
      coll.attributes.push(row);
      return reply(201, row);
    }
    match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/collections\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/indexes$/);
    if (match && method === 'POST') {
      const coll = this.collection(match[1]!, match[2]!);
      const b = body as Row;
      if (!isRow(b) || typeof b.key !== 'string' || !['key', 'unique'].includes(String(b.type))
        || !Array.isArray(b.attributes) || b.attributes.some(a => typeof a !== 'string')) this.fail(400, 'invalid index create');
      const declared = new Set(coll.attributes.map(a => String(a.key)));
      if ((b.attributes as unknown[]).some(a => !declared.has(a as string))) this.fail(400, 'index attribute is not declared');
      if (coll.indexes.some(i => i.key === b.key)) this.fail(409, 'index exists');
      const row = { ...structuredClone(b), status: 'available' };
      coll.indexes.push(row);
      return reply(201, row);
    }
    match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/collections\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})$/);
    if (match && method === 'GET') {
      return reply(200, this.collection(match[1]!, match[2]!));
    }

    /* ---- documents ---- */
    match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/collections\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/documents$/);
    if (match) {
      const coll = this.collection(match[1]!, match[2]!);
      if (method === 'GET') return this.listDocuments(match[1]!, coll, query);
      if (method === 'POST') {
        const b = body as Row;
        if (!isRow(b) || typeof b.documentId !== 'string' || !APPWRITE_ID.test(b.documentId)) this.fail(400, 'invalid documentId');
        if (b.permissions !== undefined && (!Array.isArray(b.permissions) || b.permissions.length !== 0)) this.fail(400, 'private documents accept no grants');
        const spec = this.specFor(match[1]!, coll.$id);
        const data = this.checkData(spec, coll, b.data, false);
        const candidate = { ...data };
        this.enforceUnique(match[1]!, coll.$id, spec, candidate, b.documentId as string);
        const key = this.docKey(match[1]!, coll.$id, b.documentId as string);
        if (this.documents.has(key)) this.fail(409, 'document already exists');
        const now = new Date().toISOString();
        const row = { $id: b.documentId, $permissions: [], $createdAt: now, $updatedAt: now, ...data };
        this.documents.set(key, row);
        return reply(201, structuredClone(row));
      }
    }
    match = m(/^\/databases\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/collections\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/documents\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})$/);
    if (match) {
      const coll = this.collection(match[1]!, match[2]!);
      const key = this.docKey(match[1]!, coll.$id, match[3]!);
      const existing = this.documents.get(key);
      if (!existing) this.fail(404, 'document does not exist');
      if (method === 'GET') return reply(200, structuredClone(existing));
      if (method === 'PATCH') {
        const b = body as Row;
        if (!isRow(b) || !isRow(b.data)) this.fail(400, 'invalid document patch');
        const spec = this.specFor(match[1]!, coll.$id);
        const patch = this.checkData(spec, coll, b.data, true);
        const next = { ...existing };
        for (const [key, value] of Object.entries(b.data)) {
          if (value === null) delete next[key];
          else next[key] = patch[key];
        }
        next.$updatedAt = new Date().toISOString();
        this.enforceUnique(match[1]!, coll.$id, spec, next, match[3]!);
        this.documents.set(key, next);
        return reply(200, structuredClone(next));
      }
      if (method === 'DELETE') {
        this.documents.delete(key);
        return { status: 204 };
      }
    }

    /* ---- buckets + files ---- */
    match = m(/^\/storage\/buckets$/);
    if (match && method === 'POST') {
      const b = body as Row;
      if (!isRow(b) || typeof b.bucketId !== 'string' || typeof b.name !== 'string'
        || !Array.isArray(b.permissions) || b.permissions.length !== 0 || b.fileSecurity !== true || b.enabled !== true) {
        this.fail(400, 'invalid private bucket create');
      }
      if (this.buckets.has(b.bucketId as string)) this.fail(409, 'bucket exists');
      const row = { $id: b.bucketId, $permissions: [], ...structuredClone(b) };
      delete (row as { bucketId?: unknown }).bucketId;
      this.buckets.set(b.bucketId as string, row);
      return reply(201, row);
    }
    match = m(/^\/storage\/buckets\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})$/);
    if (match && method === 'GET') {
      const bucket = this.buckets.get(match[1]!);
      if (!bucket) this.fail(404, 'bucket does not exist');
      return reply(200, bucket);
    }
    match = m(/^\/storage\/buckets\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/files$/);
    if (match && method === 'POST') {
      const bucket = this.buckets.get(match[1]!);
      if (!bucket) this.fail(404, 'bucket does not exist');
      if (bucket.fileSecurity !== true || !Array.isArray(bucket.$permissions) || bucket.$permissions.length !== 0) this.fail(403, 'bucket is not private');
      const form = body as { fileId?: unknown; file?: { name: string; type: string; bytes: Uint8Array } } | undefined;
      if (!form || typeof form.fileId !== 'string' || !APPWRITE_ID.test(form.fileId) || !form.file || !(form.file.bytes instanceof Uint8Array) || !form.file.bytes.byteLength) {
        this.fail(400, 'invalid file upload');
      }
      const fileId = form.fileId as string;
      const range = this.contentRange;
      const chunkIndex = range ? Math.floor(range.start / 5_000_000) : 0;
      const total = range ? range.total : form.file!.bytes.byteLength;
      const chunksTotal = Math.ceil(total / 5_000_000) || 1;
      const max = Number(bucket.maximumFileSize ?? 0);
      if (total > max) this.fail(413, 'file exceeds the bucket limit');
      if (range && (range.start !== chunkIndex * 5_000_000 || range.end !== Math.min(range.start + form.file!.bytes.byteLength, total) - 1 || form.file!.bytes.byteLength > 5_000_000)) {
        this.fail(400, 'content-range does not describe this chunk');
      }
      let record = this.files.get(this.fileKey(match[1]!, fileId));
      if (!record) {
        if (range && chunkIndex !== 0) this.fail(400, 'chunk upload must start at chunk 0');
        record = { fileId, bucketId: match[1]!, mime: form.file!.type || 'application/octet-stream', name: form.file!.name, permissions: [], total, chunksTotal, parts: new Map(), createdAt: new Date().toISOString() };
        this.files.set(this.fileKey(match[1]!, fileId), record);
      } else {
        if (!range) this.fail(409, 'file already exists');
        if (this.uploadId !== fileId) this.fail(400, 'x-appwrite-id does not match the upload target');
        if (record.total !== total || record.chunksTotal !== chunksTotal) this.fail(400, 'chunk plan changed mid-upload');
        if (record.parts.has(chunkIndex)) this.fail(409, 'chunk already uploaded');
      }
      record.parts.set(chunkIndex, form.file!.bytes);
      return reply(201, {
        $id: fileId, bucketId: match[1]!, $permissions: [], name: record.name,
        mimeOriginal: record.mime, sizeOriginal: total,
        chunksTotal: record.chunksTotal, chunksUploaded: record.parts.size,
      });
    }
    match = m(/^\/storage\/buckets\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})\/files\/([A-Za-z0-9][A-Za-z0-9_.-]{0,35})(\/(view|download|preview))?$/);
    if (match) {
      const record = this.fileRecord(match[1]!, match[2]!);
      if (method === 'GET' && !match[4]) return reply(200, this.filePublic(record));
      if (method === 'GET' && (match[4] === 'view' || match[4] === 'download')) {
        return { status: 200, bytes: this.fileBytes(record), mime: record.mime };
      }
      if (method === 'PUT' && !match[4]) {
        const b = body as Row;
        if (!isRow(b) || !Array.isArray(b.permissions) || b.permissions.length !== 0) this.fail(400, 'private files accept only empty permissions');
        record.permissions = [];
        return reply(200, this.filePublic(record));
      }
      if (method === 'DELETE' && !match[4]) {
        this.files.delete(this.fileKey(match[1]!, match[2]!));
        return { status: 204 };
      }
      this.fail(404, `unsupported file route ${match[4] ?? ''}`);
    }

    this.unexpected.push(`${method} ${path}`);
    this.fail(404, `unrecognized upstream route ${method} ${path}`);
  }

  /** Captured upload context for the in-flight POST (set by the gateway
   * before delegating; chunked Appwrite uploads use content-range +
   * x-appwrite-id headers). */
  private contentRange: { start: number; end: number; total: number } | undefined;
  private uploadId: string | undefined;
  setUploadContext(headers: { get(name: string): string | null }): void {
    this.contentRange = undefined;
    this.uploadId = undefined;
    const raw = headers.get('content-range');
    if (raw) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(raw);
      if (!match) throw Object.assign(new Error('malformed content-range'), { status: 400 });
      this.contentRange = { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
    }
    const id = headers.get('x-appwrite-id');
    if (id) this.uploadId = id;
  }

  /* ---------------- provisioning adapter ---------------- */

  /** In-process ProvisionClient over the same strict state: the operator
   * channel is credential-equivalent (provisioning itself asserts privacy). */
  provisionClient(): ProvisionClient {
    const fixture = this;
    const headers = { get: (name: string) => name === 'x-appwrite-key' ? fixture.apiKey : name === 'x-appwrite-project' ? fixture.projectId : null };
    const run = <T>(method: string, path: string, body?: unknown): T => {
      const result = fixture.appwrite(method, path, headers, body);
      if (result.status >= 400) throw Object.assign(new Error(`Provisioning request failed (HTTP ${result.status})`), { status: result.status });
      return (result.json ?? undefined) as T;
    };
    return {
      call: <T>(method: string, path: string, body?: unknown) => Promise.resolve(run<T>(method, path, body)),
      getOrNull: <T>(path: string) => {
        const result = fixture.appwrite('GET', path, headers);
        if (result.status === 404) return Promise.resolve(null);
        if (result.status >= 400) return Promise.reject(Object.assign(new Error(`Provisioning request failed (HTTP ${result.status})`), { status: result.status }));
        return Promise.resolve(result.json as T);
      },
      docsPath: (databaseId: string, collectionId: string) => `/databases/${encodeURIComponent(databaseId)}/collections/${encodeURIComponent(collectionId)}/documents`,
    };
  }

  /* ---------------- introspection for assertions ---------------- */

  document(db: string, coll: string, id: string): Row | undefined {
    const row = this.documents.get(this.docKey(db, coll, id));
    return row ? structuredClone(row) : undefined;
  }
  documentsIn(db: string, coll: string): Row[] {
    const prefix = `${db}/${coll}/`;
    return [...this.documents.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([, row]) => structuredClone(row));
  }
}
