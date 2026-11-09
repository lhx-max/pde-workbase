/** A workspace space explicitly connected to a team; private spaces are not implicit grants. */
export interface NativeTeamSpace {
  id: string;
  name: string;
  teamId: string;
  projectIds: string[];
  members: Array<{ userId: string; permission: 'read' | 'edit' }>;
  /** Independent team space, rather than a legacy connected personal space. */
  managed?: boolean;
}

export interface NativeTeamSpaceCreateRequest { name: string }
export interface NativeTeamSpaceDeleteRequest { targetSpaceId?: string }

export interface NativeTeamSpaceCandidate {
  id: string;
  name: string;
  projectCount: number;
}

export interface NativeTeamSpaceMemberRequest {
  permission: 'read' | 'edit' | null;
}
