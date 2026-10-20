# Independent canvas server adapters

The server composes the original canvas/file/history/preview/export and workflow engines with explicit host adapters and a built-in local asset library. The library restores folders, spaces, metadata, versions, management and canvas import/save without an account/team platform. The server does not spawn an upstream chat runtime or infer an upstream checkout. Data-root and lifecycle rules are defined by the repository [AGENTS.md](<../../AGENTS.md#safety-and-data>); use the root lifecycle tool to start the workspace.

## Composition

[createCanvasServer](<src/server.ts>) requires an explicit `dataRoot` following the root [data-root rules](<../../AGENTS.md#safety-and-data>). Await `ready` before listening and await `close()` when shutting down. `authorize` runs before JSON/upload parsers. `authorizeProject` receives the project identity and read/write scope. These are external policy ports, not an authentication product. A shared bearer token and exact allowed origins are optional local deployment controls. Allowed origins support CORS preflight; preview-origin confinement remains enforced.

Programmatic agent, media, external-asset, capability, workflow-assistant/knowledge and native-browser adapters are optional. The local asset library works without them; unconfigured external execution/import/native-resource capabilities return explicit unavailable errors. Empty agent/media discovery catalogs do not mean a provider is installed.

## Local asset library and replacement port

[server.ts](<src/server.ts>) selects `CanvasServerOptions.assetLibrary.adapter` when supplied, otherwise [service.ts](<src/asset-library/service.ts>) creates the built-in local library. `AssetLibraryAdapter` is a full server-side source replacement: every operation accepts either a direct return value or a Promise, routes await those operations, and shutdown awaits optional `close()`. Implement list/read/create/patch/version/content/batch/uses/recordUse, spaces, template import and image indexing against your own storage. The port exchanges DTOs and bytes, not the upstream platform, database or filesystem root. A list/import-only provider belongs on the separate `CanvasServerOptions.assets` / `AssetAdapter` port; `CANVAS_ASSET_ADAPTER_URL` does not replace the full library.

`GET /api/asset-library/info` returns the [AssetLibraryInfo contract](<../../packages/contracts/src/api/asset-library.ts>): source identity, capabilities, limits and `deletion: 'permanent'`. Required full-library operations are advertised as available and must genuinely work in a replacement. `imageMetadata` and `idempotentCreate` reflect adapter flags; `analysis` and `catalogue` reflect configured hooks. Do not infer AI or installed template availability from basic library support. The built-in source supports image metadata and idempotent capture; optional AI analysis/prompt generation and catalogue/template imports are not simulated.

### Library HTTP surface

[asset-library.ts](<src/routes/asset-library.ts>) implements the shared [asset-library DTOs](<../../packages/contracts/src/api/asset-library.ts>) and compatible [personal asset DTOs](<../../packages/contracts/src/api/personal-assets.ts>). Paths below are relative to `/api/asset-library` unless shown in full.

| Method and path | Request / result |
| --- | --- |
| `GET /info` | Source, truthful capabilities, limits and deletion policy. |
| `GET /` | `{ assets }`; the built-in source completes a bounded image-indexing pass before returning. |
| `POST /` | JSON create request → `201 { asset, analysis? }`; use `kind: 'folder'` for folders. |
| `POST /upload` | Multipart `file` plus metadata → `201 { asset, analysis? }`. `tags`, `source` and `execution` are JSON string fields; `captureId` is a top-level string field. |
| `GET /:id`, `PATCH /:id` | Read or patch metadata → `{ asset }`; include `revision` for an optimistic concurrency check. |
| `POST /batch` | `{ ids, action, patch? }` → `{ assets }`; actions are move/copy/tag/favorite and permanent delete/trash; rating is a metadata patch. |
| `GET /spaces?scope=local`, `POST /spaces?scope=local` | `{ folders, initialized }`; mutation semantics below. |
| `GET /:id/versions` | `{ versions }`. |
| `POST /:id/versions` | JSON `{ content, revision? }` or multipart `file` with optional `revision` → `{ asset }`; folders have no content versions. |
| `GET /:id/content?version=VERSION_ID&download=1` | Original bytes, optionally pinned to a version; supports byte ranges and attachment download. Without `version`, reads the latest version. Content has sandbox and no-sniff headers. |
| `GET /:id/metadata.yaml` | YAML metadata. |
| `GET /export?ids=ID1,ID2` | ZIP of selected assets and folder descendants. |
| `GET /:id/uses`, `POST /:id/uses` | `{ uses }` / `{ projectId, filename, versionId, usedAt }` → `{ ok: true }`; project authorization applies and paths are validated, not dereferenced. |
| `GET /:id/analysis`, `POST /:id/analysis` | Optional metadata analysis status / enqueue (`202`). |
| `GET /:id/prompt`, `POST /:id/prompt` | Read saved prompt and availability / enqueue optional prompt generation (`202`). |
| `GET /catalogue`, `POST /import-templates` | Optional catalogue / `{ templates }` → `{ assets }`; the configured catalogue must approve the complete selection. |

Current limits are 200 MB per upload, 4 MB text content, 500 assets per batch/export selection and 500 MB export bytes. `delete` and `trash` permanently remove library records, versions and unreferenced blobs; there is no restore action or implicit trash retention. Source project files and external packages are not deleted.

Create and upload accept `captureId`, scoped by `source.projectId` or `local`. Identical metadata and bytes replay the original asset; changed requests return `409`. A permanently deleted capture cannot be recreated by replaying its old key (`409`); use a new operation key. An adapter declaring `idempotentCreate: false` rejects capture-key requests with `503` rather than pretending to deduplicate.

### Spaces and project transfer

A spaces POST uses `{ upsert: [{ id, name, createdAt }], remove: [id], removeContents?: boolean, targetSpaceId?: string }`. The built-in [core.ts](<src/asset-library/core.ts>) applies the patch atomically:

- Removing a space transfers its assets and complete folder subtrees by default (`removeContents` omitted or false). The target defaults to virtual `default-project`, or may be a remaining space in the same scope, including one upserted in this patch. Parent links are retained only where valid in the target.
- `removeContents: true` explicitly and permanently deletes affected assets, descendants, versions and unreferenced bytes. It is not the default.
- The default space cannot be removed; a space cannot be both upserted and removed; a target cannot also be removed. Validation failure leaves the mutation unapplied.
- Known removed space IDs are persisted as tombstones. Stale writes or upserts cannot silently recreate them, including after restart. Use a new ID to create a replacement space; the scope groups UI records, while asset space IDs share a namespace.

`POST /api/projects/:id/asset-library/save` accepts `{ filename, name?, kind?, parentId?, spaceId?, description?, tags?, style?, usage? }`. It reads a confined project file, preserves its bytes in a new library asset, records project/filename provenance and returns `201 { asset }`.

`POST /api/projects/:id/asset-library/import` accepts `{ assetId, versionId?, path? }`, writes that version's bytes to a confined project path without overwriting existing files, records its use and returns `{ asset, version, files }`. Omitted `path` uses the version filename. If publication succeeds but a later receipt/use step fails, the response reports `ASSET_IMPORT_PARTIAL`, `files`, `publishedPaths` and `attemptedPath`; no destructive rollback removes the published file. A non-published failure reports `ASSET_IMPORT_FAILED`. These routes do not silently bind or overwrite a canvas node.

### Optional analysis and catalogue hooks

Configure `assetLibrary.analysis` and `assetLibrary.catalogue` through [AssetLibraryOptions](<src/asset-library/service.ts>). Unconfigured analysis, prompt-generation POSTs, catalogue and template-import routes return HTTP `503` with `ASSET_LIBRARY_CAPABILITY_UNAVAILABLE`. Create/upload with `aiFill` requested also rejects before saving when analysis is absent. If configured analysis fails to enqueue after a successful save, the saved asset is returned with an explicit failed analysis status. Reading a saved prompt remains possible without AI and reports `available: false`; it is not a generated success.

## Browser preferences

[Browser preference routes](<src/routes/browser-preferences.ts>) expose `GET /api/browser-preferences` → `{ revision, preferences }` and `PUT /api/browser-preferences` with `{ revision, patch }` → the updated snapshot. The exact [wire names](<../../packages/contracts/src/api/browser-preferences.ts>) inside `preferences` and `patch` are `browserBookmarks`, `browserReferences` and `browserCapture`, not shortened aliases. The [service](<src/services/browser-preferences.ts>) persists one browser profile per workspace database and uses an atomic compare-and-swap: an old revision returns `409 BROWSER_PREFERENCES_CONFLICT`, so reload and reconcile before retrying. New state starts at revision `0`; successful writes increment it and merge the supplied top-level fields. Invalid patches return `400`; corrupt persisted state fails explicitly rather than being erased. These globally authorized, `no-store` routes do not persist credentials, account state or agent settings.

## HTTP agent adapter

`CANVAS_AGENT_ADAPTER_URL` is the exact POST endpoint; `CANVAS_AGENT_ADAPTER_TOKEN` supplies its bearer token. [The adapter](<src/http-adapters.ts>) sends:

```ts
{
  task: CanvasTaskReceipt,
  request: CanvasTaskRequest,
  executionContext?: CanvasTaskExecutionContext,
  installedSkills?: {
    id: string; digest: string; instructions: string;
    resources: { path: string; digest: string; content: string }[]
  }[],
  workspace?: { cwd: string; projectRoot: string; inputs: { path: string; digest: string }[] },
  inputFiles: { path: string; digest: string; contentBase64: string }[],
  execution?: ExecutionSnapshot,
  systemPrompt?: string,
  skillIds?: string[]
}
```

`inputFiles` contains only explicitly authorized, already-staged references, checked against their SHA-256 digests and a 20 MB aggregate cap. Remote adapters should consume these bytes rather than assuming the server's local working directory exists remotely. No project-directory enumeration or implicit attachment loading occurs. Local injected adapters can use the isolated `workspace.cwd` unchanged.

The response is the shared [CanvasTaskDelivery](<../../packages/contracts/src/api/canvas-workspace.ts>): `{ content: string, files?: { path, content, encoding?: 'utf8' | 'base64' }[] }`. Runtime `execution` snapshots, composed `systemPrompt`, resolved `installedSkills` and runtime `skillIds` are ephemeral adapter transport, not durable receipt fields. An adapter must not echo credentials into its generated content.

In contrast, request-level `executionContext` is validated portable source evidence: `skillIds`, `sessionMode: 'design'`, `visiblePrompt` and nested `context` with skill IDs and browser `workspaceItems` (`id`, `kind: 'browser'`, `label`, `url`, `title`, optional `tabId`). [task-request.ts](<src/task-request.ts>) rejects unknown authority fields and credential-bearing URLs; a URL supplies evidence, not fetch permission. The normalized context is persisted with the request, participates in request identity, and is forwarded both in `request` and as top-level adapter `executionContext`. Reusing a `requestId` with changed normalized input returns `409 TASK_REQUEST_CONFLICT`.

[services-tasks.ts](<src/services-tasks.ts>) resolves requested skills through [task-skills.ts](<src/task-skills.ts>), currently allowlisting `page-recreation`. Only application-installed, bounded and symlink-confined instruction resources are transported as `installedSkills`, with digests and resource contents; their instructions also augment the system prompt. Browser evidence cannot inject arbitrary installed skills or system instructions. Missing/unsafe required resources return `503 SKILL_RESOURCE_UNAVAILABLE`; submitting without a configured agent adapter returns `503 AGENT_ADAPTER_UNAVAILABLE`, never a simulated task success.

Task publication prevalidates the complete output batch and uses no-overwrite writes. This is not an atomic multi-file transaction. Failed receipts retain exact published `result.files`; an independently saved artifact candidate is exposed through `result.candidatePath`, not mistaken for an adopted canvas result. Conflicts never authorize overwriting a changed target. Text binding semantics remain upstream-compatible: omitted `outputKind` adopts into the text card, explicit `text` saves a candidate for the adoption API, and `storyboard` applies a validated storyboard.

## HTTP media adapter

`CANVAS_MEDIA_ADAPTER_URL` is the adapter origin. Optional bearer authentication uses `CANVAS_MEDIA_ADAPTER_TOKEN`.

- `GET /models`: providers, image/video/audio models and aspect/duration catalogs.
- `GET /config`: masked provider configuration/discovery.
- `POST /config`: optional adapter-owned configuration update.
- `POST /generate`: `{ taskId, projectId, request, inputs: [{path, mime, contentBase64}] }`.
- Generation returns `{ path, contentBase64, mime, progress?: string[] }`.

Project reference images are confined and loaded by the server; input bytes have a 50 MB aggregate limit. The adapter returns bytes, not an assertion that a remote file somehow exists in the project. The server writes the output immutably, validates image decoding and reconciles the original image/video target/version/batch delivery receipts. In-process adapters can report live progress and receive an abort signal. The JSON HTTP adapter reports returned progress; it is not a streaming protocol. Cancellation suppresses later publication, but cannot promise that an upstream provider stopped billing or computing.

## External assets and capability catalogs

`CANVAS_ASSET_ADAPTER_URL` and optional `CANVAS_ASSET_ADAPTER_TOKEN` expose:

- `POST /assets/query`: `{ projectId, query }`, returning the host's catalog result.
- `POST /assets/import`: `{ projectId, reference }`, returning `{ files: [{ path, contentBase64 }] }`.

The corresponding server import endpoint is `POST /api/projects/:id/external-assets/import`. A successful response is `{ files: [...] }`, with each entry the concrete metadata returned by the original project file writer (`name`, `path`, `size`, `mtime`, `kind`, `mime` and applicable artifact metadata). Bytes have already been written to those project paths. An adapter cannot return metadata-only success. The entire batch is checked for invalid/duplicate/conflicting/existing paths and a 100 MB cap before writing. A raced failure returns `{ error, files, attemptedPath? }`; `files` lists the successfully published entries, `ASSET_IMPORT_PARTIAL` identifies a partial result, and no rollback deletes user files.

Asset source capabilities use the shared search/read/preview/write/versioned descriptor, with compatible list/import fields. External library read, preview, write and versioning are not advertised merely because list/import exists.

`CANVAS_CAPABILITY_ADAPTER_URL` and its token serve agent/model/knowledge/resource discovery through `/agents`, `/models`, `/knowledge/query` and `/resources/:kind[/id]`. Resource kinds include image-library templates, design templates, design systems and showcase descriptions. No global upstream catalog is assumed.

## HTTP CLI

[cli.ts](<src/cli.ts>) dispatches API commands to [http-cli.ts](<src/http-cli.ts>); they call the same HTTP endpoints, never open a second database. Set `CANVAS_SERVER_URL` or append `--server-url URL`; optional authorization uses `CANVAS_AUTH_TOKEN`. JSON responses are machine-readable (`--json` is accepted). In the forms below, uppercase names are caller-supplied values, not literal paths:

```text
canvas-server assets info
canvas-server assets list
canvas-server assets get ASSET_ID
canvas-server assets create --body-file JSON_PATH
canvas-server assets create --name NAME --kind text --text-file TEXT_PATH
canvas-server assets upload --file FILE --mime MIME --body-file METADATA_JSON
canvas-server assets patch ASSET_ID --body-file PATCH_JSON
canvas-server assets batch --body-file BATCH_JSON
canvas-server assets spaces --scope local
canvas-server assets spaces --scope local --body-file SPACES_PATCH_JSON
canvas-server assets versions ASSET_ID
canvas-server assets versions ASSET_ID --body-file VERSION_JSON
canvas-server assets versions ASSET_ID --file FILE --body-file METADATA_JSON
canvas-server assets content ASSET_ID --version VERSION_ID --output FILE
canvas-server assets export --ids ID1,ID2 --output FILE
canvas-server assets metadata ASSET_ID
canvas-server assets uses ASSET_ID
canvas-server assets uses ASSET_ID --body-file USE_JSON
canvas-server assets analysis ASSET_ID
canvas-server assets analysis ASSET_ID --body-file ANALYSIS_JSON
canvas-server assets prompt ASSET_ID
canvas-server assets prompt ASSET_ID --body-file ANALYSIS_JSON
canvas-server assets import ASSET_ID --project PROJECT_ID --version VERSION_ID --path PROJECT_PATH
canvas-server assets save --project PROJECT_ID --filename PROJECT_PATH --name NAME
canvas-server browser preferences
canvas-server browser preferences --body-file REVISION_PATCH_JSON
canvas-server request METHOD /api/path --body-file JSON_PATH
canvas-server request POST /api/projects/PROJECT_ID/agent/tasks --body-file TASK_JSON --prompt-file TEXT_PATH
```

Asset IDs are positional immediately after `get`, `patch`, `versions`, `content`, `uses`, `metadata`, `analysis` and `prompt`; they are not `--id` values or extra `get`/`add` verbs. `spaces` selects GET without `--body-file` and POST with it; `versions`, `uses`, `analysis` and `prompt` follow the same body-driven read/write convention, with multipart `--file` also selecting version POST. A `prompt` read does not generate anything. Import may instead obtain `assetId` from `--body-file`; save obtains `filename` from `--filename` or the body, not a positional filename. Optional flags can be omitted to use route defaults. Metadata, batches, space mutations and preference updates use the HTTP JSON shapes above; `create --text-file` sets `content`.

`--body-file -`, `--text-file -` or `--prompt-file -` can read standard input, with only one stdin consumer per invocation. `--prompt-file` is supported only for generic `request` commands. Upload/version `--body-file` metadata becomes multipart fields, including JSON serialization of objects and arrays. Binary content/export requires `--output FILE`; output is create-only, never overwrites an existing file, and an interrupted download retains its partial output. Non-success HTTP responses are printed with a failing exit status. Native installation, Save As and browser-login consent remain explicit GUI authorization steps.

## Verification and limits

Package tests retain original canvas merge, candidates, workflow graphs/results/execution, file/version/watcher, media-delivery and ffmpeg rendering regressions. Additional tests exercise real HTTP adapter transport, authorization/CORS/preview isolation, staged-byte integrity, durable receipts and real asset/media bytes. Browser-level acceptance and independent lifecycle evidence belong to the repository [parity report](<../../docs/feature-parity.md>).

Node 24 is required for `node:sqlite`. ffmpeg and optional native browser/external providers remain real host dependencies. Existing project JSON is preserved; this package does not import an unrelated historical chat or legacy multi-slot image-task database. Legacy image-task URLs expose compatibility reads/retries for this server's durable media tasks, not a rebuilt removed image-execution platform.
