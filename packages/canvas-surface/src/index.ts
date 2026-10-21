'use client';

// Public facade only: all implementation dependencies are compiled into this package.
export * from '../../canvas-workbench/src/index';
export { default } from '../../canvas-workbench/src/index';
export type {
  WorkspaceCollabContext,
  WorkflowCanvasRun,
  WorkflowResultArtifact,
  ExecutionSnapshot,
} from '../../contracts/src/index';

// Include the peer's baseline and shared primitives in the single explicit CSS export.
import '@xyflow/react/dist/style.css';
import '../../components/src/styles.css';
