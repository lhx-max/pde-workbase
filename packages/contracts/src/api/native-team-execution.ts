export interface NativeTeamRunRequest {
  message: string;
  requestId: string;
  resources?: Array<{ id: string; version: string }>;
}
export interface NativeTeamRunCreated {
  runId: string;
  conversationId?: string;
  assistantMessageId?: string;
  reused: boolean;
  resources: Array<{ id: string; version: string; digest: string }>;
  warning?: string;
}
export interface NativeTeamRunStatus {
  runId: string;
  status: string;
  projectId: string;
  sessionId: string;
  /** Remote tasks expose only logical, relative artifact names; no host paths. */
  artifacts?: Array<{ path: string }>;
}
