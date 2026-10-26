# Executor C — image App completeness/security/data audit and adversarial tests

Read 00-MASTER-SPEC.md first. Workdir /Users/zhuzhiheng/Desktop/canvas-workspace.
User explicitly asks whether image is a complete correct App: backend, tenancy, authorization, storage, missing feature migration. Main owns verdict and fixes; your job is concrete evidence and independently executable regression tests, not general advice.

Allowed writes ONLY:
- apps/server/tests/image-app-audit-20261022.test.ts (Vitest fixtures, no real secrets/network)
- /Users/zhuzhiheng/Desktop/designai-app-image/tests/image-service-audit-20261022.test.ts (node:test fixtures)
- docs/verification/image-tool-persistence-20261022/executor-c-audit.md
Do not alter production code, existing tests, other executor files, package manifests/locks, Git or cloud state. If a test exposes a bug, leave meaningful assertion active and document exact failure for main to fix; don't weaken tests or normalize expected success into failure to make green. Do not invoke actual paid inference or read credentials. No new tool/UI implementation in audit task.

## Required inspection areas, exact entry points

Image src/index.ts,server.ts,app-protocol.ts,cli.ts,image-service.ts,generation.ts,device-authorization.ts,backend/{contract,engine,executor,modal-provider}. Canvas apps/server/src/{server,tenant,http-adapters}.ts; media/{image-app,adapter-service,canvas-delivery,request-identity,cloud-task-journal}; routes/{app-image,media,files}; storage/{cloud-image-files,appwrite-client,app-entitlements}; existing tests/image-app.test.ts, media/request-identity.test.ts, cloud-task-recovery.test.ts. Read authority and app-write grant code if needed; do not infer auth is secure merely from caller-provided IDs.

## Audit/test matrix, report each as confirmed pass / confirmed bug / implemented but no live proof / not implemented

1. Correct App identity/registration: appId=image, instanceId ownership, package pure metadata/react/backend exports; missing Provider/MA/staging not reported as completed. Evaluate whether current host-backed profile is a real bounded App or merely component; give precise boundary.
2. Read/write trust: no SSO; forged x-team/user/actor/admin; valid identity without write grant; valid same tenant different business/instance; cross tenant; foreign receipt/task ID; API/media/file/CLI paths same authorization. Use existing createCanvasServer authority injection fixtures and write grants. Avoid testing only explicit unverified-local profile then claiming MA secure.
3. Models/billing: per-request current-user CodeFlicker credential, MA token never used as model token; owner-A cannot use owner-B local/device grants; local CLI dev profile cannot run production/request-identity; no fixed-account fallback; adapter static bearer is service auth not tenant identity.
4. Storage ownership/cloud: source/output/mask/JSON/layers/SVG/OCR/UV/params/settings/task/receipt/canvas references. Identify actual persistent location/format and what is STILL transient. Do not claim upcoming A/B code integrated. Project-relative paths, no local authoritative fallback, private preview/download access.
5. Task lifecycle: idempotency body changes conflict; cross-scope key reuse isolation; receipt written before charge; restart doesn't automatically resubmit paid tasks; partial upload/partial batch not committed all-or-nothing falsely; cancel during inference/upload/delivery never publishes; source removed/replaced late result doesn't overwrite wrong card.
6. Limits: receipt cap256, cloud runtime single writer, collection row limits, preview caching auth scope, quota/upload size and MIME/extension verification; persistent accumulation/orphans and recovery visibility. Distinguish availability gaps from data leaks.
7. Feature migration: original crop/adjust/flip/layers/source dimensions, relight/multiangle/quick point edit/expand/erase/reflow/upscale/vectorize/layering/mockup/cutout. For each backend/ui/CLI/storage/provider/live-test status; refer source peer code, no invented features. Mark unavailable externalGPU/OCR/B and missing transparency contract accurately.

## Minimum executable adversarial tests

A. Image HTTP service requests from two independent verified request credential fixtures use only their own credentials; browser Origin rejected; upstream error containing secret not echoed; malformed tool nested credential/input URL rejected before model fetch. Include at least a direct `/generate` tool credential-shape payload (not only App host) and assert no dispatch.
B. Image App source-node tool dispatch preserves source+generation config, rejects caller-supplied source/unknown fields, wrong instance source, reuse foreign receipt/cancel task. Include verified caller scope tests based on existing context test helpers, not self-report user headers as simulated verified identity.
C. At least one precise tenant/business/instance authority test using createCanvasServer authority/grants fixtures, if available; otherwise explicitly explain exact missing test hook instead of making up identity verification.

Run package-scoped commands. End report must list exact files/lines, exploit/repro steps, expected vs actual, severity (P0/P1/P2), actual test output, and main's smallest required fix. Do not declare 'perfect'; root determines acceptance after rerunning and real cloud tests. Also suggest which remaining feature migration is next feasible slice with current services; no speculative major architecture rewrite.
