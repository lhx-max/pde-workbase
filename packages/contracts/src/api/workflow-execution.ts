import type { ExecutionSnapshot } from './execution-snapshot.js';

/** Options pinned when the backend accepts a canvas workflow. */
export interface WorkflowExecutionRequest {
  /** Credentials stay in memory; recovery after daemon restart requires resubmission. */
  snapshot?: ExecutionSnapshot;
  conversationId?: string;
  agentId?: string;
  model?: string;
  rootPrompt?: string;
  taskExecutionId?: string;
}

export interface WorkflowExecutionStatus {
  managed: boolean;
  error?: string;
}
