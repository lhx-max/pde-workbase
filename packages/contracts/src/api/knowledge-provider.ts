/** Provider-neutral knowledge API. Provider IDs are opaque strings. */
export type KnowledgeProviderId = 'local';

export interface KnowledgeSpaceRequest {
  spaceId: string;
  scope: string;
  title: string;
}

export interface KnowledgeFolderRequest { path: string }

export interface KnowledgeProviderStatus {
  id: KnowledgeProviderId;
  label: string;
  available: boolean;
  detail?: string;
}

export interface KnowledgeProviderConfigResponse {
  activeProvider: KnowledgeProviderId;
  providers: KnowledgeProviderStatus[];
}

export interface ProviderKnowledgeWiki {
  id: string;
  title: string;
  scope: 'owned' | 'member' | 'shared';
  bizType: 'personal' | 'team';
  creatorId: string;
  description: string;
  version: number;
  updateTime: number | null;
}

export interface ProviderKnowledgeWikiListResponse {
  provider: KnowledgeProviderId;
  wikis: ProviderKnowledgeWiki[];
}

export interface ProviderKnowledgeTreeFile {
  /** Provider-native file or node identifier. Treat as opaque. */
  path: string;
  size: number;
  /** Optional display title when `path` is a non-human-readable token. */
  title?: string;
  /** Native document kind, used only for presentation and read routing. */
  kind?: 'doc' | 'sheet' | 'base' | 'slides' | 'file' | 'folder';
  /** Opaque provider path used to open this item's children. */
  childrenPath?: string;
  /** The provider can render this item but cannot edit it in the shared editor. */
  readOnly?: boolean;
}

export interface ProviderKnowledgeTreeResponse {
  provider: KnowledgeProviderId;
  wikiId: string;
  prefix: string;
  directories: string[];
  files: ProviderKnowledgeTreeFile[];
}

export interface ProviderKnowledgeFileResponse {
  provider: KnowledgeProviderId;
  wikiId: string;
  path: string;
  content: string;
}

export interface ProviderKnowledgeMutationResponse {
  provider: KnowledgeProviderId;
  wiki: ProviderKnowledgeWiki;
}

export interface ProviderKnowledgeFileWriteResponse {
  provider: KnowledgeProviderId;
  wikiId: string;
  path: string;
}

export interface ProviderKnowledgeFileDeleteResponse {
  provider: KnowledgeProviderId;
  wikiId: string;
  path: string;
}

export interface ProviderKnowledgeWikiDeleteResponse {
  provider: KnowledgeProviderId;
  wikiId: string;
}

export interface ProviderKnowledgeAssetUploadResponse {
  provider: KnowledgeProviderId;
  wikiId: string;
  path: string;
  size: number;
}
