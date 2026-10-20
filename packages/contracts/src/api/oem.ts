export const DEFAULT_OEM_CONTROL_DAEMON_PORT = 17956;

export type OemPlatform = 'mac' | 'win' | 'linux';
export type OemBuildTarget = 'app' | 'dmg' | 'zip' | 'dir' | 'nsis' | 'appimage' | 'all';
export type OemBuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type OemCapabilityId = 'agent-chat' | 'canvas' | 'knowledge' | 'media-library' | 'page-generation' | 'presentation-generation' | 'workflow';

export interface OemProductManifest {
  id: string;
  displayName: string;
  vendorName: string;
  bundleDisplayName: string;
  appId: string;
  protocolScheme: string;
  releaseFeedNamespace: string;
  dataNamespace: string;
  knowledgeProfile: 'general';
  defaultKnowledgeProvider: 'local';
  capabilities: OemCapabilityId[];
  businessModules: never[];
  /** Phase 2 cancellation switch; mirrors `ProductManifest.excludedProductModules`. */
  excludedProductModules?: string[];
  /** Disabled product bundles. Applied when the product is next started. */
  disabledModuleBundles?: string[];
  brandAssets: {
    appIcon: string | null;
    logoLight: string | null;
    logoDark: string | null;
  };
}

export interface OemProduct {
  manifest: OemProductManifest;
  kind: 'builtin' | 'oem';
  lockedFields: Array<keyof OemProductManifest>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OemBuild {
  id: string;
  productId: string;
  platform: OemPlatform;
  target: OemBuildTarget;
  status: OemBuildStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  outputRoot: string;
  artifacts: string[];
  error: string | null;
  logTail: string[];
  appVersion?: string;
  sourceRevision?: string | null;
  sourceDirty?: boolean;
  updateMetadataUrl?: string | null;
}

export interface OemProductInput {
  manifest: OemProductManifest;
}

export interface OemBuildInput {
  platform: OemPlatform;
  target?: OemBuildTarget;
  appVersion?: string;
  updateMetadataUrl?: string;
}

export interface OemBrandAssetUpload {
  value: string;
  mimeType: 'image/png' | 'image/webp' | 'image/svg+xml';
  bytes: number;
}
