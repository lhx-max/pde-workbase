
// Team-edition collaboration shared DTOs: presence overlay (presence) and
// the sync trigger. Single source of truth for the daemon routes, the web
// CollabClient, and the `bezier collab` CLI so no surface re-declares these shapes.

export type CollabMemberRole = 'owner' | 'admin' | 'member';

/** A member present in a shared project (heartbeat identity). */
export interface CollabPresenceMember {
  memberId: string;
  name?: string;
  role?: CollabMemberRole;
  avatarUrl?: string | null;
  filePath?: string | null;
  activity?: string | { label?: string } | Record<string, unknown> | null;
  heartbeatAt?: string;
}

// Workspace context seam onto the B (identity/membership) + D (visibility)
// lanes. A faithful SUBSET of B's `CurrentWorkspaceContext`
// (vela packages/shared/src/workspace-context.ts) — the exact fields C needs to
// decide whether collab runs and who the present member is — so wiring B's real
// context in is a direct field pass-through. Field names mirror B verbatim.

export type WorkspaceType = 'personal' | 'team';
export type WorkspaceMemberStatus = 'active' | 'removed';
export type WorkspaceLifecycleState =
  | 'active'
  | 'locked'
  | 'deleting'
  | 'deleted';

/**
 * Permission bits — a verbatim mirror of B's `WorkspacePermissions`
 * (vela packages/shared/src/workspace-context.ts, `buildWorkspacePermissions`).
 * C surfaces CONSUME these to gate UI; never re-derive from role/lifecycle so the
 * two lanes cannot drift. `canWriteSyncedFiles` is the read-only gate for collab;
 * `canManageSharedResources`/`canShareProjects` gate resource sharing.
 */
export interface WorkspacePermissions {
  canManageMembers: boolean;
  canInviteMembers: boolean;
  canShareProjects: boolean;
  canWriteSyncedFiles: boolean;
  canViewWorkspaceSettings: boolean;
  canManageSharedResources: boolean;
}

/**
 * The one shared workspace context every team surface consumes. A faithful mirror
 * of B's `CurrentWorkspaceContext` (vela packages/shared/src/workspace-context.ts,
 * shipped in powerformer/vela#615) so the daemon's `/api/workspace/context` proxy
 * is a straight field pass-through and no C surface re-derives role/plan/permission
 * judgements. `context` is null off-team (personal, signed out, or B unavailable).
 */
export interface WorkspaceCollabContext {
  workspaceId: string;
  workspaceType: WorkspaceType;
  workspaceMemberId: string;
  role: CollabMemberRole;
  memberStatus: WorkspaceMemberStatus;
  lifecycleState: WorkspaceLifecycleState;
  permissions: WorkspacePermissions;
  lastActiveWorkspaceId?: string;
  /** Team id — present for a team workspace, absent for a personal one. Lets the
   *  resource-hub principal derive from this one context (single identity source). */
  teamId?: string;
  /** Human-friendly team name for the workspace switcher (falls back to teamId). */
  teamName?: string;
  /**
   * B's display name for THIS workspace, whatever its type. Mirrors the
   * `workspaceName` on B's CurrentWorkspaceContext, which is required there and
   * is populated for personal workspaces too — vela derives "«owner»'s
   * workspace" for an unnamed one, and an owner may rename it outright.
   *
   * Distinct from `teamName` on purpose: `teamName` is the TEAM switcher's
   * field and stays absent for a personal workspace, so nothing may read it as
   * an "is a team" signal. Any surface that just wants to LABEL the current
   * workspace reads this one, and therefore gets a correct label from the
   * context the client already fetches at startup — without waiting on the
   * workspace-directory read that only happens when the switcher is opened.
   */
  workspaceName?: string;
  /** Display name for the presence overlay (optional; falls back to the id). */
  displayName?: string;
}

/**
 * GET /api/workspace/context. The daemon's single B-integration point: in
 * production it proxies B's context for the caller; `context` is null when there
 * is no team-workspace context (personal, signed out, or B unavailable).
 */
export interface WorkspaceContextResponse {
  context: WorkspaceCollabContext | null;
}

/** A workspace visible to the signed-in Vela identity. Mirrors B's directory item. */
export interface WorkspaceDirectoryItem {
  workspaceId: string;
  workspaceName: string;
  workspaceIconKey?: string;
  workspaceType: WorkspaceType;
  workspaceMemberId: string;
  role: CollabMemberRole;
  memberStatus: WorkspaceMemberStatus;
  lifecycleState: WorkspaceLifecycleState;
}

/** GET /api/workspace/directory. Bezier's local workspace switcher data source. */
export interface WorkspaceDirectoryResponse {
  items: WorkspaceDirectoryItem[];
  /**
   * @deprecated Compatibility echo of the request-side selection claim.
   * It is not a daemon-global active Workspace and must not scope resources.
   */
  activeWorkspaceId: string | null;
}

/**
 * PUT /api/workspace/active.
 * Verifies and resolves this tab's exact Workspace/member selection; it does
 * not mutate a daemon-global selection used to scope resources.
 */
export interface WorkspaceActiveRequest {
  workspaceId: string;
  workspaceMemberId: string;
}

export interface WorkspaceActiveResponse {
  /** Compatibility echo of the verified tab-selected Workspace id. */
  activeWorkspaceId: string;
  context: WorkspaceCollabContext;
}

// —— Derivation helpers — a verbatim mirror of B's vela
// packages/shared/src/workspace-context.ts. Both the daemon's dev context stub
// and the real B proxy derive permissions/seat summary through these, so C never
// drifts from B's authorization rules. If B's helper changes, update here too.

export function isWorkspaceLifecycleReadable(state: WorkspaceLifecycleState): boolean {
  return state !== 'deleted';
}

/**
 * Whether a context can address the workspace resource hub.
 *
 * The hub keys every resource by a TEAM workspace: `teamId` is populated only
 * for `workspaceType === 'team'` (see the field's doc above), so a personal or
 * signed-out session has no id to push, snapshot, or redact under. Everything
 * built on the hub USED to be team-only by construction. That is still true of
 * team project SHARING, which needs teammates to share with — but no longer of
 * public single-file links: see {@link workspaceContextHasWorkspaceIdentity}.
 *
 * This is the ONE predicate both sides must agree on: the daemon refuses hub
 * writes when it is false, and the web UI must not render a hub-backed entry
 * point when it is false. Deriving it twice is how a UI grows a button that can
 * only ever fail.
 */
export function workspaceContextHasTeamIdentity(
  context: WorkspaceCollabContext | null | undefined,
): boolean {
  return Boolean(
    context &&
    context.workspaceType === 'team' &&
    context.workspaceId &&
    context.workspaceMemberId,
  );
}

/**
 * Whether this session can address a resource hub partition AT ALL.
 *
 * The hub addresses purely by workspace id, and B mints a principal for any
 * workspace a caller belongs to — a personal one included, where the principal's
 * `teamId` simply IS that workspace id, a partition of one. So the requirement
 * for a hub write is an id to publish under and a member id to own the result
 * with; the workspace TYPE is not part of it.
 *
 * Use this for surfaces that only need somewhere to put a resource — the public
 * single-file link is the one today. Use {@link workspaceContextHasTeamIdentity}
 * where the feature genuinely needs a TEAM, such as sharing a project with
 * teammates.
 *
 * Same rule as its sibling: the daemon refuses the write when this is false and
 * the web UI must not render the entry point when it is false. Deriving it twice
 * is how a UI grows a button that can only ever fail — which is exactly what
 * happened here before this helper existed.
 */
export function workspaceContextHasWorkspaceIdentity(
  context: WorkspaceCollabContext | null | undefined,
): boolean {
  return Boolean(context && context.workspaceId && context.workspaceMemberId);
}

export function isWorkspaceLifecycleWritable(state: WorkspaceLifecycleState): boolean {
  return state === 'active';
}

export function buildWorkspacePermissions(input: {
  role: CollabMemberRole;
  lifecycleState: WorkspaceLifecycleState;
  memberStatus?: WorkspaceMemberStatus;
}): WorkspacePermissions {
  const memberStatus = input.memberStatus ?? 'active';
  const readable =
    memberStatus === 'active' && isWorkspaceLifecycleReadable(input.lifecycleState);
  const writable =
    memberStatus === 'active' && isWorkspaceLifecycleWritable(input.lifecycleState);
  const isOwner = input.role === 'owner';
  const isAdmin = input.role === 'admin';
  return {
    canManageMembers: writable && (isOwner || isAdmin),
    canInviteMembers: writable && (isOwner || isAdmin),
    canShareProjects: writable,
    canWriteSyncedFiles: writable,
    canViewWorkspaceSettings: readable,
    canManageSharedResources: writable && (isOwner || isAdmin),
  };
}
