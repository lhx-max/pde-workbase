import type { JsonValue } from '../common.js';
import type { ExecutionSnapshot } from './execution-snapshot.js';

export interface WorkflowAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type WorkflowAssistantScope = { mode: 'global' } | { mode: 'node'; nodeId: string };
export type WorkflowPropertyChange = { nodeId: string; path: string[]; op: 'set'; value: JsonValue } | { nodeId: string; path: string[]; op: 'remove' };
export interface WorkflowPropertyDiff { nodeId: string; title: string; path: string[]; label: string; before?: JsonValue; after?: JsonValue }
export interface WorkflowAssistantApplyRequest {
  workflow: JsonValue;
  proposal: JsonValue;
  scope: WorkflowAssistantScope;
  changes?: WorkflowPropertyChange[];
  persistedRevision: string;
}

export interface WorkflowAssistantRequest {
  scope?: WorkflowAssistantScope;
  execution?: ExecutionSnapshot;
  /** Revision returned by the last server read/save; binds the request to that persisted baseline. */
  persistedRevision?: string;
  message: string;
  /** The live editor graph, including unsaved canvas changes. */
  workflow: JsonValue;
  history?: WorkflowAssistantMessage[];
  /** Explicit current Agent and its model; never select a different provider silently. */
  agentId?: string;
  model?: string;
}

export interface WorkflowAssistantResponse {
  changes?: WorkflowPropertyChange[];
  diff?: WorkflowPropertyDiff[];
  persistedRevision?: string;
  reply: string;
  summary: string[];
  /** A complete replacement graph. Missing means the answer is advisory only. */
  proposal?: JsonValue;
  agentId?: string;
  model?: string;
  /** Exact product Skill content loaded for this proposal; not an execution receipt. */
  skill?: { id: string; digest: string };
}
