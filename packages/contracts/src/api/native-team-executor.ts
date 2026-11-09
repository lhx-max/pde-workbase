/** One explicitly paired host. The service never receives the host's DA credential. */
export type NativeTeamExecutorCapability = 'run' | 'cancel' | 'events';

export interface NativeTeamExecutorPairingRequest {
  projectId: string;
  agentId: string;
  capabilities: NativeTeamExecutorCapability[];
}

export interface NativeTeamExecutorPairing {
  code: string;
  teamId: string;
  projectId: string;
  agentId: string;
  capabilities: NativeTeamExecutorCapability[];
  expiresAt: number;
}

export interface NativeTeamExecutorRegistration {
  code: string;
  projectId: string;
  agentId: string;
  projectName: string;
  sessions: Array<{ id: string; title: string }>;
}

/** The host publishes only logical project/session identity, never file paths. */
export interface NativeTeamExecutorProjection {
  projectName: string;
  sessions: Array<{ id: string; title: string }>;
}

export interface NativeTeamExecutorCredential {
  executorId: string;
  teamId: string;
  projectId: string;
  agentId: string;
  capabilities: NativeTeamExecutorCapability[];
  token: string;
  expiresAt: number;
}

export interface NativeTeamExecutorSummary {
  id: string;
  teamId: string;
  projectId: string;
  projectName: string;
  agentId: string;
  capabilities: NativeTeamExecutorCapability[];
  status: 'active' | 'expired' | 'revoked';
  online: boolean;
  lastSeenAt: number | null;
  expiresAt: number;
}

export type NativeTeamTaskState =
  | 'queued' | 'claimed' | 'accepted' | 'running' | 'cancel_requested'
  | 'needs_review' | 'succeeded' | 'failed' | 'canceled';

export interface NativeTeamExecutorTask {
  id: string;
  teamId: string;
  projectId: string;
  sessionId: string;
  actorUserId: string;
  agentId: string;
  prompt: string;
  resources: Array<{ id: string; version: string; digest: string }>;
  state: NativeTeamTaskState;
  localRunId?: string;
  lastSourceSeq: number;
}

export interface NativeTeamExecutorTaskEvent {
  sourceSeq: number;
  type: 'running' | 'text_delta' | 'terminal' | 'needs_review';
  text?: string;
  status?: 'succeeded' | 'failed' | 'canceled';
  assistantMessageId?: string;
  artifacts?: Array<{ path: string }>;
}
