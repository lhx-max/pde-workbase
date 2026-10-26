# Executor B — generic Appwrite tool artifact files (implementation only)

Read 00-MASTER-SPEC.md first. Workdir /Users/zhuzhiheng/Desktop/canvas-workspace.
Allowed writes ONLY:
- apps/server/src/storage/cloud-tool-artifact-files.ts
- apps/server/tests/cloud-tool-artifact-files.test.ts
- docs/verification/image-tool-persistence-20261022/executor-b.md
No edits to existing CloudImageFiles, AppwriteClient, JsonStatePort, server/routes, schema, ACL, package/lockfiles or other executors' files. No actual credentials/cloud calls, no service restart/Git/npm publication. Main does real cloud wiring later.

## Exact DTOs (structurally match image src/artifacts/types.ts; no sibling imports)

Define/export Scope={namespace:string;projectId:string}; ArtifactWrite={id:string;role:'result'|'preview'|'mask'|'vector'|'layer'|'edit-state'|'surface';path:string;mime:string;content:Uint8Array;width?:number;height?:number}; StoredArtifact={id;role;path;mime;byteLength:number;sha256:string;width?;height?}. You may use local type aliases with these exact shapes; main replaces duplicate DTO imports after npm integration. No any.

Export class `CloudToolArtifactFiles` implements `put(scope,input):Promise<StoredArtifact>` and `read(scope,path):Promise<{artifact:StoredArtifact;content:Uint8Array}|null>`.
Constructor one options object:
`{client:AppwriteClient;state:JsonStatePort;bucketId:string;images:ImageFileStorage;authorize:(scope:Scope,mode:'read'|'write')=>Promise<void>}`.
Imports existing structural types from own repo. Auth always first, including replay/exists/failed ready branch. Missing option or empty bucket explicit503 unavailable, never local fallback.

## Put steps, exact behavior

1. authorize write; await state.ready. Strict validate scope IDs, project relative path (use existing normalizeSafeProjectFilePath plus reject :/%/?/#/controls), allowed IDs/roles/MIME, actual bytes>0<=30,000,000; sha256 content. Dimensions both or neither positive ints<=32M pixels. Never log bytes/user params.
2. State slot = `image-tool-file-`+sha256(JSON.stringify([namespace,projectId,path])).slice(0,40). Stored index exact record `{schemaVersion:'image-tool-file/v1',scope,artifact,fileId?:string,storage:'image'|'blob'}`. Always scope/path checked when read existing index; mismatch fail, never overwrite. Per-slot serialized lock across all instances sharing SAME state object (WeakMap state->map), explicitly one writer namespace. Do not invent distributed CAS.
3. If identical existing index (path,checksum,byteLength,MIME,role,id,width/height), return a cloned artifact without rewriting binary/index. Any different bytes/metadata same path =>409 IMAGE_TOOL_ARTIFACT_CONFLICT. Replay authorization still required.
4. For image/*: use injected images.write(projectId,path,content,mime), after verifying actual format. PNG/JPEG/WebP signature+Sharp metadata/32M pixel limit and MIME match. SVG: UTF8 strict/vector-only: svg+path, no image/script/foreignObject/DOCTYPE/ENTITY/processing instruction/event handlers/external href/src/url(data/http/file). Internal url(#gradient) allowed; max32MiB is already tighter30MB. Image pipeline must not write local temp files. images.write metadata result.name must equal path before index commit. Do not change CloudImageFiles API.
5. For application/json: validate UTF8 JSON (not arbitrary HTML or malformed); recursively forbid credentials KEY/prototypes/non-JSON; arrays may be large dense numeric data but bounded file bytes. Do not require every JSON to match a specific tool schema; tool owns content validation. Upload to existing configured bucket using deterministic fileId=`tla-`+sha256(JSON.stringify([namespace,projectId,path,sha256])).slice(0,30). Name=last path segment with .json. No duplicate index schema/collection. Do not rename JSON into image/png.
6. On upload409, do not assume success. Download exact deterministic ID and verify bytes+sha match before adopting. On other error propagate sanitized structured error. If binary upload succeeds but state.write/flush fails, don't return successful reference. Deterministic naming permits retry without paid model call. No automatic ACL changes, delete on failure, bucket changes or local fallback.
7. Index saved via state.write and awaited state.flush BEFORE return success. write returns clone. Unknown exceptions sanitized IMAGE_TOOL_ARTIFACT_IO503, no raw Appwrite response/tokens. Preserve own structured validation/denied statuses; do not turn403 into503.

Read: authorize read first; state.ready/read scoped index; mismatch fails; null absent. If image storage, images.read(projectId,path), else client.download(`/storage/buckets/<enc>/files/<enc(fileId)>/download`). Reject missing indexed file, wrong byte count/hash/MIME/signature before returning. No automatic regeneration, no remote arbitrary URL. Respect same maxsize, never read unindexed IDs supplied by browser.

## Required fixture tests (Vitest)

- PNG routed via real fixture Sharp bytes/injected image port, JSON+SVG correct paths/MIME; state.read+write+flush truly exercised.
- Fresh class/state view over saved records can read identical PNG+JSON+SVG bytes (fixture durability, label fixture).
- Same path identical content replay no duplicate upload; changed content409; duplicate concurrency once per state instance.
- Two scopes with same paths cannot resolve each other's index. Unauthorized read/write/replay rejected before storage calls.
- Upload fail; upload success/index flush fail; read missing; checksum mismatch; invalid MIME/raster mismatch/SVG external/JSON credential rejected.
- Existing upload409 content mismatch refused; no false adoption; namespace/project path traversal refused.

Run Node24 `pnpm --filter @canvas/server exec vitest run tests/cloud-tool-artifact-files.test.ts` and `pnpm --filter @canvas/server typecheck`. Other executors may add incomplete modules; report foreign failures instead of editing them. Save result report to your sole docs path with commands/real outputs/limitations.
