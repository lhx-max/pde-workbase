# Cloud project file events (`GET /api/projects/:id/events`)

`registerCloudProjectFileEvents` in `apps/server/src/routes/cloud-project-file-events.ts`
provides the cloud-authoritative replacement for the legacy local file-watch SSE
endpoint. Root wires it **before** `registerProjectFileRoutes` (same ordering rule as
`registerCloudProjectFileRoutes`) so this handler wins route registration on
cloud-backed deployments.

## Semantics — best-effort invalidation, not a log

This stream is a **best-effort file invalidation signal**, not a durable
revision log or event history:

- Events are produced by polling the current cloud index snapshot and diffing
  `name`/`path`/`size`/`mtime`/`mime`/`kind`. Changes that happen and revert
  between polls are invisible; bursts coalesce into the per-poll diff.
- There is no cursor, replay, or durability guarantee. A reader that falls
  behind (backpressure) or disconnects is simply closed — reconnecting
  re-baselines from the current cloud snapshot.
- The canvas operation event stream (`/api/apps/canvas/instances/:id/events`)
  remains the separate, authoritative operation history. This endpoint never
  substitutes for it.

## Authorization model

- `isAuthorized(req, projectId)` is injected by root and independently
  revalidates **current** MA membership / instance / project ownership on every
  call. The route never trusts request-body fields or self-reported tenant
  headers, and never caches a grant.
- The callback receives no `Response`; the route owns every error.
- Checks run: once before the initial snapshot (denied → `403`), fresh before
  each change batch is emitted, and fresh before each heartbeat. A revoked or
  erroring check after headers produces a sanitized `stream-error` event and
  the stream closes with no further content.
- The initial `files.list` snapshot is taken only after the first authorization
  passes, and it emits nothing — only subsequent diffs produce events.

## Failure and capacity contract

- Unknown project → `404 PROJECT_NOT_FOUND`.
- Access denied → `403 FORBIDDEN`.
- Capacity: at most 64 concurrent streams per registered route; further
  requests are rejected `503 EVENT_STREAM_CAPACITY` before any content.
- Storage/authorization failures before headers → `503
  CLOUD_STORAGE_UNAVAILABLE`; after headers → `stream-error
  {code: CLOUD_STORAGE_UNAVAILABLE}` then close. Raw cloud/transport messages
  are never serialized to the client.
- Revocation after headers → `stream-error {code: FORBIDDEN}` then close.

## Polling, heartbeat, teardown

- Poll cadence defaults to 3000 ms, clamped to [100, 60000] ms
  (`minPollIntervalMs` lowers the floor for tests; production callers leave the
  defaults). Polls are sequential and non-overlapping — the next tick is
  scheduled only after the previous one settles.
- A heartbeat comment frame is written every 20 s after a fresh authorization
  recheck.
- `close`, `aborted`, and `finish` all tear down the poll timer, heartbeat, and
  capacity slot. If `res.write` reports backpressure the stream is closed
  rather than buffered (see semantics above).

## Source

The only data source is `CloudProjectFiles.list(projectId)` — current cloud
snapshots. There is no filesystem watcher, chokidar, or local-disk fallback;
unconfigured cloud storage surfaces as the sanitized `503`/`stream-error`
paths above, never as silent local reads.

## Root 集成复核

已在云端路由注册、旧本地 watcher 之前接入。Root 修正并发预检期间的连接计数，在每轮云端轮询前及变更发送前重新鉴权；重复文件名的快照拒绝处理。云端列表是最多数秒延迟的 UI 失效提示，不能代替画布操作日志或作为版本基线。
