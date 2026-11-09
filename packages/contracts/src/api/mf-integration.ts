/** MF is a hosted execution owner, not a second invocation of the local AgentAdapter. */
export const MF_BRIDGE_VERSION = 1 as const;
export const MF_BRIDGE_CHANNEL = 'canvas-mf' as const;
export const MF_BRIDGE_MAX_BYTES = 28 * 1024 * 1024;

export interface MfPublicConfiguration {
  available: boolean;
  reason?: 'MF_NOT_CONFIGURED' | 'MF_CONFIGURATION_INVALID';
  uiPath: string;
  defaultAieUsername?: string;
  workbenchId?: string;
  teamId?: string;
  /** No credentials, proxy targets or capability tokens may appear here. */
  capabilities: { chat: boolean; webMcp: boolean; artifacts: boolean };
}
export interface MfSessionAssociation {
  sessionKey: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}
export interface MfSessionAssociations {
  sessions: MfSessionAssociation[];
  activeSessionKey?: string;
}
export interface MfRunState {
  state: 'idle' | 'submitting' | 'streaming' | 'recovering';
  runId: string;
  sessionKey?: string;
  reason?: 'completed' | 'stopped' | 'failed' | 'auth-required';
}
/** Task association is supplied only after the frame's bound composer context is consumed. */
export interface MfRunNotification extends MfRunState {
  boundTaskId?: string;
  boundRequestId?: string;
}
export interface MfCanvasReference {
  projectId: string;
  nodeIds: string[];
  label: string;
  revision?: number;
}
export interface MfTransferFile { path: string; contentBase64: string; mimeType?: string }
export interface MfArtifactReference {
  /** Omitted retains explicit session/Kim semantics. Workspace preview uses a different API. */
  source?: 'session' | 'workspace';
  path: string;
  name?: string;
  spaceId?: string;
  sessionKey: string;
}
export interface MfSessionUpsertRequest { sessionKey: string; title?: string; activate?: boolean }
export interface MfSessionActivateRequest { activeSessionKey: string | null }
export interface MfSessionRemoveRequest { sessionKey: string }
export interface MfTaskRunUpdate { sessionKey?: string; run?: MfRunState }
export type MfTaskDeliveryRequest = { content: string } | { artifact: MfArtifactReference };
export interface MfArtifactImportRequest { requestId: string; artifact: MfArtifactReference; outputPath?: string }
export interface MfArtifactImportResult { path: string; digest: string; requestId: string; nodeId?: string }
/** Preserve server byte provenance when acknowledging completed host/UI import. */
export interface MfBridgeArtifactImportResult extends MfArtifactImportResult { applied: true }
export interface MfCanvasTextUpdateRequest { requestId: string; nodeId: string; expectedRevision: number; text: string }
export interface MfCanvasTextUpdateResult { nodeId: string; revision: number }
/** ACK of this command only: initialization is not SDK mount, and staging is not execution/delivery. */
export interface MfBridgeAcknowledgement { accepted: true }
export interface MfBridgeControlResponses {
  'import-artifact': MfBridgeArtifactImportResult;
  initialize: MfBridgeAcknowledgement & { initialized: true };
  'set-session': MfBridgeAcknowledgement & { sessionKey?: string | undefined };
  'stage-text': MfBridgeAcknowledgement & { staged: true };
  'stage-reference': MfBridgeAcknowledgement & { staged: true };
  'stage-files': MfBridgeAcknowledgement & { staged: true; uploaded: number };
}
/** Generation ACK additionally requires the frame's verified, consumed-context run correlation. */
export interface MfSubmissionAccepted extends MfBridgeAcknowledgement {}
export interface MfToolCall {
  name: 'canvas.get_context' | 'canvas.get_selection' | 'canvas.reveal_node'
    | 'canvas.update_text' | 'canvas.import_artifact' | 'canvas.deliver_text' | 'canvas.deliver_artifact';
  arguments: Record<string, unknown>;
}
export interface MfGenerationSubmission {
  taskId: string;
  requestId: string;
  prompt: string;
  nodeId: string;
  kind: 'text' | 'html' | 'presentation';
  outputPath?: string;
  inputFiles?: MfTransferFile[];
}
export interface MfBridgeInitialize {
  configuration: MfPublicConfiguration;
  locale: 'zh-CN' | 'en';
  sessionKey?: string;
}
export interface MfBridgePayloads {
  initialize: MfBridgeInitialize;
  'set-session': { sessionKey?: string };
  'stage-reference': MfCanvasReference;
  'stage-files': { files: MfTransferFile[] };
  'stage-text': { text: string };
  'submit-generation': MfGenerationSubmission;
  'get-context': { references?: MfCanvasReference[] };
  'get-selection': Record<string, never>;
  'tool-call': MfToolCall;
  'import-artifact': MfArtifactReference;
  'session-created': { sessionKey: string };
  'session-title': { sessionKey: string; title: string };
  'run-state': MfRunNotification;
  'auth-required': { status?: number; code?: number; loginUrl?: string };
  'cancel-generation': { taskId: string };
  ready: Record<string, never>;
}
export type MfBridgeMethod = keyof MfBridgePayloads;
export interface MfBridgeError { code: string; message: string }
/** The receiver must also verify exact event.origin and event.source; this is correlation, not auth. */
export interface MfBridgeEnvelope {
  channel: typeof MF_BRIDGE_CHANNEL;
  version: typeof MF_BRIDGE_VERSION;
  instanceId: string;
  projectId: string;
  id: string;
  kind: 'request' | 'response' | 'cancel';
  method: MfBridgeMethod;
  payload?: unknown;
  error?: MfBridgeError;
}
const METHODS = new Set<string>([
  'initialize', 'set-session', 'stage-reference', 'stage-files', 'stage-text', 'submit-generation',
  'get-context', 'get-selection', 'tool-call', 'import-artifact', 'session-created', 'session-title',
  'run-state', 'auth-required', 'cancel-generation', 'ready',
]);
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
/** Reject malformed/oversized structured-clone data before routing. Payloads need method-specific checks too. */
export function isMfBridgeEnvelope(value: unknown): value is MfBridgeEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.channel !== MF_BRIDGE_CHANNEL || item.version !== MF_BRIDGE_VERSION
    || !safeId(item.instanceId) || !safeId(item.projectId) || !safeId(item.id)
    || !['request', 'response', 'cancel'].includes(String(item.kind)) || !METHODS.has(String(item.method))) return false;
  if (Object.keys(item).some(key => !['channel', 'version', 'instanceId', 'projectId', 'id', 'kind', 'method', 'payload', 'error'].includes(key))) return false;
  if (item.error !== undefined) {
    if (!item.error || typeof item.error !== 'object' || Array.isArray(item.error)) return false;
    const error = item.error as Record<string, unknown>;
    if (!safeId(error.code) || typeof error.message !== 'string' || error.message.length > 4096) return false;
  }
  if ((item.kind !== 'response' && item.error !== undefined) || (item.kind === 'cancel' && item.payload !== undefined)) return false;
  try {
    const json = JSON.stringify(value);
    if (json.length > MF_BRIDGE_MAX_BYTES) return false;
    let bytes = 0;
    for (let index = 0; index < json.length; index += 1) {
      const code = json.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && json.charCodeAt(index + 1) >= 0xdc00 && json.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
      else bytes += 3;
      if (bytes > MF_BRIDGE_MAX_BYTES) return false;
    }
    return true;
  } catch { return false; }
}
