/** The first migration format is a selective, credential-free team transfer. */
export const NATIVE_TEAM_MIGRATION_FORMAT_VERSION = 1 as const;

export type NativeTeamMigrationBlockerCode =
  | 'MULTI_TEAM_SOURCE'
  | 'ACTIVE_TEAM_RUNS'
  | 'RUN_STATE_UNAVAILABLE'
  | 'ACTIVE_EXECUTOR_TASKS'
  | 'EXECUTOR_PAIRED'
  | 'PENDING_INVITATIONS'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'UNSUPPORTED_STORAGE'
  | 'CONTENT_UNAVAILABLE'
  | 'CONTENT_MISMATCH'
  | 'BUNDLE_TOO_LARGE'
  | 'SPACE_CATALOGUE_NOT_MIGRATABLE';

export interface NativeTeamMigrationBlocker {
  code: NativeTeamMigrationBlockerCode;
  resourceId?: string;
  versionId?: string;
  count?: number;
}

export interface NativeTeamMigrationPreflight {
  formatVersion: typeof NATIVE_TEAM_MIGRATION_FORMAT_VERSION;
  sourceServiceId: string;
  teamId: string;
  checkedAt: number;
  ready: boolean;
  counts: {
    members: number;
    groups: number;
    projectBindings: number;
    projectShares: number;
    resources: number;
    versions: number;
    auditEvents: number;
  };
  blockers: NativeTeamMigrationBlocker[];
}

/** Export is an owner-held secret; callers must never log or cache the bundle. */
export interface NativeTeamMigrationBundle {
  formatVersion: typeof NATIVE_TEAM_MIGRATION_FORMAT_VERSION;
  sourceServiceId: string;
  targetServiceId: string;
  teamId: string;
  exportedAt: number;
  transferSecret: string;
  counts: Record<string, number>;
  payload: {
    users: Array<{ id: string; email: string; name: string; status: string; suspended_until: number | null; created_at: number; updated_at: number }>;
    tables: Record<string, Array<Record<string, string | number | null>>>;
    contents: Array<{ versionId: string; content: string }>;
  };
  digest: string;
}

export interface NativeTeamMigrationState {
  serviceId: string;
  teamId: string | null;
  phase: 'writable' | 'frozen' | 'exported' | 'staging' | 'staged' | 'active' | 'retired';
  digest?: string;
  counterpartServiceId?: string;
  claimsRemaining?: number;
}

export interface NativeTeamMigrationStageResult {
  state: NativeTeamMigrationState;
  claims: Array<{ userId: string; name: string; email: string; code: string }>;
}

export interface NativeTeamMigrationVerification {
  state: NativeTeamMigrationState;
  expectedCounts: Record<string, number>;
  actualCounts: Record<string, number>;
  verifiedContents: number;
  integrityOk: boolean;
  readyToActivate: boolean;
}

export interface NativeTeamMigrationReceipt {
  targetServiceId: string;
  teamId: string;
  digest: string;
  outcome: 'aborted' | 'activated';
  proof: string;
}
