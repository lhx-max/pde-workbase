# Independent canvas server adapters

The server composes the original canvas/file/history/preview/export and workflow engines with explicit host adapters. It does not spawn an upstream chat runtime, infer an upstream checkout, or install a personal/team asset service. Storage and lifecycle rules are defined by the repository [instructions](../../AGENTS.md). Use the root lifecycle tool to start the workspace.

## Composition

[createCanvasServer](src/server.ts) requires an absolute `dataRoot`; services derive their state from it. Await `ready` before listening and await `close()` when shutting down. `authorize` runs before JSON/upload parsers. `authorizeProject` receives the project identity and read/write scope. These are external policy ports, not an authentication product. A shared bearer token and exact allowed origins are optional local deployment controls. Allowed origins support CORS preflight; preview-origin confinement remains enforced.

Programmatic agent, media, asset, capability, workflow-assistant/knowledge and native-browser adapters are optional. Unconfigured execution/import/native-resource capabilities return explicit unavailable errors. Empty agent/media discovery catalogs do not mean a provider is installed.

## HTTP agent adapter

`CANVAS_AGENT_ADAPTER_URL` is the exact POST endpoint; `CANVAS_AGENT_ADAPTER_TOKEN` supplies its bearer token. [The adapter](src/http-adapters.ts) sends:

```ts
{
  task: CanvasTaskReceipt,
  request: CanvasTaskRequest,
  workspace?: { cwd: string; projectRoot: string; inputs: { path: string; digest: string }[] },
  inputFiles: { path: string; digest: string; contentBase64: string }[],
  execution?: ExecutionSnapshot,
  systemPrompt?: string,
  skillIds?: string[]
}
```

`inputFiles` contains only explicitly authorized, already-staged references, checked against their SHA-256 digests and a 20 MB aggregate cap. Remote adapters should consume these bytes rather than assuming the server's local working directory exists remotely. No project-directory enumeration or implicit attachment loading occurs. Local injected adapters can use the isolated `workspace.cwd` unchanged.

The response is the shared `CanvasTaskDelivery`: `{ content: string, files?: { path, content, encoding?: 'utf8' | 'base64' }[] }`. Execution snapshots, system prompts and skill choices are ephemeral transport context; they are not serialized into task receipts or request identity. An adapter must not echo credentials into its generated content.

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

## Verification and limits

Package tests retain original canvas merge, candidates, workflow graphs/results/execution, file/version/watcher, media-delivery and ffmpeg rendering regressions. Additional tests exercise real HTTP adapter transport, authorization/CORS/preview isolation, staged-byte integrity, durable receipts and real asset/media bytes. Browser-level acceptance and independent lifecycle evidence belong to the repository [parity report](../../docs/feature-parity.md).

Node 24 is required for `node:sqlite`. ffmpeg and optional native browser/external providers remain real host dependencies. Existing project JSON is preserved; this package does not import an unrelated historical chat or legacy multi-slot image-task database. Legacy image-task URLs expose compatibility reads/retries for this server's durable media tasks, not a rebuilt removed image-execution platform.
