# Standalone Canvas Surface

`@ks-designai/canvas-surface@0.1.5` is an ESM library distribution of the
existing canvas workbench, not a replacement implementation or an app server.
Internal workspace runtime and type dependencies are closed inside this package.
A consumer does **not** install the internal `@bezier/*` workspace packages.

## Install and mount

```sh
npm install /absolute/path/to/ks-designai-canvas-surface-0.1.5.tgz \
  react@18.3.1 react-dom@18.3.1 @xyflow/react@12.8.5
```

```tsx
import {
  CanvasWorkbenchSurface,
  flushCanvasForProject,
  type CanvasWorkbenchSurfaceProps,
  type CanvasTransport,
  type CanvasUiHost,
} from '@ks-designai/canvas-surface';
import '@ks-designai/canvas-surface/styles.css';

// Implement these with the consuming product's real primitives/adapters.
declare const uiHost: CanvasUiHost;
declare const transport: CanvasTransport;

export function ProjectCanvas({ projectId }: { projectId: string }) {
  return (
    <div style={{ height: '100%', minHeight: 500 }}>
      <CanvasWorkbenchSurface projectId={projectId} uiHost={uiHost} transport={transport} />
    </div>
  );
}

// Before switching project or reading the backend's canonical canvas revision:
await flushCanvasForProject('your-project-id');
```

Import the stylesheet once in the host's global CSS entry. It contains the canvas
and workflow domain styles, shared component styles, CSS Modules output, and
React Flow baseline CSS. Do not additionally import the old workspace styles.
The host owns its global theme tokens, page sizing and overlay primitives.

React and React DOM **18.3.1**, and `@xyflow/react` **12.8.5**, are exact peer
requirements. The host must resolve these to one copy; never alias a second
renderer into this package. The package does not carry a private React runtime.
React 19 compatibility is not claimed.

## Public contract

The entry re-exports the existing canvas-workbench public facade, including:

- `CanvasWorkbenchSurface` / default, `CanvasWorkbenchSurfaceProps`.
- `CanvasTransport`, `CanvasHostContext`, `CanvasUiHost` and its renderer props.
- `flushCanvasForProject`, `awaitCanvasGenerationBinding`, `createCanvasTaskSubmitter`.
- `readCanvasSelection`, canvas object focus/reveal/read/preview APIs.
- `TextDocumentOpener`, `TextDocumentOpenResult`, `TextDocumentChange`, generation
  result types and existing card registration/resource-picker APIs.
- Public boundary types `WorkspaceCollabContext`, `WorkflowCanvasRun`,
  `WorkflowResultArtifact`, `ExecutionSnapshot` without an extra contracts install.

Generated declarations preserve the source API; internal relative declarations
and vendored non-peer type dependencies remain package-private. No hand-written
`any` shim substitutes for the real props.

`projectId` and `uiHost` are required. The five required UI renderer methods are
`renderPopover`, `renderHoverCard`, `renderDialog`, `renderMenu`, `renderTabs`.
Optional capabilities must be explicitly provided by the consuming product;
this distribution does not fake backend, AI, artifact, sketch or file operations.
`transport` configures the API base URL, request function, credentials and resource
URLs using the existing canvas contract; it does not convert that protocol into
a different plugin-host protocol. Keep auth headers/resource authorization in
host adapters and do not persist credentials into canvas state.

The current source also exports `createMaCanvasTransport` for a host-provided MA
credential getter, selected tenant and application instance. See
`docs/tenant-cloud-integration.zh-CN.md` in the source repository for backend
configuration and team card grants. This addition requires a new package release;
the already published versions do not include it. Resource navigation still
requires an authenticated host proxy or an explicit `resourceUrl` adapter.

The existing implementation has module-level host adapters; simultaneous surfaces
with different projects in one JS realm are not certified by this distribution.
Unmount/flush/switch one active surface at a time. This package is the **canvas
surface**, not the product's top tabs, asset library, browser or document editor;
those remain host-owned and connect through the exported props.

## Build, pack, verify

Use Node 24 and pnpm 10.33.2 from this independent checkout:

```sh
pnpm install
pnpm --filter @ks-designai/canvas-surface typecheck
pnpm --filter @ks-designai/canvas-surface test
pnpm --filter @ks-designai/canvas-surface pack:surface
pnpm --filter @ks-designai/canvas-surface verify:consumer
```

The build aliases internal packages to current source in this checkout (never
stale dist or the original repository), compiles their JS/CSS with Vite, emits
and relocates the reachable declaration graph with TypeScript, checks peer-only
external imports, rejects bundled React, records source hashes and copies
third-party license texts. Build errors are fatal, including unresolved type
imports or missing third-party notices.

The tarball is written to `artifacts/`. Consumer verification creates a fresh,
retained directory under the workspace `.tmp/canvas-surface-consumers/`, copies
the tarball, runs real `npm install`, compiles public props with
`skipLibCheck: false`, bundles from only installed files, checks one React runtime,
and executes an installed-package SSR/API smoke test. It starts **no server**
and never writes the sibling plugin Kit. `artifacts/verification.json` records
sizes, digest and checks. SSR is not browser interaction or persistence parity
proof; the host must perform its own integrated runtime acceptance.

## Provenance

Local `0.1.3` adds the optional `CanvasUiHost.openImageApp(target)` navigation
hook for native image cards. The canvas resolves a registered image App and the
existing image after saving; the host owns navigation. Image App storage and
detail UI are not included. An unconfigured hook reports unavailable. See
`docs/image-app-handoff.zh-CN.md` in the source repository. This local build has
not been published to the registry.

Apache-2.0; see LICENSE and NOTICE. The build records the upstream extraction
commit and current workspace source hashes in `dist/build-report.json` and
preserves bundled third-party license texts in `dist/third-party-licenses/`.

Local `0.1.5` revalidates context fields on every render, including when a host reuses a mutable context object. An application-version or identity change rebuilds the scoped transport; previous transports reject credentials and resource access. Equal context values preserve the transport and editor state.
