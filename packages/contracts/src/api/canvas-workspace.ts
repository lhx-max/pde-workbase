/** Standalone canvas contracts. No conversation or message identity is required. */
export interface CanvasTextGenerationBinding {
  requestId: string;
  nodeId: string;
  outputKind?: 'storyboard' | 'text';
}

export interface CanvasArtifactGenerationBinding {
  requestId: string;
  nodeId: string;
  format: 'html' | 'presentation';
  outputPath?: string;
}

export type CanvasTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type CanvasTaskDeliveryState = 'applied' | 'candidate_saved' | 'delivery_failed';

export interface CanvasTaskRequest {
  requestId: string;
  prompt: string;
  designSystemId?: string;
  taskContext?: {
    targetLabel?: string;
    baseVersionSource?: string;
    baseVersionKind?: 'target-snapshot' | 'submission-input';
  };
  canvasTextGeneration?: CanvasTextGenerationBinding;
  canvasArtifactGeneration?: CanvasArtifactGenerationBinding;
  inputPaths?: string[];
}

export interface CanvasTaskReceipt {
  id: string;
  projectId: string;
  requestId: string;
  status: CanvasTaskStatus;
  deliveryState?: CanvasTaskDeliveryState;
  result?: { content?: string; file?: string; files?: string[]; candidatePath?: string; canvasNodeId?: string };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasTaskResponse { ok: true; task: CanvasTaskReceipt }

/** Recovery exposes the original canvas binding, never execution credentials. */
export interface CanvasTaskWithRequest extends CanvasTaskReceipt { request: CanvasTaskRequest }
export interface CanvasTaskListResponse { ok: true; tasks: CanvasTaskWithRequest[] }

export interface CanvasTaskDelivery {
  content: string;
  files?: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>;
}

/** A stable external identity is separate from temporary download/preview URLs. */
export interface CanvasResourceReference {
  provider: string;
  resourceId: string;
  version?: string;
}

export interface CanvasResourceDescriptor {
  reference: CanvasResourceReference;
  name: string;
  mimeType: string;
  size?: number;
  previewUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CanvasAssetSourceCapabilities {
  search: boolean;
  read: boolean;
  preview: boolean;
  write: boolean;
  versioned: boolean;
}

export interface CanvasAssetSourceDescriptor {
  id: string;
  name: string;
  capabilities: CanvasAssetSourceCapabilities;
}

/** Preserve unknown upstream document fields instead of dropping them on migration. */
export interface CanvasDocumentSnapshot {
  state: Record<string, unknown>;
  revision: number;
}

export interface CanvasDocumentPatch {
  changes: Record<string, unknown>;
  expectedRevision?: number;
  base?: Record<string, unknown>;
}
