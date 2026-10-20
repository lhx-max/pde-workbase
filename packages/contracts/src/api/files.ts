import type { OkResponse } from '../common.js';
import type { ArtifactKind, ArtifactManifest } from './artifacts.js';
import type { PersonalAssetKind, PersonalAssetTemplate } from './personal-assets.js';

export type ProjectFileKind =
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'text'
  | 'code'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'binary';

// Surfaced when the daemon's stub-guard runs in `warn` mode and detects a
// likely regression (the agent emitted a placeholder body that is much
// smaller than a prior artifact sharing the same `metadata.identifier`).
// In `reject` mode the daemon returns `422 ARTIFACT_REGRESSION` instead and
// no `ProjectFile` is produced.
export interface ProjectFileStubGuardWarning {
  code: 'ARTIFACT_REGRESSION';
  message: string;
  identifier: string;
  newSize: number;
  priorSize: number;
  priorName: string;
}

export interface ProjectFile {
  name: string;
  path?: string;
  localPath?: string;
  type?: 'file' | 'dir';
  size: number;
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
  artifactKind?: ArtifactKind;
  artifactManifest?: ArtifactManifest;
  stubGuardWarning?: ProjectFileStubGuardWarning;
  traceObjectReason?: 'new' | 'modified' | 'recovered';
}

/** Structured document preview; generated notices are distinct from user text. */
export interface ProjectDocumentPreview {
  kind?: 'pdf' | 'document' | 'presentation' | 'spreadsheet';
  title: string;
  sections: ProjectDocumentPreviewSection[];
}
export interface ProjectDocumentPreviewSection {
  title: string;
  lines: string[];
  /** Existing diagnostic lines remain on the wire; UIs localize this code only. */
  notice?: 'no-readable-text' | 'no-readable-slides' | 'no-readable-sheets' | 'no-readable-cells' | 'pdf-unavailable';
  /** Only unnamed/fallback worksheets use a generated title, never user names. */
  generatedTitle?: 'sheet';
}

/** Internal browser drag payload for moving an existing project file onto a canvas. */
export const PROJECT_FILE_DRAG_MIME = 'application/x-bezier-project-file';
/** UI-only alternative to dropping the same saved file on the active canvas. */
export const PROJECT_FILE_ADD_TO_CANVAS_EVENT = 'bezier-design:add-project-file-to-canvas';

/** Options for the host-to-canvas file import event; references retain their target identity. */
export interface ProjectFileCanvasAddOptions {
  clientX?: number;
  clientY?: number;
  referenceTargetId?: string;
  /** Reject an import whose originating selection was canceled while loading. */
  shouldApply?: () => boolean;
}

export interface ProjectFileDragPayload {
  artifactKind?: ArtifactKind;
  projectId: string;
  name: string;
  size: number;
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
  /** Original library semantics, retained when an asset is materialized as a project file. */
  sourceAsset?: {
    kind: PersonalAssetKind;
    name: string;
    description: string;
    template?: PersonalAssetTemplate & { prompt: string };
  };
}

const PROJECT_FILE_KINDS: readonly ProjectFileKind[] = [
  'html',
  'image',
  'video',
  'audio',
  'sketch',
  'text',
  'code',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'binary',
];

const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'html', 'deck', 'react-component', 'markdown-document', 'svg',
  'diagram', 'code-snippet', 'mini-app', 'design-system',
];

const PERSONAL_ASSET_KINDS: readonly PersonalAssetKind[] = [
  'folder',
  'text',
  'script',
  'image',
  'video',
  'audio',
  'slides',
  'webpage',
  'motion',
  'file',
];
const PERSONAL_ASSET_TEMPLATE_TYPES: readonly PersonalAssetTemplate['type'][] = [
  'Prototype',
  'Slides',
  'Image',
  'Video',
  'HyperFrames',
  'Audio',
];

export function parseProjectFileDragPayload(raw: string): ProjectFileDragPayload | null {
  try {
    const candidate = JSON.parse(raw) as Partial<ProjectFileDragPayload>;
    const projectId = String(candidate.projectId || '').trim();
    const name = String(candidate.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = name.split('/');
    if (!projectId || !name || segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
    if (!PROJECT_FILE_KINDS.includes(candidate.kind as ProjectFileKind)) return null;
    const sourceAsset = candidate.sourceAsset;
    const sourceKind = sourceAsset?.kind;
    const template = sourceAsset?.template;
    const parsedSourceAsset = sourceAsset && PERSONAL_ASSET_KINDS.includes(sourceKind as PersonalAssetKind)
      ? {
          kind: sourceKind as PersonalAssetKind,
          name: String(sourceAsset.name || name.split('/').pop() || name),
          description: String(sourceAsset.description || ''),
          ...(template
            && typeof template === 'object'
            && PERSONAL_ASSET_TEMPLATE_TYPES.includes(template.type as PersonalAssetTemplate['type'])
            ? {
                template: {
                  id: String(template.id || ''),
                  type: template.type as PersonalAssetTemplate['type'],
                  referencePath: String(template.referencePath || ''),
                  posterSrc: template.posterSrc == null ? null : String(template.posterSrc),
                  previewSrc: template.previewSrc == null ? null : String(template.previewSrc),
                  previewVideo: template.previewVideo == null ? null : String(template.previewVideo),
                  prompt: String(template.prompt || ''),
                },
              }
            : {}),
        }
      : undefined;
    return {
      projectId,
      name,
      size: Number.isFinite(candidate.size) ? Number(candidate.size) : 0,
      mtime: Number.isFinite(candidate.mtime) ? Number(candidate.mtime) : 0,
      kind: candidate.kind as ProjectFileKind,
      ...(ARTIFACT_KINDS.includes(candidate.artifactKind as ArtifactKind) ? { artifactKind: candidate.artifactKind } : {}),
      mime: String(candidate.mime || 'application/octet-stream'),
      ...(parsedSourceAsset ? { sourceAsset: parsedSourceAsset } : {}),
    };
  } catch {
    return null;
  }
}

export interface ProjectFolder {
  name: string;
  path: string;
  type: 'dir';
  size: 0;
  mtime: number;
}

/** `all` inventories on-disk files rather than the presentation artifact list.
 * Imported-folder hidden-path restrictions and symlink confinement still apply. */
export type ProjectFilesScope = 'artifacts' | 'all';

export interface ProjectFilesResponse {
  files: ProjectFile[];
}

export type ProjectFileVersionSource = 'ai' | 'manual' | 'restore';
export type ProjectFileVersionPromptSource = 'message' | 'project' | 'manual' | 'restore';

export type ArtifactOriginEntrySurface =
  | 'bezier_ui'
  | 'bezier_cli'
  | 'external_mcp'
  | 'unknown';

/**
 * Bounded provenance for the content lineage of an HTML file version.
 *
 * This is deliberately distinct from `ProjectFileVersion.source`: `source`
 * records how this checkpoint was created, while `origin` records where the
 * content lineage began. Prompts, file paths, account data, and credentials
 * must never be stored here.
 */
export interface ArtifactOrigin {
  entrySurface: ArtifactOriginEntrySurface;
  externalPluginId?: string;
  pluginWorkflowId?: string;
  runId?: string;
}

export type ArtifactOriginStatus =
  | 'matched'
  | 'missing_version'
  | 'digest_mismatch'
  | 'invalid_origin'
  | 'unknown';

export interface ProjectFileVersion {
  id: string;
  fileName: string;
  version: number;
  label: string;
  createdAt: number;
  source: ProjectFileVersionSource;
  prompt: string | null;
  promptSource?: ProjectFileVersionPromptSource;
  restoreFromVersionId?: string;
  size: number;
  mime: string;
  kind: ProjectFileKind;
  current: boolean;
  contentDigest?: string;
  parentVersionId?: string;
  origin?: ArtifactOrigin;
}

export interface ProjectFileVersionsResponse {
  file: ProjectFile;
  versions: ProjectFileVersion[];
}

export interface ProjectFileVersionResponse {
  version: ProjectFileVersion;
  content: string;
}

export interface CreateProjectFileVersionRequest {
  prompt?: string | null;
  label?: string | null;
  source?: ProjectFileVersionSource;
  parentVersionId?: string;
}

export interface CreateProjectFileVersionResponse {
  version: ProjectFileVersion;
}

export interface RestoreProjectFileVersionRequest {
  prompt?: string | null;
}

export interface ProjectFileVersionWarning {
  code: 'PROJECT_FILE_VERSION_CAPTURE_FAILED';
  message: string;
}

export interface RestoreProjectFileVersionResponse {
  file: ProjectFile;
  version: ProjectFileVersion | null;
  versionWarning?: ProjectFileVersionWarning;
}

export interface ProjectFoldersResponse {
  folders: ProjectFolder[];
}

export type ProjectExportManifestFileRole =
  | 'entry'
  | 'artifact'
  | 'supporting'
  | 'asset'
  | 'source'
  | 'other';

export interface ProjectExportManifestFile extends ProjectFile {
  included: boolean;
  role: ProjectExportManifestFileRole;
  reasons: string[];
}

export interface ProjectExportManifestArtifact {
  file: string;
  title: string;
  kind: ArtifactKind | null;
  renderer: string | null;
  status: string | null;
  exports: string[];
  supportingFiles: string[];
  updatedAt: string | null;
}

export const PROJECT_EXPORT_MANIFEST_SCHEMA = 'bezier.project-export-manifest.v1' as const;

export interface ProjectExportManifestResponse {
  schema: typeof PROJECT_EXPORT_MANIFEST_SCHEMA;
  projectId: string;
  projectName: string | null;
  generatedAt: string;
  entryFile: string | null;
  files: ProjectExportManifestFile[];
  artifacts: ProjectExportManifestArtifact[];
}

export interface ProjectPreviewUrlResponse {
  url: string;
  file: string;
  csp: string;
  iframeSandbox: string;
  opaqueOrigin: true;
}

/**
 * Runtime info the web host needs to render a "powered preview" — an HTML
 * artifact that requires real Web Workers, Web Storage, WASM, or (via
 * cross-origin isolation) SharedArrayBuffer, which the default opaque-origin
 * preview sandbox cannot provide.
 *
 * `baseOrigin` is the daemon's own directly-reachable http origin. The web
 * host loads the powered iframe from a host-swapped loopback variant of it.
 * That reserved browser origin is cross-origin to the app shell and is allowed
 * to read `/powered/` file bytes, but the daemon rejects its browser requests
 * to normal `/api/*` routes. `null` when the daemon cannot resolve a usable
 * origin (powered mode is then unavailable and previews stay on the opaque
 * sandbox).
 */
export interface ProjectPreviewIsolationResponse {
  supported: boolean;
  baseOrigin: string | null;
  /** URL path segment for the powered file route (`.../:id/<pathPrefix>/<file>`). */
  pathPrefix: string;
}

export interface ProjectFileResponse {
  file: ProjectFile;
  version?: ProjectFileVersion | null;
  versionWarning?: ProjectFileVersionWarning;
}

export interface ProjectFileTextPreviewResponse {
  text: string;
  truncated: boolean;
  size: number;
  limit: number;
  mime: string;
  kind: ProjectFileKind;
  poweredPreview: {
    required: boolean;
    scannedBytes: number;
    complete: boolean;
  };
}

export interface ProjectFolderResponse {
  folder: ProjectFolder;
}

export interface UploadProjectFilesResponse extends ProjectFilesResponse {}

export interface DeleteProjectFileResponse extends OkResponse {}

export interface DeleteProjectFolderResponse extends OkResponse {}

export interface RenameProjectFileRequest {
  from: string;
  to: string;
}

export interface RenameProjectFileResponse {
  file: ProjectFile;
  oldName: string;
  newName: string;
}

export function buildProjectRawFileUrl(
  baseUrl: string,
  projectId: string,
  filePath: unknown,
): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const segments = filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  if (segments.length === 0) return null;

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return `${normalizedBaseUrl}/api/projects/${encodeURIComponent(projectId)}/raw/${segments}`;
}

/**
 * Build an absolute powered-preview URL. Same shape as buildProjectRawFileUrl
 * but targets the `/powered/` route (cross-origin-isolation headers) and is
 * meant to be joined against the host-swapped preview origin derived from
 * ProjectPreviewIsolationResponse — NOT a relative path — so the iframe runs
 * at an origin isolated from the app shell and from normal daemon APIs.
 */
export function buildProjectPoweredFileUrl(
  baseOrigin: string,
  projectId: string,
  filePath: unknown,
): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const segments = filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  if (segments.length === 0) return null;

  const normalizedBaseUrl = baseOrigin.replace(/\/+$/, '');
  return `${normalizedBaseUrl}/api/projects/${encodeURIComponent(projectId)}/powered/${segments}`;
}
