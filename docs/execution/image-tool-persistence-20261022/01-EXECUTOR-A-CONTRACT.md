# Executor A — strict result-manifest validation (implementation only)

Read 00-MASTER-SPEC.md first. Workdir /Users/zhuzhiheng/Desktop/designai-app-image.
Allowed writes ONLY:
- src/artifacts/contract.ts
- tests/artifact-contract.test.ts
- docs/verification/image-tool-persistence-20261022/executor-a.md
Do not change types.ts, package.json, existing backend/tools/host code or other executors' files.

## Exact task

Implement exports using types from ./types.js:
1. `validateToolResultManifest(value:unknown):ToolResultManifest` — runtime validation of ALL frozen master constraints, return a fresh deeply cloned normalized object. No React/Node/native imports (TextEncoder allowed), no Date.now/random. Import existing pure validateTool/assertToolPath from ../backend/contract.js, type-only types. A browser can import this module without Buffer.
2. `validateArtifactPlan(value:unknown):ArtifactPlan[]` — accepts array of 1..128 planned metadata, unique IDs, allowed MIME/roles and <=256MiB total, each<=30,000,000, sha256/size/dimensions constraints. No Uint8Array/encoded bytes in JSON. Each object exact known fields.
3. `assertSafeToolJson(value:unknown):asserts value is JsonValue` — finite, acyclic, plain own-data objects/arrays; reject getters/setters/prototype manipulation/non-JSON, recursion and credential KEYS, total serialized <=128KiB. Empty literal/null values allowed. No bytes/data URLs as structured resource objects. Do not ban an ordinary user's free-text sentence because it contains the word token.
4. Errors use `Object.assign(new Error(genericMessage),{code:'IMAGE_TOOL_MANIFEST_INVALID',status:400})` except oversized =>code IMAGE_TOOL_MANIFEST_TOO_LARGE,status413. Messages must not echo input.

Manifest required fields exactly types.ts, no unknown top-level fields. Validate schemaVersion/executionId/scope/tool/source/params/artifacts/createdAt. IDs <=128 bounded ASCII identifiers; projectId<=200 bounded identifier; namespace<=240 bounded identifier including ._-; SHA fields lower64hex. Date must be parseable ISO with timezone, normalize via toISOString. For role vector require image/svg+xml; for edit-state/surface require application/json; layer/mask/preview must raster image. At least one artifact, all byte lengths/hash metadata present. editStateArtifactId references role edit-state/application/json within same manifest. Source must project-relative authorized pointer and optional lower64 SHA; no fabricated storage URL, credentials or inline binary data. Params validated through validateTool({kind:tool,source:source.path,params}); source/file authorization remains host responsibility; validator MUST NOT claim authorization just because a path is syntactically valid.

## Meaningful required tests

- Valid examples: simple raster result; vector SVG; layer raster artifacts plus edit-state JSON pointer; mockup surfaceJSON+preview; reflow multiple results; frozen input not mutated.
- Every forbidden pointer case (URL, absolute, traversal, encoded traversal/control) and malformed dimensions/sha/MIME/role/duplicate IDs/dangling edit-state rejected.
- Nested credential object, undefined, NaN/Infinity, cycle, Uint8Array, getter (must not execute getter) rejected.
- Cross-manifest edit-state ref and >128KiB record rejected; raw UV/base64 in manifest represented as unknown field rejected. Named text fields may contain words token/header normally.
- Import module should not pull React, sharp, node:fs or provider credentials. Verify source and if practical dynamic browser-like import.

Run Node24 `pnpm typecheck` and `pnpm exec tsx --test tests/artifact-contract.test.ts`. Don't run paid inference, cloud writes, installation, publication. If permission blocks test command, report exact missing step; do not silently claim test passed. Other new files may appear from parallel work; never change them to fix their type errors. Report tests and self-contained code pointers to allowed report file.
