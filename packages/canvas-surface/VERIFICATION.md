# Canvas surface packaging verification — 2026-10-21

Historical local package: **`@canvas-workspace/canvas-surface@0.1.1`**.

Current internal release is **`@ks-designai/canvas-surface@0.1.2`**. See the [published installation record](../../docs/verification/npm-distribution/README.md) and [current standalone consumer report](../../docs/verification/npm-distribution/canvas-consumer.json). The following historical artifact paths are generated locally and are excluded from Git.

- [Versioned tarball](./artifacts/canvas-workspace-canvas-surface-0.1.1.tgz): **928,256 bytes**.
- SHA-256: `08e87993c0c1222713f715ed3d319edecf11940347d651fe9a49e11f473cef2e`.
- Installed contents: **7,586,006 bytes / 292 files**.
- JavaScript: **1,358,190 bytes**; combined CSS: **390,537 bytes**.
- Bundled graph: **459 modules**, **250 declaration files**, **20 CSS Modules**.
- License inventory: **40 package records**, with license texts and upstream Apache-2.0 provenance.
- External runtime imports only: `@xyflow/react`, `react`, `react-dom`, `react/jsx-runtime`.
- Exact peer versions: React/ReactDOM **18.3.1**, React Flow **12.8.5**.

## Passing evidence

Executed with **Node v24.15.0 / pnpm 10.33.2**:

| Command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm install --no-frozen-lockfile` | Passed after manifest changes | [Final install log](./artifacts/install.log) |
| `pnpm --filter @canvas-workspace/canvas-surface typecheck` | Passed | [Tool typecheck log](./artifacts/typecheck.log) |
| `pnpm --filter @canvas-workspace/canvas-surface test` | 3/3 passed | [Test log](./artifacts/test.log) |
| `pnpm --filter @canvas-workspace/canvas-surface pack:surface` | Real Vite build, declaration closure and pnpm pack passed | [Build/pack log](./artifacts/build-pack.log) |
| `pnpm --filter @canvas-workspace/canvas-surface verify:consumer` | Passed | [Consumer log](./artifacts/consumer.log), [machine-readable report](./artifacts/verification.json) |

Consumer verification copied the tarball into a fresh retained directory, ran real
`npm install` (not a source link), and verified:

1. No installed package symlinks or `workspace:` manifest dependencies.
2. Full public props and exported types compile with **`skipLibCheck: false`**.
3. All declaration dependencies resolve inside that consumer (apart from the compiler's standard libraries).
4. Vite builds the consumer exclusively from the consumer's installed files.
5. The consumer contains exactly one React runtime; surface and React Flow resolve the same React.
6. Combined canvas/React Flow CSS and matching CSS Modules JS/CSS names exist.
7. Node can import the installed ESM entry; React 18 SSR emits the surface root.
8. `flushCanvasForProject` rejects for an unmounted project instead of faking persistence success.

## Global repository checks — existing failures, not changed here

The required broad checks were attempted and failed outside this package:

- `pnpm guard`: missing/incorrect MF React pair expectation plus undocumented
  existing JavaScript compatibility artifacts in `functions/canvas-coi` and
  `packages/canvas-core`. [Guard log](./artifacts/guard.log).
- `pnpm typecheck`: existing `Uint8Array<ArrayBufferLike>` to `BlobPart` error in
  [appwrite-client.ts:61](../../apps/server/src/storage/appwrite-client.ts#L61).
  [Workspace typecheck log](./artifacts/workspace-typecheck.log).

No server/UI source or guard was edited to silence these checks.

## Important boundaries

- No existing service was started, restarted or stopped. No sibling Kit files were written.
- SSR intentionally emits only the surface root: the original persistence provider
  withholds its canvas child tree until client-side hydration. This is not proof
  of browser rendering, drag/drop, native preview or real backend persistence parity.
  The consuming host must perform those integration checks.
- The host supplies real UI renderers, transport, auth, file/editor/AI adapters,
  theme variables and sizing. No unsupported capability is faked.
- Existing module-level host adapters are retained; concurrent different-project
  surfaces in one realm are not certified.
- Vite reports upstream `use client` directive warnings. The output explicitly
  preserves a client directive at its entry; these warnings do not mean React was bundled.
- Initial `0.1.0` used micromark's browser-only decoder, which required a DOM at
  module import. It is **not the final deliverable**. Version `0.1.1` selects that
  dependency's official equivalent pure-JS default implementation, fixing Node
  import without modifying upstream source. The extra entity table and its MIT
  license are included in the bundle.
- The package uses the current working tree, not a claimed pristine upstream
  snapshot. [Build report](./dist/build-report.json) records source hashes, commit,
  bundle closure and licenses; [NOTICE](./NOTICE) records the extraction origin.
