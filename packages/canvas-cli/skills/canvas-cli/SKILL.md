---
name: canvas-cli
description: Discover and operate the configured canvas service and its registered Apps using the canvas-cli HTTP client.
---

Use when the user requests reading or modifying the selected canvas or bound
document. Requires Node 24, an installed canvas-cli, a reachable CANVAS_SERVER_URL,
server-verified authorization, and the actual canvas/App instance mapping from
the host. If missing, report unavailable; never fabricate an ID or success.

1. Run `canvas-cli --version`, `canvas-cli apps list`, and
   `canvas-cli request GET /api/apps/canvas` to discover current capabilities.
2. Read the selected instance with `canvas-cli apps state canvas --instance ID`.
   The `/api/apps/canvas` response includes `requestSchema`; follow it rather
   than assuming an operation payload from a previous version.
3. For canvas operations, use the schema's `baseRevision` and a stable
   `operationId`; submit JSON via --body-file to the operations endpoint. Other
   App actions have their own revision fields; do not interchange them.
   Do not modify card content owned by
   another App: discover bindings and invoke that App's action instead.
4. On conflict, re-read and explain/reconcile. On uncertain network outcome,
   query the receipt before retrying; never invent a new key to repeat a write.
5. Read back the canonical state and report actual changed IDs and revisions.
   A CLI exit code alone or a textual model reply does not prove success.

Never disclose credentials. Do not treat tenant/user headers as authentication.
Remote MA cannot reach a user's loopback address; use the deployed authenticated
service address. This skill does not authorize new network exposure or bypass
service policies.

## Independent Image references

Read image cards from canonical Canvas state. If a card carries `imageReference`,
it identifies the target `teamId/bizId/applicationId/applicationInstanceId/providerInstanceId`,
`workspaceId`, `assetId`, hash and dimensions. Canvas owns layout and the reference;
read or edit Image business data through the installed `designai-image-app` CLI
and its Skill with host-provided target identity. Never infer a workspace/asset ID
from a Canvas node ID or patch Image config into Canvas JSON. Preview/download
uses the authenticated Canvas resource bridge and rechecks target authorization.
If that CLI/target authority is unavailable, report the specific missing capability.

## Legacy host-backed Image workspace actions

Discover `GET /api/apps/image` first. In the current host-backed profile the
image instance ID equals the owning canvas ID; pass the actual source/result
card ID as input.nodeId. This explicit manifest mapping replaces a fabricated
private image asset ID. `image.create` is App-scoped and creates a source card;
`image.configure/generate/regenerate/status/cancel` are instance-scoped.

Write with `--expected-revision N --idempotency-key KEY`; read the revision from
`apps state image`. Configure prompt/model/aspect/resolution/count/references
through `set`. Do not patch internal canvas drafts. `image.status` is read-only.
On uncertain outcome run `apps receipt image --instance ID --id KEY` before any
retry. One accepted batch returns one taskId per output; accepted is not image
completion. Success requires completed backend delivery, not just model done.
Never silently change a model or retry a paid generation. Preserve old images
when regenerating, and report provider failures separately from CLI validation.

## Image MVP tools and editable projects (0.8.0)

Read the live manifest and per-instance `/tools`; never equate a declaration
with a configured provider. `image.tool` includes CPU `crop` (pixel rectangle),
`adjust` (17 original controls, <=8MP), and `transform` (quarter rotations and
flips). They preserve originals and use the same receipts/delivery as AI tools.
No model credentials or model calls are needed for those CPU operations.

`image.edit.read` takes `{nodeId}` and returns `result.sourcePath`, `result.editRevision` and a nullable
manual-mockup document. `image.edit.save` takes `{nodeId,document,expectedEditRevision}` with revision
and idempotency key. Follow the strict manifest document schema: version=2,
basePath, resource paths in layers, and planar surface data; no URLs or bytes.
Use canonical sourcePath returned by the App, not an upload alias. A replaced
source causes 409. Completed edit receipts are archived durably before pruning;
old keys still replay without rolling the current document back.

Read JSON tool outputs through `request GET /api/apps/image/instances/ID/artifacts?path=ENCODED_PROJECT_PATH`.
This needs the same verified project authorization and does not supply missing
GPU/ComfyUI/OCR/surface services. Manual mockup rasterization still uses its
browser renderer; save/read is not a headless render command.
