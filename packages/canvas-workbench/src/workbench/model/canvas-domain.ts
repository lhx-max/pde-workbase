import type { ArtifactDescriptor, WorkflowResultArtifact } from '@bezier/contracts';
import type { InputCardFlowOption, PlanFlowContract, WorkflowEditorConfig } from '@bezier/workbench-core';
import { cr } from '../../locales/canvas-remainder';
import type {
  ContinueGenerateParams,
  ImageConnectedNodeKind,
  ImageConnectedNodeOrigin,
  WorkbenchImage,
} from '../ImageAssetNode';
import type { ReferenceUploadFiles } from '../ImageReferenceResourcePicker';
import type { WorkflowStageInteraction } from '../WorkflowStageCard';

export type InstanceKind = 'plan' | 'visual' | 'video';

export type CanvasInstance = {
  id: string;
  kind: InstanceKind;
  x: number;
  y: number;
  label?: string;
  flowId?: string;
  workflowConfig?: WorkflowEditorConfig;
};

export type CanvasViewport = { x: number; y: number; scale: number };

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
};

export type InstanceStatus = 'draft' | 'inProgress' | 'review' | 'ready';
export type InstanceMetric = { label: string; value: string };
export type InstanceState = {
  status: InstanceStatus;
  statusLabel: string;
  progress: number;
  updatedAt: string;
  metrics: InstanceMetric[];
  contributors?: string[];
};

export type StatusMeta = { label: string; dot: string; text: string; bg: string };
export type CardMeta = { title: string; eyebrow: string; description: string; accent: string };
export type TaskAttachment = {
  validationError?: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  sourceNodeId?: string;
  content?: string;
  naturalWidth?: number;
  naturalHeight?: number;
};
export type VisualModel = string;
export type VisualBusiness = string;
export type VisualRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type VisualResolution = '2K' | '4K';

export type VisualDirectionOption = {
  id: string;
  name: string;
  business: VisualBusiness | string;
  styleId: string;
  styleLabel: string;
  prompt: string;
  negative?: string;
  reason: string;
  mode?: string;
};

export type VisualPhase = 'idle' | 'planning';

export type ActiveImageTask = {
  taskId: string;
  /** Recovery only for replacements accepted by older clients; new requests create child nodes. */
  replacement?: { imageId: string; requestId: string };
  nativeMedia?: boolean;
  backendOwned?: boolean;
  embedInSource?: boolean;
  parentImageId?: string;
  parentGroupId?: string;
  business?: VisualBusiness;
  styleId?: string;
  evalEnabled?: boolean;
  models?: VisualModel[];
  ratio?: VisualRatio;
  resolution?: VisualResolution;
  modelId?: string;
  outputPath?: string;
  startedAt?: number;
};

export type TaskDraft = {
  text: string;
  /** Legacy persisted field, cleared before every new image submission. */
  replacement?: { imageId: string; requestId: string };
  attachments: TaskAttachment[];
  autoReview?: boolean;
  planParameters?: Record<string, string | boolean>;
  models?: VisualModel[];
  visualBusiness?: VisualBusiness;
  visualStyleId?: string;
  visualAssetId?: string;
  visualAssetPath?: string;
  visualAssetPromptPath?: string;
  visualAssetTitle?: string;
  visualAssetThumbnailPath?: string;
  imageTaskId?: string;
  activeImageTasks?: ActiveImageTask[];
  imageCount?: number;
  imageRatio?: VisualRatio;
  imageRatios?: VisualRatio[];
  imageResolution?: VisualResolution;
  visualEvalEnabled?: boolean;
  sourceImageId?: string;
  sourceGroupId?: string;
  rawPrompt?: boolean;
  negativePrompt?: string;
  visualPhase?: VisualPhase;
  visualRequestId?: string;
  plannedPrompt?: string;
  plannedNegative?: string;
  plannedMode?: string;
  plannedStyleId?: string;
  plannedStyleLabel?: string;
  plannedBusiness?: string;
  plannedSummary?: string;
  directions?: VisualDirectionOption[];
  selectedDirectionId?: string;
};

export type TaskDrafts = Record<string, TaskDraft>;
export type CanvasReferenceAsset = Pick<WorkbenchImage, 'id' | 'name' | 'path' | 'src' | 'naturalWidth' | 'naturalHeight'>;

export type CreativeBasedOn = { round?: number; card_id?: string };
export type CreativeCard = {
  [key: string]: unknown;
  id?: string;
  title?: string;
  story?: string;
  scene?: string;
  value?: string;
  entry?: string;
  status?: string;
  card_feedback?: string;
  based_on?: CreativeBasedOn;
  adopted?: boolean;
};
export type CreativeAnalysis = {
  id: string;
  label: string;
  conclusion: string;
  basis: string;
  knowledge_used?: string[];
};
export type CreativeRound = {
  round?: number;
  created_at?: string;
  trigger?: string;
  feedback?: string;
  analysis?: CreativeAnalysis[];
  cards?: CreativeCard[];
};
export type CaseCreative = { case_id: string; rounds: CreativeRound[]; updated_at: string };
export type FlatCreativeCard = CreativeCard & { _round: number; _basedOnLabel?: string; _seq?: number; _seqLabel?: string };

export type TopicItem = {
  id?: string;
  name?: string;
  slogan?: string;
  track?: string;
  angle?: string;
  scene?: string;
  isBaseline?: boolean;
  baselineRef?: string;
  status?: string;
};
export type TopicRound = {
  round?: number;
  feedback?: string;
  card_feedback?: Record<string, string>;
  topics?: TopicItem[];
};
export type TopicGroup = {
  selected_angle?: string;
  rounds?: TopicRound[];
  selection?: { selected_id?: string };
};
export type CaseTopics = {
  documentId: string;
  selected_angle: string;
  groups: Record<string, TopicGroup>;
  generation?: {
    status?: 'generating' | 'ready' | 'failed';
    group_id?: string;
    trigger?: 'round_feedback' | 'card_feedback';
    elapsed_seconds?: number;
    duration_seconds?: number;
    error?: string;
  };
  updated_at: string;
};

export type EvaluationDimension = {
  id: string;
  label: string;
  weight: number;
  score: number;
  weighted_score: number;
  reason: string;
  improvement: string;
};
export type StageEvaluation = {
  evaluation_id?: string;
  evaluation_round?: number;
  status: 'running' | 'completed' | 'failed' | 'error' | 'canceled';
  source_revision?: string;
  source_content_round?: number;
  score?: number;
  raw_score?: number;
  passed?: boolean;
  threshold?: number;
  reviewed_at?: string;
  stale?: boolean;
  error?: string;
  cancel_reason?: string;
  dimensions?: EvaluationDimension[];
  cap_triggered?: boolean;
  cap_reason?: string;
  major_problems?: string[];
  revision_priority?: string[];
  history?: StageEvaluation[];
};
export type CaseEvaluations = {
  version: number;
  auto_review?: {
    enabled: boolean;
    updated_at?: string;
    pending_count?: number;
    dispatched_count?: number;
    last_error?: string;
  };
  stages: Partial<Record<'creative' | 'topic' | 'product_sentence' | 'plan', StageEvaluation>>;
};

export type ProductItem = {
  id?: string;
  type?: string;
  sentence?: string;
  logic?: string;
  feedback?: string;
  based_on?: { round?: number; product_id?: string };
};
export type ProductDocument = {
  product_group_id?: string;
  source?: { topic_group_id?: string; topic_id?: string; topic_name?: string };
  rounds?: Array<{
    round?: number;
    feedback?: string;
    card_feedback?: Record<string, string>;
    products?: ProductItem[];
  }>;
  selection?: { selected_ids?: string[]; confirmed_at?: string };
};
export type CaseProducts = {
  documentId: string;
  status: 'idle' | 'generating' | 'ready';
  source_topic_id: string;
  source_topic_group_id: string;
  feedback: string;
  version: number;
  document: ProductDocument | null;
  updated_at: string;
};

export type ArticleSection = { product_id?: string; heading?: string; body?: string };
export type ArticleDocument = {
  type?: 'plan';
  title?: string;
  recipient?: string;
  background?: string;
  sections?: ArticleSection[];
  closing?: string;
  signature?: { company?: string; date?: string };
  rich_html?: string;
  updated_at?: string;
};
export type CaseArticle = {
  case_revision?: number;
  article_digest?: string;
  documentId: string;
  status: 'idle' | 'generating' | 'ready';
  products_confirmed: boolean;
  document: ArticleDocument | null;
  output_md: string;
  updated_at: string;
};

export type DownstreamCardOption = {
  id: 'visual';
  label: string;
  description: string;
  accent: 'visual' | 'plan' | 'video';
};

export const ARTICLE_DOWNSTREAM_OPTIONS: DownstreamCardOption[] = [{
  id: 'visual',
  get label() { return cr().visualImageGen; },
  get description() { return cr().newConnectVisual; },
  accent: 'visual',
}];

export type ArticleReviewData = {
  processFlowSourceId: string;
  processFlowId?: string;
  status: CaseArticle['status'];
  document: ArticleDocument | null;
  outputMd: string;
  isBusy: boolean;
  onExportDocx: () => void;
  onUploadOnline: () => void;
  downstreamOptions: DownstreamCardOption[];
  onSpawnDownstream: (optionId: DownstreamCardOption['id']) => void;
  evaluation?: StageEvaluation;
  onRequestEval?: () => void;
  autoCenter?: boolean;
  parentId?: string;
  artifact: ArtifactDescriptor;
};

export type EvaluationResultData = {
  stage: 'creative' | 'topic' | 'product_sentence' | 'plan';
  stageLabel: string;
  evaluation: StageEvaluation;
  sourceNodeId: string;
};

export type WorkflowStageData = {
  onRemove?: () => void;
  artifact: WorkflowResultArtifact;
  busy: boolean;
  parentId?: string;
  autoCenter?: boolean;
  evaluation?: StageEvaluation;
  onInteract: (interaction: WorkflowStageInteraction) => Promise<void>;
};

export type WorkflowPendingData = {
  title: string;
  hint: string;
  status?: 'generating' | 'failed';
  parentId?: string;
  autoCenter?: boolean;
};

export type WorkbenchCardData = {
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
  planFlowConfig?: PlanFlowContract;
  planFlowMarkdown?: string;
  planFlowSourcePath?: string;
  planFlowError?: string;
  flowOptions?: InputCardFlowOption[];
  canvasResources: CanvasReferenceAsset[];
  primaryImage?: WorkbenchImage;
  primaryImagePromptOpen?: boolean;
  primaryImageToast?: string;
  primaryImageCropSaving?: boolean;
  primaryImageActions: {
    onRetry?: (id: string) => void;
    onReplace: (id: string, file: File) => void;
    onDownload: (id: string) => void;
    onGenerate: (id: string, params: ContinueGenerateParams) => void;
    onTogglePrompt: (id: string) => void;
    onRemove: (id: string) => void;
    onCropCommit: (id: string, file: File, meta: { width: number; height: number }) => boolean | void | Promise<boolean | void>;
    onRotate: (id: string) => void;
    onAddToChat: (id: string) => void;
    onSendAnnotatedToAI: (id: string, file: File, instruction: string) => void | Promise<void>;
    onAnnotationCommit: (id: string, file: File, meta: { width: number; height: number }) => boolean | void | Promise<boolean | void>;
  };
  onRemove: (instance: CanvasInstance) => void;
  /** 复制整张能力卡：新 id + 右下偏移，草稿（提示词/模型/比例/附件）一并克隆。 */
  onDuplicate: (instance: CanvasInstance) => void;
  onDraftChange: (instanceId: string, text: string) => void;
  onDraftPatch: (instanceId: string, patch: Partial<TaskDraft>) => void;
  onAddAttachments: (instanceId: string, files: ReferenceUploadFiles) => Promise<readonly TaskAttachment[] | false>;
  onRemoveAttachment: (instanceId: string, path: string) => void;
  onSend: (instance: CanvasInstance, draftOverride?: TaskDraft) => void;
  onAnalyze: (instance: CanvasInstance) => void;
  onAddConnectedNode: (sourceId: string, kind: ImageConnectedNodeKind, origin: ImageConnectedNodeOrigin) => void;
};

export type FlowCanvasApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (scale: number) => void;
  fitView: () => void;
  /** Selects one node and makes it the sole composer owner once mounted; never moves the viewport. */
  activateNode: (nodeId: string) => boolean;
  focusNode: (nodeId: string) => boolean;
  focusNodes: (nodeIds: string[]) => boolean;
  sortByConnections: () => void;
  sortByTaskType: () => void;
  revertLayout: () => void;
  screenToFlow: (clientX: number, clientY: number) => { x: number; y: number };
};

export type CanvasLayoutPosition = { id: string; x: number; y: number; parentId?: string | null };
export type CanvasInteractionMode = 'pointer' | 'hand';
