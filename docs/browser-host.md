# Independent native browser host

## Scope and provenance

`@canvas/desktop` is a focused Electron host for the original Canvas Workspace renderer. It adds no substitute browser UI and does not start web/server processes, import upstream application internals, or include Loom's sidecar, updater, extension installation, personal assets, chat, or packaged launcher control planes.

The upstream Apache-2.0 extraction baseline is recorded in the repository's [agent guidance](../AGENTS.md). The native resource engine, image-reader attestation and associated security tests were extracted from upstream `apps/desktop/src/main/browser-resource-capture.ts`, `browser-resource-policy.ts`, `browser-image-read.ts`, and their sibling tests. The narrow preload is adapted from upstream `preload.cts`; guest ownership and lifecycle wiring are adapted from upstream `runtime.ts`. The image response helper now also verifies signatures, rejects partial-content responses, and releases streams. A request multiplexer keeps navigation policy active while resource capture observers start/stop.

## Launcher contract

The repository's `tools-dev` owns lifecycle. Build with:

```sh
pnpm --filter @canvas/desktop build
pnpm --filter @canvas/desktop typecheck
pnpm --filter @canvas/desktop test
```

Resolve the installed Electron executable from the desktop package's `electron` dependency, then invoke it with the absolute path to `apps/desktop/dist/main.js` as its application argument. Do not invoke that entrypoint with plain Node. No custom command-line arguments are required. Do not set `ELECTRON_RUN_AS_NODE`.

The launcher must provide:

| Environment | Contract |
| --- | --- |
| `CANVAS_WEB_URL` | Exact application document URL reported by the independent web lifecycle. HTTP(S), loopback, no credentials/query/fragment. SPA query/hash changes remain allowed. |
| `CANVAS_SERVER_URL` | Explicit independent backend loopback HTTP(S) origin. The guest cannot navigate to or request this privileged origin. |
| `CANVAS_BROWSER_HOST_PORT` | Explicit reserved port, 1–65535, for native command transport. No discovery, guessed default or fallback. |
| `CANVAS_DESKTOP_AUTH_TOKEN` | Per-instance cryptographically random base64url secret, at least 32 characters, shared only with the independent server process. Never renderer configuration, URL, logs or persisted asset metadata. |
| `CANVAS_DESKTOP_USER_DATA` | Explicit absolute, per-instance Electron profile directory. Distinct for concurrent workspace instances; never the upstream application's profile. |

The application emits a secret-free JSON readiness line after the configured web document loads: `{ "app": "canvas-desktop", "ready": true, "nativePort": 12345 }`. Closing the window disposes grants, cancels image reads, closes transport connections, and quits. The launcher remains responsible for process startup/termination/error reporting. This package's implementation work does not start development servers.

## Original renderer contract

The sandboxed preload exposes the original version-2 `__bezier__` contract solely to the configured application main document. The frontend must continue using `getBezierHost()` from `@bezier/host`, not access the global directly. The original panel's `<webview partition="persist:bezier-design-browser">` remains the native browser surface; webview navigation, DOM execution for inspect/edit/archive, and guest screenshot APIs remain native Electron APIs.

Implemented host methods:

- `browser.openResourceCapture(guestId, projectId, tabId)` / `closeResourceCapture(sessionId, accessToken)`.
- `browser.setCollector(guestId, enabled)`, `readImage(guestId, url)`, `collectImage(guestId, url)`, `onCollectedResource(listener)`.
- `browser.clearData({cookies?, storage?})`, isolated to the native browser partition; it also revokes grants and pending reads.
- `capture.page({clip?})` returns native PNG pixels with dimensions. Rectangles must lie inside the window content bounds.
- `shell.openExternal(url)` permits credential-free HTTP(S) only.

`readImage` is read-only. `collectImage` sends the original collected-resource event only after native document attestation and verified raster-byte retrieval. The frontend's project-file adapter owns persistence and reports backend failures; a native read/event is **not** a successful file-save acknowledgment.

Required legacy methods unrelated to this host deliberately return `ok:false` with an `unsupported` reason (`pdf.print`, `project.pickAndImport`, `project.pickAndReplaceWorkingDir`, `shell.openPath`, updater actions with action-result return values). Updater status-returning methods reject with an explicit unsupported error; updater event subscription methods throw unsupported. They exist only because the original host detector requires their structural presence. The optional external Chrome/Edge capture bridge/extension installer, Pinterest auth connector, working-directory picker, appearance and locale hooks are **absent**, not successful no-ops. Browser-only use without Electron has no native bridge and must show the existing unavailable state.

## Server-to-native resource commands

The host binds only `127.0.0.1:${CANVAS_BROWSER_HOST_PORT}`. The independent server uses:

```http
POST /command
Authorization: Bearer <CANVAS_DESKTOP_AUTH_TOKEN>
Content-Type: application/json

{"sessionId":"…","accessToken":"…","projectId":"…","action":"start"}
```

Input is the original `BrowserResourceCommand` from `@bezier/contracts`: `start`, `snapshot`, `scan`, `stop`, or `read` (the latter additionally requires opaque `resourceId` and `navigationId`). Commands are at most 64 KiB. Success is HTTP 200 `{ "ok": true, "result": BrowserResourceResult }`. Failure is `{ "ok": false, "error": { "code": "…", "message": "…" } }` with 400/401/409/413/503 as appropriate. Origin-bearing/browser-fetch-metadata requests are denied; there is no CORS allowance, generic URL-fetch endpoint, evaluation endpoint, or native filesystem endpoint.

The server must enforce its ordinary project existence/write authorization before saving. Native grants are project-bound but do not replace server project authorization. Persist verified `read` results through project files (or an explicitly configured AssetSource), never a built-in personal/team library. The resource host itself never writes capture files. UI and CLI resource routes must call the same independent server APIs.

## Security boundaries

- The main application and every guest use sandbox/context isolation, with Node integration disabled. Guest preloads are removed, nested webviews are disabled, and web security remains enabled.
- Both preload exposure and every IPC invocation require the exact configured application document. Subframes, guests, different ports/origins and same-origin preview/API paths cannot invoke the privileged bridge.
- Guest initial attach, navigation, redirects and popups permit HTTP(S) or `about:blank` only, without URL credentials and excluding privileged application/backend/native-transport origins. Popups navigate the owned guest in place instead of creating privileged windows.
- A request-level policy covers programmatic `webview.loadURL`, which Electron's `will-navigate` event does not intercept. Starting/stopping capture cannot remove that policy. Local `file:` requests remain blocked.
- Remote guest permissions and automatic downloads are denied; downloads use explicit project capture workflows instead. Only the exact trusted application main frame can perform sanitized clipboard writes for the original canvas copy interaction. Clipboard reads, OS permission prompts, file downloads and custom-protocol launches are not silently allowed.
- Grants are random, disabled initially, bounded, expiring, owned-guest and project-bound. Start enables bounded fixed-script isolated-world discovery. Native image reads attest `document.images` before and after fetching.
- Resource reads accept only observed opaque IDs, not arbitrary caller URLs; MIME and magic bytes must match. Active SVG/segmented media stay metadata-only. Limits remain 500 entries, 25 MiB/read, 30 seconds/operation and 30 minutes/grant. Redirects and partial responses are rejected.
- Navigation/reload/crash/close invalidates discovery generations and cancels reads. Grant replacement revokes the old project's grant. Owner document navigation revokes all grants. No cookies, secret URL queries or native errors are exported by resource snapshots.

## Validation and remaining evidence

The package includes the original focused grant/epoch/read tests, original image attestation tests adapted to verified raster fixtures, independent URL/frame/secret/clip/request-multiplexer tests, and sandbox-preload contract tests. Validation on the staged independent workspace: `pnpm --filter @canvas/desktop typecheck` **passed** and `pnpm --filter @canvas/desktop build` **passed** with bundled Node 24.21.0. **100 tests across 4 files passed** with verified official Node 24.21.0 (`node node_modules/vitest/vitest.mjs run` from the desktop package). The hardened bundled runtime could not load Rolldown's native binding, so the test runner used the official runtime without changing product dependencies. These tests do not start application servers.

Compilation and simulated Electron unit tests do not prove native GUI parity. A real Electron run must still verify browser navigation (including file-URL denial), inspect/edit/archive, screenshots, collector events, project-bound resource saving, clearing browser data, and concurrent instance isolation through the actual independent web/server stack. External extension installation/auth handoff, native PDF export/project folder pickers, updater and OS permission-dependent web content are intentionally not implemented in this focused package.
