# Runtime verification

## Harness ownership

The independent [e2e package](../e2e/package.json) uses only `pnpm tools-dev run web|desktop --data-dir <absolute-isolated-root> --daemon-port <reserved-port> --web-port <reserved-port> --browser-host-port <reserved-port> --production`. Desktop adds `--inspect-port` for an explicit loopback CDP connection. The neutral [runtime harness](../e2e/lib/tools-dev/runtime.ts) owns ports, readiness, logs, one process group and one temporary data root per worker; it never attaches to an ambient/shared web runtime or starts replacement application servers.

The [Playwright suite](../e2e/lib/playwright/suite.ts) provides the dynamic web origin and desktop CDP attachment. UI tests import only this suite. Test data is created through real HTTP project/file APIs. The native test serves a hermetic reference page through its own temporary fixture server; it does not replace or intercept workspace APIs or use provider accounts. All tested navigation targets the local fixture; the inherited browser home can still request optional public favicon images. Browser settings are limited to the supported English locale preference inside the isolated test profile.

Success disposes only owned runtime scratch; failures preserve the isolated data root/logs and attach the path. Screenshots and reports stay under the e2e package's generated `test-results` and `playwright-report` directories. Native resource traces are disabled because Playwright traces would otherwise persist temporary grant authorization headers. Native result evidence records paths and status codes, never bearer/access tokens.

## Commands

Build the independent shared packages, backend, web production bundle and desktop before running. Install the matching Playwright Chromium once. Use ordinary Node 24 for native Node dependencies; the hardened bundled agent runtime may reject Rolldown native loads.

```sh
pnpm --filter @canvas/e2e typecheck
pnpm --filter @canvas/e2e test
pnpm --filter @canvas/e2e exec playwright test --project=web --workers=1 --output=test-results/web
pnpm --filter @canvas/e2e exec playwright test --project=desktop --workers=1 --output=test-results/desktop
```

When invoking the test runner directly rather than through pnpm, set `CANVAS_E2E_PNPM` to the installed pnpm script so the neutral harness still invokes the repository's sole lifecycle entry. If Chromium was installed into a custom cache, supply the identical `PLAYWRIGHT_BROWSERS_PATH` for tests. Alternatively, `CANVAS_E2E_BROWSER_CHANNEL=chrome` uses an installed Chrome binary through Playwright's fresh, isolated temporary browser profile—not the user's normal profile. These settings do not change application product behavior.

## Scenarios

- Original full canvas shell, launcher tabs, project asset drawer, Markdown autosave, sketch creation, clip timeline, reload persistence; no chat or global personal/team library surface.
- HTML interactive preview, original Code view, original manual element editing, durable file version history/reload, presentation preview/source.
- Electron browser start page and real guest navigation; guest has no privileged bridge; resource discovery sanitizes URLs and keeps SVG metadata-only; original PNG bytes save into current project files; grants reject another project and fail after close; native screenshot persists a real PNG; page archive persists HTML/CSS/manifest; existing local `file:` and privileged-origin navigation are denied.
- Real HTTP project isolation, file version save/restore and web proxy; unavailable browser host is an explicit error in web-only mode. A separate nested scenario runs two production workspaces concurrently and proves both web proxies target their own independent backend/data root.

The browser-panel inspect/edit handlers are inherited from the original source but have no reachable toolbar entrypoint in that baseline. Tests do not invent a new UI or invoke private state setters to claim that capability. The original HTML file viewer's manual editing entrypoint is tested separately.

## Evidence status

### Final acceptance — all exercised gates passed

| Gate | Result |
| --- | --- |
| Guard, all package typechecks and production build | Passed |
| Package/application tests | 1,388 passed, including 112 desktop host tests |
| Real HTTP integration | 4/4 passed in 5.18 seconds |
| Original workspace + HTML/presentation web UI | 2/2 passed in 48.2 seconds |
| Real Electron browser/resource/security chain | 1/1 passed in 8.5 seconds; scenario execution 3.7 seconds |

The published evidence directory contains only 18 selected PNG images from these successful web/native runs. It excludes raw traces, failure artifacts, runtime logs and temporary authorization headers. The inherited native inspect/edit limitation described above is unchanged.

### Fresh independent-repository verification

After copying source and the 18 selected images into the separate repository, no `node_modules`, build output, runtime data or diagnostic traces were reused from the extraction workspace. A fresh frozen-lockfile installation installed 799 packages, then every shared package, server, desktop and production web build passed. Guard checked 1,133 source/evidence files and 12 package manifests; all typechecks passed.

The complete 1,388-test package/application regression set passed again from this independent checkout. HTTP integration passed **4/4 in 10.61 seconds**, including two concurrently live production instances and a real forged-Host request. All three UI scenarios passed together in **29.9 seconds**: workspace 10.0 seconds, HTML/PPT 5.0 seconds and Electron 7.0 seconds. The verification used Node 24.21.0 and pnpm 10.33.2, with the Node executable outside the original checkout; Chrome and Electron used isolated profiles. No Electron sandbox protection was disabled. The repository has its own Git history and retains the upstream license/provenance.

The initial Git whitespace review reported only end-of-file blank lines and three trailing-whitespace lines in copied/adapted source. Those formatting-only warnings were retained rather than mechanically rewriting the preserved source/CSS; they are separate from the passing build, type, functional and security checks above.

The original checkout contained concurrent uncommitted changes at the final inspection. Those changes were neither overwritten nor reverted by this extraction; the independent source baseline remains the commit identified in [NOTICE](<../NOTICE>).

### Integration findings and corrections

Harness typecheck passed and Playwright discovered all three scenarios before runtime startup.

The first real HTTP run completed **1 of 2 tests successfully** and exposed the production Next rewrite manifest's build-time `17456` backend destination. No browser was started against that faulty build. The runtime proxy was corrected rather than weakening isolation.

After the fresh production build, **all 3 real HTTP checks passed in 8.43 seconds**: HTML save/version/restore, web proxy, project isolation, unavailable native capability, traversal rejection, absent chat/library routes, and two concurrently live production workspaces with distinct data roots and correct per-runtime web/backend routing. Successful runtime scratch was cleaned.

On the final production build including the proxy Host guard, **4/4 real HTTP checks passed in 5.18 seconds**. The added security witness sends an actual forged `Host: rebound.example` with `node:http` and receives `403 / CANVAS_WEB_HOST_FORBIDDEN` before project data is returned. A first version using Node 24 `fetch` was rejected as an invalid test: an independent wire-level echo probe confirmed that fetch silently replaces a supplied Host with the URL authority. The corrected test uses a real low-level HTTP request, not a mocked request object.

The first real Chrome run passed the original launcher/project-assets/Markdown/sketch/clip/reload scenario but screenshot inspection exposed missing shared-component toolbar CSS, stale empty-canvas chat advice and internal version/sidecar files in the asset drawer. These integration defects were fixed, and the strengthened scenario **passed in 9.5 seconds**: computed horizontal toolbar dimensions/icons, exactly three visible project files, no chat advice, original Page wireframe starter saved into the sketch JSON, Markdown autosave and Clip reload persistence. The corrected screenshots below were opened and visually inspected.

**The complete two-scenario web acceptance run passed: 2/2 in 56.2 seconds**, with the workspace chain taking 10.9 seconds and the HTML/deck chain taking 22.9 seconds. It verifies the real interactive HTML button, Code view, original heading Text inspector, successful file save, at least two durable versions, revised heading after reload, both presentation slides, actual Next-slide navigation and presentation source. A second complete run on the final production build also passed **2/2 in 48.2 seconds** (workspace 10.0 seconds; HTML/deck 10.1 seconds), concurrently with the isolated HTTP run.

Initial fixture/test failures were corrected without product backdoors: the original URL-load/srcDoc activation and edit-bridge re-emit require observable readiness and idempotent click completion; text targets use the inspector's accessible Text textbox rather than the container-only HTML field; deck fixtures use the original `deck-stage` runtime with correctly overlaid slide CSS. The floating navigation is revealed through a real hover on the canvas border outside its nested iframe, with opacity/actionability verified before clicking. There are no sleeps, forced clicks, private UI state setters or mocked workspace endpoints.

The first actual Electron run exposed an ESM startup deadlock: top-level `await app.whenReady()` prevented Electron from emitting ready. The entry now invokes an async bootstrap without top-level await. A focused import/readiness regression passes. A subsequent security audit added canonical loopback-host/effective-port checks for navigation and subresources, including HTTP/HTTPS/WebSocket and blob-origin aliases while retaining distinct local fixture ports. All host tests now pass (**112/112**), with typecheck and build green.

The next actual Electron run reached its DevTools endpoint but the enclosing agent execution sandbox denied Electron's own macOS sandbox initialization (`Operation not permitted`); GPU/network helper startup failed and the host correctly exited rather than reporting ready. No `--no-sandbox` flag or renderer/guest security weakening was added. The parent agent owns explicit permission-controlled retries of the same command. A wider-context retry did start Electron and the workspace successfully, but opening New Browser reached the application's error boundary. Native renderer diagnostics captured the browser-parent render loop; the parent fixed it and included the fix in the final production build. The final permitted-context Electron run passed **1/1 in 8.5 seconds**. It exercised the original New Browser UI, real navigation/back/forward, resource discovery, byte-identical project image saving, cross-project and revoked-grant 403 responses, actual PNG capture, HTML/CSS/manifest page archive, privileged subresource denial, existing local-file denial with a private-content sentinel absent from the guest DOM, and privileged-origin/localhost-alias navigation denial. The test waits for the original address bar's delayed blur to clear before the next focus/fill; it accepts Chromium's native cancellation error-code variants while retaining rejection and no-private-content assertions. No source security policy was weakened.

Final passing-run screenshots: [Canvas](../e2e/evidence/acceptance-final/01-full-workspace.png), [Project assets](../e2e/evidence/acceptance-final/02-project-assets.png), [Launcher](../e2e/evidence/acceptance-final/03-launcher-tabs.png), [Markdown](../e2e/evidence/acceptance-final/04-text-editor.png), [Populated sketch](../e2e/evidence/acceptance-final/05-sketch-editor.png), [Clip](../e2e/evidence/acceptance-final/06-clip-workspace.png), [Interactive HTML](../e2e/evidence/acceptance-final/07-html-preview.png), [HTML source](../e2e/evidence/acceptance-final/08-html-source.png), [Saved manual edit](../e2e/evidence/acceptance-final/09-html-manual-edit.png), [Versions](../e2e/evidence/acceptance-final/10-html-versions.png), [Presentation slide one](../e2e/evidence/acceptance-final/11-presentation-preview.png), [Presentation slide two](../e2e/evidence/acceptance-final/11b-presentation-second-slide.png), [Presentation source](../e2e/evidence/acceptance-final/12-presentation-source.png). Native evidence: [Browser home](../e2e/evidence/acceptance-final/13-native-browser-home.png), [Real guest page](../e2e/evidence/acceptance-final/14-native-browser-page.png), [Discovered page resources](../e2e/evidence/acceptance-final/15-native-resources.png), [Project resource saved](../e2e/evidence/acceptance-final/16-native-project-resource-saved.png), [Actual captured project PNG](../e2e/evidence/acceptance-final/17-native-captured-project-image.png). Only these selected acceptance images are published; diagnostic artifacts are excluded.
