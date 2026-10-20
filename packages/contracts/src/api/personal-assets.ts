import type { AssetAnalysisStatus } from './hooks.js';
import type { ExecutionSnapshot } from './execution-snapshot.js';

/** Analysis credentials are request-only, never part of a saved asset. */
export interface PersonalAssetAnalysisRequest {
  execution?: ExecutionSnapshot;
  /** Missing snapshot must fail enrichment rather than fall back to a saved CLI. */
  executionRequired?: boolean;
}
export interface PersonalAssetCreateRequest extends PersonalAssetCreate, PersonalAssetAnalysisRequest {
  aiFill?: boolean;
}

export type AssetAnalysisTarget = 'metadata' | 'prompt';
/** Generated from a specific asset version; never presented as its original prompt. */
export interface PersonalAssetPrompt {
  text: string;
  versionId: string;
  generatedAt: number;
}

export interface PersonalAssetPromptStatus extends AssetAnalysisStatus {
  prompt: PersonalAssetPrompt | null;
}

/** Local, device-owned library. Never implies account or team synchronization. */
export type PersonalAssetKind =
  | "folder"
  | "text"
  | "script"
  | "image"
  | "video"
  | "audio"
  | "slides"
  | "webpage"
  | "motion"
  | "file";
/** Inline chat choice identity. Names/previews are resolved by the host, not trusted model URLs. */
export interface AssetReferenceChoice {
  assetId: string;
  versionId: string;
  spaceId: string;
}
export interface PersonalAssetVersion {
  imageMetadata?: { width?: number; height?: number; format?: string; colors: { hex: string; weight: number }[]; status: 'ready' | 'unsupported' };
  id: string;
  hash: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: number;
}
/** Installed source reference. Library metadata and prompt are independent of the package. */
export interface PersonalAssetTemplate {
  id: string;
  type: 'Prototype' | 'Slides' | 'Image' | 'Video' | 'HyperFrames' | 'Audio';
  referencePath: string;
  posterSrc: string | null;
  previewSrc: string | null;
  previewVideo: string | null;
}
export interface PersonalAsset {
  id: string;
  owner: "local-personal";
  kind: PersonalAssetKind;
  name: string;
  parentId: string | null;
  /** Existing project-folder ID used as the local business space. */
  spaceId?: string;
  description: string;
  prompt?: PersonalAssetPrompt;
  style?: string;
  usage?: string;
  tags: string[];
  favorite: boolean;
  rating?: number;
  source: { url?: string; projectId?: string; filename?: string; nodeId?: string; template?: PersonalAssetTemplate };
  versions: PersonalAssetVersion[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  trashBatchId?: string;
  revision: number;
}
export interface PersonalAssetCreate {
  /** Integer 0 (unrated, default) or 1–5 stars. */
  rating?: number;
  style?: string;
  usage?: string;
  description?: string;
  tags?: string[];
  spaceId?: string;
  name: string;
  kind: PersonalAssetKind;
  parentId?: string | null;
  content?: string;
  source?: PersonalAsset["source"];
}
export interface PersonalAssetPatch {
  prompt?: PersonalAssetPrompt;
  style?: string;
  usage?: string;
  spaceId?: string;
  name?: string;
  parentId?: string | null;
  description?: string;
  tags?: string[];
  favorite?: boolean;
  rating?: number;
  /** Optimistic concurrency; editors must not overwrite a newer revision. */
  revision?: number;
}
/** `delete` permanently removes records/content and any associated template package.
 * `trash` is a legacy spelling with the same permanent semantics; restore is unsupported. */
export type PersonalAssetBatchAction = 'delete' | 'trash' | 'move' | 'copy' | 'tag' | 'favorite';
export interface PersonalAssetBatchRequest {
  ids: string[];
  action: PersonalAssetBatchAction;
  patch?: PersonalAssetPatch;
}
export interface PersonalAssetBatchResponse { assets: PersonalAsset[] }

export interface PersonalAssetUse {
  projectId: string;
  filename: string;
  versionId: string;
  usedAt: number;
}
export const PERSONAL_ASSET_DRAG_MIME =
  "application/x-bezier-design-personal-asset";
export const PERSONAL_ASSET_DROP_EVENT = "bezier-design:personal-asset-drop";
export const PERSONAL_ASSET_CHANGED_EVENT = "bezier-design:personal-assets-changed";
