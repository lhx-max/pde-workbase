import type { AssetAnalysisStatus } from './hooks.js';
import type { ProjectFile } from './files.js';
import type { PersonalAsset, PersonalAssetCreateRequest, PersonalAssetKind, PersonalAssetUse, PersonalAssetVersion, PersonalAssetAnalysisRequest, PersonalAssetCreate } from './personal-assets.js';

/** Standalone local library protocol. Existing PersonalAsset DTOs retain wire compatibility.
 * No account, team, installed package or remote service is required.
 */
export const ASSET_LIBRARY_API_BASE = '/api/asset-library';
export interface AssetLibraryInfo {
  apiVersion: 1;
  source: { id: string; name: string; kind: 'builtin' | 'external' };
  capabilities: {
    list: boolean; read: boolean; create: boolean; upload: boolean; folders: boolean;
    spaces: boolean; metadata: boolean; versions: boolean; batch: boolean;
    content: boolean; uses: boolean; export: boolean; imageMetadata: boolean;
    projectImport: boolean; projectSave: boolean; analysis: boolean; catalogue: boolean;
    idempotentCreate: boolean;
  };
  limits: { uploadBytes: number; textBytes: number; batchAssets: number; exportBytes: number };
  deletion: 'permanent';
}
export interface AssetLibraryListResponse { assets: PersonalAsset[] }
export interface AssetLibraryAssetResponse { asset: PersonalAsset; analysis?: AssetAnalysisStatus }
export interface AssetLibraryPromptResponse extends AssetAnalysisStatus { prompt: PersonalAsset['prompt'] | null; available: boolean }
export interface AssetLibraryImportResponse { asset: PersonalAsset; version: PersonalAssetVersion; files: ProjectFile[] }
export interface AssetLibraryImportFailure {
  error: {code: 'ASSET_IMPORT_PARTIAL' | 'ASSET_IMPORT_FAILED'; message: string};
  files: ProjectFile[];
  /** Paths known to have been published, including a file whose receipt failed. */
  publishedPaths: string[];
  attemptedPath: string;
}
export interface AssetLibraryVersionsResponse { versions: PersonalAssetVersion[] }
export interface AssetLibraryUsesResponse { uses: PersonalAssetUse[] }
export interface AssetLibrarySpacesResponse { folders: {id: string; name: string; createdAt: number}[]; initialized: boolean }
export interface AssetLibrarySpacesPatch {
  upsert: AssetLibrarySpacesResponse['folders'];
  remove: string[];
  /** Default false: move affected assets and complete folder subtrees. True is
   * explicit permanent deletion of those assets, versions and unreferenced bytes.
   */
  removeContents?: boolean;
  /** Default virtual space 'default-project'; otherwise a remaining space ID in
   * this scope (including an upsert in this patch). Cannot also be removed.
   */
  targetSpaceId?: string;
}
export interface AssetLibraryVersionRequest { content: string; revision?: number }
export interface AssetLibraryImportRequest { assetId: string; versionId?: string; path?: string }
export interface AssetLibrarySaveRequest {
  filename: string; name?: string; kind?: PersonalAssetKind; parentId?: string | null;
  spaceId?: string; description?: string; tags?: string[]; style?: string; usage?: string;
}
export interface AssetLibraryCreateRequest extends PersonalAssetCreateRequest {
  /** Stable caller operation key, scoped by source.projectId (or local). Identical
   * bytes + metadata replay the original asset; a changed request conflicts (409).
   * Multipart upload sends this as a string field, not inside source.
   */
  captureId?: string;
}
export type AssetLibraryAnalysisRequest = PersonalAssetAnalysisRequest;
export interface AssetLibraryAnalysisResponse extends AssetAnalysisStatus {}
export interface AssetLibraryCatalogueResponse { templates: PersonalAssetCreate[] }
export interface AssetLibraryImportTemplatesRequest { templates: PersonalAssetCreate[] }
export interface AssetLibraryUnavailableError { error: { code: 'ASSET_LIBRARY_CAPABILITY_UNAVAILABLE'; message: string; capability: 'analysis' | 'catalogue' } }
/** HTTP: GET base/list => {assets}; POST base/upload => 201 {asset}; PATCH :id => {asset};
 * POST batch => {assets}; GET/POST spaces?scope=local => {folders,initialized};
 * GET :id/versions => {versions}; POST :id/versions (JSON or multipart file) => {asset};
 * GET :id/content?version=&download=1 => bytes (Range supported); GET/POST :id/uses => {uses}/{ok:true};
 * GET export?ids=comma-separated => ZIP; GET :id/metadata.yaml => YAML; GET info => AssetLibraryInfo.
 * Multipart upload accepts file plus original string fields (tags/source/execution are JSON strings).
 * Unconfigured analysis/prompt generation and catalogue/import-templates return 503, never fabricated success.
 * delete/trash permanently delete library records and unreferenced blobs, not external source packages.
 */
