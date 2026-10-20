export interface RunContextSelection {
  /** Authoring entry intent, not permission to enable or execute an automation. */
  automationAuthoring?: 'scheduled' | 'hook';
  /** Independent canvas execution; conversationId remains the presentation owner. */
  canvasExecution?: { mode: 'independent' };
  /** Explicit answer association; transcript adjacency is not task ownership. */
  canvasClarification?: { sourceAssistantMessageId: string; sourceRunId: string; formId: string; answerText: string; requestId: string };
  /** Presentation only. Does not grant writes, bind a target, or prove delivery.
   * Machine data remains in the run/message for components and CLI consumers. */
  resultPresentation?: { kind: 'task-result'; title: string };
  /** Internal canvas page-to-artifact delivery binding. */
  canvasArtifactGeneration?: {
    requestId: string;
    nodeId: string;
    format: 'html' | 'presentation';
    outputPath?: string;
  };
  /** Immutable canvas-origin snapshot for task routing, recovery and conflict checks. */
  canvasTask?: CanvasTaskContextSnapshot;
  skillIds?: string[];
  pluginIds?: string[];
  mcpServerIds?: string[];
  connectorIds?: string[];
  workspaceItems?: WorkspaceContextItem[];
}

export interface CanvasTaskContextSnapshot {
  schemaVersion: 1;
  taskExecutionId: string;
  kind: 'text' | 'presentation' | 'webpage' | 'workflow';
  title: string;
  targetRef:
    | {
        kind: 'canvas-node';
        nodeId: string;
        label: string;
      }
    | {
        kind: 'workflow-step';
        workflowRunId: string;
        stepRunId: string;
        label: string;
      };
  inputSnapshot: {
    visiblePrompt: string;
    executionPromptDigest: string;
    attachmentNames: string[];
  };
  baseVersion: {
    kind: 'target-snapshot' | 'submission-input';
    digest: string;
  };
}

export type WorkspaceContextKind =
  | 'design-files'
  | 'design-system'
  | 'project'
  | 'local-code'
  | 'file'
  | 'folder'
  | 'browser'
  | 'canvas'
  | 'terminal'
  | 'side-chat'
  | 'live-artifact';

export interface WorkspaceContextItem {
  id: string;
  kind: WorkspaceContextKind;
  label: string;
  tabId?: string;
  path?: string;
  absolutePath?: string;
  url?: string;
  title?: string;
}

export interface ProjectContextPluginRef {
  id: string;
  title: string;
  description?: string;
}

export interface ProjectContextMcpServerRef {
  id: string;
  label?: string;
  transport?: string;
  url?: string;
  command?: string;
}

export interface ProjectContextConnectorRef {
  id: string;
  name: string;
  provider?: string;
  category?: string;
  description?: string;
  status?: string;
  accountLabel?: string;
}
