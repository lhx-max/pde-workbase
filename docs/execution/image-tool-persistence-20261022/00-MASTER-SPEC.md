# Image tools cloud persistence v1 — implementation SPEC

Owner/planning/integration/acceptance: main Codex. Executors: 3 local Devin CLI SWE-2 Max processes. Date2026-10-22.

## Product decision (frozen)

- User approved our Appwrite project/bucket. Do not request access to peer project, copy personal credentials, create accounts, modify ACL/schema or silently use local files.
- Image App owns tool processing and edit-state semantics; canvas owns positions, resource references, project identity and host authorization. MA user/biz/instance identity remains authoritative. No new user/team directory.
- Binary files AND substantial editable JSON (layers/OCR/style/UV/mask/batch recipes) go in Storage. Small manifest/job records go in durable JSON slots. Do not stuff base64 into canvas/database rows or add a bucket/table per tool.
- Current single-output image.tool cloud proof is done, but multi-output/SVG/surface/layer persistent delivery is NOT done. This milestone implements reusable persistence primitives, not fake complete GPU/UI/MA acceptance.
- Existing `CloudImageFiles` only accepts image/*; do not bypass that invariant to store JSON as a pretend PNG. Build separate typed tool artifact adapter for JSON and reuse image storage for image resources.
- Keep original peer UI/style and algorithms. No UI changes in these three tasks. No changes in peer repo or MA host.

## Existing evidence and source

Canvas /Users/zhuzhiheng/Desktop/canvas-workspace; image /Users/zhuzhiheng/Desktop/designai-app-image; upstream /Users/zhuzhiheng/Desktop/design-canvas @996622df61943932a0f1e8adfee26c7bf5c53e3a.
Read all applicable AGENTS and canvas skill .devin/skills/canvas-app-platform/SKILL.md plus app-development-handbook.zh-CN.md. Image docs/APP_CONTRACT.md, UNIFIED_APP_STANDARD.md, BACKEND_TOOLS.md describe current boundaries. Current proof docs/verification/image-backend-tools-20261022 includes real Appwrite readback, fixture model, restart and idempotency.

Source-of-truth types: image src/artifacts/types.ts written by main agent. DO NOT CHANGE types.ts without reporting a concrete issue to main. All executors must implement exact signatures from their task files. Node24, pnpm10.33.2, strict TypeScript, no any/@ts-ignore. Tests under package tests. Preserve ALL existing dirty work. Do not git checkout/reset/add/commit/push or publish npm. Do not edit package.json/lockfiles/build outputs; main handles packaging. Do not start/stop existing runtime services or read credentials.

## Data semantics and limits

1. ToolStorageScope(namespace/projectId) comes from a trusted backend adapter, never browser params. namespace represents verified tenancy/business/instance storage namespace; actorId is separately verified for attribution and idempotency. No self-reported permission fields.
2. Request digest is sha256 normalized request by caller. Stable execution ID = sha256(JSON.stringify([namespace,projectId,actorId,idempotencyKey])).slice(0,32). Same key+same identity+digest reuses; different digest => TOOL_IDEMPOTENCY_CONFLICT409. Same key different scopes/users => different executions.
3. Artifact IDs identifiers max128; scope fields nonempty bounded240, projectId max200 and identifier characters. Project paths relative, max2000; reject absolute/backslash/dot segments/colon/control/%/?/#. No external URLs, symlink/local path or data URL for resource pointers.
4. Allowed MIME: image/png,image/jpeg,image/webp,image/svg+xml,application/json. Single artifact <=30,000,000 bytes, batch <=256MiB, 1..128 outputs, unique IDs. Width/height both optional; if supplied both positive safe ints, product<=32M. Source file referenced, not duplicated in result manifest.
5. Stored SHA256 exactly64 lowercasehex, positive byteLength. Binary bytes never JSON job fields. JSON values finite, no cycles/undefined/functions/prototypes/accessors; nesting<=12; reject credential-shaped KEYS recursively (token/secret/password/authorization/cookie/bearer/apiKey/session/header/oauth/jwt/signature and __proto__/constructor/prototype). Free text content is not interpreted as auth.
6. Manifest JSON encoded UTF8 <=128KiB. Tool params use existing validateTool with source path to check known tool/param fields. editStateArtifactId optional but when present must reference exactly one artifact with role edit-state and MIME application/json. Big layer graphs and UV/mask arrays belong in this artifact file, not manifest params or canvas JSON.
7. CreatedAt/UpdatedAt valid ISO dates. Manifest validates exact allowed top-level and artifact/source/scope fields; clone inputs to prevent caller mutation after persistence. Error {code,message}, short generic message<=500; no provider body/credentials.
8. Fail-closed: no configured port => explicit unavailable, no fake saved state. Upload partial failure keeps tracked staged outputs, never publishes committed manifest; cancel blocks new writes/commit, never automatically runs a paid model. Retry storage writes only, with identical planned artifact hashes; changed outputs conflict. Original resource never changed.
9. This architecture currently requires explicitly single-writer namespace, as JsonStatePort promises. Do not invent distributed CAS from Appwrite REST PATCH. Main writes journal adapter and integration after executor returns.

## Required acceptance by main

- Inspect source and diff against scope; independently run tests, builds and packed consumer checks.
- Real Appwrite mixed PNG/SVG/JSON/mask/edit-state save -> readback -> reconstruct manifest after fresh service/cache; scoped denial, failure/cancel and duplicate commit. Model/GPU tests remain fixtures until configured; no paid calls or user data mutation as a test.
- Report static contract, fixture checks, real cloud persistence, UI integration, formal MA/staging separately. This milestone must not claim full feature migration.
