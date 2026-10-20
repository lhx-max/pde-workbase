# Canvas Workspace — independent extraction

> **必读规范入口（任何 AI / Agent 进仓先读）**：根目录 [`SKILL.md`](./SKILL.md)（卡片包开发、App 互联协议、COI 接口、冻结区、分支规则）与 [`docs/canvas-card-pack.zh-CN.md`](./docs/canvas-card-pack.zh-CN.md)、[`docs/canvas-app-interop.zh-CN.md`](./docs/canvas-app-interop.zh-CN.md)。

This is a standalone repository extracted from Bezier/Loom commit `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`. Do not import, symlink, or resolve runtime resources from the original checkout. Keep the upstream Apache-2.0 license and record adapted source provenance.

## Product boundary

Preserve the original canvas workspace UI, CSS, interaction and data behavior; do not redesign it. Include top tabs, project assets, text/sketch/clip/browser surfaces, previews, canvas APIs, JSON, files, artifact organization and delivery. Include the original Canvas / Assets / Collect sidebar and a standalone local asset library with real folders, metadata, versions, management and canvas import/save operations. The user explicitly selected this built-in local library after the initial extraction. Exclude the original chat product UI/runtime and original account/team platform. The user approved an MF SDK integration: keep its React 19 UI in the isolated [MF document](<apps/mf-ui>), served on exact reserved `mf.localhost`, a different loopback origin from the `127.0.0.1` canvas through the same app-owned listener. Do not restore MF's plain localhost hostname or proxy `/sso-health`: that SDK development branch extracts a browser-side SSO token. Connect through versioned contracts and authenticated adapters; never import MF into the canvas component tree or allow its document host to reach normal canvas APIs. Canvas package/typing constraints remain React 18; Next App Router supplies its own renderer, so record actual browser renderer versions separately from installed peers. Server-side MF credentials are single-user, local-only; shared/public reverse-proxy deployment is unsupported. The local canvas and asset library remain authoritative; unconfigured MF is explicitly unavailable. Reuse the original asset UI and injected-storage core; external asset libraries remain replaceable adapters. Agent execution, browser hosts and authorization belong behind adapters. Unconfigured capabilities must report an explicit unsupported/unavailable result; never fake success.

## Layout and commands

- `apps/web`: extracted React/Next workspace and app-local host adapters.
- `apps/server`: independent canvas/file/task/preview/export HTTP service and CLI.
- `packages/canvas-workbench`, `workbench-core`, `workbench-ui`: original canvas and workflow UI/domain packages.
- `packages/components`, `contracts`, `host`, `release`: shared dependency closure, to be narrowed without breaking compatibility.
- `tools/dev`: standalone lifecycle entrypoint, called by `pnpm tools-dev`.
- `e2e`: real HTTP and Playwright integration checks.
- Root scripts are checks or tools only. Use package-scoped build/test commands, not root build/test aliases.

Use Node 24 and pnpm 10.33.2. New source, tooling and tests are TypeScript. Existing upstream build `.mjs` files are retained compatibility artifacts, not a reason to add new JavaScript source. Tests belong in package-level `tests/` siblings of `src/`; UI automation belongs in `e2e/ui/` with lifecycle fixtures. Run `pnpm install` after package changes, then `pnpm guard`, `pnpm typecheck`, package tests/builds and actual runtime checks.

## Safety and data

The independent server receives an explicit resolved data root from its entrypoint. Services must derive storage from that root or explicit constructor arguments; never refer to the upstream checkout or infer a data root from cwd. Do not weaken path traversal/symlink checks, preview sandboxing, native browser grants, target revisions, idempotency or cancellation. Backend application code must not import frontend private implementation, or vice versa; shared DTOs go in pure contracts. Do not migrate unrelated upstream features merely to satisfy imports.

## Evidence

`docs/feature-parity.md` tracks completeness; copied or compiled is not verified. Record test/build/runtime evidence and limitations, especially browser native capabilities, ffmpeg availability, delivery recovery and multiple workspace instances. No co-author commit trailers.
