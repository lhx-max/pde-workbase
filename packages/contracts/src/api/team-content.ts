/** Network-safe projections. Never include local paths, runtime state or credentials. */
export interface NativeTeamSharedProject {
  id: string;
  name: string;
  updatedAt?: number;
  removable?: boolean;
  permission: 'read' | 'edit' | 'collaborate' | 'manage' | null;
  sessions: Array<{ id: string; title: string }>;
}

/** Internal personal-to-team file transfer uses application/zip; UI selects project IDs, not OS files. */
export interface NativeTeamProjectUploadRequest {
  name: string;
  spaceId: string;
}
export interface NativeTeamProjectUploadOptions {
  spaces: Array<{ id: string; name: string }>;
  enabled: boolean;
}

export interface NativeTeamProjectContent extends NativeTeamSharedProject {
  files: Array<{ path: string; size: number; mime: string }>;
}

export interface NativeTeamFileContent {
  path: string;
  content: string;
  revision: string;
  editable: boolean;
}

export interface NativeTeamFileUpdateRequest {
  path: string;
  content: string;
  expectedRevision: string;
}

export interface NativeTeamSessionContent {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string }>;
}
