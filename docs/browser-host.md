# Independent native browser host

## Scope

`@canvas/desktop` hosts the original workspace browser and Collect sidebar. It does not substitute a new browser UI or start the Web/API services itself. Navigation, history, bookmarks, reference sites, resource capture, project screenshots, page archives, asset saves, downloads, extension capture and conditional login handoff are included. The original chat, account/team, sidecar and updater platforms are not.

Source provenance and boundaries are recorded in [agent guidance](<../AGENTS.md>) and [NOTICE](<../NOTICE>). The independent native bridge reuses the original resource engine, image attestation, capture extension, inspector and login connector code, with isolated application identity and storage.

## Launch and ownership

Build with `pnpm --filter @canvas/desktop build`, then use `pnpm tools-dev run desktop --data-dir "$CANVAS_DATA_DIR" --production`. Data-root rules are centralized in [agent guidance](<../AGENTS.md#safety-and-data>). The launcher resolves Electron from the desktop package, supplies the absolute compiled entry, and owns all child processes. Do not run the Electron entry with plain Node or set `ELECTRON_RUN_AS_NODE`.

| Environment | Contract |
| --- | --- |
| `CANVAS_WEB_URL` | Exact loopback application origin reported by the Web lifecycle; no credentials/query/fragment. SPA query/hash navigation remains allowed. |
| `CANVAS_SERVER_URL` | Explicit backend origin, denied to remote guests. |
| `CANVAS_BROWSER_HOST_PORT` | Explicit reserved native **resource transport** port. |
| `CANVAS_DESKTOP_AUTH_TOKEN` | Per-instance random base64url secret shared only with the server. Never renderer configuration, logs, metadata or URLs. |
| `CANVAS_DESKTOP_USER_DATA` | Explicit absolute, separate Electron profile for this instance. Never the original application's or the user's ordinary browser profile. |

A secret-free readiness line reports `{ "app": "canvas-desktop", "ready": true, "nativePort": 12345 }`. Closing the application revokes grants, cancels reads and pending native work, closes listeners, and quits. Concurrent instances require distinct data roots, profiles and transport ports.

## UI and persistence

- The original browser lives in a workspace tab; **Canvas → asset sidebar → Collect** opens the original compact collector and its project-file tray. Expansion creates a full browser tab without navigating the project away.
- The sandboxed application preload exposes the original version-2 host contract only to its trusted main document. App code uses `getBezierHost()` from `@bezier/host`.
- Project screenshots and collected images retain source metadata. The tray can add them to the canvas or open the canonical asset save dialog.
- Page-resource batches and browser asset captures save actual bytes to the selected local asset space/folder. Opening or canceling the save dialog is not a write. Idempotent capture IDs protect retries.
- Bookmarks, reference sites and capture switches persist through `/api/browser-preferences`; only a one-time, revision-zero migration reads the old localStorage values. Failed server writes do not pretend to have succeeded.
- Browser images added as references are staged. They enter an Agent request only after a subsequent explicit user submission.
- Page archive means HTML, CSS and a manifest, not a complete website/runtime clone. Page extraction forwards bounded context, archive inputs and the installed page-recreation instructions to an optional Agent adapter. No Agent adapter means an explicit unavailable response.

Pure Web mode retains the original fallback/home UI but cannot provide Electron DOM/resource capture. Its Collect and extension settings explain the native requirement.

## Resource transport and CLI

The native resource listener binds only `127.0.0.1:${CANVAS_BROWSER_HOST_PORT}`. The server sends:

```http
POST /command
Authorization: Bearer <CANVAS_DESKTOP_AUTH_TOKEN>
Content-Type: application/json

{"sessionId":"…","accessToken":"…","projectId":"…","action":"start"}
```

The fixed command union is `start`, `snapshot`, `scan`, `stop`, or `read`; reads also require opaque resource/navigation IDs. Requests are bounded to 64 KiB. Results use `{ok:true,result}` or structured `{ok:false,error:{code,message}}`. Browser-origin requests are denied. This is not a generic URL-fetch, filesystem, evaluation or native-invoke endpoint.

The UI and `canvas-server browser resources …` use the same project-authorized server APIs. A resource grant does not replace project authorization. The resource engine reads bytes; the project or asset-library service owns acknowledged persistence.

## Downloads and login consent

- Native downloads belong to an owned WebContents, pass URL/redirect checks, and always require the system Save As dialog. Canceling, navigation or owner loss cancels pending work. Owned same-origin blob downloads are supported.
- Electron's DownloadItem API does **not** expose a trustworthy initiating-frame identity. The implementation does not claim frame-level download attribution; owned-WebContents checks, protected-origin guards and native Save As remain the boundary.
- Google login buttons/popups hand off the confirmed source site's ordinary login page; OAuth state/authorization URLs are not forwarded as a generic external-opening channel.
- Pinterest retains the original **macOS + unpackaged development** condition. Explicit onboarding precedes any connector registration/profile change. Its independent native host is `com.canvas_workspace.pinterest_auth`. Cookie scope, rollback and navigation cancellation remain enforced. Actual account authentication requires the user's browser and consent; automated tests use temporary synthetic inputs, not real accounts.

## Independent capture extension

**Browser menu → Browser extension** opens the original settings section. Installation first requests native confirmation and a Save As destination for the built ZIP. The user unpacks and loads it manually in a compatible browser; the application does not silently modify an ordinary browser profile.

- Extension identity: `filiogdhdejjikcnhfgdclfcnflecgpd`.
- Normal discovery: loopback ports **18373–18382**, separate from both the original application and the resource transport above.
- Consent enables capture for the current owned desktop session, not permanently. After restarting, use Install extension again to enable reception. Canceling the subsequent ZIP export does not undo an already granted Enable confirmation; it merely skips exporting the package.
- Receivers are bounded, short-lived and one-use. Exact Host/origin/header validation, project context revocation and limited saved-asset inspector scopes are retained. The worker keeps the private inspector session internal and exposes only a tab-bound opaque handle to content scripts.
- A same-source asset refresh retains previously verified capabilities while refreshing; new sources and failed refreshes fail closed. Capture/inspector persistence holds one adapter across asynchronous writes and follow-up reads.
- The original optional Native Messaging fallback was renamed to `com.canvas_workspace.browser_bridge`, but this installer does **not** register a relay for it. Normal capture uses HTTP discovery; do not depend on or claim validation of that fallback.
- Build packaging requires system `zip` (macOS/Linux baseline); Windows-native packaging is unverified.

See the [extension guide](<../apps/desktop/browser-extension/README.md>) and [Pinterest connector guide](<../apps/desktop/experiments/pinterest-auth/README.md>).

## Security invariants

- Sandboxing, context isolation and web security remain enabled; guests get no Node integration, privileged preload or nested webviews.
- Preload and every privileged IPC require the exact owned application main frame. Guests, subframes and same-origin API/preview paths cannot invoke them.
- Guest navigation, redirects and popups allow credential-free HTTP(S) or `about:blank`, excluding privileged app/API/native origins and their loopback aliases. Programmatic `loadURL` is covered by request policy; capture observers cannot replace that policy.
- Remote guest permissions remain denied. Clipboard reads and arbitrary custom protocols are not granted. Native installation/download/login consent cannot be bypassed through the resource CLI.
- Grants are random, bounded, expiring, project/guest/navigation-owned and initially disabled. Reads use observed opaque IDs, attest the image document before and after retrieval, and verify raster MIME/signature. Active SVG and segmented media stay metadata-only.
- Resource bounds remain 500 entries, 25 MiB/read, 30 seconds/operation and 30 minutes/grant. Navigation, reload, crash, close, grant replacement and owner loss invalidate epochs and cancel reads. Snapshots do not export cookies, secret queries or raw native errors.

## Verification boundary

Unit coverage includes original resource/epoch/image tests, ownership/preload/transport guards, extension receiver/inspector protocols, native-download lifecycle and conditional login cancellation. Real UI tests exercise the owned production Web/API/Electron lifecycle, not a replacement server.

Current counts, screenshots and unresolved/manual checks belong in [runtime verification](<runtime-verification.md>) and [feature parity](<feature-parity.md>). Compilation is not GUI acceptance. No automated check should be described as real-account login, ordinary-profile installation or manual OS-dialog acceptance when it used mocks or temporary profiles. Native PDF printing, project-directory pickers and updater methods remain explicitly unsupported compatibility stubs; they are not browser-download implementations.
