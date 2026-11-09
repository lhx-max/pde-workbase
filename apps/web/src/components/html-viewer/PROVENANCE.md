# Original HTML/PPT viewer extraction

Upstream: Bezier/Loom commit `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`, Apache-2.0.

## Source and retained behavior

[HtmlViewer](<../HtmlViewer.tsx>) extracts the original `apps/web/src/components/FileViewer.tsx` HtmlViewer (upstream lines 6249–15477), plus its transitive top-level declarations. It is not a replacement iframe implementation. Original JSX/class names, effects and bridge protocols remain, including:

- HTML URL/srcDoc dual transport, lazy activation and challenge/response recovery, powered-preview origin isolation, sandbox/redirect/focus routing, source inlining and scoped assets.
- Source/preview modes, viewport/resolution/zoom, reload and last-good-source restoration, retained-tab file/watcher snapshots, source/revision caches and source authorization fencing.
- Deck thumbnails, navigation/keyboard shortcuts, presentation/fullscreen/presenter window, speaker-note editing and saves.
- Manual editing: target picking, inline text/style editing, selection/hover geometry, dirty-draft exit handling, undo/redo, image replacement/upload, frozen source and preview-state restoration.
- Inspect and comment/pod selection, host-authoritative inspect CSS validation, source persistence, comment overlays/composition and attachment callbacks.
- Original file-version history/preview/restore/export, HTML/PDF/PPTX/ZIP/image export settings, progress/ETA and result/error feedback.

[Inspect overrides](<inspect-overrides.ts>) is the unchanged pure helper group from upstream FileViewer lines 4655–5081, split out for security regression tests and reexported from the viewer.

The following helpers retain upstream implementations; relative imports were adjusted to the independent checkout:

| Extracted helper | Upstream source |
| --- | --- |
| [ManualEditPanel](<ManualEditPanel.tsx>) | `apps/web/src/components/ManualEditPanel.tsx` |
| [IframeKeepAlivePool](<IframeKeepAlivePool.tsx>) | `apps/web/src/components/IframeKeepAlivePool.tsx` |
| [HTML source cache](<html-source-snapshot-cache.ts>) | `apps/web/src/components/html-source-snapshot-cache.ts` |
| [PreviewCaptureEvents](<PreviewCaptureEvents.ts>) | `apps/web/src/components/PreviewCaptureEvents.ts` |
| [SocialShareGrid](<SocialShareGrid.tsx>) | `apps/web/src/components/SocialShareGrid.tsx` |
| [Pod member helpers](<pod-members.ts>) | `apps/web/src/lib/pod-members.ts` |
| [Clipboard helper](<copy-to-clipboard.ts>) | `apps/web/src/lib/copy-to-clipboard.ts` |
| [Slide navigation](<slide-nav.ts>) | `apps/web/src/runtime/slide-nav.ts` |
| [Powered preview](<powered-preview.ts>) | `apps/web/src/runtime/powered-preview.ts` |
| [Version origin](<version-origin.ts>) | `apps/web/src/artifacts/version-origin.ts` |
| [Iframe observation](<iframe-error.ts>) | `apps/web/src/observability/iframe-error.ts` |

Shared source/runtime/styles already extracted by the other workers are reused. No runtime import or symlink points into the upstream checkout.

## Independent boundaries and intentional adaptations

[Adapters](<adapters.tsx>) define optional, per-viewer embedding callbacks for deployment configuration/status/deployment, publishing/unpublishing, template/asset saving, social-share preparation and external-editor/agent handoff. They do not contact product deployment, chat or personal/team asset APIs. [Capability resolution](<capabilities.ts>) rejects missing operations with `UNSUPPORTED_CAPABILITY`; adapter errors are shown, not reported as success. The original deployment/share/export dialogs remain callback-driven. Personal asset save preserves its original trigger markup; the external handoff catalogue/product picker is replaced by its callback-driven fallback action, preserving the original fallback chrome classes. The host owns its target-selection experience.

Product analytics/onboarding/network telemetry are not imported. [Telemetry](<telemetry.ts>) emits local `canvas-workspace:viewer-event` CustomEvents, which embedding hosts may observe. Iframe observation starts/stops with local subscribers instead of relying on a removed product bootstrap. The centered loading indicator retains its status/layout wrapper but uses the shared spinner instead of the removed product logo runtime.

Strict independent file-provider failures are caught and rendered, with the original last-good-source recovery retained. A standalone viewer establishes its own original iframe pool; an embedding workspace can wrap its viewers with the exported `IframeKeepAliveProvider` to share the original bounded pool.

## Validation and remaining gaps

- [Extraction tests](<../../../tests/html-viewer-extraction.test.ts>) and [retention tests](<../../../tests/html-viewer-retention.test.ts>): **18 passed** using official Node 24.21.0 and Vitest 4.1.6. Covers inspect injection defenses, raw-text-aware/idempotent source splicing, authorization/revision/LRU caching, slide nonce deduplication, safe powered origins, unsupported adapters, adapter instance isolation, fail-closed/deduplicated manual-edit exit, hidden/in-flight retention, and the full file-router prop contract. [Manual-edit retention](<manual-edit-retention.ts>) extracts the original FileWorkspace save/exit maps into an optional per-workspace helper; shell activation/close/navigation must await it.
- Full web `tsc --noEmit --pretty false` **passed (exit 0)** after the adapter/iframe-pool integration. After the follow-up file-router/retention changes, the complete imported FileViewer + HtmlViewer closure and retention type tests also **passed** with a scoped project extending the same web compiler settings (avoiding concurrent shell edits). Main owns final whole-repo build and runtime validation.
- No browser or native-host runtime verification was performed by this worker. Actual iframe paint, manual-edit interaction, comment submission, version restore and PDF/PPTX capture require main integration/runtime checks. Compiled/copied is not visual parity evidence.
- The supplied upstream source has **no active palette/tweaks toolbar or panel**. It retains routing heuristics/historical comments and passes `paletteBridge: false` at upstream line 9040. This extraction preserves that baseline; it does not recreate older removed UI.
- Browser-worker comment/asset-preview components, frontend-owned file/version APIs and shared capture/export runtime must be wired by their owners. Optional deployment/publishing/template/asset/handoff capabilities intentionally remain unavailable until an embedding host supplies adapters.
- Original manual-edit CSS resides in shared `styles/viewer/memory.css` (roughly upstream lines 881–2010); the parent confirmed the frontend restored this stylesheet at the original cascade position.
