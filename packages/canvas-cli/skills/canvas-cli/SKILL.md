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
