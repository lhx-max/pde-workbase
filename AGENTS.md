# Canvas Workspace — independent extraction

This is a standalone repository extracted from Bezier/Loom commit `319e5eee556a3641d2ee68a6111a36ddc7a1eff7`. Do not import, symlink, or resolve runtime resources from the original checkout. Keep the upstream Apache-2.0 license and record adapted source provenance.

## Product boundary

Preserve the original canvas workspace UI, CSS, interaction and data behavior; do not redesign it. Include top tabs, project assets, text/sketch/clip/browser surfaces, previews, canvas APIs, JSON, files, artifact organization and delivery. Exclude chat product UI/runtime and a built-in personal/team asset platform. Agent execution, external asset libraries, browser hosts and authorization belong behind adapters. Unconfigured capabilities must report an explicit unsupported/unavailable result; never fake success.

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
