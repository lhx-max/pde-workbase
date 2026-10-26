# Canvas MA Adapter — App-owned wrapper layer

2026-10-22. This records the App-side wrapper that mounts the canvas workbench
inside an MA session-app host. It is code + unit evidence only — it does **not**
claim MA registration, real host open, real Agent invocation, or staging.

## What ships

| File | Purpose |
| --- | --- |
| `packages/canvas-workbench/src/platform/ma-context.ts` | Pure contract mirror + validation: published context 1.0 shape, bounded-safe field checks, scope key, `canvas.read` envelope builder, response-mapping validator, sanitized unavailable codes/messages. No React. |
| `packages/canvas-workbench/src/platform/ma-app.tsx` | `createCanvasApp(options)` factory. Returns a React component typed to the published props `{ context, fileClient, conversation, providerClient }`. `context` controls routing; the remaining props are accepted for host compatibility (no invented SDK hooks). |
| `apps/web/tests/canvas-ma-app.test.tsx` | Vitest/jsdom tests. The real `CanvasWorkbenchSurface` is mocked; assertions prove wrapper flow only, not real canvas behavior. |
| `docs/CANVAS_MA_ADAPTER.md` | This report. |

Root integrated the public export and backend authentication; external host, SDK and menus remain owner-controlled.

## Consumed host contract (no invented props)

The host publishes `PluginComponentProps` = `{ context, fileClient, providerClient?, conversation }`.
Baseline inspected: `design-ai-client/yihan-dev-ma@fa9475183`,
`ma-v/src/session-apps/types.ts` (`ApplicationContextValue`) and
`SessionAppSurface.tsx` (actually passes `context/fileClient/conversation`;
`providerClient` is optional in the SDK type and never passed).

`context` fields (all required except `locale`, per the published type):
`applicationId, applicationVersion, applicationInstanceId, providerInstanceId,
bizId, sessionId, actor{userId,tenantId}, locale?`.
`actor` is a claimed business identity for routing/isolation only — never an
authorization input.

## Required factory options

```ts
createCanvasApp({
  baseUrl,              // explicit absolute App API root (may carry a deploy prefix)
  getCredential,        // (context) => Promise<'Bearer ...'> — called per HTTP request
  uiHost,               // existing CanvasUiHost shell primitives
  fetcher?,             // optional fetch injection (tests/signing gateways)
  resourceUrl?,         // authenticated browser-resource bridge (url, context) => url
  surface?,             // existing surface callbacks subset, only when needed
  renderUnavailable?,   // optional host-styled unavailable renderer
  renderLoading?,       // optional host-styled loading renderer
})
```

Hard requirements the host must supply for the canvas to open:

- **`getCredential`** — the official MA login SDK getter returning `Bearer <token>`.
  Called per request with the *current* context; never cached globally, never
  stored in canvas JSON. Throw/garbage → `CREDENTIAL_UNAVAILABLE`; the raw cause
  is never rendered.
- **`uiHost`** — existing canvas shell renderer contract (`CanvasUiHost`).
- **`resourceUrl`** — browser `img`/`frame` navigations cannot carry credential
  headers. The host must provide an authenticated bridge (signed URL or
  credential-carrying proxy). Without it the app renders
  `RESOURCE_URL_UNAVAILABLE` instead of smuggling tokens into URLs.

`baseUrl` is validated by the existing `createMaCanvasTransport` (unchanged):
http/https only, http only on loopback, no userinfo/query/hash, credentials
never leave the configured origin + path prefix, `redirect: 'error'`. Invalid →
`CONFIGURATION_UNAVAILABLE`-family alert (`CONFIGURATION_INVALID`), no request.

## Open-existing-instance semantics (no creation anywhere)

`providerInstanceId` is **not** the canvas projectId. The server mapping is
`canvasProviderProjectId = ma-sha256(['canvas', tenantId, applicationId, pid])`
(`apps/server/src/routes/canvas-provider.ts`), computed with Node crypto —
the browser cannot recompute it, per `docs/ROOT_MA_MAPPING_CORRECTION.md`
which overrides any direct-alias phrasing.

Mount flow per scope:

1. Validate context (bounded strings, control-char/path-segment safety,
   actor whitespace rules mirroring the Provider envelope validator).
2. `POST {baseUrl}/open-platform/v1/instances/{pid}/actions/canvas.read` with the
   full Provider envelope (`protocolVersion 1.0`, `requestId`/`idempotencyKey`,
   all identity fields, `input:{}`). This is the only Provider call on the open
   path — it is read-only; the server returns `PROVIDER_INSTANCE_NOT_FOUND`
   (404) for unregistered instances and has no create semantics here. We never
   call `canvas.create`, `canvas.operations`, `POST /api/projects`, or any
   register/MA-management API.
3. Validate the response mapping before mounting: `protocolVersion==='1.0'`,
   `actionId==='canvas.read'`, `providerInstanceId` echo matches request,
   `revision` is a positive safe integer, `data.canvasInstanceId` is a bounded
   safe path segment. Any mismatch → `SERVICE_UNAVAILABLE`, nothing mounts.
4. Render `CanvasWorkbenchSurface` with `projectId = data.canvasInstanceId`,
   the configured `transport`, `uiHost`, and `locale`. Original canvas UI,
   styles and behavior are untouched — the wrapper only injects.

Failure mapping (all rendered via `role="alert"`, sanitized codes only):
`404 → INSTANCE_NOT_FOUND`, `401/403 → ACCESS_DENIED`, `400 → CONTEXT_INVALID`,
credential failures → `CREDENTIAL_UNAVAILABLE`, anything else →
`SERVICE_UNAVAILABLE`.

## Scope, isolation, and rerenders

Scope key = `baseUrl + tenantId + userId + applicationId + applicationVersion +
applicationInstanceId + bizId + providerInstanceId`.

- A genuine scope change re-keys (`key={scope}`) and remounts the surface, so
  no A↔B canvas state can bleed; the keyed scope prevents an old document from being displayed while the new preflight resolves.
- Semantically identical context objects (new reference, or changes limited to
  `sessionId`/`locale`) do **not** rebuild the transport or reset drafts.
- Credential/resource callbacks accept session updates only for their original scope; stale A callbacks refuse after switching to B. A sessionId change within the same scope reaches the next request without a remount.
- In-flight `canvas.read` from scope A is aborted (AbortController) and guarded
  by scope check when switching to B — a late A response can never mark B ready.

## Evidence

```text
$ cd apps/web && ../../node_modules/.bin/vitest run tests/canvas-ma-app.test.tsx
 Test Files  1 passed (1)
      Tests  36 passed (36)
```

```text
$ cd packages/canvas-workbench && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit
# 0 errors in platform/ma-app.tsx / platform/ma-context.ts
# (4 pre-existing errors in ../workbench-ui sources, unrelated to this change)
```

Covered by tests: single authenticated `canvas.read` POST (URL, envelope shape,
`x-mav-*` headers, `getCredential(context)`), no create/register/`/api/projects`
calls, identical-semantic rerender preserving transport + mount count, genuine
scope change remounting to the resolved projectId, stale-A cancellation
(abort + result discard), 404/403/network/mapping-mismatch unavailable alerts,
missing/malformed context (traversal, control chars, whitespace actor,
unsupported protocolVersion), unsafe `baseUrl`, missing `resourceUrl`,
credential failure sanitization (no raw-cause leak), `resourceUrl` bridge
invocation with `(url, context)`, pure-helper valid/malformed cases.

`pnpm guard` could not run in this sandbox (tsx's IPC `listen()` socket is
blocked by the environment, `EPERM` — not a code failure). The checks guard
performs (symlink escapes, workspace dep resolution, banned product components,
JS-source allowlist, tests-outside-src) are unaffected by this diff: no
package.json, symlink, `.js` source, or banned component was added.

## Limits and remaining real gates

- **Not verified**: real MA-V host open, real registration/catalog, real Agent
  invocation, staging. The mocked surface proves wrapper flow only.
- **Server gate**: the Provider supports verified MA authority plus exact server-side action grants; loopback development is separately gated. Real MA login, current action grants and the deployment gateway still require formal verification.
- **Registration**: `frontend.moduleId/exportName` and `provider.baseUrl` in the
  deployment manifest must be produced by the release profile; the local
  `http://127.0.0.1:17463` manifest values are dev-only.
- **Resource bridge**: a real authenticated `resourceUrl` (signed URL or
  cookie-proxy) must be supplied by the host for images/frames to load; the
  wrapper refuses to mount without it.
- **Agent orchestration, fileClient, conversation**: out of scope by contract;
  ignored, not wired.
- **React runtime**: this package is React 18; the real MA host renderer version
  must be verified at integration time per repo rules.

## Root 集成复核

已导出 `createCanvasApp` 并纳入 canvas-surface 0.1.4 构建与完整类型声明。Root 增加旧 scope transport 的凭据/资源拒绝检查，避免 A→B 切换后旧回调获取 B 的凭据；移除渲染期间的 setState，实际 React 检查 36 项通过。完整包构建通过；生产宿主仍需真实资源鉴权桥，未把占位 resourceUrl 当作已接通。

Root 最终回归：画布服务 566 项通过、1 跳过；Web 512 项通过。上方 worker 沙箱类型/guard 限制是历史执行说明，Root 已独立完成服务类型检查；全工作区检查仍有浏览器范围外两个 E2E fixture 缺失，见最终证据。
