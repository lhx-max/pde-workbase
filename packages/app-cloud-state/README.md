# @ks-designai/app-cloud-state

Versioned JSON state slots on a single Appwrite collection, under a strict
single-writer contract. Node 24, ESM, zero runtime dependencies — the caller
injects a structural Appwrite client and owns endpoint, project and
credentials. This package never holds or logs credentials.

The cloud owns **versioned business slots** (one Appwrite document per slot).
It is *not* a directory or SQLite-file backup mechanism: payloads are opaque
JSON values up to 1 MiB each.

## API

```ts
import { AppwriteJsonState } from '@ks-designai/app-cloud-state';

const state = new AppwriteJsonState({
  client,            // structural Appwrite client (below)
  databaseId,        // Appwrite database id
  collectionId,      // Appwrite collection id (see schema below)
  namespace,         // explicit namespace; never inferred from cwd/env
  singleWriter: true, // REQUIRED acknowledgement — must be literally `true`
  initialize: true,  // optional one-time bootstrap acknowledgement
});

await state.ready;          // load namespace rows; rejects on unavailable/corrupt
const value = state.read('k');   // deep clone, or undefined
state.write('k', { ok: true });  // synchronous snapshot + queued write
await state.flush();             // durability barrier
```

Exports: `CloudStateError`, `JsonStatePort`, `AppwriteJsonState`,
`AppwriteStateClient`, `AppwriteJsonStateOptions`, `MANIFEST_SLOT`,
`stateDocumentId`.

### Client contract

```ts
interface AppwriteStateClient {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
  getOrNull<T>(path: string): Promise<T | null>;      // 404 -> null
  docsPath(databaseId: string, collectionId: string): string;
  // e.g. `/databases/<db>/collections/<col>/documents`
}
```

Any object with this shape works (an existing Appwrite REST client, an
Appwrite Function transport, or a test double). No vendor SDK is imported.

## Collection schema (exact)

One document per `(namespace, slot)`. Attributes:

| attribute   | type     | contents |
|-------------|----------|----------|
| `namespace` | string   | exact-equality queried namespace |
| `slot`      | string   | business key, or `__manifest__` for the reserved manifest row |
| `revision`  | integer  | `>= 0`, monotonically incremented by the single writer |
| `payload`   | string   | serialized JSON value, max **1 MiB** (1 048 576 bytes) |
| `updatedAt` | string (ISO datetime) | ISO timestamp of the last write |

Document id is deterministic: **first 36 hex chars of
`sha256(JSON.stringify([namespace, slot]))`**
(`stateDocumentId(namespace, slot)` computes it). A fresh process
re-derives the same ids, and a row whose `$id` does not match its
`namespace`/`slot` is treated as corruption.

The reserved manifest row (`slot === '__manifest__'`) establishes the
namespace and schema version. Its `payload` is exactly:

```json
{"kind":"app-cloud-state/manifest","schemaVersion":1,"namespace":"<namespace>"}
```

Rows are listed with serialized Appwrite Query objects —
`equal(namespace, <ns>)` + `orderAsc($id)` + `limit(100)` + `cursorAfter(<id>)`
for pagination — sent as `queries[]=<json>` params. Pages that do not
advance, oversized pages, duplicate slots, unparsable payloads or any field
mismatch fail the load closed (`CLOUD_STATE_CORRUPT`), never partially.

## Single writer — explicit, required

`singleWriter` must be literally `true`; any other value (including a
missing field) makes the constructor throw. This is an acknowledgement, not
a feature: **there is no distributed CAS, no optimistic-concurrency token,
and no automatic replica safety.** Revisions are last-writer-wins *within*
the one owning process. If two writers ever touch a namespace, a write-side
409 surfaces as `CLOUD_STATE_CONFLICT` and the instance poisons — it does
not merge, retry or overwrite.

## Initialization — explicit, required

A namespace without a manifest row is **unavailable**
(`CLOUD_STATE_MANIFEST_MISSING`), not empty. A missing collection is likewise
**unavailable** (`CLOUD_STATE_UNAVAILABLE`), never silently empty.

`initialize: true` is an explicit, isolated bootstrap acknowledgement: when
the listing shows no manifest, the package creates *only* the manifest
document — never collection schema, indexes or ACLs. If the create races
another initializer and returns 409, the existing manifest is re-read and
validated (`schemaVersion === 1`, matching namespace); it is never reset or
overwritten.

## Failure semantics

- `read`/`write` before `ready` resolves throw `CLOUD_STATE_NOT_READY`.
- `write` validates the value first: `undefined`, functions, symbols, bigint,
  non-finite numbers, cyclic graphs, non-plain objects (`Date`, `Map`, class
  instances) and symbol-keyed properties are rejected
  (`CLOUD_STATE_INVALID_PAYLOAD`) rather than silently coerced. Payloads over
  1 MiB are rejected (`CLOUD_STATE_PAYLOAD_TOO_LARGE`) **before** any
  in-memory mutation.
- `write` serializes the value at call time into an immutable snapshot —
  later mutation of the caller's object cannot affect memory or the queued
  request — then queues one POST (new slot) or PATCH (existing slot) per
  write, serially, with monotonic revisions. `flush()` waits for all queued
  writes.
- Any asynchronous persistence failure **poisons** the backend: every
  subsequent `read`, `write` and `flush` throws the recorded failure. There
  is no in-memory success, no default-empty fallback and no automatic
  overwrite — the remote state is uncertain and a restart (fresh instance)
  is required.
- Upstream/network errors are wrapped into stable `CloudStateError`s;
  response bodies are never copied into messages.

## Error codes

| code | status | meaning |
|------|--------|---------|
| `CLOUD_STATE_NOT_CONFIGURED` | 503 | missing client/ids/namespace, or `singleWriter !== true` |
| `CLOUD_STATE_NOT_READY` | 503 | `read`/`write` before `ready` |
| `CLOUD_STATE_UNAVAILABLE` | 503 | collection missing or unreachable; manifest unreadable |
| `CLOUD_STATE_MANIFEST_MISSING` | 503 | namespace not initialized; pass `initialize:true` deliberately |
| `CLOUD_STATE_SCHEMA_VERSION` | 503 | manifest `schemaVersion` is not 1 |
| `CLOUD_STATE_CORRUPT` | 503 | malformed/duplicate rows, key or `$id` mismatch, stalled pagination |
| `CLOUD_STATE_INVALID_SLOT` | 400 | empty or >240-char key |
| `CLOUD_STATE_RESERVED_SLOT` | 400 | `__manifest__` is not a business key |
| `CLOUD_STATE_INVALID_PAYLOAD` | 400 | non-JSON value |
| `CLOUD_STATE_PAYLOAD_TOO_LARGE` | 413 | serialized payload exceeds 1 MiB |
| `CLOUD_STATE_CONFLICT` | 409 | unexpected document conflict — external writer |
| `CLOUD_STATE_INCONSISTENT` | 503 | document vanished mid-write |
| `CLOUD_STATE_PERSIST` | 502 | queued write failed; backend poisoned, restart required |

## Scripts

- `pnpm build` — `tsc` to `dist/` (ESM + declarations)
- `pnpm typecheck` — `tsc --noEmit` for `src/` and `tests/`
- `pnpm test` — `vitest run`

## Limitations

- No delete API — represent empty values explicitly.
- No cross-slot transactions; the serial queue orders writes but a mid-queue
  failure still poisons the backend.
- Payloads are whole values per slot; there is no field-level patching.
- Correctness assumes the collection schema above exists and the injected
  client is authenticated; both are deployment concerns owned by the caller.

## Runtime ownership and private deployment preflight

The canonical Canvas, Doc and Sketch entrypoints acquire AppwriteWriterLock before opening their stores. The lock uses an atomic document create in the configured runtime collection, with a fixed service name; a second writer fails. Graceful shutdown flushes before releasing the same owner's lock. There is no TTL takeover or fencing: after a crash, verify every old process stopped before explicitly handling its stale lock. Embedders must arrange the same ownership barrier; the JsonStatePort singleWriter option alone is an assertion.

assertPrivateAppwriteStorage performs a read-only production preflight: collections require documentSecurity=true and no collection grants, buckets require fileSecurity=true and no bucket grants. It never repairs ACLs. Existing users-readable development storage does not satisfy this deployment contract. Application upload clients explicitly confirm empty grants only on newly created objects; conflicts do not modify another existing object's permissions.
