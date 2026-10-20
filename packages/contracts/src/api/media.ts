export const MEDIA_EXECUTION_MODES = [
  'enabled',
  'disabled',
] as const;

export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];

export const MEDIA_SURFACES = [
  'image',
  'video',
  'audio',
] as const;

export type MediaSurface = (typeof MEDIA_SURFACES)[number];

/** Optional image-specific operation for a source image. */
export const MEDIA_IMAGE_OPERATIONS = ['cutout'] as const;
export type MediaImageOperation = (typeof MEDIA_IMAGE_OPERATIONS)[number];

/** Verified adapter behavior, not inferred from a chat agent or a model family name.
 * Missing/false capabilities fail closed; availability/credentials are checked at execution.
 */
export interface MediaImageCapabilities {
  imageEdit: boolean;
  transparentBackground: boolean;
}

export interface MediaImageCapabilityModel {
  id: string;
  imageCapabilities?: MediaImageCapabilities;
}

export interface MediaImageCapabilityDenial {
  code: 'MEDIA_CAPABILITY_UNSUPPORTED';
  message: string;
  missingCapabilities: Array<keyof MediaImageCapabilities>;
}

export function mediaImageOperationDenial(
  model: MediaImageCapabilityModel,
  operation: MediaImageOperation,
): MediaImageCapabilityDenial | null {
  const required: Array<keyof MediaImageCapabilities> = operation === 'cutout'
    ? ['imageEdit', 'transparentBackground']
    : [];
  const missingCapabilities = required.filter(capability => model.imageCapabilities?.[capability] !== true);
  return missingCapabilities.length ? {
    code: 'MEDIA_CAPABILITY_UNSUPPORTED',
    message: `media model "${model.id}" does not support ${operation}: missing verified ${missingCapabilities.join(', ')} capability`,
    missingCapabilities,
  } : null;
}

export const MEDIA_TASK_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
] as const;

export type MediaTaskStatus = (typeof MEDIA_TASK_STATUSES)[number];

export interface MediaTaskError {
  message: string;
  status?: number;
  code?: string;
}

/**
 * Stable placement identity supplied by a canvas or other media consumer.
 * Position remains consumer-owned; the task only records which logical slot
 * the generated asset was intended to fill.
 */
export interface MediaTaskSlotMetadata {
  id: string;
  kind?: string;
  label?: string;
}

/**
 * Bounded provenance needed to reconnect generated media to its source after
 * a daemon or browser restart.
 */
export interface MediaTaskLineageMetadata {
  sourceNodeIds?: string[];
  sourceTaskId?: string;
  sourceAssetPath?: string;
  sourceRevision?: string | number;
}

export interface MediaTaskGenerationMetadata {
  operation?: MediaImageOperation;
  prompt?: string;
  aspect?: string;
  quality?: string;
  resolution?: string;
  slot?: MediaTaskSlotMetadata;
  lineage?: MediaTaskLineageMetadata;
}

export interface MediaTaskAcceptedResponse extends MediaTaskGenerationMetadata {
  canvasDeliveryOwned?: boolean;
  /** The same client request was already accepted; no new provider job started. */
  reused?: boolean;
  taskId: string;
  status: MediaTaskStatus;
  startedAt: number;
  surface?: MediaSurface | string;
  model?: string;
}

/** Optional durable canvas delivery; omitting it preserves standalone media behavior. */
export interface MediaCanvasDeliveryTarget {
  nodeId: string;
  kind: 'image' | 'video';
  basePath: string;
  /** Image replacement request identity or active video result identity. */
  baseVersion: string;
  fileUrl: string;
}

export interface MediaTaskSnapshot extends MediaTaskAcceptedResponse {
  canvasDelivery?: { status: string; error: string | null };
  endedAt: number | null;
  progress: string[];
  nextSince: number;
  file?: unknown;
  error?: MediaTaskError | null;
}

export interface ProjectMediaTask extends MediaTaskGenerationMetadata {
  taskId: string;
  status: MediaTaskStatus;
  startedAt: number;
  endedAt: number | null;
  elapsed: number;
  surface?: MediaSurface | string;
  model?: string;
  progress: string[];
  progressCount: number;
  file?: unknown;
  error?: MediaTaskError | null;
}

export interface ProjectMediaTasksResponse {
  tasks: ProjectMediaTask[];
}

/** Recover a failed project task without creating another upstream job. */
export interface MediaTaskResumeRequest {
  /** Stable for transport retries, fresh for an intentional new generation. */
  clientRequestId?: string;
  resumeTaskId?: string;
}

export const MEDIA_POLICY_DENIAL_CODES = [
  'MEDIA_EXECUTION_DISABLED',
  'MEDIA_SURFACE_DENIED',
  'MEDIA_MODEL_DENIED',
] as const;

export type MediaPolicyDenialCode = (typeof MEDIA_POLICY_DENIAL_CODES)[number];

/**
 * Run-scoped policy controlling Loom-owned media generation only.
 *
 * `allowedSurfaces` and `allowedModels` apply solely to `/api/tools/media/generate`
 * and in-run `bezier media generate`. External MCP media tools are intentionally
 * unaffected: provider policy for those belongs to the MCP server / orchestrator.
 */
export interface MediaExecutionPolicy {
  mode: MediaExecutionMode;
  allowedSurfaces?: MediaSurface[];
  allowedModels?: string[];
}

export const DEFAULT_MEDIA_EXECUTION_POLICY: MediaExecutionPolicy = {
  mode: 'enabled',
};

export interface MediaPolicyTarget {
  surface: MediaSurface;
  model?: string;
}

export interface MediaPolicyDenial {
  code: MediaPolicyDenialCode;
  message: string;
}

export function mediaExecutionPolicyDenial(
  policy: MediaExecutionPolicy,
  target: MediaPolicyTarget,
): MediaPolicyDenial | null {
  if (policy.mode === 'disabled') {
    return {
      code: 'MEDIA_EXECUTION_DISABLED',
      message: 'media generation is disabled for this run',
    };
  }
  if (
    Array.isArray(policy.allowedSurfaces) &&
    policy.allowedSurfaces.length > 0 &&
    !policy.allowedSurfaces.includes(target.surface)
  ) {
    return {
      code: 'MEDIA_SURFACE_DENIED',
      message: `media surface "${target.surface}" is not allowed for this run`,
    };
  }
  if (
    target.model &&
    Array.isArray(policy.allowedModels) &&
    policy.allowedModels.length > 0 &&
    !policy.allowedModels.includes(target.model)
  ) {
    return {
      code: 'MEDIA_MODEL_DENIED',
      message: `media model "${target.model}" is not allowed for this run`,
    };
  }
  return null;
}

/** Request for Loom's deterministic local HyperFrames scaffold. */
export interface HyperFramesScaffoldRequest {
  /** Project-relative path in the form `.hyperframes-cache/<id>`. */
  compositionDir: string;
}

/** Files created before the agent authors the composition HTML. */
export interface HyperFramesScaffoldResponse {
  compositionDir: string;
  files: ['hyperframes.json', 'meta.json', 'index.html'];
}
