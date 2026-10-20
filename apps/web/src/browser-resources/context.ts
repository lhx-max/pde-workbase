import type { WorkspaceCollabContext } from '@bezier/contracts';

/**
 * The complete workspace identity carried by workspace-aware web requests.
 *
 * Keep this helper independent from React hooks and project state so shared
 * catalog modules can use it without creating an import cycle.
 */
export function workspaceProjectHeaders(context: WorkspaceCollabContext): HeadersInit {
  return {
    'x-bezier-workspace-id': context.workspaceId,
    'x-bezier-workspace-type': context.workspaceType,
    'x-bezier-workspace-member-id': context.workspaceMemberId,
    'x-bezier-workspace-role': context.role,
    'x-bezier-workspace-lifecycle-state': context.lifecycleState,
    'x-bezier-workspace-member-status': context.memberStatus,
    'x-bezier-workspace-can-share-projects': String(context.permissions.canShareProjects),
    'x-bezier-workspace-can-write-synced-files': String(context.permissions.canWriteSyncedFiles),
  };
}

/**
 * Browser-owned navigations (iframe/img/a) cannot attach request headers.
 * Preserve the exact authority in the URL for those surfaces; the daemon
 * freshly verifies both values before serving Workspace-owned bytes.
 */
export function workspaceResourceUrl(
  path: string,
  context: WorkspaceCollabContext | null | undefined,
): string {
  if (!context) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}workspaceId=${encodeURIComponent(context.workspaceId)}`
    + `&workspaceMemberId=${encodeURIComponent(context.workspaceMemberId)}`;
}

/** Append a query fragment without corrupting an already workspace-scoped URL. */
export function appendResourceQuery(path: string, query: string): string {
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query.replace(/^[?&]+/, '')}`;
}

/**
 * Cache partition matching exactly the fields {@link workspaceProjectHeaders}
 * puts on the wire. Other context fields do not scope these requests.
 */
export function workspaceIdentityCacheKey(
  context: WorkspaceCollabContext | null | undefined,
): string {
  if (!context) return 'none';
  return [
    context.workspaceId,
    context.workspaceType,
    context.workspaceMemberId,
    context.role,
    context.memberStatus,
    context.lifecycleState,
    String(context.permissions?.canShareProjects),
    String(context.permissions?.canWriteSyncedFiles),
  ].join(':');
}

