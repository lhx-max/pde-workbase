# Canvas Provider project IDs — compact canonical form, legacy compatibility, flush barrier

2026-10-22. Records the Provider (`/open-platform/v1/instances/:pid/actions/:actionId`)
project-id algorithm change required by the Appwrite cloud registry, the
legacy-resolution compatibility rules, and the durability barrier on create.
Scope: `apps/server/src/routes/canvas-provider.ts` +
`apps/server/tests/canvas-provider.test.ts` only. No host/SDK/schema change.

## Why

The cloud project registry and canvas persistence use the project id directly
as the Appwrite `documentId` (`cloud-project-registry.ts` `documentId:
project.id`, `canvas-appwrite-persistence.ts` `documentId: projectId`).
Appwrite documentIds are limited to **36 chars**. The previous id was
`ma-` + full sha256 hex = **67 chars**, so every Provider-mapped project row
failed its cloud metadata write — the actual cloud blocker.

## Canonical algorithm (new creations and preferred resolution)

```
canvasProviderProjectId(tenantId, applicationId, providerInstanceId)
  = 'ma-' + sha256hex(canonical(['canvas', tenantId, applicationId, providerInstanceId]))[0:32]
```

- **35 chars** (`ma-` + 32 hex), inside the 36-char documentId limit.
- `canonical` is the existing stable serialization from `canvas/merge.ts`;
  the digest input is unchanged, so the id is still a pure server-side
  function of the **full** tenant + application + pid tuple — truncation only
  shortens the output, it does not narrow the input.
- Distinct tuples still produce distinct ids (tested across tenant,
  application, and pid axes).

## Legacy addressing (read/reuse only, never assigned)

```
legacyCanvasProviderProjectId(tenantId, applicationId, providerInstanceId)
  = 'ma-' + sha256hex(canonical(['canvas', tenantId, applicationId, providerInstanceId]))   // 67 chars
```

Resolution inside the per-key serial lock, before authorization:

1. `registry.get(compactId)` — a hit is the canonical target.
2. else `registry.get(legacyId)` — a hit is reused **after the identical full
   validation** (`project.teamId` must equal the request tenant and
   `metadata.canvasProvider` must canonically equal
   `{protocolVersion:'1.0', applicationId, providerInstanceId, tenantId}`).
3. else the compact id is the create target for `canvas.create` and the
   not-found subject for every other action.

Hard rules:

- **No migration**: a valid legacy row keeps serving under its 67-char id; no
  compact row is created for it, and `data.canvasInstanceId` keeps returning
  the legacy id.
- **No create-on-read / no aliasing**: `canvas.read`/`canvas.context`/
  `canvas.operations` on a missing instance return 404; only `canvas.create`
  creates, always under the compact id.
- **Fail closed on conflict**: a compact hit with a mismatched mapping, or a
  legacy hit whose `canvasProvider` metadata belongs to another tuple (or is
  absent — a name-squatting row), returns 403 `PROVIDER_MAPPING_FORBIDDEN`
  before any mutation. A truncated-digest collision therefore *fails the
  mapping check*; it can never silently adopt another tuple's project, and
  there is no compact↔legacy fallback after a hit.
- `operationId` digests (`ma-` + 64 hex) are unchanged: they are stored as an
  *attribute* of cloud operation rows whose `documentId` is a random
  `op-<uuid>`, so the 36-char limit does not apply.
- Frontend/host code always reads the returned `data.canvasInstanceId`; it
  never recomputes the id, so mixed compact/legacy fleets work unchanged.

## Durability barrier

`registry.create` on a cloud-backed registry only *schedules* the Appwrite
metadata write (the registry `onSave` tail). The route dependency type gains
an optional `flush?(): Promise<void> | void`, and the handler now runs

```
if (body.actionId === 'canvas.create') await deps.registry.flush?.();
```

after the mapping is created or validated and **before** the new instance is
read or acknowledged — covering fresh creates and create replays alike. A
still-pending or previously-failed flush therefore surfaces as
5xx `PROVIDER_STORAGE_ERROR` instead of a fake success; a replayed create on
a locally-present-but-undurable row keeps failing rather than reporting a
durable instance. Local registries may omit `flush` (no-op via `?.`). The
existing authorization, CAS/replay, archived and mapping guards are
unchanged.

## Limits / notes

- Legacy 67-char rows can only ever exist in **local** registries — they were
  never writable as cloud documentIds — so the compatibility path is
  exercised by local storage (and by cloud `ready` only insofar as a cloud
  row id could theoretically be that long; Appwrite rejects it at write).
- Compact truncation raises the theoretical collision surface from 2^256 to
  2^128 (birthday-bound ~2^64 ids for a 50% collision) — irrelevant at any
  realistic project count, and a collision still fails closed at the mapping
  check rather than cross-adopting.
- `pnpm guard` could not run in this sandbox (tsx IPC `listen()` is blocked,
  `EPERM`); no package.json/symlink/`.js`-source/test-location changes were
  made, so the checks it enforces are unaffected.

## Evidence

```text
$ cd apps/server && ../../node_modules/.bin/vitest run tests/canvas-provider.test.ts
 Test Files  1 passed (1)
      Tests  27 passed (27)
```

```text
$ cd apps/server && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit \
    && ../../node_modules/.bin/tsc -p tsconfig.tests.json --noEmit
# 0 errors
```

New coverage: 35-char canonical shape + tuple distinctness; legacy mapping
read/ops/create-replay reuse with no compact row created; conflicting and
metadata-absent legacy rows → 403 before mutation; compact preferred when
both forms valid; pure-missing read → 404 with no creation; flush barrier
gates the HTTP ack; flush failure → 500 `PROVIDER_STORAGE_ERROR` on create
and on replay. All 21 pre-existing tests unchanged and green.

The real-Appwrite Provider probe (cloud `documentId` round-trip with a
35-char id) is owned by root integration and is deliberately not claimed
here.
