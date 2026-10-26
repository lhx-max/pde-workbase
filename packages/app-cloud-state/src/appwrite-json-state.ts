import { createHash } from 'node:crypto';
import { CloudStateError } from './errors.js';
import type { AppwriteJsonStateOptions, AppwriteStateClient, JsonStatePort } from './port.js';

/** Reserved slot carrying the namespace manifest; never a business value. */
export const MANIFEST_SLOT = '__manifest__';

const SCHEMA_VERSION = 1;
const MANIFEST_KIND = 'app-cloud-state/manifest';
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB, enforced before memory mutation
const MAX_VALUE_DEPTH = 512;
const PAGE_LIMIT = 100;

/** Collection row shape: namespace (string), slot (string), revision
 * (integer >= 0), payload (string holding serialized JSON), updatedAt
 * (datetime string). `$id` is the deterministic document id. */
interface StateRow {
  $id: string;
  namespace: string;
  slot: string;
  revision: number;
  payload: string;
  updatedAt: string;
}

interface QueuedWrite {
  slot: string;
  revision: number;
  payload: string;
  existed: boolean;
}

/** Document id: first 36 hex chars of sha256 over
 * `JSON.stringify([namespace, slot])`. Deterministic across instances, so a
 * fresh process re-derives the same ids. */
export function stateDocumentId(namespace: string, slot: string): string {
  return createHash('sha256').update(JSON.stringify([namespace, slot]), 'utf8').digest('hex').slice(0, 36);
}

// Serialized Appwrite Query objects — the only query form internal
// Appwrite accepts on the documents path.
const qEqual = (attribute: string, value: string) => JSON.stringify({ method: 'equal', attribute, values: [value] });
const qOrderAsc = (attribute: string) => JSON.stringify({ method: 'orderAsc', attribute });
const qLimit = (n: number) => JSON.stringify({ method: 'limit', values: [n] });
const qCursorAfter = (id: string) => JSON.stringify({ method: 'cursorAfter', values: [id] });
const qEncode = (queries: string[]) => queries.map(q => `queries[]=${encodeURIComponent(q)}`).join('&');

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function corrupt(why: string): never {
  throw new CloudStateError(503, 'CLOUD_STATE_CORRUPT', `malformed cloud state data: ${why}`);
};

function invalidPayload(why: string): never {
  throw new CloudStateError(400, 'CLOUD_STATE_INVALID_PAYLOAD', `value is not JSON: ${why}`);
};

/** Strict JSON-value gate run before serialization so nothing is silently
 * coerced: rejects undefined, functions, symbols, bigint, non-finite numbers,
 * cyclic graphs, non-plain objects (Date, Map, class instances…) and
 * symbol-keyed properties. */
function assertJsonValue(value: unknown, seen: Set<object>, depth: number): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidPayload('non-finite number');
    return;
  }
  if (typeof value !== 'object') invalidPayload(typeof value);
  if (depth > MAX_VALUE_DEPTH) invalidPayload('nesting too deep');
  if (seen.has(value)) invalidPayload('cyclic reference');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, seen, depth + 1);
    } else {
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) invalidPayload('non-plain object');
      for (const symbol of Object.getOwnPropertySymbols(value))
        if (Object.getOwnPropertyDescriptor(value, symbol)?.enumerable) invalidPayload('symbol-keyed property');
      for (const key of Object.keys(value)) assertJsonValue((value as Record<string, unknown>)[key], seen, depth + 1);
    }
  } finally {
    seen.delete(value);
  }
}

/** Cloud-owned, versioned JSON business slots on one Appwrite collection.
 * Not a directory or SQLite-file backup: each slot is one document carrying
 * an opaque JSON payload. */
export class AppwriteJsonState implements JsonStatePort {
  readonly ready: Promise<void>;

  private readonly client: AppwriteStateClient;
  private readonly databaseId: string;
  private readonly collectionId: string;
  private readonly namespace: string;
  private readonly initialize: boolean;

  private slots = new Map<string, { value: unknown; revision: number }>();
  private tail: Promise<void> = Promise.resolve();
  private failure: CloudStateError | null = null;
  private loaded = false;

  constructor(options: AppwriteJsonStateOptions) {
    if (!options || typeof options !== 'object')
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_CONFIGURED', 'options are required');
    const { client, databaseId, collectionId, namespace } = options;
    if (!client || typeof client.call !== 'function' || typeof client.getOrNull !== 'function' || typeof client.docsPath !== 'function')
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_CONFIGURED', 'client with call/getOrNull/docsPath is required');
    if (typeof databaseId !== 'string' || databaseId.length === 0)
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_CONFIGURED', 'databaseId is required');
    if (typeof collectionId !== 'string' || collectionId.length === 0)
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_CONFIGURED', 'collectionId is required');
    if (typeof namespace !== 'string' || namespace.length === 0 || namespace.length > 240)
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_CONFIGURED', 'explicit non-empty namespace is required (never inferred)');
    if (options.singleWriter !== true)
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_CONFIGURED',
        'singleWriter must be explicitly true: no distributed CAS or replica safety is provided');
    this.client = client;
    this.databaseId = databaseId;
    this.collectionId = collectionId;
    this.namespace = namespace;
    this.initialize = options.initialize === true;
    this.ready = this.load().then(() => undefined, (error: unknown) => {
      this.failure = error instanceof CloudStateError
        ? error
        : new CloudStateError(503, 'CLOUD_STATE_UNAVAILABLE', 'cloud state unavailable');
      throw this.failure;
    });
    // Every failure still surfaces through ready, read, write and flush; this
    // handler only keeps an un-awaited ready from tripping Node's
    // unhandled-rejection crash.
    void this.ready.catch(() => {});
  }

  private collectionPath(): string {
    return this.client.docsPath(this.databaseId, this.collectionId);
  }

  private assertUsable(): void {
    if (this.failure) throw this.failure;
    if (!this.loaded)
      throw new CloudStateError(503, 'CLOUD_STATE_NOT_READY', 'cloud state is not ready: await port.ready first');
  }

  private checkSlot(key: unknown): string {
    if (typeof key !== 'string' || key.length === 0 || key.length > 240)
      throw new CloudStateError(400, 'CLOUD_STATE_INVALID_SLOT', 'slot key must be a non-empty string of at most 240 chars');
    if (key === MANIFEST_SLOT)
      throw new CloudStateError(400, 'CLOUD_STATE_RESERVED_SLOT', `slot name ${MANIFEST_SLOT} is reserved`);
    return key;
  }

  read(key: string): unknown | undefined {
    this.assertUsable();
    const entry = this.slots.get(this.checkSlot(key));
    return entry === undefined ? undefined : structuredClone(entry.value);
  }

  write(key: string, value: unknown): void {
    this.assertUsable();
    const slot = this.checkSlot(key);
    // Validate and serialize up front: the payload string is the immutable
    // snapshot, so a caller mutating `value` after write() returns can never
    // leak into memory or the queued request. The 1 MiB bound is enforced
    // before any in-memory state changes.
    assertJsonValue(value, new Set(), 0);
    const payload = JSON.stringify(value);
    if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES)
      throw new CloudStateError(413, 'CLOUD_STATE_PAYLOAD_TOO_LARGE', 'slot payload exceeds the 1 MiB limit');
    const snapshot: unknown = JSON.parse(payload);
    const prior = this.slots.get(slot);
    const revision = prior === undefined ? 0 : prior.revision + 1;
    this.slots.set(slot, { value: snapshot, revision });
    const op: QueuedWrite = { slot, revision, payload, existed: prior !== undefined };
    this.tail = this.tail.then(() => this.persist(op));
  }

  async flush(): Promise<void> {
    await this.ready;
    await this.tail;
    if (this.failure) throw this.failure;
  }

  private async persist(op: QueuedWrite): Promise<void> {
    if (this.failure) return;
    try {
      const data = {
        namespace: this.namespace,
        slot: op.slot,
        revision: op.revision,
        payload: op.payload,
        updatedAt: new Date().toISOString(),
      };
      if (op.existed) {
        await this.client.call('PATCH', `${this.collectionPath()}/${encodeURIComponent(stateDocumentId(this.namespace, op.slot))}`, { data });
      } else {
        await this.client.call('POST', this.collectionPath(), { documentId: stateDocumentId(this.namespace, op.slot), data, permissions:[] });
      }
    } catch (error) {
      this.poison(error);
    }
  }

  /** A failed write leaves remote state uncertain — the queued revision may
   * or may not have landed. Never report in-memory success, never retry or
   * overwrite automatically: poison the backend and require a restart. */
  private poison(error: unknown): void {
    if (this.failure) return;
    const status = statusOf(error);
    if (status === 409)
      this.failure = new CloudStateError(409, 'CLOUD_STATE_CONFLICT', 'cloud state conflict: another writer touched the namespace; restart required');
    else if (status === 404)
      this.failure = new CloudStateError(503, 'CLOUD_STATE_INCONSISTENT', 'cloud state document vanished mid-write; restart required');
    else if (error instanceof CloudStateError)
      this.failure = error;
    else
      this.failure = new CloudStateError(502, 'CLOUD_STATE_PERSIST', 'cloud state persistence failed; restart required');
  }

  private async load(): Promise<void> {
    const rows = await this.listRows();
    const slots = new Map<string, { value: unknown; revision: number }>();
    let manifest: unknown;
    for (const raw of rows) {
      const parsed = this.parseRow(raw);
      if (slots.has(parsed.row.slot) || (parsed.row.slot === MANIFEST_SLOT && manifest !== undefined))
        corrupt(`duplicate slot ${JSON.stringify(parsed.row.slot)}`);
      if (parsed.row.slot === MANIFEST_SLOT) manifest = parsed.value;
      else slots.set(parsed.row.slot, { value: parsed.value, revision: parsed.row.revision });
    }
    if (manifest !== undefined) this.assertManifest(manifest);
    else if (this.initialize) await this.createManifest();
    else throw new CloudStateError(503, 'CLOUD_STATE_MANIFEST_MISSING',
      'cloud state namespace has no manifest; pass initialize:true for an explicit one-time bootstrap');
    this.slots = slots;
    this.loaded = true;
  }

  /** All rows of this namespace, fetched with exact-equality queries and
   * deterministic $id-ordered cursor pagination. */
  private async listRows(): Promise<StateRow[]> {
    const rows: StateRow[] = [];
    let cursor: string | null = null;
    for (;;) {
      const queries = [qEqual('namespace', this.namespace), qOrderAsc('$id'), qLimit(PAGE_LIMIT)];
      if (cursor !== null) queries.push(qCursorAfter(cursor));
      let page: { documents?: unknown };
      try {
        page = await this.client.call('GET', `${this.collectionPath()}?${qEncode(queries)}`);
      } catch (error) {
        const status = statusOf(error);
        throw new CloudStateError(status === 401 || status === 403 ? status : 503,
          'CLOUD_STATE_UNAVAILABLE', 'cloud state collection unavailable');
      }
      if (!page || !Array.isArray(page.documents)) corrupt('list response is not a document page');
      const docs = page.documents;
      if (docs.length > PAGE_LIMIT) corrupt('page exceeds requested limit');
      if (docs.length === 0) break;
      const lastId = (docs[docs.length - 1] as { $id?: unknown }).$id;
      if (typeof lastId !== 'string' || lastId.length === 0) corrupt('row is missing $id');
      if (cursor !== null && lastId <= cursor) corrupt('pagination did not advance');
      rows.push(...(docs as StateRow[]));
      if (docs.length < PAGE_LIMIT) break;
      cursor = lastId;
    }
    return rows;
  }

  private parseRow(raw: unknown): { row: StateRow; value: unknown } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return corrupt('row is not an object');
    const record = raw as Record<string, unknown>;
    if (typeof record.$id !== 'string' || record.$id.length === 0) return corrupt('row is missing $id');
    if (record.namespace !== this.namespace) return corrupt('namespace key mismatch');
    if (typeof record.slot !== 'string' || record.slot.length === 0) return corrupt('row is missing slot');
    if (record.$id !== stateDocumentId(this.namespace, record.slot)) return corrupt('$id does not match namespace+slot');
    if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || (record.revision as number) < 0) return corrupt('revision must be an integer >= 0');
    if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) return corrupt('updatedAt must be a datetime string');
    if (typeof record.payload !== 'string'||Buffer.byteLength(record.payload)>MAX_PAYLOAD_BYTES) return corrupt('payload must be a bounded string');
    let value: unknown;
    try {
      value = JSON.parse(record.payload);
    } catch {
      return corrupt('payload is not valid JSON');
    }
    try{assertJsonValue(value,new Set(),0);}catch{return corrupt('payload contains a non-JSON value');}
    return {
      row: { $id: record.$id, namespace: this.namespace, slot: record.slot, revision: record.revision, payload: record.payload, updatedAt: record.updatedAt },
      value,
    };
  }

  private assertManifest(value: unknown): void {
    const manifest = value as Record<string, unknown> | null;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) corrupt('manifest payload is not an object');
    if (manifest.schemaVersion !== SCHEMA_VERSION)
      throw new CloudStateError(503, 'CLOUD_STATE_SCHEMA_VERSION', `unsupported cloud state schemaVersion ${JSON.stringify(manifest.schemaVersion)}`);
    if(manifest.kind!==MANIFEST_KIND||Object.keys(manifest).some(key=>!['kind','schemaVersion','namespace'].includes(key)))corrupt('manifest kind or fields mismatch');
    if (manifest.namespace !== this.namespace) corrupt('manifest namespace mismatch');
  }

  /** Bootstrap writes exactly the manifest document — never schema, indexes
   * or ACLs. A create conflict means another initializer ran: re-read and
   * validate the existing manifest, never reset it. */
  private async createManifest(): Promise<void> {
    const documentId = stateDocumentId(this.namespace, MANIFEST_SLOT);
    const data = {
      namespace: this.namespace,
      slot: MANIFEST_SLOT,
      revision: 0,
      payload: JSON.stringify({ kind: MANIFEST_KIND, schemaVersion: SCHEMA_VERSION, namespace: this.namespace }),
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.client.call('POST', this.collectionPath(), { documentId, data, permissions:[] });
    } catch (error) {
      if (statusOf(error) === 409) {
        let existing: StateRow | null;
        try {
          existing = await this.client.getOrNull<StateRow>(`${this.collectionPath()}/${encodeURIComponent(documentId)}`);
        } catch (lookupError) {
          const status = statusOf(lookupError);
          throw new CloudStateError(status === 401 || status === 403 ? status : 503,
            'CLOUD_STATE_UNAVAILABLE', 'cloud state manifest could not be re-read');
        }
        if (!existing) throw new CloudStateError(503, 'CLOUD_STATE_UNAVAILABLE', 'cloud state manifest conflicted but is missing');
        this.assertManifest(this.parseRow(existing).value);
        return;
      }
      const status = statusOf(error);
      throw new CloudStateError(status === 401 || status === 403 ? status : 502,
        'CLOUD_STATE_UNAVAILABLE', 'cloud state manifest could not be created');
    }
  }
}
