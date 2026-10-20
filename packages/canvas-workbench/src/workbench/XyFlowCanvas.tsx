'use client';

import { xy } from '../locales/xyflow-canvas';
import { CanvasEmptyState } from './CanvasEmptyState';
import { AdaptiveCanvasBackground } from './AdaptiveCanvasBackground';
import { canvasEdgeNodeStates } from './canvas-edge-geometry';
import { WorkflowRunGroupNode, WorkflowQuestionNode, type WorkflowRunGroupData } from './WorkflowRunGroupNode';
import { IMAGE_GENERATION_RATIOS, IMAGE_GENERATION_RESOLUTIONS } from '@bezier/contracts';
import { resolveVisualModelSelection } from './visual-model-routing';
import { useCanvasMediaCatalog } from '../platform/media-catalog';
import { createStoryboardStackSignature } from './storyboard-stack-state';
import { CanvasSaveAssetButton } from './CanvasSaveAssetButton';

import React from 'react';
import { createPortal } from 'react-dom';
import { CanvasAddNodeMenu } from './CanvasAddNodeMenu';
import type { CanvasNodeCreationKind } from './canvas-node-catalog';
import addMenuStyles from './CanvasAddNodeMenu.module.css';
import { applyNodeChanges } from '@xyflow/react';
import { didParentRebase, fitStoryboardDragBounds, followStoryboardDrag } from './storyboard-drag';
import { CanvasGroupMemberAction } from './CanvasNodeActions';
import { CanvasConnectionLine, CanvasEdgeActions, CanvasReferenceEdge } from './CanvasReferenceEdge';
import { canvasConnectionError, isGeneratedCanvasEdge, stableCanvasHandleId } from './canvas-edge-rules';
import { CANVAS_INPUT_SELECTOR, CANVAS_OVERLAY_SELECTOR, releaseCanvasInputFocus } from './canvas-interaction';
import { Button } from '@bezier/components';
import { countSourceCardImageTasks } from './image-generation-lineage';
import {
  PROJECT_FILE_DRAG_MIME,
  PERSONAL_ASSET_DRAG_MIME,
  PERSONAL_ASSET_DROP_EVENT,
  parseProjectFileDragPayload,
  type ProjectFileDragPayload,
} from '@bezier/contracts';
import { getCanvasHostContext } from '../platform/api-base';
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  SelectionMode,
  MarkerType,
  addEdge,
  applyEdgeChanges,
  useNodesState,
  useNodeConnections,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type OnNodesChange,
  type OnSelectionChangeParams,
  type Viewport as RFViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AdjustIcon,
  AnnotateIcon,
  ChatAddIcon,
  CropIcon,
  ImageAssetNode,
  RotateIcon,
  imageFileUrl,
  resolveImageSrc,
  type ImageAssetData,
} from './ImageAssetNode';
import { CanvasNodeActions } from './CanvasNodeActions';
import { CanvasSelectionToolbar } from './CanvasSelectionToolbar';
import type { GroupMemberGeometry } from './canvas-group-operations';
import { CanvasNodeSourceHandle } from './CanvasNodeSourceHandle';
import { CanvasSourceMenuRequest } from './CanvasNodeSourceHandle';
import CropEditor from './crop/CropEditor';
import ImageAdjustOverlay from './ImageAdjustOverlay';
import ImageEditorView from './ImageEditorView';
import {
  ImageReferenceResourcePicker,
  type ReferenceImageAsset,
} from './ImageReferenceResourcePicker';
import { ImageGenerationOptionControls } from './ImageGenerationOptionControls';
import {
  mergeReferenceImagePrompt,
} from './reference-image-prompt';
import { useCanvasHistory, useCanvasInteractionActivity } from '../platform/canvas-compat';
import { CanvasRenderPolicyProvider } from './CanvasRenderPolicy';
import { useCanvasIdleWork } from '../platform/canvas-idle-work';
import { useCanvasLocale } from '../platform/canvas-locale';
import { canvasSelectionChrome } from '../locales/chrome';
import { formatNodeTimestamp } from './node-timestamp';
import { ImageGroupNode, type ImageGroupData } from './ImageGroupNode';
import { OrganizationGroupNode, type OrganizationGroupData } from './OrganizationGroupNode';
import { StoryboardAssetGroupNode } from './StoryboardAssetGroupNode';
import { StoryboardGalleryNode } from './StoryboardGalleryNode';
import { StoryboardImageStackNode } from './StoryboardImageStackNode';
import { PromptCardNode } from './PromptCardNode';
import { BasicCanvasNode, type BasicCanvasNodeData } from './BasicCanvasNode';
import { ImageGenerationError } from './ImageGenerationError';
import { CanvasComposerAttachment, CanvasComposerFocusProvider, CanvasComposerHeader, CanvasComposerShell } from './CanvasComposerChrome';
import { WorkflowStageCard } from './WorkflowStageCard';
import { CompositionSafeTextarea } from './CompositionSafeField';
export type { WorkflowStageInteraction } from './WorkflowStageCard';
export { workflowResultItemHandleId } from './WorkflowStageCard';
import { focusedNodeViewport } from './viewport-card-placement';
import { computeTidyPositions, computeTypePositions, tidyNodeSize } from './model/canvas-layout';
import { normalizedProjectFilePath, projectFileNodeIds, projectFileReferences } from './model/project-file-locator';
export { computeTidyPositions, computeTypePositions } from './model/canvas-layout';
export {
  articleNodeId,
  buildArticleNode,
  buildCardNode,
  buildWorkflowPendingNode,
  buildWorkflowStageNode,
  creativeNodeId,
  evaluationNodeId,
  processFlowNodeId,
  processKnowledgeNodeId,
  productNodeId,
  topicNodeId,
  workflowPendingNodeId,
  workflowStageNodeId,
  type BuildCardNodeArgs,
} from './model/canvas-node-builders';
export { projectFileNodeId } from './model/project-file-locator';
export { pickLatestEvaluation } from './model/canvas-data';
import {
  type CanvasEdge,
  type CanvasInteractionMode,
  type CanvasLayoutPosition,
  type CanvasViewport,
  type FlowCanvasApi,
  type StageEvaluation,
  type VisualModel,
  type VisualRatio,
  type VisualResolution,
  type WorkbenchCardData,
  type WorkflowPendingData,
  type WorkflowStageData,
} from './model/canvas-domain';

export {
  ARTICLE_DOWNSTREAM_OPTIONS,
  type ArticleDocument,
  type ArticleReviewData,
  type ArticleSection,
  type CanvasEdge,
  type CanvasInstance,
  type CanvasInteractionMode,
  type CanvasLayoutPosition,
  type CanvasReferenceAsset,
  type CanvasViewport,
  type CaseArticle,
  type CaseCreative,
  type CaseEvaluations,
  type CaseProducts,
  type CaseTopics,
  type CreativeCard,
  type CreativeRound,
  type DownstreamCardOption,
  type EvaluationDimension,
  type EvaluationResultData,
  type FlatCreativeCard,
  type FlowCanvasApi,
  type InstanceKind,
  type ProductDocument,
  type ProductItem,
  type StageEvaluation,
  type TopicGroup,
  type TopicItem,
  type TopicRound,
  type VisualDirectionOption,
  type VisualPhase,
  type WorkflowPendingData,
  type WorkflowStageData,
} from './model/canvas-domain';


export type {
  WorkbenchImage,
  ImageAssetData,
  ContinueGenerateParams,
  ImageConnectedNodeKind,
  ImageConnectedNodeOrigin,
} from './ImageAssetNode';
export { buildImageNode, imageFileUrl, getImageDisplaySize } from './ImageAssetNode';
export type { ImageGroup, ImageGroupData } from './ImageGroupNode';
export { buildImageGroupNode, layoutGroupMembers } from './ImageGroupNode';
export type { WorkbenchPromptCard, PromptCardData } from './PromptCardNode';
export { buildPromptCardNode } from './PromptCardNode';
export type { CanvasBasicNode, CanvasBasicNodeKind, BasicCanvasNodeData } from './BasicCanvasNode';
export {
  buildBasicCanvasNode,
  createCanvasArtifactNode,
  STORYBOARD_CARD_DEFAULT_HEIGHT,
  STORYBOARD_CARD_DEFAULT_WIDTH,
  STORYBOARD_SOURCE_EXAMPLE,
  TEXT_CARD_DEFAULT_HEIGHT,
  TEXT_CARD_DEFAULT_WIDTH,
} from './BasicCanvasNode';
const VISUAL_RATIOS: VisualRatio[] = [...IMAGE_GENERATION_RATIOS];
const VISUAL_RESOLUTIONS: VisualResolution[] = [...IMAGE_GENERATION_RESOLUTIONS];import { VISUAL_NODE_SIZE as MINIMAX_IMAGE_NODE_SIZE } from './visual-node-size';


function AttachIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.3 10.8 4.8-4.8a2.7 2.7 0 0 1 3.8 3.8l-6.5 6.5a4 4 0 0 1-5.7-5.7l6.1-6.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m3.5 3.7 12.6 5.5a.9.9 0 0 1 0 1.6l-12.6 5.5 2.3-5.2h5.1M3.5 3.7l2.3 5.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniMaxImagePlaceholderIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="m6 17 4.2-4.2 3 3 2.2-2.2L19 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="16.5" cy="8.5" r="1.5" fill="currentColor" />
  </svg>;
}

function MiniMaxImageGeneratorNode({
  data,
  selected,
}: {
  data: WorkbenchCardData;
  selected: boolean;
}) {
  const {
    instance,
    draft,
    feedback,
    isSending,
    canvasResources,
    primaryImage,
    primaryImageToast,
    primaryImageCropSaving,
    primaryImageActions,
    onDraftChange,
    onDraftPatch,
    onAddAttachments,
    onRemoveAttachment,
    onSend,
    onAddConnectedNode,
    onRemove,
    onDuplicate,
  } = data;
  const { setNodes } = useReactFlow();
  const [expanded, setExpanded] = React.useState(false);
  const [resourcePickerMode, setResourcePickerMode] = React.useState<'reference' | 'template' | null>(null);
  const [cropping, setCropping] = React.useState(false);
  const [adjusting, setAdjusting] = React.useState(false);
  const [annotating, setAnnotating] = React.useState(false);
  const closeResourcePicker = React.useCallback(() => setResourcePickerMode(null), []);
  const selectedPromptImageRef = React.useRef<string | null>(null);
  const mediaCatalog = useCanvasMediaCatalog();
  const selectedModel = resolveVisualModelSelection(draft.models?.[0], mediaCatalog);
  const modelOptions = mediaCatalog.image.map(model => ({ value: model.id, label: model.label }));
  const selectedRatio: VisualRatio = draft.imageRatios?.[0] || draft.imageRatio || '1:1';
  const nodeSize = MINIMAX_IMAGE_NODE_SIZE[selectedRatio];
  const selectedResolution: VisualResolution = draft.imageResolution || '2K';
  const imageCount = Math.min(4, Math.max(1, draft.imageCount || 1));
  const sourceCardTaskCount = countSourceCardImageTasks({
    activeImageTasks: draft.activeImageTasks,
    legacyTaskId: draft.imageTaskId,
    legacySourceImageId: draft.sourceImageId,
    legacySourceGroupId: draft.sourceGroupId,
  });
  const generating = isSending || sourceCardTaskCount > 0;
  React.useEffect(() => {
    if (generating || !mediaCatalog.ready || !mediaCatalog.image.length || selectedModel === draft.models?.[0]) return;
    onDraftPatch(instance.id, { models: [selectedModel] });
  }, [draft.models, generating, instance.id, mediaCatalog, onDraftPatch, selectedModel]);
  const failed = Boolean(feedback && /失败|错误|error|No such file/i.test(feedback));
  const canSubmit = Boolean(
    !generating
    && (draft.text.trim() || draft.attachments.length)
  );
  const hasPrimaryImage = Boolean(primaryImage?.path || primaryImage?.src);
  const imageReady = !generating && !failed && hasPrimaryImage;
  // A new attempt never replaces an existing result with a loading/error slab.
  const displayPrimaryImage = hasPrimaryImage;
  const primaryImageSrc = primaryImage?.path
    ? imageFileUrl(primaryImage.path)
    : resolveImageSrc(primaryImage?.src);

  React.useEffect(() => {
    if (!selected) {
      setResourcePickerMode(null);
      setCropping(false);
      setAdjusting(false);
      setAnnotating(false);
      selectedPromptImageRef.current = null;
    }
  }, [selected]);

  React.useEffect(() => {
    if (!selected || !imageReady || !primaryImage) return;
    if (selectedPromptImageRef.current === primaryImage.id) return;
    selectedPromptImageRef.current = primaryImage.id;
    const generatedPrompt = primaryImage.prompt?.trim();
    if (generatedPrompt && generatedPrompt !== draft.text) {
      onDraftChange(instance.id, generatedPrompt);
    }
  }, [draft.text, imageReady, instance.id, onDraftChange, primaryImage, selected]);

  const submit = () => {
    if (!canSubmit) return;
    // 把卡面此刻的草稿直接交给提交链路，避免 React Flow 节点 data 的回调闭包
    // 落后一个 render，出现“按钮已亮但提交读到旧空草稿”的假点击。
    if (imageReady && primaryImage?.path) {
      const byPath = new Map(draft.attachments.map(attachment => [attachment.path, attachment]));
      byPath.set(primaryImage.path, {
        name: primaryImage.name || 'reference.png',
        path: primaryImage.path,
        size: 0,
        mimeType: 'image/*',
      });
      onSend(instance, {
        ...draft,
        models: [selectedModel],
        attachments: [...byPath.values()],
        sourceImageId: primaryImage.id,
        sourceGroupId: undefined,
        rawPrompt: true,
      });
      return;
    }
    onSend(instance, { ...draft, models: [selectedModel] });
  };

  const useCanvasResources = (assetIds: string[]) => {
    const selectedAssets = canvasResources
      .filter(resource => assetIds.includes(resource.id) && resource.path)
      .map(resource => ({
        name: resource.name,
        path: resource.path!,
        size: 0,
        mimeType: 'image/*',
      }));
    const byPath = new Map(draft.attachments.map(attachment => [attachment.path, attachment]));
    selectedAssets.forEach(attachment => byPath.set(attachment.path, attachment));
    onDraftPatch(instance.id, { attachments: [...byPath.values()] });
    closeResourcePicker();
  };

  const useLibraryResources = async (
    files: readonly File[],
    assets: readonly ReferenceImageAsset[],
  ) => {
    const saved = await onAddAttachments(instance.id, files);
    if (!saved) return false;
    void assets;
    const nextText = mergeReferenceImagePrompt(draft.text);
    onDraftPatch(instance.id, {
      ...(nextText !== draft.text ? { text: nextText } : {}),
    });
    return true;
  };


  const selectWholeImageCard = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || selected) return;
    const keepExistingSelection = event.shiftKey || event.metaKey || event.ctrlKey;
    setNodes(currentNodes => currentNodes.map(node => {
      if (node.id === instance.id) return node.selected ? node : { ...node, selected: true };
      if (keepExistingSelection || !node.selected) return node;
      return { ...node, selected: false };
    }));
  };

  return (
    <>
    <article
      className={`minimax-image-generator ${selected ? 'is-selected' : ''} ${generating ? 'is-generating' : ''} ${failed ? 'is-failed' : ''} ${displayPrimaryImage ? 'has-result' : ''}`}
      style={{
        width: nodeSize.width,
        minWidth: nodeSize.width,
        '--minimax-image-width': `${nodeSize.width}px`,
        '--minimax-image-height': `${nodeSize.height}px`,
      } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="minimax-image-target-handle" />
      <CanvasNodeSourceHandle onAddNode={kind => onAddConnectedNode(instance.id, kind, {
        x: instance.x,
        y: instance.y,
        width: nodeSize.width,
        height: nodeSize.height,
      })} />

      {/* 不依赖出图后隐藏的标题行；有图片时移到卡内，避开编辑工具条。 */}
      <CanvasNodeActions
        floating
        placement={selected ? 'inside' : 'outside'}
        onDownload={() => { if (imageReady && primaryImage) primaryImageActions.onDownload(primaryImage.id); }}
        downloadDisabled={!imageReady || !primaryImage || cropping || adjusting || annotating}
        downloadLabel={xy().downloadImage}
        onDuplicate={() => onDuplicate(instance)}
        onRemove={() => onRemove(instance)}
        duplicateLabel={xy().duplicateImageCard}
        removeLabel={xy().removeImageCard}
      />
      <div className="minimax-image-title minimax-image-drag-handle">
        <span className="minimax-image-title-icon"><MiniMaxImagePlaceholderIcon /></span>
        <span>{instance.label || xy().image}</span>
      </div>

      {!displayPrimaryImage && <label className="minimax-image-upload nodrag nopan" onPointerDown={event => event.stopPropagation()}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 10.5v-8m0 0L5 5.5m3-3 3 3M3 9.5v3h10v-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{xy().uploadImage}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={generating}
          onChange={event => {
            void onAddAttachments(instance.id, event.currentTarget.files).catch(() => { /* Upload owner renders the error feedback. */ });
            event.currentTarget.value = '';
          }}
        />
      </label>}

      <div
        className="minimax-image-frame minimax-image-drag-handle"
        data-state={displayPrimaryImage ? 'ready' : generating ? 'generating' : failed ? 'failed' : 'empty'}
        style={{ width: nodeSize.width, minWidth: nodeSize.width, height: nodeSize.height }}
        onPointerDown={selectWholeImageCard}
      >
        {displayPrimaryImage && primaryImage ? (
          <img
            className="minimax-image-primary-result"
            src={primaryImageSrc}
            alt={primaryImage.name || xy().generateImage}
            draggable={false}
          />
        ) : generating ? (
          <div className="minimax-image-state" role="status">
            <span className="minimax-image-spinner" aria-hidden="true" />
            <strong>{xy().imageGenerating}</strong>
            <span>{feedback || xy().preparingJob}</span>
          </div>
        ) : failed ? (
          <div className="minimax-image-state is-error" role="alert">
            <span className="minimax-image-error-mark" aria-hidden="true">!</span>
            <strong>{xy().genFailed}</strong>
            <span>{feedback}</span>
          </div>
        ) : (
          <div className="minimax-image-empty">
            <MiniMaxImagePlaceholderIcon />
            {feedback && <span>{feedback}</span>}
          </div>
        )}

        {selected && imageReady && primaryImage && !cropping && !adjusting && !annotating && (
          <div className="image-action-capsule nodrag nopan" onClick={event => event.stopPropagation()}>
            <Button
              variant="ghost"
              className="has-label"
              aria-label={xy().crop}
              onClick={() => setCropping(true)}
            >
              <CropIcon /><span>{xy().crop}</span>
            </Button>
            <Button variant="ghost" className="has-label" aria-label={xy().colorGrade} onClick={() => setAdjusting(true)}>
              <AdjustIcon /><span>{xy().colorGrade}</span>
            </Button>
            <Button variant="ghost" className="has-label" aria-label={xy().rotateRight90} onClick={() => primaryImageActions.onRotate(primaryImage.id)}>
              <RotateIcon /><span>{xy().rotate}</span>
            </Button>
            <span className="image-capsule-divider" />
            <Button variant="ghost" className="has-label" aria-label={xy().annotate} onClick={() => setAnnotating(true)}><AnnotateIcon /><span>{xy().annotate}</span></Button>
            <CanvasSaveAssetButton nodeId={primaryImage.id} />
            <span className="image-capsule-divider" aria-hidden="true" />
            <Button variant="ghost" size="icon" className="bezier-tooltip" data-tooltip={xy().addToChat} aria-label={xy().addToChat} onClick={() => primaryImageActions.onAddToChat(primaryImage.id)}><ChatAddIcon /></Button>
          </div>
        )}


        {adjusting && imageReady && primaryImage && (
          <ImageAdjustOverlay
            src={primaryImageSrc}
            name={primaryImage.name}
            busy={primaryImageCropSaving}
            onCancel={() => setAdjusting(false)}
            onCommit={async (file, meta) => {
              await primaryImageActions.onCropCommit(primaryImage.id, file, meta);
              setAdjusting(false);
            }}
          />
        )}

        {annotating && imageReady && primaryImage && (
          <ImageEditorView
            presentation="inline"
            src={primaryImageSrc}
            name={primaryImage.name}
            saving={primaryImageCropSaving}
            onClose={() => setAnnotating(false)}
            onCommit={async (file, meta) => {
              await primaryImageActions.onAnnotationCommit(primaryImage.id, file, meta);
              setAnnotating(false);
            }}
            onRegenerate={async (file, instruction) => {
              await primaryImageActions.onSendAnnotatedToAI(primaryImage.id, file, instruction);
              setAnnotating(false);
            }}
          />
        )}

        {cropping && imageReady && primaryImage && (
          <CropEditor
            src={primaryImageSrc}
            name={primaryImage.name}
            naturalWidth={primaryImage.naturalWidth || nodeSize.width}
            naturalHeight={primaryImage.naturalHeight || nodeSize.height}
            displayWidth={nodeSize.width}
            displayHeight={nodeSize.height}
            busy={primaryImageCropSaving}
            onCancel={() => setCropping(false)}
            onCommit={async (file, meta) => {
              if (await primaryImageActions.onCropCommit(primaryImage.id, file, meta) === false) return false;
              setCropping(false);
            }}
          />
        )}

        {(primaryImageToast || (displayPrimaryImage && (generating || failed))) && <span className="image-asset-toast nodrag nopan" role="status">{primaryImageToast || (generating ? xy().generatingKeepOriginal : xy().thisGenFailedKept)}</span>}
      </div>

      {primaryImage?.error && <ImageGenerationError error={primaryImage.error} onRetry={() => primaryImageActions.onRetry?.(primaryImage.id)} />}
      {selected && (
        <CanvasComposerShell
          ownerId={instance.id}
          expanded={expanded}
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}
          data-action-ui-id="visual-image-composer"
        >
          <CanvasComposerHeader
            attachmentsLabel={xy().referenceAssets}
            addLabel={xy().addReference}
            addDisabled={generating}
            expanded={expanded}
            onExpand={() => setExpanded(value => !value)}
            onAdd={() => setResourcePickerMode('reference')}
          >
            {draft.attachments.map(attachment => (
              <CanvasComposerAttachment
                key={attachment.path}
                name={attachment.name}
                mimeType={attachment.mimeType}
                src={attachment.mimeType.startsWith('image/') ? imageFileUrl(attachment.path) : undefined}
              >
                {!generating && !attachment.sourceNodeId && (
                  <Button variant="ghost" size="icon" aria-label={xy().removeAttachment(attachment.name)} onClick={() => onRemoveAttachment(instance.id, attachment.path)}>×</Button>
                )}
              </CanvasComposerAttachment>
            ))}
          </CanvasComposerHeader>


          <div className="minimax-image-prompt-wrap">
            <CompositionSafeTextarea
              value={draft.text}
              maxLength={7500}
              disabled={generating}
              placeholder={xy().describeWanted}
              aria-label={xy().imagePrompt}
              onValueChange={text => onDraftChange(instance.id, text)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <span className="minimax-image-prompt-count">{draft.text.length} / 7500</span>
          </div>

          <div className="minimax-image-toolbar">
            <div className="minimax-image-toolbar-left">
              <ImageGenerationOptionControls
                model={selectedModel}
                modelOptions={modelOptions}
                ratio={selectedRatio}
                ratioOptions={VISUAL_RATIOS}
                selectedRatios={[selectedRatio]}
                resolution={selectedResolution}
                resolutionOptions={VISUAL_RESOLUTIONS}
                onModelChange={model => onDraftPatch(instance.id, { models: [model as VisualModel] })}
                onRatioChange={ratio => onDraftPatch(instance.id, { imageRatio: ratio as VisualRatio, imageRatios: [ratio as VisualRatio] })}
                onResolutionChange={resolution => onDraftPatch(instance.id, { imageResolution: resolution as VisualResolution })}
                count={imageCount}
                onCountChange={imageCount => onDraftPatch(instance.id, { imageCount })}
                onTemplateClick={() => setResourcePickerMode('template')}
              />

            </div>

            <div className="minimax-image-toolbar-right">
              <Button
                type="submit"
                variant="primary"
                size="icon"
                className="minimax-image-submit"
                disabled={!canSubmit}
                aria-label={generating ? xy().generatingImage : xy().generateImage}
                title={canSubmit ? xy().generateImage : xy().needPromptOrRef}
              >
                {generating ? <span className="minimax-image-submit-spinner" aria-hidden="true" /> : <span aria-hidden="true">↑</span>}
              </Button>
            </div>
          </div>
        </CanvasComposerShell>
      )}
    </article>
    <ImageReferenceResourcePicker
      open={resourcePickerMode !== null}
      libraryOnly={resourcePickerMode === 'template'}
      resources={canvasResources}
      includeLibraryTab={false}
      onClose={closeResourcePicker}
      onUseCanvas={useCanvasResources}
      onUseLibrary={useLibraryResources}
      onUpload={async files => { await onAddAttachments(instance.id, files); }}
    />
    </>
  );
}

function WorkbenchCardNode(props: NodeProps<Node<WorkbenchCardData>>) {
  if (props.data.instance.kind === 'plan') return null;
  return <OtherWorkbenchCardNode {...props} />;
}

function OtherWorkbenchCardNode({ data, selected }: NodeProps<Node<WorkbenchCardData>>) {
  if (data.instance.kind === 'visual') {
    return <MiniMaxImageGeneratorNode data={data} selected={Boolean(selected)} />;
  }
  const {
    instance,
    meta,
    state,
    draft,
    feedback,
    isSending,
    isGeneratingCreative,
    isBoundToCase,
    onRemove,
    onDuplicate,
    onDraftChange,
    onAddAttachments,
    onRemoveAttachment,
    onSend,
  } = data;
  return (
    <article className={`canvas-node accent-${meta.accent} status-${state.status}`}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      <Handle type="source" position={Position.Right} className="node-handle" />
      <div className="node-inner">
        <div className="node-drag-surface">
          <div className="node-topline">
            <span className="node-kind">{meta.eyebrow}</span>
            <CanvasNodeActions
              onDuplicate={() => onDuplicate(instance)}
              onRemove={() => onRemove(instance)}
              duplicateLabel={xy().duplicateCard}
              removeLabel={xy().removeCard}
            />
          </div>

          <div className="node-title-row">
            <h2>{instance.label || meta.title}</h2>
          </div>

        </div>

        {/* plan 已在上方独立返回，这里只剩 visual / video 两类能力卡 */}
        {isBoundToCase ? (
          <div className="task-actionbar nodrag nopan">
            <span className="task-locked">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <rect x="3" y="7" width="10" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              {isGeneratingCreative ? xy().filedGenerating : xy().filedLocked}
            </span>
            {feedback && <span className="task-feedback">{feedback}</span>}
          </div>
        ) : (
          <div className="task-composer nodrag nopan">
            <CompositionSafeTextarea
              value={draft.text}
              onValueChange={value => onDraftChange(instance.id, value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void onSend(instance);
                }
              }}
              placeholder={xy().taskPlaceholder(meta.title)}
              aria-label={xy().taskInput(meta.title)}
            />
            {draft.attachments.length > 0 && (
              <div className="task-attachments">
                {draft.attachments.map(attachment => (
                  <span key={attachment.path} className="task-attachment">
                    <AttachIcon />
                    <span>{attachment.name}</span>
                    <Button variant="ghost" size="icon" onClick={() => onRemoveAttachment(instance.id, attachment.path)} aria-label={xy().removeAttachment(attachment.name)}>×</Button>
                  </span>
                ))}
              </div>
            )}
            <div className="task-actions">
              <label className="task-attach" title={xy().uploadAttachment}>
                <AttachIcon />
                <span>{xy().attachment}</span>
                <input type="file" multiple onChange={event => {
                  void onAddAttachments(instance.id, event.currentTarget.files).catch(() => { /* Upload owner renders the error feedback. */ });
                  event.currentTarget.value = '';
                }} />
              </label>
              <Button
                variant="primary"
                className="task-send"
                disabled={isSending}
                onClick={() => void onSend(instance)}
              >
                <SendIcon />
                {isSending ? xy().loading : xy().send}
              </Button>
            </div>
            {feedback && <span className="task-feedback">{feedback}</span>}
          </div>
        )}

        <div className="node-footline node-drag-surface">
          <span className="node-updated">
            <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
              <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M6 3.5v2.5l1.8 1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {formatNodeTimestamp(state.updatedAt)}
          </span>
          {state.contributors && state.contributors.length > 0 && (
            <span className="node-avatars" aria-label={xy().participants}>
              {state.contributors.map((c, i) => (
                <span key={i} className="node-avatar">{c}</span>
              ))}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * 内联评测小卡：跟随每个创意轮次尾部展示该轮的独立评测。
 * 视觉与创意评审卡对齐（细边框 / 圆角 / 中性），通过=墨绿、待改=中性、载入=紫。
 */
function ProcessRoundEvaluation({
  evaluation,
  isLatest = false,
  onRequest,
  disabled = false,
}: {
  evaluation?: StageEvaluation;
  isLatest?: boolean;
  onRequest?: () => void;
  disabled?: boolean;
}) {
  if (!evaluation) {
    if (!isLatest || !onRequest) return null;
    return (
      <div className="process-eval process-eval-empty">
        <span>{xy().notEvaluated}</span>
        <Button variant="ghost" disabled={disabled} onClick={onRequest}>{xy().startEval}</Button>
      </div>
    );
  }

  const loading = evaluation.status === 'running';
  if (loading) {
    return (
      <div className="process-eval is-running" aria-live="polite">
        <div className="process-eval-loading">
          <span className="process-eval-spinner" aria-hidden="true" />
          <div className="process-eval-loading-copy">
            <strong>{xy().generatingEval}</strong>
            <span>{xy().auditorWorking}</span>
          </div>
        </div>
      </div>
    );
  }

  if (evaluation.status === 'error' || evaluation.status === 'failed') {
    return (
      <div className="process-eval is-error" aria-live="polite">
        <div className="process-eval-loading">
          <div className="process-eval-loading-copy">
            <strong>{xy().evalFailed}</strong>
            <span>{evaluation.error || xy().autoReviewMissed}</span>
          </div>
          {isLatest && onRequest && (
            <Button variant="ghost" className="process-eval-retry" disabled={disabled} onClick={onRequest}>
              {xy().reEvaluate}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (evaluation.status === 'canceled') {
    return (
      <div className="process-eval is-error" aria-live="polite">
        <div className="process-eval-loading">
          <div className="process-eval-loading-copy">
            <strong>{xy().evalCancelled}</strong>
            <span>{evaluation.cancel_reason || xy().evalStopped}</span>
          </div>
          {isLatest && onRequest && (
            <Button variant="ghost" className="process-eval-retry" disabled={disabled} onClick={onRequest}>
              {xy().reEvaluate}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const dimensions = [...(evaluation.dimensions || [])].sort((left, right) => left.score - right.score);
  const score = evaluation.score ?? 0;
  const passed = Boolean(evaluation.passed);
  const threshold = evaluation.threshold || 80;
  return (
    <details className={`process-eval nodrag nopan${passed ? ' is-passed' : ' is-revision'}${evaluation.stale ? ' is-stale' : ''}`}>
      <summary className="process-eval-head">
        <span className="process-eval-kind"><i className="process-eval-dot" />{xy().thisRoundEval}</span>
        <span className={`process-eval-tag${passed ? ' is-passed' : ' is-revision'}`}>
          {evaluation.stale ? xy().pendingRetest : passed ? xy().humanReady : xy().needsEdits}
        </span>
        <span className="process-eval-score" aria-label={xy().evalScore(score)}>
          <strong>{score}</strong><span>/ 100</span>
        </span>
        <i className="process-eval-caret" aria-hidden="true" />
      </summary>
      <div className="process-eval-body">
        <div className={`process-eval-verdict${passed ? ' is-passed' : ' is-revision'}`}>
          <strong>{evaluation.stale ? xy().contentUpdated : passed ? xy().canHumanReview : xy().editBeforeHuman}</strong>
          <span>{passed ? xy().reachedThreshold(threshold) : xy().shortOfThreshold(Math.max(0, Math.round((threshold - score) * 10) / 10))}</span>
        </div>
        {evaluation.cap_triggered && <p className="process-eval-cap">{xy().triggerCap}{evaluation.cap_reason}</p>}
        {(evaluation.major_problems || []).length > 0 && (
          <div className="process-eval-block">
            <h4>{xy().mainIssues}</h4>
            {(evaluation.major_problems || []).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
          </div>
        )}
        {dimensions.length > 0 && (
          <div className="process-eval-dims">
            {dimensions.map(item => (
              <details key={item.id} open={item.score < 80}>
                <summary>
                  <span>{item.label}</span>
                  <i><b style={{ width: `${Math.max(4, item.score)}%` }} /></i>
                  <strong>{item.score}</strong>
                </summary>
                <p>{item.reason}</p>
                {item.improvement && <small><b>{xy().suggestions}</b>{item.improvement}</small>}
              </details>
            ))}
          </div>
        )}
        {(evaluation.revision_priority || []).length > 0 && (
          <div className="process-eval-block is-priority">
            <h4>{xy().prioritize}</h4>
            {(evaluation.revision_priority || []).map((item, index) => <p key={`${item}-${index}`}><b>{index + 1}</b>{item}</p>)}
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * 轮次意见回显：只显示「人工方向意见」。
 * 评测自动修改触发的意见（以「关联评测」开头）内容与下方评测卡完全重复，
 * 这里直接不显示，详情看本轮评测卡即可，避免画布冗余。
 */
function WorkflowStageNode({ id, data }: NodeProps<Node<WorkflowStageData>>) {
  const connections = useNodeConnections({ id, handleType: 'source' });
  const connectedSourceHandles = connections.flatMap(connection => connection.sourceHandle ? [connection.sourceHandle] : []);
  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = React.useRef<HTMLElement>(null);
  const itemLayoutSignature = (data.artifact.items ?? [])
    .map((item) => `${item.id}:${item.title}:${item.summary ?? ''}`)
    .join('|');

  React.useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;

    let frame = 0;
    const syncHandles = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    };

    // React Flow 会跟踪节点外框，但子卡正文换行后，多个自定义 Handle 的内部
    // y 坐标仍可能停留在旧布局。节点和每张子卡任一尺寸变化时都重新测量。
    syncHandles();
    const observer = new ResizeObserver(syncHandles);
    observer.observe(card);
    card.querySelectorAll<HTMLElement>('.process-result-item, .workflow-result-item-handle').forEach((item) => observer.observe(item));
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [id, itemLayoutSignature, updateNodeInternals]);

  /*
   * 评测入口复用已有的 ProcessRoundEvaluation（旧结果卡那条评测小卡），不另做一套：
   * 用户要的是「位置挪一下」，不是新视觉语言。
   *
   * 触发走 artifact.actions 里 capability 为 evaluate 的那个动作——找不到就没有评测
   * 能力（流程 MD 写了 `- 支持评测：否`），此时 onRequest 为空，卡片也不会渲染评测条。
   */
  const evaluateAction = data.artifact.actions.find((action) => action.capability === 'evaluate');
  const requestEval = evaluateAction
    ? () => {
        void data.onInteract({
          actionId: evaluateAction.id,
          selectedIds: data.artifact.selectedIds ?? [],
          feedback: '',
        });
      }
    : undefined;
  return (
    <><WorkflowStageCard
      connectedSourceHandles={connectedSourceHandles}
      artifact={data.artifact}
      busy={data.busy}
      rootRef={cardRef}
      evaluation={(
        <ProcessRoundEvaluation
          {...(data.evaluation ? { evaluation: data.evaluation } : {})}
          isLatest
          {...(requestEval ? { onRequest: requestEval } : {})}
          disabled={data.busy}
        />
      )}
      onInteract={data.onInteract}
    />
    <CanvasNodeActions onRemove={data.onRemove} removeLabel={xy().deletePlanCard} /></>
  );
}

/**
 * 生成中的占位卡：骨架屏 + 一句在等什么。
 *
 * 复用画板本地结果卡的外壳和骨架样式，
 * 这样它和随后顶替它的真结果卡是同一个外形，切换时不会突然换一张卡。
 * 没有任何按钮——这个阶段用户没什么可操作的，给按钮只会让人点了没反应。
 */
function WorkflowPendingNode({ data }: NodeProps<Node<WorkflowPendingData>>) {
  const failed = data.status === 'failed';
  return (
    <article className={`canvas-node workflow-pending-card status-${failed ? 'failed' : 'review'}`}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      <Handle type="source" position={Position.Right} className="node-handle" />
      <div className="node-inner">
        <div className="node-drag-surface">
          <div className="node-title-row">
            <h2>{data.title}</h2>
            <span className="workflow-pending-meta">{failed ? xy().genFailed : xy().generating}</span>
          </div>
          {/*
            * hint 只做无障碍播报，不上卡面。
            *
            * 标题右边已经有「生成中」，正文再来一句「创意生成中」就是同一件事说两遍，
            * 还白占一行把骨架屏往下推。屏幕阅读器仍能从 loading 区的 aria-label 拿到它。
            */}
        </div>
        {failed ? (
          <p className="workflow-pending-error" role="alert">{data.hint}</p>
        ) : (
          <div className="canvas-result-loading" aria-label={data.hint} aria-live="polite">
            <span className="canvas-result-spinner" aria-hidden="true" />
            <div className="canvas-result-skeletons">
              <span className="canvas-result-skeleton" />
              <span className="canvas-result-skeleton" />
              <span className="canvas-result-skeleton" />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

const nodeTypes = {
  workbenchCard: WorkbenchCardNode,
  // 创意、话题、产品句三阶段共用同一个过程结果节点。
  workflowStage: WorkflowStageNode,
  // 结果还没落盘时的占位（骨架屏），第一份 artifact 一到就被顶掉。
  workflowPending: WorkflowPendingNode,
  imageAsset: ImageAssetNode,
  imageGroup: ImageGroupNode,
  organizationGroup: OrganizationGroupNode,
  workflowRunGroup: WorkflowRunGroupNode,
  workflowQuestion: WorkflowQuestionNode,
  storyboardAssetGroup: StoryboardAssetGroupNode,
  storyboardGallery: StoryboardGalleryNode,
  storyboardImageStack: StoryboardImageStackNode,
  promptCard: PromptCardNode,
  basicCanvas: BasicCanvasNode,
};

// React Flow receives these on every controlled-node update. Keep their
// identities stable so dragging one node does not make the canvas reconcile
// unrelated configuration objects on every pointer frame.
const FLOW_PRO_OPTIONS = { hideAttribution: true };
const FLOW_DEFAULT_EDGE_OPTIONS = {
  type: 'reference',
  markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: 'var(--canvas-edge-color, #98a2b3)' },
  interactionWidth: 24,
};
const FLOW_EDGE_TYPES = { reference: CanvasReferenceEdge };
const FLOW_CONNECTION_LINE_STYLE = { stroke: 'var(--canvas-edge-active, #98a2b3)', strokeWidth: 1.35 };

function toRFEdges(edges: CanvasEdge[]): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: stableCanvasHandleId(edge.sourceHandle) ?? undefined,
    targetHandle: stableCanvasHandleId(edge.targetHandle) ?? undefined,
    data: { ...edge.data, generated: isGeneratedCanvasEdge(edge.id) },
    reconnectable: !isGeneratedCanvasEdge(edge.id),
    deletable: !isGeneratedCanvasEdge(edge.id),
    zIndex: -1,
  }));
}

function fromRFEdges(edges: Edge[]): CanvasEdge[] {
  return edges.map(edge => {
    const { connectedAt: _pulse, generated: _generated, sourceTitle: _sourceTitle, targetTitle: _targetTitle, ...data } = edge.data ?? {};
    return ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: stableCanvasHandleId(edge.sourceHandle),
    targetHandle: stableCanvasHandleId(edge.targetHandle),
    ...(Object.keys(data).length ? { data } : {}),
  });
  });
}

function edgesEqual(a: CanvasEdge[], b: CanvasEdge[]) {
  if (a.length !== b.length) return false;
  return a.every((edge, index) => (
    edge.id === b[index]?.id
    && edge.source === b[index]?.source
    && edge.target === b[index]?.target
    && (edge.sourceHandle ?? null) === (b[index]?.sourceHandle ?? null)
    && (edge.targetHandle ?? null) === (b[index]?.targetHandle ?? null)
  ));
}

type CanvasSurfaceProps = {
  nodes: Node[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  apiRef?: React.MutableRefObject<FlowCanvasApi | null>;
  interactionMode?: CanvasInteractionMode;
  onInteractionModeChange?: (mode: CanvasInteractionMode) => void;
  onEdgesChangePersist: (edges: CanvasEdge[]) => void;
  onNodePositionsCommit: (positions: Array<{ id: string; x: number; y: number }>) => void;
  priorLayout?: CanvasLayoutPosition[] | null;
  onPriorLayoutPersist?: (positions: CanvasLayoutPosition[] | null) => void;
  onViewportPersist: (viewport: CanvasViewport) => void;
  onFilesDrop?: (files: File[], flowPosition: { x: number; y: number }) => void;
  onProjectFileDrop?: (file: ProjectFileDragPayload, flowPosition: { x: number; y: number }) => void;
  onAddNode?: (kind: CanvasNodeCreationKind, flowPosition: { x: number; y: number }) => void;
  onGroupSelectedImages?: (imageIds: string[], geometry?: GroupMemberGeometry[]) => string | void;
  onGroupSelection?: (nodes: Node[]) => string | void;
  onRemoveGroupMembers?: (ids: string[]) => void;
  /** 只影响呈现，不改连线数据；用于右上角的“显示连线”开关。 */
  edgesVisible?: boolean;
  /** 小地图独立于节点和视口数据，随用户的画布偏好保存。 */
  /** 画布背景是显示层偏好，不该影响已有的节点/连线能力。 */
  background?: 'dots' | 'grid' | 'none';
  tone?: 'default' | 'warm-gray' | 'cool-gray' | 'paper' | 'sage' | 'mist-blue' | 'lavender' | 'blush' | 'sand';
  empty?: boolean;
};

type LocateProjectFileEvent = {
  projectId?: string;
  fileName?: string;
};

function CanvasSurface({
  nodes: desiredNodes,
  edges: desiredEdges,
  viewport,
  apiRef,
  interactionMode = 'pointer',
  onInteractionModeChange: _onInteractionModeChange,
  onEdgesChangePersist,
  onNodePositionsCommit,
  priorLayout,
  onPriorLayoutPersist,
  onViewportPersist,
  onFilesDrop,
  onProjectFileDrop,
  onAddNode,
  onGroupSelectedImages,
  onGroupSelection,
  onRemoveGroupMembers,
  edgesVisible = true,
  background = 'dots',
  tone = 'default',
  empty,
}: CanvasSurfaceProps) {
  const history = useCanvasHistory();
  const idleWork = useCanvasIdleWork();
  const selectionChrome = canvasSelectionChrome(useCanvasLocale());
  const canvasRootRef = React.useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useNodesState<Node>(desiredNodes);
  const liveDragNodes = React.useRef(nodes);
  liveDragNodes.current = nodes;
  const dragBaseline = React.useRef<Node[] | null>(null);
  const [edges, setEdges] = React.useState<Edge[]>(() => toRFEdges(desiredEdges));
  const edgesRef = React.useRef(edges);
  const [isFileDrag, setIsFileDrag] = React.useState(false);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = React.useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = React.useState('');
  const [sourceMenuRequest, setSourceMenuRequest] = React.useState<{ nodeId: string; nonce: number } | null>(null);
  const [paneMenu, setPaneMenu] = React.useState({ open: false, screen: { x: 0, y: 0 }, flow: { x: 0, y: 0 } });
  const paneMenuScale = useStore(state => paneMenu.open ? state.transform[2] : 1);
  const connectionCancelledRef = React.useRef(false);
  const reconnectingIdRef = React.useRef<string | undefined>(undefined);
  const cancelConnection = useStore(state => state.cancelConnection);
  React.useEffect(() => {
    if (!connectionNotice || isConnecting) return;
    const timer = window.setTimeout(() => setConnectionNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [connectionNotice, isConnecting]);
  const selectedNodes = React.useMemo(() => nodes.filter(node => node.selected), [nodes]);
  const selectedIdsKey = JSON.stringify(selectedNodes.map(node => node.id));
  const selectedImageIds = selectedNodes.every(node => node.type === 'imageAsset' && !node.parentId)
    ? selectedNodes.map(node => node.id) : [];
  const selectedNodeIdsRef = React.useRef<Set<string>>(new Set());
  const pointerSelectionRef = React.useRef<Set<string> | null>(null);
  const pendingActivationNodeIdRef = React.useRef<string | null>(null);
  // Selection is the only owner of composer visibility. No second focus state
  // may keep a composer alive after multiselect, deselection or node removal.
  const activeComposerOwnerId = React.useMemo(() => {
    return selectedNodes.length === 1 && !edges.some(edge => edge.selected) ? selectedNodes[0]!.id : null;
  }, [selectedNodes, edges]);
  const { setViewport, getViewport, getNodes, screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const flowWidth = useStore(state => state.width);
  const flowHeight = useStore(state => state.height);
  const draggingRef = React.useRef(false);
  const movingRef = React.useRef(false);
  const movementIdleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCanvasInteractionActive = useCanvasInteractionActivity();
  const syncInteractionActivity = React.useCallback(() => {
    const active = draggingRef.current || movingRef.current;
    canvasRootRef.current?.classList.toggle('is-interacting', active);
    setCanvasInteractionActive(active);
  }, [setCanvasInteractionActive]);

  React.useEffect(() => () => {
    if (movementIdleTimer.current) clearTimeout(movementIdleTimer.current);
    setCanvasInteractionActive(false);
  }, [setCanvasInteractionActive]);
  const skipEdgeEcho = React.useRef(false);
  const edgeSyncReadyRef = React.useRef(false);
  const viewportReady = React.useRef(false);
  const focusViewportLockUntilRef = React.useRef(0);
  const fileDragDepth = React.useRef(0);
  const desiredNodesSigRef = React.useRef('');
  const desiredNodePositionsRef = React.useRef(new Map(
    desiredNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
  ));
  const nodeDataSignatureRef = React.useRef(new WeakMap<object, string>());
  const stackDataSignature = React.useRef(createStoryboardStackSignature());
  const priorLayoutRef = React.useRef<CanvasLayoutPosition[] | null>(priorLayout ?? null);

  React.useEffect(() => {
    priorLayoutRef.current = priorLayout ?? null;
  }, [priorLayout]);
  // 已完成「首次居中」的派生卡 id：处理过的卡永不再被自动移动，从根上杜绝拖动联动
  const centeredRef = React.useRef<Set<string>>(new Set());
  const promptCollisionRef = React.useRef<Set<string>>(new Set());

  const focusNodesById = React.useCallback((nodeIds: string[]) => {
    const wanted = new Set(nodeIds);
    const targets = nodes.filter(node => wanted.has(node.id));
    if (targets.length === 0) return false;
    if (targets.length === 1) {
      const target = targets[0]!;
      const width = target.measured?.width || target.width || 350;
      const height = target.measured?.height || target.height || 360;
      const nextViewport = focusedNodeViewport({
        viewportWidth: flowWidth,
        viewportHeight: flowHeight,
        node: {
          x: target.position.x,
          y: target.position.y,
          width,
          height,
        },
      });
      focusViewportLockUntilRef.current = performance.now() + 900;
      void setViewport(nextViewport, { duration: 260 });
      return true;
    }
    focusViewportLockUntilRef.current = performance.now() + 900;
    void fitView({
      nodes: targets,
      padding: 0.24,
      minZoom: 0.1,
      maxZoom: 1.25,
      duration: 260,
    });
    return true;
  }, [fitView, flowHeight, flowWidth, nodes, setViewport]);

  const activateNodeById = React.useCallback((nodeId: string) => {
    const target = nodes.find(node => node.id === nodeId);
    if (!target) {
      pendingActivationNodeIdRef.current = nodeId;
      return false;
    }
    pendingActivationNodeIdRef.current = null;
    selectedNodeIdsRef.current = new Set([nodeId]);
    setEdges(current => current.map(edge => edge.selected ? { ...edge, selected: false } : edge));
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.closest('.react-flow__node')?.getAttribute('data-id') !== nodeId) {
      canvasRootRef.current?.focus({ preventScroll: true });
    }
    setNodes(current => current.map(node => (
      node.selected === (node.id === nodeId)
        ? node
        : { ...node, selected: node.id === nodeId }
    )));
    return true;
  }, [nodes, setNodes]);

  React.useEffect(() => {
    const pendingNodeId = pendingActivationNodeIdRef.current;
    if (pendingNodeId) activateNodeById(pendingNodeId);
  }, [activateNodeById]);

  // interactionMode 由上层注入：可含「空格按住」的临时抓手
  const isHandMode = interactionMode === 'hand';

  const lastFileReferencesSignature = React.useRef('');
  React.useEffect(() => {
    const projectId = getCanvasHostContext().projectId;
    // File references depend on business data, never live drag positions.
    const references = projectFileReferences(desiredNodes);
    const publish = () => window.dispatchEvent(new CustomEvent('bezier-design:project-file-references', {
      detail: { projectId, references },
    }));
    const request = (event: Event) => {
      if ((event as CustomEvent).detail?.projectId === projectId) publish();
    };
    const signature = JSON.stringify([projectId, references]);
    if (signature !== lastFileReferencesSignature.current) {
      lastFileReferencesSignature.current = signature;
      publish();
    }
    window.addEventListener('bezier-design:request-project-file-references', request);
    return () => window.removeEventListener('bezier-design:request-project-file-references', request);
  }, [desiredNodes]);

  React.useEffect(() => {
    const locateProjectFile = (event: Event) => {
      const detail = (event as CustomEvent<LocateProjectFileEvent>).detail;
      if (detail?.projectId && detail.projectId !== getCanvasHostContext().projectId) return;
      const fileName = normalizedProjectFilePath(detail?.fileName);
      if (!fileName) return;
      const ids = projectFileNodeIds(nodes, fileName);
      const currentIndex = ids.findIndex(id => nodes.some(node => node.id === id && node.selected));
      const targetId = ids[(currentIndex + 1) % ids.length];
      const target = targetId ? nodes.find(node => node.id === targetId) : undefined;
      window.dispatchEvent(new CustomEvent('bezier-design:project-file-location-result', {
        detail: { fileName: detail.fileName, found: Boolean(target) },
      }));
      if (!target) return;
      setNodes(current => current.map(node => ({ ...node, selected: node.id === target.id })));
      window.requestAnimationFrame(() => {
        void fitView({
          nodes: [target],
          padding: 0.55,
          minZoom: 0.45,
          maxZoom: 1.25,
          duration: 260,
        });
      });
    };
    window.addEventListener('bezier-design:locate-project-file', locateProjectFile);
    return () => window.removeEventListener('bezier-design:locate-project-file', locateProjectFile);
  }, [fitView, nodes, setNodes]);

  const visibleNodes = nodes;

  const visibleEdges = React.useMemo(() => {
    if (!edgesVisible) return [];
    const selectedIds = new Set<string>(JSON.parse(selectedIdsKey));
    const titles = new Map(desiredNodes.map(node => {
      const data = node.data as { node?: { title?: string; kind?: string }; artifact?: { title?: string }; title?: string; label?: string };
      return [node.id, data.node?.title || data.artifact?.title || data.title || data.label || (node.type === 'imageAsset' ? xy().image : xy().card)];
    }));
    const endpointStates = canvasEdgeNodeStates(desiredNodes, selectedIds);
    return edges.filter(edge => endpointStates.get(edge.source)?.visible && endpointStates.get(edge.target)?.visible).map(edge => ({ ...edge,
      zIndex: Math.max(edge.zIndex ?? -1, endpointStates.get(edge.source)!.edgeFloor, endpointStates.get(edge.target)!.edgeFloor),
      ariaLabel: `${titles.get(edge.source) ?? xy().source} → ${titles.get(edge.target) ?? xy().target}，${isGeneratedCanvasEdge(edge.id) ? xy().genSource : xy().assetRef}`,
      data: { ...edge.data, sourceTitle: titles.get(edge.source), targetTitle: titles.get(edge.target) },
      className: [edge.id === hoveredEdgeId ? 'is-hover-highlight' : '', selectedIds.size
        ? endpointStates.get(edge.source)?.related || endpointStates.get(edge.target)?.related ? 'is-related' : 'is-muted'
        : ''].filter(Boolean).join(' ') }));
  }, [edgesVisible, edges, desiredNodes, selectedIdsKey, hoveredEdgeId]);
  // Endpoint membership depends on edges, not the changing node positions.
  const highlightNode = React.useMemo(() => {
    if (!edgesVisible) return null;
    const endpointIds = new Set(edges.filter(edge => edge.id === hoveredEdgeId || edge.selected)
      .flatMap(edge => [edge.source, edge.target]));
    if (!endpointIds.size) return null;
    const cached = new WeakMap<Node, Node>();
    return (node: Node): Node => {
      if (!endpointIds.has(node.id)) return node;
      let highlighted = cached.get(node);
      if (!highlighted) {
        highlighted = { ...node, className: `${node.className ?? ''} is-edge-endpoint` };
        cached.set(node, highlighted);
      }
      return highlighted;
    };
  }, [edges, edgesVisible, hoveredEdgeId]);
  const highlightedNodes = React.useMemo(() => highlightNode ? visibleNodes.map(highlightNode) : visibleNodes,
    [highlightNode, visibleNodes]);

  React.useEffect(() => {
    if (draggingRef.current) return;
    const dataSignature = (data: Node['data']) => {
      const object = data as object;
      const cached = nodeDataSignatureRef.current.get(object);
      if (cached !== undefined) return cached;
      const signature = data.editor && data.versions ? stackDataSignature.current(data) : JSON.stringify(data);
      nodeDataSignatureRef.current.set(object, signature);
      return signature;
    };
    const sameNode = (left: Node, right: Node) => (
      left.id === right.id
      && left.type === right.type
      && left.position.x === right.position.x
      && left.position.y === right.position.y
      && left.parentId === right.parentId
      && !!left.hidden === !!right.hidden
      // `selected` is normally owned by React Flow. Only nodes whose business
      // model explicitly supplies a selection value may override it during
      // desired-state reconciliation. Basic nodes do not supply one.
      && (right.selected === undefined || left.selected === right.selected)
      && dataSignature(left.data) === dataSignature(right.data)
    );
    const signature = desiredNodes.map(node => [
      node.id,
      node.type,
      node.position.x,
      node.position.y,
      node.parentId ?? '',
      node.hidden ? 'hidden' : 'visible',
      node.selected === undefined ? '' : node.selected ? 'selected' : 'unselected',
      dataSignature(node.data),
    ].join(':')).join('|');
    if (signature === desiredNodesSigRef.current) return;
    desiredNodesSigRef.current = signature;
    const previousDesiredPositions = desiredNodePositionsRef.current;
    desiredNodePositionsRef.current = new Map(
      desiredNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
    );
    setNodes(currentNodes => {
      const currentById = new Map(currentNodes.map(node => [node.id, node]));
      let changed = currentNodes.length !== desiredNodes.length;
      const nextNodes = desiredNodes.map(desired => {
        const existing = currentById.get(desired.id);
        if (!existing) {
          changed = true;
          return desired;
        }
        const previousDesiredPosition = previousDesiredPositions.get(desired.id);
        const positionChangedUpstream = Boolean(previousDesiredPosition) && (
          previousDesiredPosition!.x !== desired.position.x
          || previousDesiredPosition!.y !== desired.position.y
        );
        const parentRebased = didParentRebase(desired.parentId, previousDesiredPositions, desiredNodePositionsRef.current);
        // Selection, card data and polling updates frequently rebuild desiredNodes with
        // the position from the previous render. Preserve React Flow's live position
        // unless the upstream position itself actually changed (layout, hydration, etc.).
        const reconciledDesired = positionChangedUpstream || parentRebased || existing.parentId !== desired.parentId
          ? desired
          : { ...desired, position: existing.position };
        if (sameNode(existing, reconciledDesired)) return existing;
        changed = true;
        return {
          ...existing,
          ...reconciledDesired,
          parentId: reconciledDesired.parentId,
          hidden: reconciledDesired.hidden,
          selected: reconciledDesired.selected ?? existing.selected,
          measured: existing.measured,
        };
      });
      return changed ? nextNodes : currentNodes;
    });
  }, [desiredNodes, setNodes]);

  React.useEffect(() => {
    if (draggingRef.current) return;
    const isChildCard = (node: Node) => node.type === 'promptCard';
    const livePromptIds = new Set(nodes.filter(isChildCard).map(node => node.id));
    for (const id of promptCollisionRef.current) {
      if (!livePromptIds.has(id)) promptCollisionRef.current.delete(id);
    }

    const positions: Array<{ id: string; x: number; y: number }> = [];
    const nextNodes = [...nodes];
    for (const prompt of nodes.filter(isChildCard)) {
      if (promptCollisionRef.current.has(prompt.id) || !prompt.parentId) continue;
      const parent = nextNodes.find(node => node.id === prompt.parentId);
      if (!parent) continue;
      if (!parent.measured?.width || !parent.measured?.height || !prompt.measured?.width || !prompt.measured?.height) {
        continue;
      }
      const promptSize = tidyNodeSize(prompt);
      const promptRect = {
        x: parent.position.x + prompt.position.x,
        y: parent.position.y + prompt.position.y,
        w: promptSize.w,
        h: promptSize.h,
      };
      const blockers = [promptRect];
      const candidates = nextNodes
        .filter(node => !node.parentId && node.id !== parent.id && !isChildCard(node))
        .sort((a, b) => a.position.x - b.position.x);

      for (const candidate of candidates) {
        const size = tidyNodeSize(candidate);
        let x = candidate.position.x;
        const y = candidate.position.y;
        let moved = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const collisions = blockers.filter(rect => !(
            x + size.w + 12 <= rect.x
            || x >= rect.x + rect.w + 12
            || y + size.h + 12 <= rect.y
            || y >= rect.y + rect.h + 12
          ));
          if (!collisions.length) break;
          x = Math.max(...collisions.map(rect => rect.x + rect.w + 12));
          moved = true;
        }
        if (!moved) continue;
        candidate.position = { ...candidate.position, x };
        positions.push({ id: candidate.id, x, y });
        blockers.push({ x, y, w: size.w, h: size.h });
      }
      promptCollisionRef.current.add(prompt.id);
    }
    if (!positions.length) return;
    const moved = new Map(positions.map(position => [position.id, position]));
    setNodes(current => current.map(node => {
      const position = moved.get(node.id);
      return position ? { ...node, position: { x: position.x, y: position.y } } : node;
    }));
    onNodePositionsCommit(positions);
  }, [nodes, onNodePositionsCommit, setNodes]);

  React.useEffect(() => {
    if (skipEdgeEcho.current) {
      skipEdgeEcho.current = false;
      return;
    }
    const previousIds = new Set(edgesRef.current.map(edge => edge.id));
    const next = toRFEdges(desiredEdges).map(edge => edgeSyncReadyRef.current && !previousIds.has(edge.id) && !isGeneratedCanvasEdge(edge.id)
      ? { ...edge, data: { ...edge.data, connectedAt: Date.now() } } : edge);
    edgeSyncReadyRef.current = true;
    edgesRef.current = next;
    setEdges(next);
  }, [desiredEdges]);

  React.useEffect(() => {
    // A card action can persist node data while a camera focus animation is in
    // flight. Ignore the old viewport bundled in that response; onMoveEnd will
    // persist the animation's final viewport once it has settled.
    if (performance.now() < focusViewportLockUntilRef.current) return;
    const next = { x: viewport.x, y: viewport.y, zoom: viewport.scale };
    void setViewport(next);
    viewportReady.current = true;
  }, [viewport.x, viewport.y, viewport.scale, setViewport]);

  /**
   * 首次挂载后校验：持久化视口是否让内容落在可视区外。
   *
   * 视口是无条件恢复的（见上一个 effect），但保存时的容器尺寸可能和现在不同
   * （例如上次全屏、这次作为 Bezier 右侧面板只有几百像素宽）。此时原偏移
   * 会让卡片越界 —— 表现为"左边一片空白、卡片挤在右侧、只能看到半张卡"。
   *
   * 判据是「有没有**完整**可见的节点」而非「有没有交集」：
   * 后者过于宽松，卡片露出一条边就算通过，实际上仍然不可用。
   *
   * 只在挂载后做一次：之后用户手动调整的视野必须被尊重。
   */
  const initialFitCheckedRef = React.useRef(false);
  React.useEffect(() => {
    if (initialFitCheckedRef.current) return;
    if (nodes.length === 0) return;

    // 等 setViewport 与首次布局落定
    const timer = window.setTimeout(() => {
      const flow = document.querySelector('.react-flow');
      if (!(flow instanceof HTMLElement)) return;
      const bounds = flow.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      const elements = Array.from(flow.querySelectorAll('.react-flow__node'));
      // DOM 还没渲染出节点就不要落锁，留给下一次 nodes 变化重试，
      // 否则会出现"锁已置位但从未真正判定过"的空转。
      if (elements.length === 0) return;
      initialFitCheckedRef.current = true;

      const hasFullyVisibleNode = elements.some((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        return (
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom
        );
      });

      if (!hasFullyVisibleNode) {
        void fitView({ padding: 0.16, minZoom: 0.28, maxZoom: 1, duration: 220 });
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [nodes.length, fitView]);

  const applyLayout = React.useCallback((positions: CanvasLayoutPosition[]) => {
    if (!positions.length) return;
    const map = new Map(positions.map(position => [position.id, position]));
    const changed = nodes.some(node => {
      const next = map.get(node.id);
      return next && (Math.abs(next.x - node.position.x) > 0.01 || Math.abs(next.y - node.position.y) > 0.01);
    });
    if (!changed) return;
    // Only roots actually moved by this layout belong in its restore point.
    // Persisting parent-relative children here makes group commit treat them as moves.
    const snapshot = nodes.filter(node => map.has(node.id)).map(node => ({ id: node.id, x: node.position.x, y: node.position.y, parentId: node.parentId ?? null }));
    priorLayoutRef.current = snapshot;
    onPriorLayoutPersist?.(snapshot);
    setNodes(current => current.map(node => {
      const next = map.get(node.id);
      return next ? { ...node, position: { x: next.x, y: next.y } } : node;
    }));
    history.run(() => onNodePositionsCommit(positions));
  }, [history, nodes, onNodePositionsCommit, onPriorLayoutPersist, setNodes]);

  const sortByTaskType = React.useCallback(() => {
    applyLayout(computeTypePositions(nodes, edges));
    window.setTimeout(() => { void fitView({ padding: 0.16, minZoom: 0.02, maxZoom: 1, duration: 220 }); }, 60);
  }, [applyLayout, edges, fitView, nodes]);

  React.useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      getSelectedNodeIds: () => getNodes().filter(node => node.selected).map(node => node.id),
      zoomIn: () => { void zoomIn({ duration: 120 }); },
      zoomOut: () => { void zoomOut({ duration: 120 }); },
      zoomTo: (scale) => {
        const current = getViewport();
        void setViewport({ x: current.x, y: current.y, zoom: scale }, { duration: 160 });
      },
      fitView: () => {
        void fitView({ padding: 0.16, minZoom: 0.1, maxZoom: 1, duration: 220 });
      },
      activateNode: activateNodeById,
      focusNode: nodeId => focusNodesById([nodeId]),
      focusNodes: focusNodesById,
      screenToFlow: (clientX, clientY) => screenToFlowPosition({ x: clientX, y: clientY }),
      sortByConnections: () => {
        applyLayout(computeTidyPositions(nodes, edges));
        window.setTimeout(() => { void fitView({ padding: 0.16, minZoom: 0.02, maxZoom: 1, duration: 220 }); }, 60);
      },
      sortByTaskType,
      revertLayout: () => {
        const previous = priorLayoutRef.current ?? priorLayout;
        if (!previous) return;
        const currentRoots = new Set(nodes.filter(node => !node.parentId || !nodes.some(parent => parent.id === node.parentId)).map(node => node.id));
        const restorable = previous.filter(position => currentRoots.has(position.id) || (
          'parentId' in position && nodes.some(node => node.id === position.id && node.parentId === position.parentId)
        ));
        const map = new Map(restorable.map(position => [position.id, position]));
        setNodes(current => current.map(node => {
          const position = map.get(node.id);
          return position ? { ...node, position: { x: position.x, y: position.y } } : node;
        }));
        history.run(() => onNodePositionsCommit(restorable));
        priorLayoutRef.current = null;
        onPriorLayoutPersist?.(null);
        window.setTimeout(() => { void fitView({ padding: 0.16, minZoom: 0.02, maxZoom: 1, duration: 220 }); }, 60);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [activateNodeById, apiRef, applyLayout, edges, fitView, focusNodesById, getViewport, getNodes, history, nodes, onNodePositionsCommit, onPriorLayoutPersist, priorLayout, screenToFlowPosition, setViewport, sortByTaskType, zoomIn, zoomOut, setNodes]);

  // Opening drawers or resizing panels changes the available area, not the
  // user's camera. Keep pan/zoom unchanged; explicit navigation commands and
  // the one-time visibility recovery above own viewport fitting.

  // 派生卡「首次出现」时做一次居中：对齐到根方案卡水平中心线，然后把结果持久化
  // （写回 positionsRef → 下次 build 时 autoCenter=false）。一旦居中并记入 centeredRef，
  // 该卡永不再被自动移动 —— 从根上杜绝「拖前面的，后面跟着动」的联动。
  React.useEffect(() => {
    if (draggingRef.current) return;
    const DERIVED = new Set(['workflowStage', 'workflowPending', 'resultCard']);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const rootOf = (node: Node): Node | undefined => {
      let cur: Node | undefined = node;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.type === 'workbenchCard') return cur;
        const parentId = (cur.data as { parentId?: string } | undefined)?.parentId;
        if (!parentId) return undefined;
        cur = byId.get(parentId);
      }
      return undefined;
    };

    let patched: Array<{ id: string; x: number; y: number }> | null = null;
    for (const node of nodes) {
      if (!DERIVED.has(node.type || '') || node.parentId?.startsWith('workflow-run-group-')) continue;
      const data = node.data as { autoCenter?: boolean; parentId?: string };
      // 用户已定位（autoCenter=false）或本会话已居中过的卡，一律不再自动动
      if (!data.autoCenter || centeredRef.current.has(node.id)) continue;
      const childH = node.measured?.height;
      const root = rootOf(node);
      const rootH = root?.measured?.height;
      if (!childH || !rootH || !root) continue; // 尺寸还没测出来，等下一帧再处理（暂不标记）
      const targetY = root.position.y + rootH / 2 - childH / 2;
      centeredRef.current.add(node.id); // 尺寸就绪，标记为已处理，之后不再触碰
      (patched ??= []).push({ id: node.id, x: node.position.x, y: targetY });
    }
    if (patched) {
      const map = new Map(patched.map(p => [p.id, p]));
      setNodes(current => current.map(n => {
        const p = map.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      }));
      // 持久化居中结果：写回 positionsRef，desiredNodes 不会再把它重置回顶部
      onNodePositionsCommit(patched.map(p => ({ id: p.id, x: p.x, y: p.y })));
    }
  }, [nodes, setNodes, onNodePositionsCommit]);

  const onNodesChange: OnNodesChange<Node> = React.useCallback((changes) => {
    setNodes(current => {
      const safe = changes.filter(c => c.type !== 'remove' || current.find(n => n.id === c.id)?.deletable !== false);
      const moving = new Set(safe.flatMap(c => c.type === 'position' && (c.dragging || (dragBaseline.current && c.dragging === false)) ? [c.id] : []));
      if (moving.size && !dragBaseline.current) dragBaseline.current = current;
      let next = applyNodeChanges(safe, current);
      if (moving.size) next = followStoryboardDrag(next, current, moving);
      next = fitStoryboardDragBounds(next);
      liveDragNodes.current = next;
      return next;
    });
    const started = changes.some(change => change.type === 'position' && change.dragging === true);
    const ended = changes.some(change => change.type === 'position' && change.dragging === false);
    if (started) {
      draggingRef.current = true;
      syncInteractionActivity();
    }
    if (ended) {
      // React Flow normally follows this batch with onNodeDragStop, which is
      // the single persistence path. Release a stuck interaction only when a
      // canceled drag never emits drag-stop.
      window.setTimeout(() => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        dragBaseline.current = null;
        syncInteractionActivity();
      }, 0);
    }
  }, [setNodes, syncInteractionActivity]);

  /**
   * React Flow 拖拽中的 position change 只用来驱动画面。最终坐标以
   * drag-stop 为准持久化，避免某些节点/多选拖拽没有在最后一批
   * onNodesChange 里携带 position，随后又被 desiredNodes 的旧坐标覆盖。
   */
  const onNodeDragStop: OnNodeDrag<Node> = React.useCallback((_event, node, draggedNodes) => {
    draggingRef.current = false;
    const stoppedNodes = draggedNodes.length > 0 ? draggedNodes : [node];
    const positions = Array.from(new Map(stoppedNodes.map(item => [
      item.id,
      { id: item.id, x: item.position.x, y: item.position.y },
    ])).values());
    if (dragBaseline.current) {
      const old = new Map(dragBaseline.current.map(n => [n.id, n]));
      const live = liveDragNodes.current;
      const touchedGroups = live.filter(n => n.type === 'storyboardGallery' && (
        n.position.x !== old.get(n.id)?.position.x || n.position.y !== old.get(n.id)?.position.y ||
        live.some(c => c.parentId === n.id && (c.position.x !== old.get(c.id)?.position.x || c.position.y !== old.get(c.id)?.position.y))));
      const touched = new Set(touchedGroups.map(g => g.id));
      for (const n of live.filter(n => touched.has(n.id) || (n.parentId && touched.has(n.parentId)))) {
        const value = { id: n.id, x: n.position.x, y: n.position.y };
        const index = positions.findIndex(p => p.id === n.id);
        if (index >= 0) positions[index] = value; else positions.push(value);
      }
    }
    dragBaseline.current = null;
    if (positions.length > 0) history.run(() => onNodePositionsCommit(positions));
    syncInteractionActivity();
  }, [history, onNodePositionsCommit, syncInteractionActivity]);

  /**
   * 旧行为由 React Flow 先删内部列表，却不触碰业务状态与服务器快照；
   * 下一次新增触发 desiredNodes 对账时，节点便全部“复活”。现在关闭内置删除，
   * 统一经这里调用各类节点自己的持久化删除回调。
   */
  const persistNodeDeletion = React.useCallback((deletedNodes: Node[]) => {
    canvasRootRef.current?.focus({ preventScroll: true });
    history.run(() => {
    const removedRunGroups = new Set(deletedNodes.filter(node => node.type === 'workflowRunGroup').map(node => node.id));
    for (const node of deletedNodes) {
      if (node.parentId && removedRunGroups.has(node.parentId)) continue;
      if (node.deletable === false || node.type === 'storyboardAssetGroup') continue;
      if (node.type === 'workbenchCard') {
        const data = node.data as WorkbenchCardData;
        data.onRemove(data.instance);
        continue;
      }
      if (node.type === 'basicCanvas') {
        const data = node.data as BasicCanvasNodeData;
        data.onRemove(data.node.id);
        continue;
      }
      if (node.type === 'imageAsset') {
        const data = node.data as ImageAssetData;
        data.onRemove(data.image.id);
        continue;
      }
      if (node.type === 'imageGroup') {
        const data = node.data as ImageGroupData;
        data.onUngroup(data.group.id);
      }
      if (node.type === 'workflowRunGroup') {
        (node.data as WorkflowRunGroupData).onRemove();
      }
      if (node.type === 'organizationGroup') {
        (node.data as OrganizationGroupData).onDissolve();
      }
    }
    });
  }, [history]);

  React.useEffect(() => {
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.closest('.xy-flow-host') || target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], .clip-canvas-node')) return;
      // Keep a stable selection fallback. React Flow selection is local UI
      // state, while node data is reconciled from persisted canvas state; a
      // data refresh must not make Delete silently miss the card the user just
      // selected while card data refreshes frequently.
      const selectedNodes = nodes.filter(node => (
        node.selected || selectedNodeIdsRef.current.has(node.id)
      ));
      if (!selectedNodes.length) return;
      const deletableNodes = selectedNodes.filter(node => (
        node.type === 'workbenchCard'
        || node.type === 'basicCanvas'
        || node.type === 'imageAsset'
        || node.type === 'imageGroup'
        || node.type === 'organizationGroup'
        || node.type === 'workflowRunGroup'
      ));
      if (!deletableNodes.length) return;
      event.preventDefault();
      persistNodeDeletion(deletableNodes);
    };
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [nodes, persistNodeDeletion]);

  const persistEdges = React.useCallback((next: Edge[]) => {
    const serialized = fromRFEdges(next);
    if (edgesEqual(serialized, desiredEdges)) return;
    skipEdgeEcho.current = true;
    history.run(() => onEdgesChangePersist(serialized));
  }, [desiredEdges, history, onEdgesChangePersist]);

  const isValidConnection = React.useCallback((connection: Connection | Edge) => {
    const sourceNode = nodes.find(node => node.id === connection.source);
    const targetNode = nodes.find(node => node.id === connection.target);
    const sourceKind = sourceNode?.type === 'basicCanvas'
      ? (sourceNode.data as BasicCanvasNodeData).node.kind
      : undefined;
    const targetKind = targetNode?.type === 'basicCanvas'
      ? (targetNode.data as BasicCanvasNodeData).node.kind
      : undefined;
    if (!sourceNode || !targetNode) return false;
    if (targetNode.type === 'organizationGroup') return false;
    if (sourceNode.type === 'organizationGroup') {
      if (!(sourceNode.data as OrganizationGroupData).referenceReady) return false;
      if (!(targetKind === 'page' || (targetNode.type === 'workbenchCard' && (targetNode.data as WorkbenchCardData).instance.kind === 'visual'))) return false;
    }
    const membershipEdges = nodes.filter(node => node.parentId).map(node => ({ id: `membership:${node.id}`, source: node.id, target: node.parentId! }));
    return !canvasConnectionError(connection, [...edgesRef.current, ...membershipEdges], sourceKind, targetKind, reconnectingIdRef.current);
  }, [nodes]);

  const onConnect = React.useCallback((connection: Connection) => {
    if (connectionCancelledRef.current) return;
    if (!isValidConnection(connection)) return;
    const next = addEdge({
      ...connection,
      id: `e-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
      data: { connectedAt: Date.now() },
    }, edgesRef.current);
    edgesRef.current = next;
    setEdges(next);
    persistEdges(next);
    setConnectionNotice(xy().connectedNoAuto);
  }, [isValidConnection, persistEdges]);

  const disconnectEdge = React.useCallback((id: string) => {
    if (isGeneratedCanvasEdge(id)) return;
    const next = edgesRef.current.filter(edge => edge.id !== id);
    edgesRef.current = next;
    setEdges(next);
    persistEdges(next);
    setConnectionNotice(xy().disconnectedKept);
  }, [persistEdges]);

  const onReconnect = React.useCallback((edge: Edge, connection: Connection) => {
    if (connectionCancelledRef.current) return;
    if (isGeneratedCanvasEdge(edge.id)) return;
    reconnectingIdRef.current = edge.id;
    if (!isValidConnection(connection)) return;
    const next = edgesRef.current.map(item => item.id === edge.id
      ? { ...item, ...connection, data: { ...item.data, connectedAt: Date.now() } } : item);
    edgesRef.current = next;
    setEdges(next);
    persistEdges(next);
    setConnectionNotice(xy().relinkedKept);
  }, [isValidConnection, persistEdges]);

  const onEdgesChange = React.useCallback((changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, edgesRef.current);
    edgesRef.current = next;
    setEdges(next);
    const structural = changes.some(change => change.type === 'remove' || change.type === 'add' || change.type === 'replace');
    if (structural) persistEdges(next);
  }, [persistEdges]);

  const onMoveStart = React.useCallback(() => {
    movingRef.current = true;
    syncInteractionActivity();
    if (movementIdleTimer.current) clearTimeout(movementIdleTimer.current);
    // Interrupted programmatic zoom may omit move-end. Refresh only after
    // viewport movement has actually gone quiet; node drag remains independent.
    movementIdleTimer.current = setTimeout(() => {
      movingRef.current = false;
      syncInteractionActivity();
    }, 200);
  }, [syncInteractionActivity]);

  const pendingViewport = React.useRef<{ save: () => void; cancel: () => void } | null>(null);
  React.useEffect(() => {
    const flushViewport = () => {
      const pending = pendingViewport.current;
      pendingViewport.current = null;
      pending?.cancel();
      pending?.save();
    };
    const onVisibility = () => { if (document.hidden) flushViewport(); };
    window.addEventListener('pagehide', flushViewport);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flushViewport();
      window.removeEventListener('pagehide', flushViewport);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const onMoveEnd = React.useCallback((_: unknown, next: RFViewport) => {
    if (movementIdleTimer.current) clearTimeout(movementIdleTimer.current);
    movingRef.current = false;
    syncInteractionActivity();
    if (!viewportReady.current) return;
    pendingViewport.current?.cancel();
    const save = () => onViewportPersist({ x: next.x, y: next.y, scale: next.zoom });
    const cancel = idleWork.schedule(() => {
      pendingViewport.current = null;
      save();
    }, 360);
    pendingViewport.current = { save, cancel };
  }, [onViewportPersist, syncInteractionActivity, idleWork]);

  const hasCanvasDrop = React.useCallback((event: React.DragEvent) => (
    Array.from(event.dataTransfer?.types || []).some(type => (
      type === 'Files' || type === PROJECT_FILE_DRAG_MIME || type === PERSONAL_ASSET_DRAG_MIME
    ))
  ), []);

  const onDragEnter = React.useCallback((event: React.DragEvent) => {
    if (!hasCanvasDrop(event)) return;
    event.preventDefault();
    fileDragDepth.current += 1;
    setIsFileDrag(true);
  }, [hasCanvasDrop]);

  const onDragOver = React.useCallback((event: React.DragEvent) => {
    if (!hasCanvasDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [hasCanvasDrop]);

  const onDragLeave = React.useCallback((event: React.DragEvent) => {
    if (!hasCanvasDrop(event)) return;
    event.preventDefault();
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setIsFileDrag(false);
  }, [hasCanvasDrop]);

  const onDrop = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    fileDragDepth.current = 0;
    setIsFileDrag(false);
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const personalAsset = event.dataTransfer?.getData(PERSONAL_ASSET_DRAG_MIME);
    if (personalAsset) {
      try {
        const value = JSON.parse(personalAsset);
        if (typeof value.id === 'string' && value.projectId === getCanvasHostContext().projectId) window.dispatchEvent(new CustomEvent(PERSONAL_ASSET_DROP_EVENT, { detail: { id: value.id, projectId: value.projectId, clientX: event.clientX, clientY: event.clientY } }));
      } catch { /* Ignore foreign or malformed drags. */ }
      return;
    }
    const projectFile = parseProjectFileDragPayload(
      event.dataTransfer?.getData(PROJECT_FILE_DRAG_MIME) || '',
    );
    if (projectFile) {
      onProjectFileDrop?.(projectFile, flow);
      return;
    }
    if (!onFilesDrop) return;
    const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    onFilesDrop(files, flow);
  }, [onFilesDrop, onProjectFileDrop, screenToFlowPosition]);

  const onSelectionChange = React.useCallback((params: OnSelectionChangeParams) => {
    selectedNodeIdsRef.current = new Set(params.nodes.map(node => node.id));
  }, []);

  function groupSelection() {
    if (onGroupSelection) {
      try {
        const error = onGroupSelection(selectedNodes);
        if (error) setConnectionNotice(error);
      } catch (error) {
        setConnectionNotice(error instanceof Error ? error.message : xy().groupFailed);
      }
      return;
    }
    if (!onGroupSelectedImages || selectedImageIds.length < 2) {
      setConnectionNotice(xy().groupNeedImages);
      return;
    }
    try {
      const geometry = selectedNodes.flatMap(node => {
        const width = node.measured?.width ?? node.width;
        const height = node.measured?.height ?? node.height;
        return width && height ? [{ id: node.id, ...node.position, width, height }] : [];
      });
      const error = onGroupSelectedImages(selectedImageIds, geometry);
      if (error) setConnectionNotice(error);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : xy().groupFailed);
    }
  }

  const clearCanvasSelection = React.useCallback(() => {
    pendingActivationNodeIdRef.current = null;
    selectedNodeIdsRef.current = new Set();
    setNodes(current => current.map(node => node.selected ? { ...node, selected: false } : node));
    setEdges(current => current.map(edge => edge.selected ? { ...edge, selected: false } : edge));
    canvasRootRef.current?.focus({ preventScroll: true });
  }, [setNodes]);

  const onNodeClick = React.useCallback((event: React.MouseEvent, clickedNode: Node) => {
    // A click on a non-focusable image frame does not naturally blur the
    // textarea used by the previously selected card. Without this, the next
    // Delete/Backspace is still targeted at that stale textarea and the canvas
    // correctly (but confusingly) refuses to delete the newly selected card.
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = event.target instanceof globalThis.Node ? event.target : null;
    if (
      active?.closest('input, textarea, select, [contenteditable="true"]')
      && target
      && !active.contains(target)
    ) {
      active.blur();
    }

    // Image cards use their frame as a drag handle and disable select-on-drag.
    // Depending on where the click lands, React Flow therefore does not always
    // commit a selection change. Make click selection explicit so keyboard
    // actions have one reliable target. Shift keeps the existing multi-select
    // behavior and toggles the clicked node.
    pendingActivationNodeIdRef.current = null;
    // Use the gesture's original selection, not React Flow's keyboard-store
    // timing. Modifier clicks must toggle identically for every node surface.
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const previousSelection = pointerSelectionRef.current ?? selectedNodeIdsRef.current;
    pointerSelectionRef.current = null;
    if (additive) {
      const nextSelection = new Set(previousSelection);
      if (nextSelection.has(clickedNode.id)) nextSelection.delete(clickedNode.id);
      else nextSelection.add(clickedNode.id);
      selectedNodeIdsRef.current = nextSelection;
      setNodes(current => current.map(node => node.selected === nextSelection.has(node.id)
        ? node : { ...node, selected: nextSelection.has(node.id) }));
      return;
    }
    setEdges(current => current.map(edge => edge.selected ? { ...edge, selected: false } : edge));
    setNodes(current => {
      const selectedIds = new Set<string>();
      const next = current.map(node => {
        const selected = node.id === clickedNode.id;
        if (selected) selectedIds.add(node.id);
        return node.selected === selected ? node : { ...node, selected };
      });
      selectedNodeIdsRef.current = selectedIds;
      return next;
    });
  }, [setNodes]);

  const onNodeDoubleClick = React.useCallback((_: React.MouseEvent, clickedNode: Node) => {
    if (clickedNode.type === 'organizationGroup' || clickedNode.type === 'imageGroup' || nodes.some(node => node.id === clickedNode.parentId && (node.type === 'organizationGroup' || node.type === 'imageGroup'))) {
      activateNodeById(clickedNode.id);
      return;
    }
    focusNodesById([clickedNode.id]);
  }, [activateNodeById, focusNodesById, nodes]);

  return (
    <div
      ref={canvasRootRef}
      className={`flow-canvas xy-flow-host mode-${isHandMode ? 'hand' : 'pointer'}${isConnecting ? ' is-connecting' : ''}${isFileDrag ? ' is-file-drag' : ''}${selectedNodes.length > 1 ? ' has-multiselection' : ''}`}
      style={{ containerType: 'inline-size' }}
      data-canvas-tone={tone}
      tabIndex={-1}
      onDoubleClickCapture={event => {
        // Only the bare pane owns this shortcut. Node editors, edges and
        // overlays keep their own double-click behavior.
        if (!onAddNode || event.button !== 0 || !(event.target instanceof Element)
          || !event.target.classList.contains('react-flow__pane')) return;
        event.preventDefault();
        event.stopPropagation();
        clearCanvasSelection();
        const screen = { x: event.clientX, y: event.clientY };
        setPaneMenu({ open: true, screen, flow: screenToFlowPosition(screen) });
      }}
      onPointerDownCapture={event => {
        // Node labels and drag handles include SVG paths, not only HTML elements.
        // They must transfer focus to the card just like clicks on its frame.
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest('.xy-flow-host')) return;
        pointerSelectionRef.current = target.closest('.react-flow__node')
          ? new Set(selectedNodeIdsRef.current) : null;
        if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;
        (target?.closest<HTMLElement>('[tabindex]') ?? event.currentTarget).focus({ preventScroll: true });
      }}
      onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target?.closest('.xy-flow-host') || target.closest(CANVAS_OVERLAY_SELECTOR)) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (isConnecting) {
            connectionCancelledRef.current = true;
            cancelConnection?.();
            setIsConnecting(false);
            setConnectionNotice(xy().cancelConnectKept);
            return;
          }
          if (releaseCanvasInputFocus(target)) return;
          clearCanvasSelection();
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey
          && !target.closest(CANVAS_INPUT_SELECTOR) && !nodes.some(node => node.selected)) {
          const selectedEdges = edgesRef.current.filter(edge => edge.selected && !isGeneratedCanvasEdge(edge.id));
          if (selectedEdges.length) {
            event.preventDefault();
            event.stopPropagation();
            const ids = new Set(selectedEdges.map(edge => edge.id));
            const next = edgesRef.current.filter(edge => !ids.has(edge.id));
            edgesRef.current = next;
            setEdges(next);
            persistEdges(next);
            setConnectionNotice(xy().disconnectedKept);
            return;
          }
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g'
          && !event.shiftKey && !target.closest(CANVAS_INPUT_SELECTOR)) {
          event.preventDefault();
          event.stopPropagation();
          groupSelection();
          return;
        }
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
        if (target.closest(CANVAS_INPUT_SELECTOR) || target.closest('.clip-canvas-node')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) history.redo(); else history.undo();
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <CanvasEdgeActions.Provider value={disconnectEdge}>
      <CanvasSourceMenuRequest.Provider value={sourceMenuRequest}>
      <CanvasGroupMemberAction.Provider value={onRemoveGroupMembers && selectedNodes.length === 1 && selectedNodes[0]?.parentId && nodes.some(parent => parent.id === selectedNodes[0]!.parentId && (parent.type === 'organizationGroup' || parent.type === 'imageGroup'))
        ? { nodeId: selectedNodes[0]!.id, onRemove: () => onRemoveGroupMembers([selectedNodes[0]!.id]) } : null}>
      <CanvasComposerFocusProvider activeOwnerId={activeComposerOwnerId}>
      <CanvasRenderPolicyProvider activeNodeId={activeComposerOwnerId}>
        <ReactFlow
          nodes={highlightedNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          edgeTypes={FLOW_EDGE_TYPES}
          onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={() => { connectionCancelledRef.current = false; setIsConnecting(true); setConnectionNotice(xy().connectHint); }}
          onConnectEnd={(event, state) => {
            setIsConnecting(false);
            if (connectionCancelledRef.current) return;
            if (!state.isValid && state.fromHandle?.type === 'source' && event.target instanceof HTMLElement && event.target.closest('.react-flow__pane') && state.fromNode) {
              setSourceMenuRequest({ nodeId: state.fromNode.id, nonce: Date.now() });
              setConnectionNotice(xy().pickDownstream);
              return;
            }
            if (!state.isValid) setConnectionNotice(xy().invalidConnect);
          }}
          onReconnect={onReconnect}
          onReconnectStart={(_event, edge) => { connectionCancelledRef.current = false; reconnectingIdRef.current = edge.id; setIsConnecting(true); }}
          onReconnectEnd={() => { reconnectingIdRef.current = undefined; setIsConnecting(false); }}
          isValidConnection={isValidConnection}
          onMoveStart={onMoveStart}
          onMove={onMoveStart}
          onMoveEnd={onMoveEnd}
          onNodeClick={onNodeClick}
          onPaneClick={clearCanvasSelection}
          onNodeDoubleClick={onNodeDoubleClick}
          onSelectionChange={onSelectionChange}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          deleteKeyCode={null}
          selectNodesOnDrag={false}
          selectionOnDrag={!isHandMode}
          selectionMode={SelectionMode.Partial}
          panOnDrag={isHandMode}
          panActivationKeyCode={null}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={!onAddNode}
          minZoom={0.02}
          maxZoom={4}
          proOptions={FLOW_PRO_OPTIONS}
          defaultEdgeOptions={FLOW_DEFAULT_EDGE_OPTIONS}
          connectionLineComponent={CanvasConnectionLine}
          connectionLineStyle={FLOW_CONNECTION_LINE_STYLE}
        >
          {background !== 'none' && (
            <AdaptiveCanvasBackground pattern={background} />
          )}
        </ReactFlow>
      </CanvasRenderPolicyProvider>
      </CanvasComposerFocusProvider>
      </CanvasGroupMemberAction.Provider>
      </CanvasSourceMenuRequest.Provider>
      </CanvasEdgeActions.Provider>
      {connectionNotice && <div className="canvas-connection-notice" role="status">{connectionNotice}</div>}

      <div className="xy-drop-hint" aria-hidden="true" />

      <CanvasSelectionToolbar nodes={selectedNodes} onGroup={groupSelection} onClear={clearCanvasSelection}
        groupLabel={selectedNodes.some(node => node.type === 'organizationGroup' || node.type === 'imageGroup') ? selectionChrome.moveIntoGroup : selectionChrome.group}
        onRemoveMembers={onRemoveGroupMembers && selectedNodes.length > 1 && selectedNodes.every(node => node.parentId && nodes.some(parent => parent.id === node.parentId && (parent.type === 'organizationGroup' || parent.type === 'imageGroup')))
          ? () => onRemoveGroupMembers(selectedNodes.map(node => node.id)) : undefined} />

      {empty && <CanvasEmptyState canDropFiles={Boolean(onFilesDrop)} />}
      {onAddNode && typeof document !== 'undefined' && createPortal(
        <CanvasAddNodeMenu
          open={paneMenu.open}
          onOpenChange={open => setPaneMenu(current => ({ ...current, open }))}
          side="bottom"
          scale={paneMenuScale}
          trigger={<span
            className={addMenuStyles.pointerAnchor}
            style={{ left: paneMenu.screen.x, top: paneMenu.screen.y }}
            tabIndex={-1}
            aria-hidden="true"
            onFocus={() => canvasRootRef.current?.focus({ preventScroll: true })}
          />}
          onAddNode={kind => {
            // A deliberate pointer placement must not trigger the initial
            // offscreen-content recovery when adding to an empty canvas.
            initialFitCheckedRef.current = true;
            onAddNode(kind, paneMenu.flow);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

export function XyFlowCanvas(props: CanvasSurfaceProps) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}
