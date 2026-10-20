export type ProjectLedgerActorType = 'user' | 'agent' | 'system' | 'external';

/** An explicit download handed to the browser/host, not proof of a disk save or approval. */
export interface ProjectDownloadObservation {
  requestId: string;
  fileName: string;
  nodeId?: string;
  contentDigest?: string;
  versionId?: string;
  format?: string;
}

export type ProjectLedgerOrigin = 'realtime' | 'backfill' | 'reconciled';

export type ProjectLedgerSensitivity = 'normal' | 'sensitive' | 'restricted';

export type ProjectLedgerVisibility = 'user' | 'internal';

export type ProjectLedgerEvidenceKind =
  | 'message'
  | 'db_row'
  | 'project_file'
  | 'file_version'
  | 'run_log'
  | 'native_session'
  | 'deployment';

export interface ProjectLedgerEvidenceRef {
  kind: ProjectLedgerEvidenceKind;
  id: string;
  version?: string;
  /** A controlled table name emitted by the daemon, never arbitrary SQL. */
  table?: string;
  /** Project-relative or daemon-log-relative path. Absolute paths are not exposed. */
  path?: string;
  digest?: string;
  excerpt?: string;
}

export interface ProjectLedgerEvent {
  /** Database insertion order for live catch-up, scoped to this data root. */
  sequence?: number;
  id: string;
  projectId: string;
  workspaceId?: string;
  type: string;
  occurredAt: number;
  recordedAt: number;
  actorType: ProjectLedgerActorType;
  actorId?: string;
  source: string;
  entityType: string;
  entityId: string;
  entityVersion?: string;
  conversationId?: string;
  runId?: string;
  workflowRunId?: string;
  correlationId?: string;
  causationId?: string;
  summary: string;
  payload: Record<string, unknown>;
  evidenceRefs: ProjectLedgerEvidenceRef[];
  payloadDigest: string;
  sensitivity: ProjectLedgerSensitivity;
  visibility: ProjectLedgerVisibility;
  origin: ProjectLedgerOrigin;
  idempotencyKey: string;
  schemaVersion: number;
}

export interface ProjectLedgerListResponse {
  projectId: string;
  events: ProjectLedgerEvent[];
  nextCursor: string | null;
  highWaterMark?: number;
  hasMore?: boolean;
}

export interface ProjectLedgerEventResponse {
  event: ProjectLedgerEvent;
}

export type ProjectLedgerVerifyIssueCode =
  | 'invalid-event'
  | 'missing-evidence'
  | 'digest-mismatch'
  | 'missing-run-terminal'
  | 'unknown-schema';

export interface ProjectLedgerVerifyIssue {
  code: ProjectLedgerVerifyIssueCode;
  eventId?: string;
  evidenceId?: string;
  message: string;
}

export interface ProjectLedgerVerifyResponse {
  ok: boolean;
  projectId: string;
  checkedEvents: number;
  checkedEvidenceRefs: number;
  issues: ProjectLedgerVerifyIssue[];
  /** References whose external contents were not checked. */
  uncheckedEvidenceRefs?: number;
}

export interface ProjectLedgerReconcileResponse {
  projectId: string;
  dryRun: boolean;
  discovered: number;
  inserted: number;
  existing: number;
}

export interface ProjectLedgerState {
  projectId: string;
  projectName: string;
  goal?: string;
  phase: 'created' | 'active' | 'blocked' | 'delivered' | 'completed' | 'archived';
  latestEventId?: string;
  latestEventAt?: number;
  latestRun?: {
    runId: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
    updatedAt: number;
  };
  contexts: {
    skillId?: string;
    designSystemId?: string;
    modelId?: string;
    pluginIds: string[];
    knowledgeIds: string[];
  };
  artifactIds: string[];
  openDecisionCount: number;
  deliveryCount: number;
  generatedAt: number;
  throughEventId?: string;
}

export interface ProjectLedgerStateResponse {
  state: ProjectLedgerState;
}
