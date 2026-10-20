import { parse, stringify } from "yaml";
import type { PersonalAsset, PersonalAssetKind } from "./personal-assets.js";

export type GraphNodeType = "project" | "asset" | "knowledge" | "preference";

/** Stable, shared node contract for retrieval, automation, and future graph UI. */
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  spaceId: string | null;
  label: string;
  preview: string | null;
  weight: number;
  /** Server-owned provenance for live source projections. */
  source?: { id: string; revision: string; ref: string; updatedAt?: number };
  description?: string;
  tags?: string[];
  style?: string;
  usage?: string;
  contentVersion?: string;
  /** Explicit links parsed from the source, never inferred from shared tags. */
  references?: string[];
}

export type GraphEdgeType =
  | "produced"
  | "used"
  | "derived"
  | "referenced"
  | "similar";

export type GraphEvidenceKind = "source" | "operation" | "ai";

export interface GraphEvidence {
  kind: GraphEvidenceKind;
  /** Source file, operation record, or analysis run identifier. */
  ref: string;
  summary?: string;
}

/** Evidence-bearing relation; inferred relations must never look like facts. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: GraphEdgeType;
  evidence: GraphEvidence;
  confidence: number;
  createdAt: number;
  endpointVersions?: { from: string; to: string };
  status?: "active" | "stale" | "missing";
}

export type GraphNodeInput = GraphNode;
export type GraphEdgeInput = Omit<GraphEdge, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

export interface AssetSearchQuery {
  query?: string;
  spaceIds?: string[];
  kinds?: PersonalAssetKind[];
  tags?: string[];
  projectId?: string;
  limit?: number;
  offset?: number;
  snapshot?: string;
  maxBytes?: number;
  styles?: string[];
  usages?: string[];
}

export type AssetSearchMatchField =
  | "name"
  | "tag"
  | "description"
  | "style"
  | "usage"
  | "source"
  | "project";

export interface AssetSearchCandidate {
  assetId: string;
  node: GraphNode;
  kind: PersonalAssetKind;
  score: number;
  matchedBy: AssetSearchMatchField[];
  yaml: string;
}

export interface AssetSearchResponse {
  candidates: AssetSearchCandidate[];
  /** Bounded, model-ready YAML. Full content remains opt-in. */
  candidateYaml: string;
  total: number;
  scanned: number;
  page?: IndexPage;
}

export interface AssetGraphQuery {
  query?: string;
  spaceIds?: string[];
  assetIds?: string[];
  projectId?: string;
  types?: GraphNodeType[];
  limit?: number;
  offset?: number;
  edgeOffset?: number;
  edgeLimit?: number;
  snapshot?: string;
  maxBytes?: number;
  includeStale?: boolean;
  tags?: string[];
  styles?: string[];
  usages?: string[];
}

export interface AssetGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  page?: IndexPage;
  edgePage?: IndexPage;
}

export interface IndexPage {
  snapshot: string;
  nextOffset: number | null;
  total: number;
}

export interface AssetFacet { value: string; count: number }
export interface AssetFacetResponse {
  total: number;
  spaces: AssetFacet[];
  kinds: AssetFacet[];
  tags: AssetFacet[];
  styles: AssetFacet[];
  usages: AssetFacet[];
  pages?: Record<'spaces' | 'kinds' | 'tags' | 'styles' | 'usages', IndexPage>;
}

export interface GraphSourceStatus {
  id: string;
  status: "ready" | "failed";
  checkedAt: number;
  changedAt: number;
  count: number;
  error?: string;
}

export interface AssetIndexStatus {
  scope: "local-personal";
  schemaVersion: 1;
  snapshot: string;
  nodes: number;
  edges: number;
  staleEdges: number;
  missingEdges: number;
  sources: GraphSourceStatus[];
}

export function assetCandidateYaml(asset: PersonalAsset): string {
  const version = asset.versions.at(-1);
  return stringify({
    asset_id: asset.id,
    type: asset.kind,
    space_id: asset.spaceId || "default-project",
    name: asset.name,
    description: asset.description,
    tags: asset.tags,
    style: asset.style || "",
    usage: asset.usage || "",
    source: {
      ...(asset.source.projectId
        ? { project_id: asset.source.projectId }
        : {}),
      ...(asset.source.filename ? { filename: asset.source.filename } : {}),
      ...(asset.source.url ? { url: asset.source.url } : {}),
    },
    ...(version
      ? {
          content: {
            version_id: version.id,
            filename: version.filename,
            mime: version.mime,
            size: version.size,
          },
        }
      : {}),
  });
}

export function assetSearchCandidatesYaml(
  candidates: AssetSearchCandidate[],
): string {
  return stringify({
    assets: candidates.map((candidate) => ({
      ...parse(candidate.yaml),
      score: candidate.score,
      matched_by: candidate.matchedBy,
    })),
  });
}
