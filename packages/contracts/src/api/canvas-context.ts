import type { ProjectLedgerEvent } from './project-ledger.js';

export type CanvasContextNodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'ready';

export interface CanvasContextNodeSummary {
  id: string;
  kind: string;
  title: string;
  brief?: string;
  status: CanvasContextNodeStatus;
  outputPaths: string[];
  sourceNodeIds: string[];
  taskIds: string[];
  incomingNodeIds: string[];
  outgoingNodeIds: string[];
  updatedAt?: string;
}

export interface CanvasContextSummary {
  /** Recent explicit use signals; never inferred satisfaction or approval. */
  recentUsage?: Array<Pick<ProjectLedgerEvent, 'id' | 'type' | 'entityId' | 'entityVersion' | 'occurredAt' | 'payload'>>;
  projectId: string;
  revision: number;
  nodeCount: number;
  edgeCount: number;
  statusCounts: Partial<Record<CanvasContextNodeStatus, number>>;
  nodes: CanvasContextNodeSummary[];
  truncated: boolean;
}

export interface CanvasContextSummaryResponse {
  summary: CanvasContextSummary;
}

export interface CanvasNodeHistoryResponse {
  projectId: string;
  nodeId: string;
  node: CanvasContextNodeSummary | null;
  events: ProjectLedgerEvent[];
}
