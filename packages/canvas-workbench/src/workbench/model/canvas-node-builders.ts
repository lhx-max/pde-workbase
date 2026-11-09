import { workflowProjectPath } from '@bezier/contracts';
import type { WorkflowResultArtifact } from '@bezier/contracts';
import type { InputCardFlowOption } from '@bezier/workbench-core';
import type { Node } from '@xyflow/react';
import { cr } from '../../locales/canvas-remainder';
import type {
  ImageConnectedNodeKind,
  ImageConnectedNodeOrigin,
  WorkbenchImage,
} from '../ImageAssetNode';
import type { ReferenceUploadFiles } from '../ImageReferenceResourcePicker';
import type { WorkflowStageInteraction } from '../WorkflowStageCard';
import {
  ARTICLE_DOWNSTREAM_OPTIONS,
  type ArticleReviewData,
  type CanvasInstance,
  type CanvasReferenceAsset,
  type CardMeta,
  type CaseArticle,
  type DownstreamCardOption,
  type EvaluationResultData,
  type InstanceState,
  type StageEvaluation,
  type StatusMeta,
  type TaskAttachment,
  type TaskDraft,
  type WorkbenchCardData,
  type WorkflowPendingData,
  type WorkflowStageData,
} from './canvas-domain';

export function creativeNodeId(instanceId: string) {
  return `creative-${instanceId}`;
}

export function topicNodeId(instanceId: string) {
  return `topic-${instanceId}`;
}

export function productNodeId(instanceId: string, roundNo = 1) {
  return roundNo <= 1 ? `product-${instanceId}` : `product-${instanceId}-round-${roundNo}`;
}

export function articleNodeId(instanceId: string) {
  return `article-${instanceId}`;
}

export function evaluationNodeId(instanceId: string, stage: EvaluationResultData['stage']) {
  return `evaluation-${stage}-${instanceId}`;
}

export function processFlowNodeId(instanceId: string) {
  return `process-flow-${instanceId}`;
}

export function processKnowledgeNodeId(instanceId: string, knowledgeId: string) {
  return `process-knowledge-${instanceId}-${knowledgeId}`;
}

export type BuildCardNodeArgs = {
  instance: CanvasInstance;
  projectPath: string;
  meta: CardMeta;
  state: InstanceState;
  statusMeta: StatusMeta;
  draft: TaskDraft;
  feedback?: string;
  isSending: boolean;
  isGeneratingCreative: boolean;
  isBoundToCase: boolean;
  autoReviewEnabled: boolean;
  autoReviewBusy: boolean;
  autoReviewPendingCount?: number;
  linkedArticleTitle?: string;
  linkedArticleReady?: boolean;
  planFlowConfig?: WorkbenchCardData['planFlowConfig'];
  planFlowMarkdown?: string;
  planFlowSourcePath?: string;
  planFlowError?: string;
  flowOptions?: InputCardFlowOption[];
  canvasResources: CanvasReferenceAsset[];
  primaryImage?: WorkbenchImage;
  primaryImagePromptOpen?: boolean;
  primaryImageToast?: string;
  primaryImageCropSaving?: boolean;
  primaryImageActions: WorkbenchCardData['primaryImageActions'];
  callbacks: {
    onRemove: (instance: CanvasInstance) => void;
    onDuplicate: (instance: CanvasInstance) => void;
    onDraftChange: (instanceId: string, text: string) => void;
    onDraftPatch: (instanceId: string, patch: Partial<TaskDraft>) => void;
    onAddAttachments: (instanceId: string, files: ReferenceUploadFiles) => Promise<readonly TaskAttachment[] | false>;
    onRemoveAttachment: (instanceId: string, path: string) => void;
    onSend: (instance: CanvasInstance, draftOverride?: TaskDraft) => void;
    onAnalyze: (instance: CanvasInstance) => void;
    onAddConnectedNode: (sourceId: string, kind: ImageConnectedNodeKind, origin: ImageConnectedNodeOrigin) => void;
  };
};

export function buildCardNode(args: BuildCardNodeArgs): Node<WorkbenchCardData> {
  const { instance, callbacks, ...rest } = args;
  return {
    id: instance.id,
    type: 'workbenchCard',
    position: { x: instance.x, y: instance.y },
    dragHandle: instance.kind === 'visual' ? '.minimax-image-drag-handle' : '.node-drag-surface',
    data: {
      instance,
      ...rest,
      ...callbacks,
    },
  };
}

export function buildArticleNode(args: {
  instanceId: string;
  processFlowId: string;
  parentId: string;
  parentPosition: { x: number; y: number };
  position?: { x: number; y: number };
  article: CaseArticle;
  isBusy?: boolean;
  onExportDocx: () => void;
  onUploadOnline: () => void;
  downstreamOptions?: DownstreamCardOption[];
  onSpawnDownstream: (optionId: DownstreamCardOption['id']) => void;
  onRequestEval?: () => void;
  evaluation?: StageEvaluation;
}): Node<ArticleReviewData> {
  const autoCenter = !args.position;
  return {
    id: articleNodeId(args.instanceId),
    type: 'resultCard',
    position: args.position ?? { x: args.parentPosition.x + 540, y: args.parentPosition.y },
    draggable: true,
    dragHandle: '.node-drag-surface',
    data: {
      processFlowSourceId: articleNodeId(args.instanceId),
      processFlowId: args.processFlowId,
      status: args.article.status,
      document: args.article.document,
      outputMd: args.article.output_md,
      artifact: {
        id: `article-${args.instanceId}`,
        projectId: '',
        title: args.article.document?.title || cr().articleBody,
        summary: args.article.status === 'generating'
          ? cr().modelWritingBody
          : cr().execSections(args.article.document?.sections?.length || 0),
        renderer: 'document',
        resource: {
          kind: 'project-file',
          path: args.article.output_md
            || workflowProjectPath(args.instanceId, 'deliverables/documents/article.md'),
          mimeType: 'text/markdown',
        },
        preview: args.article.document ? {
          title: args.article.document.title || '',
          recipient: args.article.document.recipient || '',
          background: args.article.document.background || '',
          sections: (args.article.document.sections || []).map(section => ({
            heading: section.heading || '',
            body: section.body || '',
          })),
        } : undefined,
        capabilities: ['download', 'export', 'publish'],
        status: args.article.status === 'generating' ? 'generating' : 'ready',
        updatedAt: args.article.updated_at || new Date(0).toISOString(),
      },
      isBusy: Boolean(args.isBusy),
      onExportDocx: args.onExportDocx,
      onUploadOnline: args.onUploadOnline,
      downstreamOptions: args.downstreamOptions ?? ARTICLE_DOWNSTREAM_OPTIONS,
      onSpawnDownstream: args.onSpawnDownstream,
      onRequestEval: args.onRequestEval,
      evaluation: args.evaluation,
      autoCenter,
      parentId: args.parentId,
    },
  };
}

export function workflowStageNodeId(resultId: string): string {
  return `workflow-result-${resultId}`;
}

export function buildWorkflowStageNode(args: {
  onRemove?: () => void;
  artifact: WorkflowResultArtifact;
  position?: { x: number; y: number };
  parentId?: string;
  onInteract: (interaction: WorkflowStageInteraction) => Promise<void>;
  busy?: boolean;
  evaluation?: StageEvaluation;
}): Node<WorkflowStageData> {
  return {
    id: workflowStageNodeId(args.artifact.id),
    type: 'workflowStage',
    position: args.position ?? { x: 0, y: 0 },
    draggable: true,
    dragHandle: '.node-drag-surface',
    data: {
      artifact: args.artifact,
      ...(args.onRemove ? { onRemove: args.onRemove } : {}),
      parentId: args.parentId,
      autoCenter: !args.position,
      busy: Boolean(args.busy),
      ...(args.evaluation ? { evaluation: args.evaluation } : {}),
      onInteract: args.onInteract,
    },
  };
}

export function workflowPendingNodeId(instanceId: string): string {
  return `workflow-pending-${instanceId}`;
}

export function buildWorkflowPendingNode(args: {
  instanceId: string;
  nodeId?: string;
  title: string;
  hint: string;
  status?: 'generating' | 'failed';
  position?: { x: number; y: number };
  parentId?: string;
}): Node<WorkflowPendingData> {
  return {
    id: args.nodeId ?? workflowPendingNodeId(args.instanceId),
    type: 'workflowPending',
    position: args.position ?? { x: 0, y: 0 },
    draggable: true,
    dragHandle: '.node-drag-surface',
    data: {
      title: args.title,
      hint: args.hint,
      ...(args.status ? { status: args.status } : {}),
      parentId: args.parentId,
      autoCenter: !args.position,
    },
  };
}
