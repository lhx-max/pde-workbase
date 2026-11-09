/**
 * DA-native team roles. The vocabulary follows WEMUX, while the policy and
 * enforcement live in DA so no external collaboration backend is required.
 */
export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface NativeTeamUser {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'banned';
  createdAt: number;
}

export interface NativeTeamSummary {
  id: string;
  name: string;
  description: string;
  role: TeamRole;
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface NativeTeamMember {
  user: NativeTeamUser;
  role: TeamRole;
  joinedAt: number;
}

/** Archived data remains on its original team service; invitations never reactivate. */
export interface NativeTeamArchive extends NativeTeamSummary {
  archivedAt: number;
}
export interface NativeTeamArchivesResponse { teams: NativeTeamArchive[] }
export const TEAM_DISSOLVE_CONFIRMATION_TOKEN = 'DISSOLVE_TEAM';
export const TEAM_DISSOLVE_CONFIRMATION_LEGACY_ZH = '解散团队';
export const TEAM_DISSOLVE_CONFIRMATION_EN = 'Dissolve team';

/** Human phrases plus the stable token. Old clients keep sending the Chinese phrase. */
export const TEAM_DISSOLVE_CONFIRMATIONS = [
  TEAM_DISSOLVE_CONFIRMATION_TOKEN,
  TEAM_DISSOLVE_CONFIRMATION_LEGACY_ZH,
  TEAM_DISSOLVE_CONFIRMATION_EN,
] as const;

export function isTeamDissolveConfirmation(value: unknown): value is string {
  return typeof value === 'string' && (TEAM_DISSOLVE_CONFIRMATIONS as readonly string[]).includes(value);
}

export interface NativeTeamDissolveRequest { confirmation: string }
export interface NativeTeamLifecycleResponse { ok: true }

export interface NativeTeamInvitation {
  id: string;
  teamId: string;
  /** Optional label shown to the owner; invitations are device-based, not email-bound. */
  name?: string;
  /** Legacy email-bound invitations remain readable during migration. */
  email?: string;
  role: Exclude<TeamRole, 'owner'>;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  token?: string;
  expiresAt: number;
  createdAt: number;
}

export interface NativeTeamProjectShare {
  id: string;
  teamId: string;
  projectId: string;
  scope: 'project' | 'all_sessions' | 'session';
  sessionId?: string;
  targetType: 'user' | 'agent';
  targetId: string;
  permission: 'read' | 'edit' | 'collaborate';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface NativeTeamAuditEvent {
  id: string;
  teamId: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  createdAt: number;
}

/** A DA-native organization group. Members can appear in more than one group. */
export interface NativeTeamGroup {
  id: string;
  teamId: string;
  name: string;
  members: Array<{ type: 'user' | 'agent'; id: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface NativeTeamGroupCreateRequest {
  name: string;
}

export interface NativeTeamGroupUpdateRequest {
  name?: string;
  members?: Array<{ type: 'user' | 'agent'; id: string }>;
}

export interface NativeTeamUsageWindow {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  recordedRuns: number;
  daily: Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number; runs: number }>;
  projects: Array<{ projectId: string; projectName: string; inputTokens: number; outputTokens: number; totalTokens: number; runs: number }>;
  agents: Array<{ agentId: string; inputTokens: number; outputTokens: number; totalTokens: number; runs: number }>;
  members: Array<{ userId: string; userName: string; inputTokens: number; outputTokens: number; totalTokens: number; runs: number }>;
  models: Array<{ modelId: string; providerId: string; totalTokens: number; runs: number }>;
  providers: Array<{ providerId: string; totalTokens: number; runs: number }>;
}

export type NativeTeamQuotaPeriod = 'day' | 'month';
export type NativeTeamQuotaAction = 'warn' | 'block';

export interface NativeTeamMemberQuota {
  userId: string;
  userName: string;
  enabled: boolean;
  period: NativeTeamQuotaPeriod;
  limitTokens: number;
  usedTokens: number;
  usagePercent: number;
  action: NativeTeamQuotaAction;
  exceeded: boolean;
}

export interface NativeTeamNode {
  id: string;
  userId: string;
  userName: string;
  name: string;
  kind: 'host' | 'client';
  platform: string;
  version: string;
  capabilities: string[];
  online: boolean;
  lastSeenAt: number;
  createdAt: number;
}

export interface NativeTeamInsightEvent {
  id: string;
  kind: 'run' | 'audit';
  action: string;
  title: string;
  detail: string;
  status?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  occurredAt: number;
}

export interface NativeTeamBootstrapResponse {
  needsOwnerRegistration: boolean;
}

export const NATIVE_TEAM_PROTOCOL_VERSION = 1;

export interface NativeTeamServiceDescriptor {
  serviceId: string;
  protocolVersion: number;
  capabilities: Array<'team-management' | 'team-resources' | 'team-content' | 'team-execution' | 'team-executor-pairing' | 'team-migration-preflight' | 'team-migration-v1' | 'device-management'>;
}

export interface NativeTeamAuthResponse {
  token: string;
  user: NativeTeamUser;
}

export interface NativeTeamInvitationJoinRequest {
  identityKey: string;
  name: string;
}

export interface NativeTeamInvitationJoinResponse extends NativeTeamAuthResponse {
  team: NativeTeamSummary;
}

export interface NativeTeamServerStartRequest {
  port?: number;
  publicBaseUrl?: string;
}

export interface NativeTeamServerStatus {
  enabled: boolean;
  running: boolean;
  bindHost: string;
  port: number;
  publicBaseUrl?: string;
  urls: string[];
}

export interface NativeTeamMeResponse {
  user: NativeTeamUser;
  teams: NativeTeamSummary[];
  selectedTeamId: string | null;
}

export interface NativeTeamInsights {
  observedAt: number;
  scope: 'authorized-sessions';
  activeMembers: number;
  runs: Array<{ id: string; projectId: string; projectName: string; sessionId: string; sessionTitle: string; status: string; updatedAt: number }>;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheWriteTokens: number; recordedRuns: number };
  usageWindows?: Record<'7d' | '30d' | 'all', NativeTeamUsageWindow>;
  storage: { bytes: number; versions: number; resources: number; quotaBytes: null };
  execution: Array<{ projectId: string; projectName: string; agentId: string; enabled: boolean }>;
  nodes?: NativeTeamNode[];
  quotas?: NativeTeamMemberQuota[];
  events?: NativeTeamInsightEvent[];
}

export interface NativeTeamDetailResponse {
  team: NativeTeamSummary;
  members: NativeTeamMember[];
  invitations: NativeTeamInvitation[];
  shares: NativeTeamProjectShare[];
  audit: NativeTeamAuditEvent[];
  groups?: NativeTeamGroup[];
}

export interface NativeTeamRegisterRequest {
  email: string;
  name: string;
  password: string;
  invitationToken?: string;
}

export interface NativeTeamLoginRequest {
  email: string;
  password: string;
}

export interface NativeTeamCreateRequest {
  name: string;
  description?: string;
}

export interface NativeTeamInviteRequest {
  name?: string;
  email?: string;
  role: Exclude<TeamRole, 'owner'>;
}

export interface NativeTeamMemberRoleRequest {
  role: TeamRole;
}

export interface NativeTeamOwnershipTransferRequest {
  userId: string;
}

export interface NativeTeamStorageSettings {
  binding: { provider: 'local'; wikiId: string } | null;
  hasVersions: boolean;
  /** Absolute folder on the host; exposed only through the local owner API. */
  path?: string;
}

export interface NativeTeamStoragePathRequest { path: string }

export interface NativeTeamProjectShareRequest {
  projectId: string;
  scope: NativeTeamProjectShare['scope'];
  sessionId?: string;
  targetType: NativeTeamProjectShare['targetType'];
  targetId: string;
  permission: NativeTeamProjectShare['permission'];
}
