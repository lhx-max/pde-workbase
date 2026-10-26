'use client';

import type { ProjectFileCanvasAddOptions } from '@bezier/contracts';
import { openCanvasImageEditor } from './platform/image-app';

import { workflowGroupRuns, activeWorkflowGroups, dismissedWorkflowNodeIds, workflowRunConnections, arrangeWorkflowMembers, workflowRunGroupId, workflowQuestionNodeId, workflowNodeOwners, reconcileWorkflowGroups, workflowGroupMoves, type WorkflowRunGroupLayout } from './workbench/workflow-run-group';
import type { WorkflowCanvasRun } from '@bezier/contracts';
import { PROJECT_LAYOUT, projectLayoutPath } from '@bezier/contracts';
import { storyboardStackStatus } from './workbench/storyboard-stack-state';

import React from 'react';
import { CanvasAddNodeMenu } from './workbench/CanvasAddNodeMenu';
import { localizeDaemonMessage } from './locales/daemon-messages';
import { storyboardVersionAttachments, submitStoryboardVersion } from './workbench/storyboard-version-generation';
import { applyCanvasImageReplacement } from './workbench/canvas-image-replacement';
import { duplicateCanvasPage } from './workbench/canvas-page-duplication';
import { commitCanvasImageEdit } from './workbench/canvas-image-edit';
import { isVisualModelEnabled, visualModelToNativeMediaModel } from './workbench/visual-model-routing';
import { failCanvasCutout, submitCanvasCutout } from './workbench/canvas-cutout-submission';
import { canvasArtifactProjection, withCanvasResultHistory } from '@bezier/contracts';
import { groupCandidateReason, planGroupGeometry, planGroupDissolve, type GroupMemberGeometry } from './workbench/canvas-group-operations';
import { addOrganizationMembers, removeOrganizationMembers, createOrganizationGroup, organizationMembers, organizationMove, moveRelativeGroupMembers, type OrganizationGroup } from './workbench/canvas-organization-groups';
import { snapshotImageGroupReferences } from './workbench/canvas-group-reference';
import { STORYBOARD_ASSETS_STATE_KEY, type StoryboardAsset } from '@bezier/contracts';
import { assetsForStoryboard, snapshotStoryboard, storyboardAssetPrompt, storyboardAssetImageRatio, storyboardAssetGenerationAttachments, isolateStoryboardAssets, reconcileStoryboardAssetImages, setStoryboardAssetAssociation, storyboardShotReferences, storyboardReferenceContext, storyboardReferenceImage, storyboardReferenceImageLabels } from './workbench/storyboard-assets';
import { storyboardGroupId } from './workbench/StoryboardAssetGroupNode';
import { commitGalleryPositions, layoutStoryboardGalleries, storyboardGroupChainEdges, storyboardRelationGalleryLinks, visibleStoryboardEdges } from './workbench/storyboard-gallery';
import { useStoryboardRelations } from './workbench/useStoryboardRelations';
import { selectedStoryboardShotImage, storyboardFrame, patchStoryboardFrame, storyboardVideoFrames } from './workbench/storyboard-shot-images';
import { StoryboardRelationOverlay } from './workbench/StoryboardRelationOverlay';
import type { BasicCanvasNodeData } from './workbench/BasicCanvasNode';
import { Button, CanvasViewToolbar } from '@bezier/components';
import type {
  ProjectFile,
  ProjectFileDragPayload,
  WorkflowResultArtifact,
  WorkflowResultInteractionResponse,
  WorkflowResultSyncDetail,
} from '@bezier/contracts';
import {
  WORKFLOW_RESULT_SYNC_EVENT,
  PROJECT_FILE_ADD_TO_CANVAS_EVENT,
  parseProjectFileDragPayload,
  workflowResultSupportsSurface,
} from '@bezier/contracts';
import {
  getCanvasHostContext,
  projectApiFetch,
  platformFetch,
  projectFetch,
  projectFileUrl,
  resolveCanvasImageSrc,
} from './platform/api-base';
import {
  submitAgentTask,
  stageHostChatAttachments,
  type AgentTaskDisplay,
  type CanvasArtifactGenerationResult,
  type CanvasTextGenerationResult,
} from './platform/agent-bridge';
import { useCanvasHistory, useCanvasState, useCanvasFlush, useCanvasSnapshot } from './platform/canvas-compat';
import { useCanvasMediaSubmission } from './platform/media-submission';
import { useCanvasMediaCatalog } from './platform/media-catalog';
import { resolveVisualModelSelection } from './workbench/visual-model-routing';
import { uploadCanvasAttachment } from './platform/canvas-file-upload';
import { HTML_PAGE_CARD_SIZE } from './workbench/visual-node-size';
import {
  requireCanvasPopoverRenderer,
  useCanvasUiHost,
} from './platform/ui-host';
import { applyCanvasTextGenerationResults } from './workbench/canvas-text-generation';
import { useCanvasTextDocumentChange } from './workbench/useCanvasTextDocumentChange';
import {
  applyCanvasTextDocumentChange,
  canvasTextPatchWithCopyOnWrite,
  shareCanvasTextForDuplicate,
} from './workbench/model/canvas-text-files';
import { registerCanvasObjects, canvasObjectReference } from './platform/object-bridge';
import { acceptsCanvasGenerationPatch } from './workbench/canvas-generation-patch';
import {
  isCanvasArtifactFile,
  projectFileArtifactDescriptor,
  type CanvasArtifactLaunchRequest,
} from './workbench/canvas-artifact';
import {
  linkedAttachmentsByTarget,
  resolveCanvasSourceAttachments,
  sameLinkedAttachments,
} from './workbench/canvas-linked-attachments';
import {
  inheritConnectedVisualDraftSettings,
  resolveConnectedVisualSourceDraft,
} from './workbench/connected-visual-draft';
import { embedLegacyPrimaryImages } from './workbench/image-primary-state';
import { recoverNativeImageOutput } from './workbench/native-media-recovery';
import { persistImageTarget } from './workbench/image-submission-persistence';
import {
  IpHand,
  IpMinus,
  IpPlus,
  IpPointer,
  IpTidy,
} from './icons/ip';
import { Icon } from './ui/Icon';
import {
  XyFlowCanvas,
  buildCardNode,
  buildWorkflowPendingNode,
  buildWorkflowStageNode,
  buildImageGroupNode,
  buildImageNode,
  buildBasicCanvasNode,
  STORYBOARD_CARD_DEFAULT_HEIGHT,
  STORYBOARD_CARD_DEFAULT_WIDTH,
  STORYBOARD_SOURCE_EXAMPLE,
  TEXT_CARD_DEFAULT_HEIGHT,
  TEXT_CARD_DEFAULT_WIDTH,
  createCanvasArtifactNode,
  creativeNodeId,
  topicNodeId,
  productNodeId,
  workflowStageNodeId,
  workflowResultItemHandleId,
  articleNodeId,
  evaluationNodeId,
  imageFileUrl,
  getImageDisplaySize,
  layoutGroupMembers,
  type CanvasEdge,
  type CanvasInstance,
  type CanvasViewport,
  type CanvasLayoutPosition,
  type CanvasInteractionMode,
  type CanvasBasicNode,
  type CanvasBasicNodeKind,
  type FlowCanvasApi,
  type ImageGroup,
  type InstanceKind,
  type WorkbenchImage,
  type WorkbenchPromptCard,
  type ContinueGenerateParams,
  type ImageConnectedNodeKind,
  type ImageConnectedNodeOrigin,
  type WorkflowStageInteraction,
} from './workbench/XyFlowCanvas';
import { findStoryboardPairPlacement } from './workbench/storyboard-pair-placement';
import type { WorkflowEditorConfig } from '@bezier/workbench-core';
import { buildAnnotationRegenerateTarget } from './workbench/annotation-regenerate';
import { getVideoFrameSize } from './workbench/video-frame-size';
import {
  WORKFLOW_RESULT_FALLBACK_ORIGIN,
  resolveWorkflowBranchPosition,
  resolveWorkflowResultPositions,
  type WorkflowResultPosition,
} from './workbench/workflow-result-layout';
import { materializedWorkflowArtifactLineage } from './workbench/workflow-artifact-lineage';
import {
  placeCardInViewport,
  type CanvasRect,
} from './workbench/viewport-card-placement';
import {
  deriveImageLineage,
  reconcileImageLineageEdges,
  resolveGenerationParent,
  resolveChildImageColumnX,
  resolveImageGenerationLineage,
} from './workbench/image-generation-lineage';
import type { CanvasReferenceResource, ReferenceUploadFiles } from './workbench/ImageReferenceResourcePicker';
// 回主页要用的路由与图标（画布顶栏的返回入口）
import type { CanvasWorkflowPendingRequest } from './CanvasWorkbenchSurface';
import type { TextDocumentChange } from './platform/artifact-bridge';
import type { CanvasImageGenerationLaunchRequest } from './workbench/image-generation-launch';
import { cloneStoryboardPlan, parseSavedStoryboardPlan } from './workbench/storyboard-card';
import { prepareReportStoryboards, submitReportStoryboards, isPendingReportStoryboard } from './workbench/report-storyboard-handoff';
import { placeNewStoryboardBranch } from './workbench/canvas-flow-layout';
import {
  createPresentationGenerationTask,
  type CanvasPresentationGenerationLaunchRequest,
} from './workbench/presentation-generation-launch';
import {
  canvasNodeDefaultTitle,
  type CanvasNodeCreationKind,
  type CanvasNodeCreationRequest,
} from './workbench/canvas-node-catalog';
import { useCanvasLocale } from './platform/canvas-locale';
import { canvasAddNodeChrome } from './locales/node-catalog';
import { workbenchShell } from './locales/workbench-shell';
import { workbenchShellExtra } from './locales/workbench-shell-extra';
import type {
  ActiveImageTask,
  TaskAttachment,
  TaskDraft,
  TaskDrafts,
  VisualBusiness,
  VisualModel,
  VisualResolution,
} from './workbench/model/canvas-domain';
import {
  backendStyleId,
  deliveryPendingHasMaterialized,
  genericWorkflowAgentBinding,
  nativeMediaTaskAsImageTask,
  normalizeTaskDrafts,
  sameViewportValue,
  workflowInitialPendingNodeId,
  workflowPendingArtifactPosition,
  workflowRegenerationPendingNodeId,
  type ImageTask,
  type NativeMediaTask,
  type PendingWorkflowGeneration,
} from './workbench/model/workbench-model';

// 团队知识库管理台。整页体量不小且不是主路径，懒加载，别拖慢画布首屏。

type Viewport = CanvasViewport;

const EMPTY_WORKFLOW_RUNS: WorkflowCanvasRun[] = [];
const CANVAS_WORKFLOW_AGENT_TERMINAL_EVENT = 'bezier-design:canvas-workflow-agent-terminal';

/**
 * A direct delivery is materialized by the daemon, so its loader has to use
 * the same deterministic position calculation as `canvas-state.ts`. Otherwise
 * the real card appears in a second, distant slot instead of taking the
 * skeleton over.
 */
function useEffectEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const handlerRef = React.useRef(handler);
  // 用 layout effect 而非 effect：确保同一次提交内后续读取到的已是新实现。
  React.useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  return React.useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

function cardMeta(locale?: string | null): Record<InstanceKind, { title: string; eyebrow: string; description: string; accent: string }> {
  const shell = workbenchShell(locale);
  return {
    plan: { title: shell.card.plan.title, eyebrow: 'PLAN', description: shell.card.plan.description, accent: 'plan' },
    visual: { title: shell.card.visual.title, eyebrow: 'VISUAL', description: shell.card.visual.description, accent: 'visual' },
    video: { title: shell.card.video.title, eyebrow: 'VIDEO', description: shell.card.video.description, accent: 'video' },
  };
}

type InstanceStatus =
  | 'draft'      // 未开始 / 空实例
  | 'inProgress' // 进行中
  | 'review'     // 待审 / 待确认
  | 'ready';     // 已完成

type InstanceMetric = { label: string; value: string };
type InstanceState = {
  status: InstanceStatus;
  statusLabel: string;
  progress: number;              // 0..1
  updatedAt: string;             // 人读时间
  metrics: InstanceMetric[];     // 2 条指标
  contributors?: string[];       // 头像文字
};

function statusMeta(locale?: string | null): Record<InstanceStatus, { label: string; dot: string; text: string; bg: string }> {
  const shell = workbenchShell(locale);
  return {
    draft:      { label: shell.status.draft, dot: '#b1b7c0', text: '#57606a', bg: 'rgba(87, 96, 106, 0.08)' },
    inProgress: { label: shell.status.inProgress, dot: '#7c7ff2', text: '#5457e6', bg: 'rgba(124, 127, 242, 0.12)' },
    review:     { label: shell.status.review, dot: '#a9abf6', text: '#5457e6', bg: 'rgba(124, 127, 242, 0.08)' },
    ready:      { label: shell.status.ready, dot: '#7c7ff2', text: '#5457e6', bg: 'rgba(124, 127, 242, 0.14)' },
  };
}

// 占位数据源 —— 后面接真实状态只要替换本函数
function getInstanceState(isSending = false, locale?: string | null): InstanceState {
  const shell = workbenchShell(locale);
  if (isSending) {
    return {
      status: 'inProgress',
      statusLabel: shell.status.waitingModel,
      progress: 0.08,
      updatedAt: shell.status.intakeSubmitted,
      metrics: [{ label: shell.status.task, value: '—' }, { label: shell.status.stage, value: shell.status.processing }],
    };
  }
  return {
    status: 'draft',
    statusLabel: shell.status.draft,
    progress: 0,
    updatedAt: shell.status.notStartedYet,
    metrics: [{ label: shell.status.task, value: '—' }, { label: shell.status.stage, value: shell.status.pendingSubmit }],
  };
}



function ToolIcon({ name }: { name: 'pointer' | 'hand' | 'minus' | 'plus' | 'tidy' | 'collapse' | 'expand' | 'chat' | 'chevronDown' | 'chevronUp' | 'chevronRight' | 'grid' | 'edges' | 'map' | 'dots' | 'blank' | 'shapes' | 'library' | 'revert' | 'close' | 'check' | 'folder' | 'help' | 'text' | 'storyboard' | 'page' | 'presentation' | 'image' | 'video' }) {
  if (name === 'pointer') return <IpPointer />;
  if (name === 'hand') return <IpHand />;
  if (name === 'minus') return <IpMinus />;
  if (name === 'plus') return <IpPlus />;
  if (name === 'tidy') return <IpTidy />;
  if (name === 'chevronDown') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'chevronRight') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 6.5 3.5 3.5L8 13.5" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'chevronUp') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6.5 12 3.5-3.5 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'grid') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5.5" height="5.5" rx=".7" fill="none" stroke="currentColor" strokeWidth="1.45" /><rect x="11.5" y="3" width="5.5" height="5.5" rx=".7" fill="none" stroke="currentColor" strokeWidth="1.45" /><rect x="3" y="11.5" width="5.5" height="5.5" rx=".7" fill="none" stroke="currentColor" strokeWidth="1.45" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx=".7" fill="none" stroke="currentColor" strokeWidth="1.45" /></svg>
  );
  if (name === 'edges') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.45" /><circle cx="15" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.45" /><circle cx="5" cy="15" r="2" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="m6.7 6.1 6.6 2.8M6.7 13.9l6.6-2.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>
  );
  if (name === 'map') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 5 4-2 6 2 4-2v12l-4 2-6-2-4 2V5Z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 3v12m6-10v12" fill="none" stroke="currentColor" strokeWidth="1.45" /></svg>
  );
  if (name === 'dots') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="5" r="1" fill="currentColor" /><circle cx="10" cy="5" r="1" fill="currentColor" /><circle cx="15" cy="5" r="1" fill="currentColor" /><circle cx="5" cy="10" r="1" fill="currentColor" /><circle cx="10" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" /><circle cx="5" cy="15" r="1" fill="currentColor" /><circle cx="10" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /></svg>
  );
  if (name === 'blank') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.45" /></svg>
  );
  if (name === 'shapes') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.45" /><rect x="10.5" y="10.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M12 5h4m-2-2v4" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>
  );
  if (name === 'library') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v11H4zM7 4.5v11m3-8h3" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'revert') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.2 7.2H3.5V4.5m0 2.7A6.5 6.5 0 1 1 5.4 14" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'close') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>
  );
  if (name === 'check') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.1 3.1 3.1L15.2 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'folder') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 6.4h5l1.6 1.9h7.8v7.3a1.5 1.5 0 0 1-1.5 1.5H4.3a1.5 1.5 0 0 1-1.5-1.5V7.9a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'help') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M7.8 7.6a2.35 2.35 0 0 1 4.4 1.15c0 1.65-2.2 1.8-2.2 3.35M10 14.2v.1" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>
  );
  if (name === 'text') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h12M10 4v12M7 16h6" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'storyboard') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.8" y="4" width="14.4" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7.5 4v12M12.5 4v12M2.8 8h14.4M2.8 12h14.4" fill="none" stroke="currentColor" strokeWidth="1.25" /></svg>
  );
  if (name === 'page') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M3 7.2h14" fill="none" stroke="currentColor" strokeWidth="1.35" /><circle cx="5.3" cy="5.1" r=".65" fill="currentColor" /><circle cx="7.5" cy="5.1" r=".65" fill="currentColor" /><circle cx="9.7" cy="5.1" r=".65" fill="currentColor" /></svg>
  );
  if (name === 'presentation') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="M10 14v3M7.5 17h5M6.5 6.5h7M6.5 9h4" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
  );
  if (name === 'image') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.45" /><circle cx="7.2" cy="7.5" r="1.3" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="m4.5 14 3.6-3.4 2.7 2 2.1-2 2.6 3.4" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (name === 'video') return (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="5" width="10.5" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.45" /><path d="m13.5 8 3.5-2v8l-3.5-2" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  const paths: Record<'collapse' | 'expand' | 'chat', React.ReactElement> = {
    collapse: <path d="M12 5l-4 5 4 5" />,
    expand: <path d="M8 5l4 5-4 5" />,
    // 对话气泡：与 dock 内其他线性图标同一笔触重量，不引入填充图形。
    chat: <path d="M4 5.5h12v8H8.5L5 16.5v-3H4z" />,
  };
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {React.cloneElement(paths[name] as React.ReactElement<React.SVGProps<SVGPathElement>>, {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.45,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })}
    </svg>
  );
}

const EMPTY_WORKFLOW_ARTIFACTS: WorkflowResultArtifact[] = [];
const INITIAL_CANVAS_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

/** Camera saves must not rebuild FlowHome's business nodes and editors. */
function PersistedCanvasSurface(props: Omit<React.ComponentProps<typeof XyFlowCanvas>, 'viewport' | 'onViewportPersist'>) {
  const [viewport, setViewport] = useCanvasState('workbenchViewport', INITIAL_CANVAS_VIEWPORT);
  const persist = React.useCallback((next: Viewport) => {
    setViewport(current => sameViewportValue(current, next) ? current : next);
  }, [setViewport]);
  return <XyFlowCanvas {...props} viewport={viewport} onViewportPersist={persist} />;
}

function ProductionCanvasViewToolbar({ apiRef, background, tone, onBackgroundChange, onToneChange, connectionsVisible, onConnectionsVisibleChange }: {
  apiRef: React.RefObject<FlowCanvasApi | null>;
  background: 'dots' | 'grid' | 'none';
  tone: 'default' | 'warm-gray' | 'cool-gray' | 'paper' | 'sage' | 'mist-blue' | 'lavender' | 'blush' | 'sand';
  onBackgroundChange: (value: 'dots' | 'grid' | 'none') => void;
  onToneChange: (value: 'default' | 'warm-gray' | 'cool-gray') => void;
  connectionsVisible: boolean;
  onConnectionsVisibleChange: (value: boolean) => void;
}) {
  const [viewport] = useCanvasState('workbenchViewport', INITIAL_CANVAS_VIEWPORT);
  const shell = workbenchShell(useCanvasLocale());
  const extra = workbenchShellExtra(useCanvasLocale());
  return <CanvasViewToolbar
    ariaLabel={shell.view.boardControls}
    labels={{
      zoomOut: shell.zoom.out, zoomIn: shell.zoom.in, zoomOptions: shell.zoom.options,
      zoomValue: shell.zoom.ariaCurrent, fitView: shell.zoom.fit,
      tidy: shell.view.tidy, displaySettings: shell.view.displaySettings, closeSettings: shell.view.closeSettings,
      canvasSettings: extra.canvasSettings, backgroundStyle: extra.backgroundStyle, backgroundColor: extra.backgroundColor,
      dots: shell.view.dots, grid: shell.view.grid, none: shell.view.none,
      defaultTone: shell.view.default, warmGray: shell.view.warmGray, coolGray: shell.view.coolGray,
      hideConnections: shell.view.hideEdges, showConnections: shell.view.showEdges,
    }}
    zoom={viewport.scale}
    minZoom={0.02}
    maxZoom={4}
    onZoomOut={() => apiRef.current?.zoomOut()}
    onZoomIn={() => apiRef.current?.zoomIn()}
    onZoomTo={value => apiRef.current?.zoomTo(value)}
    onFitView={() => apiRef.current?.fitView()}
    tidyActions={[
      { id: 'connections', icon: 'connections', label: extra.tidyByFlow, description: extra.tidyByFlowHint, onSelect: () => apiRef.current?.sortByConnections() },
      { id: 'task-type', icon: 'category', label: extra.tidyByTask, description: extra.tidyByTaskHint, onSelect: () => apiRef.current?.sortByTaskType() },
      { id: 'revert', icon: 'revert', label: extra.restoreLayout, description: extra.restoreLayoutHint, onSelect: () => apiRef.current?.revertLayout() },
    ]}
    background={background}
    tone={tone}
    onBackgroundChange={onBackgroundChange}
    onToneChange={onToneChange}
    connectionsVisible={connectionsVisible}
    onConnectionsVisibleChange={onConnectionsVisibleChange}
  />;}

function FlowHome({
  workflowRuns: allWorkflowRuns = EMPTY_WORKFLOW_RUNS,
  workflowRunsError,
  workflowArtifacts,
  onWorkflowArtifactsRefresh,
  projectPath,
  defaultVisualModel,
  instances,
  setInstances,
  images,
  setImages,
  promptCards,
  setPromptCards,
  basicNodes,
  setBasicNodes,
  imageGroups,
  setImageGroups,
  edges,
  setEdges,
  taskDrafts,
  setTaskDrafts,
  workflowPendingRequest,
  nodeCreationRequest,
  onNodeCreationConsumed,
  onDocumentsDrop,
  artifactLaunchRequest,
  onArtifactLaunchConsumed,
  imageGenerationLaunchRequest,
  onImageGenerationLaunchConsumed,
  presentationGenerationLaunchRequest,
  onPresentationGenerationLaunchConsumed,
  textDocumentChange,
  textGenerationResults,
  artifactGenerationResults,
  artifactGenerationProgress,
}: {
  workflowRuns?: WorkflowCanvasRun[];
  workflowRunsError?: string;
  workflowArtifacts: WorkflowResultArtifact[];
  onWorkflowArtifactsRefresh?: () => Promise<void> | void;
  projectPath: string;
  defaultVisualModel: VisualModel;
  instances: CanvasInstance[];
  setInstances: React.Dispatch<React.SetStateAction<CanvasInstance[]>>;
  images: WorkbenchImage[];
  setImages: React.Dispatch<React.SetStateAction<WorkbenchImage[]>>;
  promptCards: WorkbenchPromptCard[];
  setPromptCards: React.Dispatch<React.SetStateAction<WorkbenchPromptCard[]>>;
  basicNodes: CanvasBasicNode[];
  setBasicNodes: React.Dispatch<React.SetStateAction<CanvasBasicNode[]>>;
  imageGroups: ImageGroup[];
  setImageGroups: React.Dispatch<React.SetStateAction<ImageGroup[]>>;
  edges: CanvasEdge[];
  setEdges: React.Dispatch<React.SetStateAction<CanvasEdge[]>>;
  taskDrafts: TaskDrafts;
  setTaskDrafts: React.Dispatch<React.SetStateAction<TaskDrafts>>;
  workflowPendingRequest?: CanvasWorkflowPendingRequest | null;
  nodeCreationRequest?: CanvasNodeCreationRequest | null;
  onNodeCreationConsumed?: (nonce: string, nodeId: string) => void;
  onDocumentsDrop?: (files: File[], flowPosition: { x: number; y: number }) => void;
  artifactLaunchRequest?: CanvasArtifactLaunchRequest | null;
  onArtifactLaunchConsumed?: (nonce: string) => void;
  imageGenerationLaunchRequest?: CanvasImageGenerationLaunchRequest | null;
  onImageGenerationLaunchConsumed?: (nonce: string) => void;
  presentationGenerationLaunchRequest?: CanvasPresentationGenerationLaunchRequest | null;
  onPresentationGenerationLaunchConsumed?: (nonce: string) => void;
  textDocumentChange?: TextDocumentChange | null;
  textGenerationResults?: CanvasTextGenerationResult[];
  artifactGenerationResults?: CanvasArtifactGenerationResult[];
  artifactGenerationProgress?: CanvasArtifactGenerationResult[];
}) {
  const uiHost = useCanvasUiHost();
  // Flow reconciliation retains callbacks when serializable node data is unchanged.
  // Read the latest host so connecting/replacing an App adapter takes effect.
  const imageAppHostRef = React.useRef(uiHost?.openImageApp);
  imageAppHostRef.current = uiHost?.openImageApp;
  const canvasLocale = useCanvasLocale();
  const shell = workbenchShell(canvasLocale);
  const x = workbenchShellExtra(canvasLocale);
  const addNodeChrome = canvasAddNodeChrome(canvasLocale);
  const history = useCanvasHistory();
  const flushCanvas = useCanvasFlush();
  const submitMedia = useCanvasMediaSubmission();
  const getCanvasSnapshot = useCanvasSnapshot();
  const [storedWorkflowGroups, setWorkflowGroups] = useCanvasState<Record<string, WorkflowRunGroupLayout>>('workbenchWorkflowRunGroups', {});
  const workflowRuns = React.useMemo(() => workflowGroupRuns(allWorkflowRuns), [allWorkflowRuns]);
  const workflowGroups = React.useMemo(() => activeWorkflowGroups(storedWorkflowGroups, workflowRuns), [storedWorkflowGroups, workflowRuns]);
  const [organizationGroups, setOrganizationGroups] = useCanvasState<OrganizationGroup[]>('workbenchOrganizationGroups', []);
  const [dismissedWorkflowResults, setDismissedWorkflowResults] = useCanvasState<Record<string, boolean>>('dismissedWorkflowResults', {});
  const removeWorkflowResult = React.useCallback((resultId: string) => {
    history.run(() => setDismissedWorkflowResults(current => ({ ...current, [resultId]: true })));
  }, [history, setDismissedWorkflowResults]);
  const renderPopover = requireCanvasPopoverRenderer(uiHost);
  const [sendingId, setSendingId] = React.useState('');
  const imageSubmissionLocksRef = React.useRef(new Set<string>());
  const [feedback, setFeedback] = React.useState<Record<string, string>>({});
  const consumedImageLaunchNonceRef = React.useRef<string | null>(null);
  const consumedPresentationLaunchNonceRef = React.useRef<string | null>(null);
  const consumedNodeCreationNonceRef = React.useRef<string | null>(null);
  /**
   * 对话区是否展开。
   * 用 useCanvasState 持久化：折叠状态属于用户的工作布局偏好，
   * 刷新页面后被重置回展开会很烦人。
   */
  const consumedArtifactLaunchNonceRef = React.useRef<string | null>(null);
  const [storyboardAssets, setStoryboardAssets] = useCanvasState<StoryboardAsset[]>(STORYBOARD_ASSETS_STATE_KEY, []);
  const storyboardAssetsRef = React.useRef(storyboardAssets);
  storyboardAssetsRef.current = storyboardAssets;
  const [storyboardGroupPositions, setStoryboardGroupPositions] = useCanvasState<Record<string, { x: number; y: number }>>('storyboardAssetGroupPositions', {});
  const [detachedStoryboardImages] = useCanvasState<Record<string, boolean>>('detachedStoryboardImages', {});
  const storyboardGalleries = React.useMemo(() => {
    const groups = layoutStoryboardGalleries(basicNodes, storyboardAssets, images, detachedStoryboardImages, storyboardGroupPositions);
    return groups;
  }, [basicNodes, storyboardAssets, images, detachedStoryboardImages, storyboardGroupPositions]);
  const { active: storyboardRelation, pinned: pinnedStoryboardRelation, hover: hoverStoryboardRelation, pin: pinStoryboardRelation, clear: clearStoryboardRelation } = useStoryboardRelations();
  React.useEffect(() => {
    if (!storyboardRelation) return;
    const plan = basicNodes.find(n => n.id === storyboardRelation.storyboardId)?.storyboard;
    if (!plan || (storyboardRelation.kind === 'shot' ? !plan.shots.some(s => s.id === storyboardRelation.id) : !storyboardAssets.some(a => a.id === storyboardRelation.id))) clearStoryboardRelation();
  }, [basicNodes, storyboardAssets, storyboardRelation, clearStoryboardRelation]);
  const storyboardGenerationLocksRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    setBasicNodes(current => {
      let changed = false;
      const next = current.map(node => {
        const source = node.storyboardVideoSource;
        if (!source) return node;
        const shot = current.find(n => n.id === source.storyboardId)?.storyboard?.shots.find(s => s.id === source.shotId);
        const mode = shot?.tailFrame ? 'firstlast' as const : 'i2v' as const;
        const first = shot && selectedStoryboardShotImage(shot, images);
        const last = shot?.tailFrame && selectedStoryboardShotImage(shot.tailFrame, images);
        const frames = first ? [first, ...(last ? [last] : [])].map((image, index) => ({ sourceNodeId: image.id, name: index ? shell.frames.last : shell.frames.first, path: image.path!, mimeType: 'image/png', size: 0 })) : [];
        if (node.videoMode === mode && JSON.stringify(node.storyboardVideoFrames) === JSON.stringify(frames)) return node;
        changed = true;
        return { ...node, videoMode: mode, storyboardVideoFrames: frames, videoFirstFrameUrl: undefined, videoLastFrameUrl: undefined };
      });
      return changed ? next : current;
    });
  }, [basicNodes, images, setBasicNodes]);
  React.useEffect(() => {
    setBasicNodes(current => {
      let changed = false;
      const next = current.map(node => {
        if (!node.storyboard) return node;
        const shots = node.storyboard.shots.map(shot => {
          let next = shot;
          for (const frame of ['first', 'last'] as const) {
            if (frame === 'last' && !shot.tailFrame) continue;
            const state = storyboardFrame(shot, frame);
            if (state.selectedImagePath) continue;
            const image = selectedStoryboardShotImage(state, images);
            if (!image?.path) continue;
            changed = true;
            next = patchStoryboardFrame(next, frame, { selectedImagePath: image.path });
          }
          return next;
        });
        return shots.some((shot, index) => shot !== node.storyboard!.shots[index]) ? { ...node, storyboard: { ...node.storyboard, shots } } : node;
      });
      return changed ? next : current;
    });
  }, [images, setBasicNodes]);
  React.useEffect(() => {
    const isolated = isolateStoryboardAssets(basicNodes, storyboardAssets, edges);
    if (isolated.assets !== storyboardAssets) setStoryboardAssets(current => isolateStoryboardAssets(basicNodes, current, edges).assets);
    if (isolated.nodes !== basicNodes) setBasicNodes(current => isolateStoryboardAssets(current, storyboardAssets, edges).nodes);
  }, [basicNodes, storyboardAssets, edges, setStoryboardAssets, setBasicNodes]);
  React.useEffect(() => {
    const next = reconcileStoryboardAssetImages(storyboardAssets, images);
    if (next !== storyboardAssets) setStoryboardAssets(current => reconcileStoryboardAssetImages(current, images));
  }, [images, storyboardAssets, setStoryboardAssets]);

  // Server-delivered images persist portable paths; resolve URLs in this workspace.
  React.useEffect(() => {
    if (!images.some(image => image.path && !image.src)) return;
    setImages(current => current.map(image => image.path && !image.src ? { ...image, src: imageFileUrl(image.path) } : image));
  }, [images, setImages]);

  // Upgrade persisted HTML placeholders using authoritative file semantics.
  // Keep ids, geometry and edges; never recreate a deleted node or replay AI.
  const legacyArtifactKey = basicNodes.filter(node => node.kind === 'artifact' && node.artifact?.renderer === 'html')
    .map(node => node.id).sort().join('|');
  React.useEffect(() => {
    if (!legacyArtifactKey) return;
    const controller = new AbortController();
    void (async () => {
      const response = await projectFetch('/files', { signal: controller.signal });
      if (!response.ok) return;
      const payload = await response.json() as { files?: ProjectFile[] };
      if (controller.signal.aborted) return;
      const files = new Map((payload.files ?? []).map(file => [file.path || file.name, file]));
      setBasicNodes(nodes => nodes.map(node => {
        if (node.kind !== 'artifact' || node.artifact?.renderer !== 'html' || node.artifact.resource.kind !== 'project-file') return node;
        const file = files.get(node.artifact.resource.path);
        if (!file) return node;
        const fresh = projectFileArtifactDescriptor(getCanvasHostContext().projectId, { ...file, projectId: getCanvasHostContext().projectId, artifactKind: file.artifactManifest?.kind ?? file.artifactKind });
        const artifact = { ...node.artifact, preview: fresh.preview };
        return { ...node, artifact, ...canvasArtifactProjection(artifact) };
      }));
    })().catch(error => { if (!controller.signal.aborted) console.warn('Unable to reconcile legacy canvas artifacts', error); });
    return () => controller.abort();
  }, [legacyArtifactKey, setBasicNodes]);

  useCanvasTextDocumentChange(getCanvasHostContext().projectId, textDocumentChange, change => {
    setBasicNodes(nodes => {
      const next = applyCanvasTextDocumentChange(nodes, change);
      if (next !== nodes) basicNodesRef.current = next;
      return next;
    });
  });

  React.useEffect(() => {
    if (!textGenerationResults?.length) return;
    setBasicNodes(nodes => applyCanvasTextGenerationResults(nodes, textGenerationResults));
  }, [setBasicNodes, textGenerationResults]);
  React.useEffect(() => {
    if (!artifactGenerationResults?.length) return;
    const results = new Map(artifactGenerationResults.map(result => [result.binding.requestId, result]));
    setBasicNodes(nodes => nodes.map(node => {
      const result = node.kind === 'page' && node.generation ? results.get(node.generation.requestId) : undefined;
      if (!result || result.binding.nodeId !== node.id || (node.generation?.status === result.status && node.generation?.appliedRequestId === result.binding.requestId)) return node;
      const patch = {
        ...node,
        ...(result.status === 'succeeded' && result.outputPath ? { projectFilePath: result.outputPath } : {}),
        generation: {
          ...node.generation,
          requestId: result.binding.requestId,
          status: result.status,
          ...(result.status === 'succeeded' && result.outputPath ? { previewPath: result.outputPath, appliedRequestId: result.binding.requestId } : {}),
          ...(result.error ? { error: result.error } : {}),
        },
      };
      return result.status === 'succeeded' && result.outputPath ? withCanvasResultHistory(node, patch, ['projectFilePath']) : patch;
    }));
  }, [artifactGenerationResults, setBasicNodes]);
  const [workflowArtifactBusyId, setWorkflowArtifactBusyId] = React.useState('');
  const [workflowStagePositions, setWorkflowStagePositions] = useCanvasState<Record<string, WorkflowResultPosition>>(
    'workbenchWorkflowStagePositionsV2',
    {},
  );
  const [pendingWorkflowGenerations, setPendingWorkflowGenerations] = React.useState<
    Record<string, PendingWorkflowGeneration>
  >({});
  const [imageEditorSaving, setImageEditorSaving] = React.useState(false);
  const [canvasTool, setCanvasTool] = React.useState<CanvasInteractionMode>('hand');
  // 这些是视图偏好，不碰画布业务数据；刷新后仍保留用户上次的观看方式。
  const [canvasEdgesVisible, setCanvasEdgesVisible] = useCanvasState<boolean>('workbenchCanvasEdgesVisible', true);
  const [canvasBackground, setCanvasBackground] = useCanvasState<'dots' | 'grid' | 'none'>('workbenchCanvasBackground', 'dots');
  const [canvasTone, setCanvasTone] = useCanvasState<'default' | 'warm-gray' | 'cool-gray' | 'paper' | 'sage' | 'mist-blue' | 'lavender' | 'blush' | 'sand'>('workbenchCanvasTone', 'default');
  const [canvasPriorLayout, setCanvasPriorLayout] = useCanvasState<CanvasLayoutPosition[] | null>('workbenchPriorLayoutV1', null);
  // 空格按住时临时切到当前 sticky 工具的相反模式（抓手↔指针），松开恢复
  const [tempToggle, setTempToggle] = React.useState(false);
  const effectiveTool: CanvasInteractionMode = tempToggle
    ? (canvasTool === 'hand' ? 'pointer' : 'hand')
    : canvasTool;
  // 工作流上拉菜单
  const [workflowMenuOpen, setWorkflowMenuOpen] = React.useState(false);

  const [toolModeMenuOpen, setToolModeMenuOpen] = React.useState(false);
  const toolModeCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepToolModeOpen = () => {
    if (toolModeCloseTimer.current) clearTimeout(toolModeCloseTimer.current);
    setToolModeMenuOpen(true);
  };
  const scheduleToolModeClose = () => {
    if (toolModeCloseTimer.current) clearTimeout(toolModeCloseTimer.current);
    toolModeCloseTimer.current = setTimeout(() => setToolModeMenuOpen(false), 350);
  };
  React.useEffect(() => () => {
    if (toolModeCloseTimer.current) clearTimeout(toolModeCloseTimer.current);
  }, []);
  const [projectAssetsOpen, setProjectAssetsOpen] = React.useState(false);

  React.useEffect(() => {
    const syncProjectAssetsState = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      setProjectAssetsOpen(Boolean(detail?.open));
    };
    window.addEventListener('bezier-design:project-assets-state', syncProjectAssetsState);
    return () => window.removeEventListener('bezier-design:project-assets-state', syncProjectAssetsState);
  }, []);

  const [imageToasts, setImageToasts] = React.useState<Record<string, string>>({});
  const instancesRef = React.useRef(instances);
  const basicNodesRef = React.useRef(basicNodes);
  const imagesRef = React.useRef(images);
  const promptCardsRef = React.useRef(promptCards);
  const imageGroupsRef = React.useRef(imageGroups);
  const edgesRef = React.useRef(edges);
  const canvasHostRef = React.useRef<HTMLElement | null>(null);
  const flowApiRef = React.useRef<FlowCanvasApi | null>(null);
  React.useEffect(() => registerCanvasObjects(getCanvasHostContext().projectId, {
    selectedNodeIds: () => flowApiRef.current?.getSelectedNodeIds() ?? [],
    preview: nodeId => {
      const node = basicNodes.find(value => value.id === nodeId);
      if (!node) return null;
      return { label: node.title || '', text: (node.text || '').slice(0, 600),
        path: node.kind === 'page' ? node.projectFilePath : undefined,
        format: node.artifactFormat, revision: node.generation?.requestId,
        shots: node.storyboard?.shots.slice(0, 3).map(shot => shot.description.slice(0, 100)) };
    },
    fail: (nodeId, requestId, error) => setBasicNodes(nodes => nodes.map(node => node.id === nodeId && acceptsCanvasGenerationPatch(node.generation, { requestId, status: 'failed' })
      ? { ...node, generation: { ...node.generation, requestId, status: 'failed', error } } : node)),
    read: nodeId => {
      const node = basicNodes.find(value => value.id === nodeId);
      return node && (node.kind === 'text' || node.kind === 'page') ? canvasObjectReference(getCanvasHostContext().projectId, node, 'reference') : null;
    },
    focus: nodeId => {
      if (!basicNodes.some(node => node.id === nodeId) || !flowApiRef.current) return false;
      flowApiRef.current.activateNode(nodeId);
      flowApiRef.current.focusNode(nodeId);
      return true;
    },
    prepare: async (reference, requestId) => {
      const node = basicNodes.find(value => value.id === reference.nodeId);
      if (!node || node.kind !== reference.kind || (node.text || '') !== reference.text || node.projectFilePath !== reference.path) throw new Error(shell.errors.targetChanged);
      if (node.generation?.status === 'running') throw new Error(shell.errors.targetBusy);
      setBasicNodes(nodes => nodes.map(value => value.id === node.id ? { ...value, generation: { requestId, status: 'running', ...(node.kind === 'text' ? { baseText: reference.text } : {}) } } : value));
      await flushCanvas();
    },
  }), [basicNodes, setBasicNodes, flushCanvas]);
  const SOURCE_GHOST_W = 248;
  const creativePositionsRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const topicPositionsRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const productPositionsRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const articlePositionsRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const evaluationPositionsRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const workflowStagePositionsRef = React.useRef<Record<string, WorkflowResultPosition>>({});
  const imageToastTimers = React.useRef<Record<string, number>>({});
  const finalizingImageTasksRef = React.useRef(new Set<string>());
  // 终态任务在 state 移除落盘前可能被下一次轮询再次看到。仅靠 finalizing 锁只能防并发，
  // 防不住前一次已经结束、下一拍又覆写同一成图 URL，后者正是卡片闪烁的来源。
  const finalizedImageTasksRef = React.useRef(new Set<string>());
  const safeTaskDrafts = normalizeTaskDrafts(taskDrafts);

  instancesRef.current = instances;
  basicNodesRef.current = Array.isArray(basicNodes) ? basicNodes : [];
  // Commands (duplicate, edit, downstream generation) need visible canvas
  // coordinates, not the historical position before gallery presentation.
  const galleryImagePositions = new Map(storyboardGalleries.flatMap(gallery => gallery.members.map(member => [member.id, { x: gallery.x + member.x, y: gallery.y + member.y }] as const)));
  imagesRef.current = (Array.isArray(images) ? images : []).map(image => {
    const position = galleryImagePositions.get(image.embeddedInSource ? image.sourceInstanceId || image.id : image.id);
    return position ? { ...image, ...position } : image;
  });
  promptCardsRef.current = Array.isArray(promptCards) ? promptCards : [];
  imageGroupsRef.current = Array.isArray(imageGroups) ? imageGroups : [];
  edgesRef.current = Array.isArray(edges) ? edges : [];
  workflowStagePositionsRef.current = workflowStagePositions || {};

  // A canvas edge is also a data dependency: every project-backed output on
  // the source side becomes an input attachment on the target side. Deriving
  // this from the persisted edge list keeps click-to-create, manual connect,
  // reconnect and disconnect on one path instead of copying files ad hoc.
  const linkedInputsSignatureRef = React.useRef('');
  React.useEffect(() => {
    const linkedByTarget = linkedAttachmentsByTarget({
      edges: Array.isArray(edges) ? edges : [],
      basicNodes: basicNodesRef.current,
      images: imagesRef.current,
      groups: organizationGroups,
    });
    const signature = JSON.stringify([
      [...linkedByTarget],
      instancesRef.current.filter(item => item.kind === 'visual').map(item => item.id),
      basicNodesRef.current.map(item => [item.id, item.linkedAttachments]),
    ]);
    if (linkedInputsSignatureRef.current === signature) return;
    linkedInputsSignatureRef.current = signature;

    setTaskDrafts(current => {
      const drafts = normalizeTaskDrafts(current);
      const visualIds = new Set(instancesRef.current.filter(item => item.kind === 'visual').map(item => item.id));
      const targets = new Set([
        ...visualIds,
        ...Object.entries(drafts)
          .filter(([, draft]) => draft.attachments.some(attachment => Boolean(attachment.sourceNodeId)))
          .map(([id]) => id),
      ]);
      let changed = false;
      const next = { ...drafts };
      for (const targetId of targets) {
        const draft = drafts[targetId] || { text: '', attachments: [] };
        const linked = linkedByTarget.get(targetId) || [];
        const linkedPaths = new Set(linked.map(attachment => attachment.path));
        const manual = draft.attachments.filter(attachment => (
          !attachment.sourceNodeId && !linkedPaths.has(attachment.path)
        ));
        const attachments: TaskAttachment[] = [...manual, ...linked];
        if (JSON.stringify(attachments) === JSON.stringify(draft.attachments)) continue;
        next[targetId] = { ...draft, attachments };
        changed = true;
      }
      return changed ? next : current;
    });

    setBasicNodes(current => {
      let changed = false;
      const next = current.map(node => {
        const linked = linkedByTarget.get(node.id) || [];
        if (sameLinkedAttachments(node.linkedAttachments, linked)) return node;
        changed = true;
        return { ...node, linkedAttachments: linked };
      });
      return changed ? next : current;
    });
  }, [basicNodes, edges, images, instances, organizationGroups, setBasicNodes, setTaskDrafts]);

  // 内嵌首图属于视觉母卡本身：它不再是独立画布节点，也不应保留一条指向
  // 不存在节点的历史连线。图片状态变化后统一清掉，兼容任务轮询与旧数据。
  React.useEffect(() => {
    const embeddedIds = new Set(
      (Array.isArray(images) ? images : [])
        .filter(image => image.embeddedInSource)
        .map(image => image.id),
    );
    if (!embeddedIds.size) return;
    setEdges(current => {
      const source = Array.isArray(current) ? current : [];
      const next = source.filter(edge => !embeddedIds.has(edge.source) && !embeddedIds.has(edge.target));
      return next.length === source.length ? source : next;
    });
  }, [images, setEdges]);

  const imageLineage = React.useMemo(() => deriveImageLineage({
    images: Array.isArray(images) ? images : [],
    instanceIds: instances.map(instance => instance.id),
    groupIds: (Array.isArray(imageGroups) ? imageGroups : []).map(group => group.id),
  }), [imageGroups, images, instances]);

  // 图片节点只保存父子关系，边统一由关系派生。这样任务轮询、刷新恢复与旧数据
  // 迁移都走同一条路径，不再由各个生图入口各写一份、再被清理器互相覆盖。
  React.useEffect(() => {
    setEdges(current => reconcileImageLineageEdges(
      Array.isArray(current) ? current : [],
      imageLineage.edges,
      imageLineage.managedTargetIds,
    ));
  }, [edges, imageLineage, setEdges]);

  // 兼容已经落盘的旧画布：首代生成图过去被存成独立节点，但它本质上就是
  // 视觉母卡的结果。载入时只迁移每张母卡的一张首图，后续衍生图仍保留为节点。
  React.useEffect(() => {
    const source = Array.isArray(images) ? images : [];
    const normalized = embedLegacyPrimaryImages(
      source,
      instances.filter(item => item.kind === 'visual').map(item => item.id),
    );
    if (normalized !== source) setImages(normalized);
  }, [images, instances, setImages]);

  React.useEffect(() => {
    const groups = Array.isArray(imageGroups) ? imageGroups : [];
    const sourceImages = Array.isArray(images) ? images : [];
    if (!groups.length) return;

    const placements = new Map<string, { x: number; y: number }>();
    let groupsChanged = false;
    const normalizedGroups = groups.map(group => {
      if (group.layoutMode === 'free') return group;
      const members = group.memberIds
        .map(id => sourceImages.find(image => image.id === id))
        .filter((image): image is WorkbenchImage => Boolean(image));
      if (members.length < 2) return group;

      const layout = layoutGroupMembers(members);
      layout.placements.forEach(item => placements.set(item.id, { x: item.x, y: item.y }));
      if (group.width === layout.width && group.height === layout.height) return group;
      groupsChanged = true;
      return { ...group, width: layout.width, height: layout.height };
    });

    let imagesChanged = false;
    const normalizedImages = sourceImages.map(image => {
      const placement = placements.get(image.id);
      if (!placement || (image.x === placement.x && image.y === placement.y)) return image;
      imagesChanged = true;
      return { ...image, ...placement };
    });

    if (groupsChanged) setImageGroups(normalizedGroups);
    if (imagesChanged) setImages(normalizedImages);
  }, [imageGroups, images, setImageGroups, setImages]);

  const resolvedWorkflowArtifactPositions = React.useMemo(() => {
    const savedByArtifactId = Object.fromEntries(workflowArtifacts.flatMap(artifact => {
      const saved = workflowStagePositions[workflowStageNodeId(artifact.id)];
      return saved ? [[artifact.id, saved] as const] : [];
    }));
    const rootPositions = Object.fromEntries(instances.map(instance => [
      instance.id,
      { x: instance.x, y: instance.y },
    ]));
    return resolveWorkflowResultPositions(workflowArtifacts, savedByArtifactId, rootPositions);
  }, [instances, workflowArtifacts, workflowStagePositions]);

  // Seed every generated position into canvas persistence once. Manual drags
  // overwrite the same entry later, so refreshes restore the user's layout
  // without triggering a viewport reset or a second auto-layout pass.
  React.useEffect(() => {
    if (workflowArtifacts.length === 0) return;
    setWorkflowStagePositions(current => {
      let changed = false;
      const next = { ...(current || {}) };
      for (const artifact of workflowArtifacts) {
        const nodeId = workflowStageNodeId(artifact.id);
        if (next[nodeId]) continue;
        const position = resolvedWorkflowArtifactPositions[artifact.id];
        if (!position) continue;
        next[nodeId] = position;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [resolvedWorkflowArtifactPositions, setWorkflowStagePositions, workflowArtifacts]);

  // 空格：按住临时切到相反模式（默认抓手→临时指针），松开恢复 sticky tool
  React.useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(el?.closest?.('button, input, textarea, select, [contenteditable="true"]'));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setTempToggle(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setTempToggle(false);
    };
    const clearTemp = () => setTempToggle(false);

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', clearTemp);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', clearTemp);
    };
  }, []);

  const refreshWorkflowArtifacts = useEffectEvent(async () => {
    try {
      await onWorkflowArtifactsRefresh?.();
    } catch {
      // The host keeps the last confirmed projection and its normal poll will
      // retry. A refresh failure must not turn a successful interaction into
      // a false operation failure.
    }
  });

  /**
   * Home image mode lands here instead of starting an Agent chat run.
   * Materialize the same visual card the canvas creates locally, copy every
   * selected control/reference into its persisted draft, then call the normal
   * direct generator. From this point onward Home and canvas are one path.
   */
  const consumeImageGenerationLaunch = useEffectEvent((request: CanvasImageGenerationLaunchRequest) => {
    if (consumedImageLaunchNonceRef.current === request.nonce) return;
    consumedImageLaunchNonceRef.current = request.nonce;
    const instanceId = addInstance('visual', undefined, undefined, 'center');
    if (!instanceId) {
      consumedImageLaunchNonceRef.current = null;
      return;
    }
    const instance = instancesRef.current.find(item => item.id === instanceId);
    if (!instance) {
      consumedImageLaunchNonceRef.current = null;
      return;
    }
    const model: VisualModel = request.model === 'codex-gpt-image-2'
      ? 'codex-gpt2'
      : request.model;
    const draft: TaskDraft = {
      text: request.prompt,
      attachments: request.references.map(reference => ({
        name: reference.name,
        path: reference.path,
        size: reference.size ?? 0,
        mimeType: 'image/*',
      })),
      models: [model],
      imageCount: 1,
      imageRatio: request.ratio,
      imageRatios: [request.ratio],
      imageResolution: request.resolution,
      rawPrompt: true,
    };
    updateDraft(instanceId, draft);
    onImageGenerationLaunchConsumed?.(request.nonce);
    void generateImageDirect(instance, draft);
  });

  React.useEffect(() => {
    if (!projectPath || !imageGenerationLaunchRequest) return;
    if (consumedImageLaunchNonceRef.current === imageGenerationLaunchRequest.nonce) return;
    // Deferring consumption keeps the StrictMode probe cancellable. The nonce
    // is marked only inside the real callback, never by the discarded setup.
    const timer = window.setTimeout(
      () => consumeImageGenerationLaunch(imageGenerationLaunchRequest),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [consumeImageGenerationLaunch, imageGenerationLaunchRequest, projectPath]);

  /** Home PPT mode creates and starts the same persistent PPT card used in-canvas. */
  const consumePresentationGenerationLaunch = useEffectEvent((request: CanvasPresentationGenerationLaunchRequest) => {
    if (consumedPresentationLaunchNonceRef.current === request.nonce) return;
    consumedPresentationLaunchNonceRef.current = request.nonce;
    const nodeId = addBasicNode('page', 'presentation');
    const task = createPresentationGenerationTask(request);
    patchBasicNode(nodeId, {
      text: request.prompt,
      presentationOptions: {
        length: request.length,
        template: request.template,
        templateTitle: request.templateTitle,
        templateDescription: request.templateDescription,
        templateReferencePath: request.templateReferencePath,
        templatePrompt: request.templatePrompt,
      },
      generation: {
        requestId: task.requestId,
        status: 'running',
        previewPath: task.outputPath,
        totalSlides: task.totalSlides,
      },
    });
    onPresentationGenerationLaunchConsumed?.(request.nonce);
    void submitAgentTask(task.agentPrompt, {
      kind: 'instruction-card',
      title: shell.ppt.generate,
      visiblePrompt: task.visiblePrompt,
      canvasArtifactGeneration: {
        requestId: task.requestId,
        nodeId,
        format: 'presentation',
        outputPath: task.outputPath,
      },
      taskContext: {
        targetLabel: shell.ppt.card,
        baseVersionKind: 'submission-input',
        baseVersionSource: JSON.stringify({
          prompt: request.prompt,
          length: request.length,
          template: request.template,
          templateTitle: request.templateTitle,
          templateReferencePath: request.templateReferencePath,
        }),
      },
    }).catch(error => {
      patchBasicNode(nodeId, {
        generation: {
          requestId: task.requestId,
          status: 'failed',
          previewPath: task.outputPath,
          totalSlides: task.totalSlides,
          error: error instanceof Error ? error.message : shell.workflow.startFailed,
        },
      });
    });
  });

  React.useEffect(() => {
    if (!projectPath || !presentationGenerationLaunchRequest) return;
    if (consumedPresentationLaunchNonceRef.current === presentationGenerationLaunchRequest.nonce) return;
    const timer = window.setTimeout(
      () => consumePresentationGenerationLaunch(presentationGenerationLaunchRequest),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [consumePresentationGenerationLaunch, presentationGenerationLaunchRequest, projectPath]);

  React.useEffect(() => {
    const pending = Object.values(pendingWorkflowGenerations).filter(item => item.workflowRunId && !item.error);
    if (!pending.length) return;
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        for (const runId of new Set(pending.map(item => item.workflowRunId!))) {
          const response = await platformFetch(`/api/workflow-graph-runs/${encodeURIComponent(runId)}`);
          if (!response.ok || disposed) continue;
          const state = await response.json() as { steps?: Array<{ id: string; status: string; error?: { message?: string } }>; execution?: { error?: string } };
          if (disposed) return;
          for (const item of pending.filter(candidate => candidate.workflowRunId === runId)) {
            const step = state.steps?.find(candidate => candidate.id === item.stepRunId);
            const error = state.execution?.error || (step?.status === 'failed' ? step.error?.message || shell.workflow.stepFailed : step?.status === 'cancelled' ? shell.workflow.stopped : '');
            if (error) setPendingWorkflowGenerations(current => current[item.stepRunId]
              ? { ...current, [item.stepRunId]: { ...current[item.stepRunId]!, error } } : current);
          }
        }
        if (!disposed) await refreshWorkflowArtifacts();
      } catch { /* Read-only recovery: a disconnected view cannot fail a run. */ }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [pendingWorkflowGenerations]);

  React.useEffect(() => {
    const receiveAgentTerminal = (event: Event) => {
      const detail = (event as CustomEvent<{
        stepRunId?: string;
        ok?: boolean;
        artifactCanvasNodeId?: string;
        message?: string;
      }>).detail;
      if (!detail?.stepRunId) return;
      if (detail.ok) {
        // The host has committed Agent output back to the graph runtime. Pull
        // immediately instead of making the user wait for the 2s poll.
        if (detail.artifactCanvasNodeId) {
          setPendingWorkflowGenerations(current => {
            const pending = current[detail.stepRunId!];
            return pending
              ? {
                  ...current,
                  [detail.stepRunId!]: {
                    ...pending,
                    artifactCanvasNodeId: detail.artifactCanvasNodeId,
                  },
                }
              : current;
          });
        }
        void refreshWorkflowArtifacts();
        return;
      }
      // Keep a visible failed card instead of silently deleting the loader.
      // The user can retry from the source result while retaining evidence of
      // why this branch did not materialize.
      setPendingWorkflowGenerations(current => {
        if (!current[detail.stepRunId!]) return current;
        return {
          ...current,
          [detail.stepRunId!]: {
            ...current[detail.stepRunId!]!,
            error: detail.message || shell.workflow.saveFailed,
          },
        };
      });
    };
    window.addEventListener(CANVAS_WORKFLOW_AGENT_TERMINAL_EVENT, receiveAgentTerminal);
    return () => window.removeEventListener(CANVAS_WORKFLOW_AGENT_TERMINAL_EVENT, receiveAgentTerminal);
  }, []);

  React.useEffect(() => {
    const completedResults = Object.values(pendingWorkflowGenerations).flatMap(pending => {
      const artifact = workflowArtifacts.find(candidate => candidate.sourceStepRunId === pending.stepRunId);
      return artifact ? [{ pending, artifact }] : [];
    });
    const completedDeliveries = Object.values(pendingWorkflowGenerations).flatMap(pending => {
      const node = basicNodes.find(candidate => (
        (pending.artifactCanvasNodeId && candidate.id === pending.artifactCanvasNodeId)
        || candidate.source?.agentStepRunId === pending.stepRunId
        || (
          pending.baselineCanvasNodeIds?.includes(candidate.id) === false
          && candidate.source?.resultId === pending.sourceArtifactId
        )
      ));
      return node ? [{ pending, node }] : [];
    });
    if (completedResults.length === 0 && completedDeliveries.length === 0) return;

    // The final result replaces its loading card at the exact same location.
    // This keeps both the selected-item edge and the user's viewport stable.
    setWorkflowStagePositions(current => {
      const next = { ...(current || {}) };
      for (const { pending, artifact } of completedResults) {
        next[workflowStageNodeId(artifact.id)] = pending.position;
      }
      return next;
    });
    if (completedDeliveries.length > 0) {
      setBasicNodes(current => current.map(node => {
        const completed = completedDeliveries.find(item => item.node.id === node.id);
        return completed
          ? { ...node, x: completed.pending.position.x, y: completed.pending.position.y }
          : node;
      }));
    }
    setPendingWorkflowGenerations(current => {
      const next = { ...current };
      for (const { pending } of completedResults) delete next[pending.stepRunId];
      for (const { pending } of completedDeliveries) delete next[pending.stepRunId];
      return next;
    });
  }, [basicNodes, pendingWorkflowGenerations, setBasicNodes, setWorkflowStagePositions, workflowArtifacts]);

  React.useEffect(() => {
    if (!workflowPendingRequest || workflowPendingRequest.mode === 'delivery') return;
    const artifact = workflowArtifacts.find(candidate => (
      candidate.workflowRunId === workflowPendingRequest.runId
      && candidate.sourceStepRunId === workflowPendingRequest.stepRunId
    ));
    if (!artifact) return;

    // The first materialized result takes over the loading card's exact slot.
    // Copying a dragged pending position is important: a result appearing must
    // never snap the user's canvas back to the default origin.
    const pendingId = workflowInitialPendingNodeId(workflowPendingRequest.stepRunId);
    const resultId = workflowStageNodeId(artifact.id);
    setWorkflowStagePositions(current => {
      const source = current || {};
      if (source[resultId]) return current;
      const next = {
        ...source,
        [resultId]: source[pendingId] ?? WORKFLOW_RESULT_FALLBACK_ORIGIN,
      };
      delete next[pendingId];
      return next;
    });
  }, [setWorkflowStagePositions, workflowArtifacts, workflowPendingRequest]);

  React.useEffect(() => {
    if (
      !workflowPendingRequest
      || workflowPendingRequest.mode !== 'delivery'
      || !workflowPendingRequest.artifactCanvasNodeId
    ) return;
    const pendingId = workflowInitialPendingNodeId(workflowPendingRequest.stepRunId);
    const pendingPosition = workflowStagePositionsRef.current[pendingId];
    if (!pendingPosition) return;
    const artifactId = workflowPendingRequest.artifactCanvasNodeId;
    if (!basicNodes.some(node => node.id === artifactId)) return;

    // A user may drag a loading card while the Agent is still running. Once
    // the daemon's durable card arrives, retain that intentional placement and
    // then discard the temporary-position key.
    setBasicNodes(current => current.map(node => (
      node.id === artifactId && (node.x !== pendingPosition.x || node.y !== pendingPosition.y)
        ? { ...node, x: pendingPosition.x, y: pendingPosition.y }
        : node
    )));
    setWorkflowStagePositions(current => {
      const next = { ...(current || {}) };
      delete next[pendingId];
      return next;
    });
  }, [basicNodes, setBasicNodes, setWorkflowStagePositions, workflowPendingRequest]);

  const interactWithWorkflowArtifact = useEffectEvent(async (
    artifact: WorkflowResultArtifact,
    interaction: WorkflowStageInteraction,
  ) => {
    setWorkflowArtifactBusyId(artifact.id);
    try {
      const reportDrafts = interaction.actionId === 'continue'
        ? prepareReportStoryboards(artifact, interaction.selectedIds, interaction.feedback,
          resolvedWorkflowArtifactPositions[artifact.id] ?? { x: 120, y: 120 })
        : [];
      const execution = interaction.actionId === 'evaluate' ? uiHost?.getExecutionSnapshot?.() : undefined;
      if (interaction.actionId === 'evaluate' && !execution) throw new Error(shell.workflow.hostMissingEval);
      const response = await platformFetch(`/api/workflow-results/${encodeURIComponent(artifact.id)}/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...interaction,
          ...(execution ? { execution } : {}),
          expectedVersion: artifact.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json() as WorkflowResultInteractionResponse & {
        error?: { message?: string; code?: string };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error?.message || payload.error?.code || payload.message || shell.workflow.opFailed);
      }
      if (payload.agentPrompt) {
        const genericWorkflow = genericWorkflowAgentBinding(payload.runMetadata?.genericWorkflow, artifact.title);
        let pendingStepRunId = '';
        if (genericWorkflow) {
          const sourcePosition = resolvedWorkflowArtifactPositions[artifact.id]
            ?? workflowStagePositionsRef.current[workflowStageNodeId(artifact.id)]
            ?? { x: 120, y: 120 };
          pendingStepRunId = genericWorkflow.stepRunId;
          setPendingWorkflowGenerations(current => ({
            ...current,
            [genericWorkflow.stepRunId]: {
              stepRunId: genericWorkflow.stepRunId,
              workflowRunId: genericWorkflow.runId,
              sourceArtifactId: artifact.id,
              selectedIds: [...interaction.selectedIds],
              title: genericWorkflow.nodeTitle || artifact.title,
              baselineCanvasNodeIds: basicNodes.map(node => node.id),
              position: resolveWorkflowBranchPosition(
                sourcePosition,
                [
                  ...Object.values(resolvedWorkflowArtifactPositions),
                  ...Object.values(pendingWorkflowGenerations).map(candidate => candidate.position),
                ],
              ),
            },
          }));
        }
        try {
          await submitAgentTask(payload.agentPrompt, {
            kind: 'instruction-card',
            title: artifact.title,
            visiblePrompt: payload.visiblePrompt || payload.message || shell.workflow.continue,
            ...(payload.runMetadata?.workflowBinding
              ? { workflowBinding: payload.runMetadata.workflowBinding as AgentTaskDisplay['workflowBinding'] }
              : {}),
            ...(payload.runMetadata?.runArchive
              ? { runArchive: payload.runMetadata.runArchive as AgentTaskDisplay['runArchive'] }
              : {}),
            ...(genericWorkflow ? { genericWorkflow } : {}),
            ...(genericWorkflow
              ? {
                  taskContext: {
                    targetLabel: genericWorkflow.nodeTitle,
                    baseVersionKind: 'target-snapshot' as const,
                    baseVersionSource: JSON.stringify({
                      workflowRunId: genericWorkflow.runId,
                      stepRunId: genericWorkflow.stepRunId,
                      sourceArtifactId: artifact.id,
                      selectedIds: interaction.selectedIds,
                      feedback: interaction.feedback,
                    }),
                  },
                }
              : {}),
          });
        } catch (error) {
          if (pendingStepRunId) {
            setPendingWorkflowGenerations(current => {
              const next = { ...current };
              delete next[pendingStepRunId];
              return next;
            });
          }
          throw error;
        }
      }
      // Only terminal proposal reviews hand off here. Graphs with a configured
      // successor continue through their existing Agent execution owner above.
      if (!payload.agentPrompt && payload.state === 'completed' && reportDrafts.length) {
        await submitReportStoryboards(reportDrafts, {
          read: () => basicNodesRef.current,
          write: next => { basicNodesRef.current = next; setBasicNodes(next); },
          persist: () => flushCanvas(['workbenchBasicNodes']),
          submit: submitAgentTask,
        });
      }
      await refreshWorkflowArtifacts();
      window.dispatchEvent(new CustomEvent<WorkflowResultSyncDetail>(WORKFLOW_RESULT_SYNC_EVENT, {
        detail: {
          projectId: artifact.projectId,
          resultId: artifact.id,
          source: 'canvas',
          phase: 'committed',
          selectedIds: interaction.selectedIds,
          feedback: interaction.feedback,
        },
      }));
    } finally {
      setWorkflowArtifactBusyId('');
    }
  });

  // ── 业务链连线：下一张卡连上一张卡（单一真源 = 卡片声明的上游）──────
  //
  // 画布上每张派生卡都声明了自己的上游，连线不再按卡片类型各写一套 effect，
  // 而是从这份上游声明统一派生一套 `chain-` 边：
  //   载入卡     source = 建档卡(instance.id)
  //   首结果卡   source = 建档卡（parentResultId 为空时退回）
  //   下阶段结果卡 source = 上一张结果卡(parentResultId)
  //   正文卡     source = 最后一张产品句结果卡（无结果时退回建档卡）
  //
  // 载入卡就是首结果卡的「载入态」：两者 target 落在同一位置、source 都是建档卡。
  // 第一份 artifact 落盘后，载入卡消失、结果卡顶上，这条边的 source 不变、
  // target 换成结果卡——视觉上就是同一条线原地平移接管，不会闪断。
  const chainEdges = React.useMemo(() => {
    const list: CanvasEdge[] = [];
    const push = (source: string, target: string, sourceHandle?: string) => {
      list.push({
        id: `chain-${source}-${sourceHandle ?? 'group'}-${target}`,
        source,
        target,
        ...(sourceHandle ? { sourceHandle } : {}),
      });
    };
    // 阶段结果卡之间：上一张结果卡 → 下一张结果卡（首张退回建档卡）
    for (const artifact of workflowArtifacts) {
      const source = artifact.parentResultId
        ? workflowStageNodeId(artifact.parentResultId)
        : artifact.parentNodeId;
      if (!source) continue;
      const target = workflowStageNodeId(artifact.id);
      if (artifact.parentResultId && artifact.parentItemIds?.length) {
        for (const itemId of artifact.parentItemIds) {
          push(source, target, workflowResultItemHandleId(itemId));
        }
      } else {
        push(source, target);
      }
    }
    // Regeneration is a real branch from the current result. While the Agent
    // is running, draw the same lineage that the final artifact will inherit:
    // item regeneration starts at the subtle child handle; whole-card
    // regeneration starts at the outer group handle.
    for (const pending of Object.values(pendingWorkflowGenerations)) {
      const source = workflowStageNodeId(pending.sourceArtifactId);
      const target = workflowRegenerationPendingNodeId(pending.stepRunId);
      if (pending.selectedIds.length > 0) {
        for (const itemId of pending.selectedIds) {
          push(source, target, workflowResultItemHandleId(itemId));
        }
      } else {
        push(source, target);
      }
    }
    if (workflowPendingRequest?.parentResultId) {
      const source = workflowStageNodeId(workflowPendingRequest.parentResultId);
      const target = workflowInitialPendingNodeId(workflowPendingRequest.stepRunId);
      if (workflowPendingRequest.parentItemIds?.length) {
        for (const itemId of workflowPendingRequest.parentItemIds) {
          push(source, target, workflowResultItemHandleId(itemId));
        }
      } else {
        push(source, target);
      }
    }
    // A confirmed result may materialize as a real editable canvas node.
    // Keep that deliverable visibly attached to the exact historical result
    // the user confirmed instead of leaving it as an unrelated loose card.
    for (const lineage of materializedWorkflowArtifactLineage(basicNodes)) {
      const source = workflowStageNodeId(lineage.sourceResultId);
      if (lineage.sourceItemIds.length > 0) {
        for (const itemId of lineage.sourceItemIds) {
          push(source, lineage.targetNodeId, workflowResultItemHandleId(itemId));
        }
      } else {
        push(source, lineage.targetNodeId);
      }
    }
    return list;
  }, [basicNodes, workflowArtifacts, pendingWorkflowGenerations, workflowPendingRequest]);

  React.useEffect(() => {
    setEdges(current => {
      const base = Array.isArray(current) ? current : [];
      // 业务链边整体由 chainEdges 重建，因此先把旧链边全部剔除：
      //   chain-*                        当前口径
      //   workflow-* / pending-*         历史遗留（旧的两套 effect 持久化的）
      //   auto-* 指向 creative/topic/product/evaluation  更早的遗留
      // 其余（用户手绘边、视觉下游边 e-*、图片树边）原样保留。
      const kept = base.filter(edge => {
        const id = edge.id;
        if (id.startsWith('chain-') || id.startsWith('workflow-') || id.startsWith('pending-')) return false;
        if (id.startsWith('auto-evaluation-')) return false;
        if (id.startsWith('auto-') && (
          edge.target.startsWith('creative-')
          || edge.target.startsWith('topic-')
          || edge.target.startsWith('product-')
          || edge.target.startsWith('evaluation-')
        )) return false;
        return true;
      });
      const keptIds = new Set(kept.map(edge => edge.id));
      const additions = chainEdges.filter(edge => !keptIds.has(edge.id));
      const next = [...kept, ...additions];
      return JSON.stringify(next) === JSON.stringify(base) ? base : next;
    });
  }, [chainEdges, setEdges]);

  function persistInstances(next: CanvasInstance[]) {
    instancesRef.current = next;
    setInstances(next);
  }

  function placeWithoutOverlap(x: number, y: number, ignoreId?: string) {
    const CARD_W = 360;
    const CARD_H = 220;
    const STEP = 48;
    let nx = x;
    let ny = y;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const overlaps = instancesRef.current.some(item => (
        item.id !== ignoreId
        && Math.abs(item.x - nx) < CARD_W * 0.7
        && Math.abs(item.y - ny) < CARD_H * 0.55
      ));
      if (!overlaps) return { x: nx, y: ny };
      nx += STEP;
      ny += STEP;
    }
    return { x: nx, y: ny };
  }

  function currentViewportPlacement(width: number, height: number) {
    const defaultVideoFrame = getVideoFrameSize();
    const rect = canvasHostRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const padding = 24;
    const topLeft = toFlowPoint(rect.left + padding, rect.top + padding);
    const bottomRight = toFlowPoint(rect.right - padding, rect.bottom - padding);
    const occupied: CanvasRect[] = [
      ...instancesRef.current.map(instance => ({ x: instance.x, y: instance.y, width: 360, height: 240 })),
      ...basicNodesRef.current.map(existing => ({
        x: existing.x,
        y: existing.y,
        width: existing.width || (existing.kind === 'text' ? TEXT_CARD_DEFAULT_WIDTH : existing.kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_WIDTH : existing.kind === 'page' ? HTML_PAGE_CARD_SIZE.width : existing.kind === 'video' ? defaultVideoFrame.width : 320),
        height: existing.height || (existing.kind === 'text' ? TEXT_CARD_DEFAULT_HEIGHT : existing.kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_HEIGHT : existing.kind === 'page' ? HTML_PAGE_CARD_SIZE.height : existing.kind === 'video' ? defaultVideoFrame.height : 220),
      })),
    ];
    return placeCardInViewport({
      bounds: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
      center: toFlowPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
      width,
      height,
      occupied,
    });
  }

  function toFlowPoint(clientX: number, clientY: number) {
    const api = flowApiRef.current;
    if (api) return api.screenToFlow(clientX, clientY);
    return { x: clientX, y: clientY };
  }

  function ghostScreenOrigin(clientX: number, clientY: number) {
    return {
      x: clientX - SOURCE_GHOST_W / 2,
      y: clientY - 28,
    };
  }

  /**
   * 在画布上加一张卡。
   *
   * 返回新卡 id（没建成返回空串）—— 调用方有时要拿着 id 继续往卡里写东西，
   * 比如首页把用户敲的那句指令带进来时要写进这张卡的输入草稿。
   */
  function addInstance(...args: Parameters<typeof addInstanceImpl>): ReturnType<typeof addInstanceImpl> {
    return history.run(() => addInstanceImpl(...args));
  }

  function addInstanceImpl(
    kind: InstanceKind,
    clientX?: number,
    clientY?: number,
    mode: 'center' | 'ghost' = 'center',
    // 走流程链路的卡带上流程 id；不传即默认流程，兼容单流程时的一键添加
    flowId?: string,
    workflowConfig?: WorkflowEditorConfig,
    requestedPosition?: { x: number; y: number },
  ): string {
    const host = canvasHostRef.current;
    const rect = host?.getBoundingClientRect();
    const defaultX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const defaultY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const dropX = clientX ?? defaultX;
    const dropY = clientY ?? defaultY;
    const anchor = mode === 'ghost' ? ghostScreenOrigin(dropX, dropY) : { x: dropX, y: dropY };
    const world = toFlowPoint(anchor.x, anchor.y);
    const visiblePlacement = clientX == null && clientY == null && mode === 'center'
      ? currentViewportPlacement(360, 240)
      : null;
    const placed = requestedPosition ?? visiblePlacement ?? placeWithoutOverlap(
      mode === 'ghost' ? world.x : world.x - 180,
      mode === 'ghost' ? world.y : world.y - 120,
    );
    const instance: CanvasInstance = {
      id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      x: placed.x,
      y: placed.y,
      ...(flowId ? { flowId } : {}),
      ...(workflowConfig ? { workflowConfig } : {}),
      // 项目为容器，每张业务卡独立建档：拖入时不继承全局项目路径；
      // 建档由可选业务模块负责，画布只持久化返回的绑定。
    };
    persistInstances([...instancesRef.current, instance]);
    return instance.id;
  }

  function addBasicNode(...args: Parameters<typeof addBasicNodeImpl>): ReturnType<typeof addBasicNodeImpl> {
    return history.run(() => addBasicNodeImpl(...args));
  }

  function addBasicNodeImpl(
    kind: CanvasBasicNodeKind,
    artifactFormat?: 'html' | 'presentation',
    requestedPosition?: { x: number; y: number },
    collisionDirection: 'forward' | 'backward' | 'none' = 'forward',
    titleOverride?: string,
  ): string {
    const host = canvasHostRef.current;
    const rect = host?.getBoundingClientRect();
    const screenX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const screenY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const world = toFlowPoint(screenX, screenY);
    const id = `basic-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const title = titleOverride ?? (kind.startsWith('card.') ? kind.split('.').pop() ?? kind : canvasNodeDefaultTitle(canvasLocale, kind as CanvasNodeCreationKind | 'artifact', artifactFormat));
    const defaultVideoFrame = getVideoFrameSize();
    const width = kind === 'sketch' ? 420 : kind === 'video' ? defaultVideoFrame.width : kind === 'text' ? TEXT_CARD_DEFAULT_WIDTH : kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_WIDTH : kind === 'page' ? HTML_PAGE_CARD_SIZE.width : 320;
    const height = kind === 'sketch' ? 300 : kind === 'video' ? defaultVideoFrame.height : kind === 'text' ? TEXT_CARD_DEFAULT_HEIGHT : kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_HEIGHT : kind === 'page' ? HTML_PAGE_CARD_SIZE.height : 220;
    const visiblePlacement = requestedPosition ? null : currentViewportPlacement(width, height);
    let x = requestedPosition?.x ?? visiblePlacement?.x ?? world.x - width / 2;
    let y = requestedPosition?.y ?? visiblePlacement?.y ?? world.y - height / 2;
    for (let attempt = 0; requestedPosition && collisionDirection !== 'none' && attempt < 20; attempt += 1) {
      const overlaps = basicNodesRef.current.some(existing => {
        const existingWidth = existing.width || (existing.kind === 'text' ? TEXT_CARD_DEFAULT_WIDTH : existing.kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_WIDTH : existing.kind === 'page' ? HTML_PAGE_CARD_SIZE.width : existing.kind === 'video' ? defaultVideoFrame.width : 320);
        const existingHeight = existing.height || (existing.kind === 'text' ? TEXT_CARD_DEFAULT_HEIGHT : existing.kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_HEIGHT : existing.kind === 'page' ? HTML_PAGE_CARD_SIZE.height : existing.kind === 'video' ? defaultVideoFrame.height : 220);
        return x < existing.x + existingWidth + 48
          && x + width + 48 > existing.x
          && y < existing.y + existingHeight + 48
          && y + height + 48 > existing.y;
      });
      if (!overlaps) break;
      x += (width + 72) * (collisionDirection === 'backward' ? -1 : 1);
    }
    const item: CanvasBasicNode = {
      id,
      kind,
      x,
      y,
      width,
      height,
      title,
      ...(kind === 'sketch' ? { sketchPending: true, projectFilePath: projectLayoutPath(PROJECT_LAYOUT.sketches, `canvas-${id}.sketch.json`) } : {}),
      ...(kind === 'page' ? { artifactFormat: artifactFormat ?? 'html' } : {}),
      ...(kind === 'text' || kind === 'page' ? { text: '' } : {}),
      ...(kind === 'video' ? { text: '', videoAspect: '16:9', videoLength: 5, videoResolution: '720p' } : {}),
    };
    setBasicNodes(current => [...(Array.isArray(current) ? current : []), item]);
    basicNodesRef.current = [...basicNodesRef.current, item];
    flowApiRef.current?.activateNode(id);
    return id;
  }

  function addNodeFromCatalog(...args: Parameters<typeof addNodeFromCatalogImpl>): ReturnType<typeof addNodeFromCatalogImpl> {
    return history.run(() => addNodeFromCatalogImpl(...args));
  }

  function addNodeFromCatalogImpl(kind: CanvasNodeCreationKind, position?: { x: number; y: number }, titleOverride?: string): string {
    // The pointer shortcut supplies canvas coordinates captured at double-click;
    // the dock keeps its existing automatic placement in the visible viewport.
    const addBasic = (nodeKind: CanvasBasicNodeKind, format?: 'html' | 'presentation') =>
      addBasicNode(nodeKind, format, position, position ? 'none' : 'forward', titleOverride);
    if (kind === 'sketch') return addBasic('sketch');
    if (kind === 'browser') return addBasic('browser');
    const nodeId = kind === 'video'
        ? addBasic('video')
        : kind === 'text'
          ? addBasic('text')
          : kind === 'storyboard'
            ? addBasic('storyboard')
            : kind === 'page'
              ? addBasic('page', 'html')
              : kind === 'presentation'
                ? addBasic('page', 'presentation')
                : kind === 'image'
                  ? addInstance('visual', undefined, undefined, 'center', undefined, undefined, position)
                  : '';
    if (nodeId) flowApiRef.current?.activateNode(nodeId);
    return nodeId;
  }

  React.useEffect(() => {
    if (!nodeCreationRequest) return;
    if (consumedNodeCreationNonceRef.current === nodeCreationRequest.nonce) return;
    const nodeId = addNodeFromCatalog(nodeCreationRequest.kind, nodeCreationRequest.position, nodeCreationRequest.title);
    if (!nodeId) return;
    consumedNodeCreationNonceRef.current = nodeCreationRequest.nonce;
    onNodeCreationConsumed?.(nodeCreationRequest.nonce, nodeId);
  }, [nodeCreationRequest, onNodeCreationConsumed]);

  function addUpstreamTextNode(...args: Parameters<typeof addUpstreamTextNodeImpl>): ReturnType<typeof addUpstreamTextNodeImpl> {
    return history.run(() => addUpstreamTextNodeImpl(...args));
  }

  function addUpstreamTextNodeImpl(
    targetId: string,
    origin: ImageConnectedNodeOrigin,
  ) {
    const existingSourceId = (Array.isArray(edgesRef.current) ? edgesRef.current : [])
      .filter(edge => edge.target === targetId)
      .map(edge => basicNodesRef.current.find(node => node.id === edge.source))
      .find(node => node?.kind === 'text')?.id;
    if (existingSourceId) {
      patchBasicNode(targetId, { storyboardEntryMode: 'generate' });
      flowApiRef.current?.activateNode(targetId);
      return existingSourceId;
    }

    const normalizedTargetWidth = origin.width === 480 || origin.width === 680
      ? STORYBOARD_CARD_DEFAULT_WIDTH
      : Math.max(origin.width || 0, STORYBOARD_CARD_DEFAULT_WIDTH);
    const normalizedTargetHeight = origin.height === 420 || origin.height === 560
      ? STORYBOARD_CARD_DEFAULT_HEIGHT
      : Math.max(origin.height || 0, STORYBOARD_CARD_DEFAULT_HEIGHT);
    const placement = findStoryboardPairPlacement({
      target: {
        x: origin.x,
        y: origin.y,
        width: normalizedTargetWidth,
        height: normalizedTargetHeight,
      },
      sourceWidth: TEXT_CARD_DEFAULT_WIDTH,
      sourceHeight: TEXT_CARD_DEFAULT_HEIGHT,
      obstacles: basicNodesRef.current
        .filter(node => node.id !== targetId)
        .map(node => ({
          x: node.x,
          y: node.y,
          width: node.width || (node.kind === 'text' ? TEXT_CARD_DEFAULT_WIDTH : node.kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_WIDTH : node.kind === 'page' ? HTML_PAGE_CARD_SIZE.width : 320),
          height: node.height || (node.kind === 'text' ? TEXT_CARD_DEFAULT_HEIGHT : node.kind === 'storyboard' ? STORYBOARD_CARD_DEFAULT_HEIGHT : node.kind === 'page' ? HTML_PAGE_CARD_SIZE.height : 220),
        })),
    });
    patchBasicNode(targetId, { x: placement.target.x, y: placement.target.y });
    const sourceId = addBasicNode('text', undefined, {
      x: placement.source.x,
      y: placement.source.y,
    }, 'none');
    patchBasicNode(sourceId, { text: STORYBOARD_SOURCE_EXAMPLE });
    patchBasicNode(targetId, { storyboardEntryMode: 'generate', generation: undefined });
    setEdges(current => {
      const edges = Array.isArray(current) ? current : [];
      const next = [...edges, {
        id: `e-${sourceId}-${targetId}-${Date.now().toString(36)}`,
        source: sourceId,
        target: targetId,
      }];
      edgesRef.current = next;
      return next;
    });
    // The sample text is supporting context. The storyboard remains the
    // operation target and therefore owns selection and its Composer.
    flowApiRef.current?.activateNode(targetId);
    return sourceId;
  }

  function addConnectedNode(...args: Parameters<typeof addConnectedNodeImpl>): ReturnType<typeof addConnectedNodeImpl> {
    return history.run(() => addConnectedNodeImpl(...args));
  }

  function addConnectedNodeImpl(
    sourceId: string,
    kind: ImageConnectedNodeKind,
    origin: ImageConnectedNodeOrigin,
  ) {
    const owner = organizationGroups.find(group => group.memberIds.includes(sourceId))
      || imageGroupsRef.current.find(group => group.memberIds.includes(sourceId));
    const targetX = owner ? owner.x + owner.width + 120 : origin.x + origin.width + 120;
    const targetY = owner ? owner.y : origin.y;
    let targetId = '';

    if (kind === 'sketch' || kind === 'video' || kind === 'text' || kind === 'storyboard' || kind === 'page' || kind === 'presentation') {
      targetId = addBasicNode(
        kind === 'sketch' ? 'sketch' : kind === 'video' ? 'video' : kind === 'text' ? 'text' : kind === 'storyboard' ? 'storyboard' : 'page',
        kind === 'presentation' ? 'presentation' : kind === 'page' ? 'html' : undefined,
        { x: targetX, y: targetY },
      );
      if (kind === 'text' && origin.textInstruction) {
        patchBasicNode(targetId, { textInstruction: origin.textInstruction, title: origin.title || shell.workflow.text });
      }
      if (kind === 'storyboard' && origin.storyboardEntryMode === 'generate') {
        patchBasicNode(targetId, { storyboardEntryMode: 'generate', generation: undefined });
      }
      if (kind === 'video') patchBasicNode(targetId, { text: origin.prompt || '' });
    } else {
      let placed = placeWithoutOverlap(targetX, targetY);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const occupied = basicNodesRef.current.find(node => (
          placed.x < node.x + (node.width || 480) + 48
          && placed.x + 420 + 48 > node.x
          && placed.y < node.y + (node.height || 500) + 48
          && placed.y + 300 + 48 > node.y
        ));
        if (!occupied) break;
        placed = placeWithoutOverlap(occupied.x + (occupied.width || 480) + 120, placed.y);
      }
      targetId = `visual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const instance: CanvasInstance = { id: targetId, kind: 'visual', x: placed.x, y: placed.y };
      persistInstances([...instancesRef.current, instance]);

      const sourceImage = imagesRef.current.find(image => image.id === sourceId)
        ?? imagesRef.current.find(image => image.sourceInstanceId === sourceId && image.embeddedInSource);
      setTaskDrafts(current => {
        const drafts = normalizeTaskDrafts(current);
        // 独立图片节点用 image.id 连线，但生图设置仍存放在它所属的视觉卡草稿中。
        const sourceDraft = resolveConnectedVisualSourceDraft(
          drafts,
          sourceId,
          sourceImage?.sourceInstanceId,
        );
        return {
          ...drafts,
          [targetId]: {
            text: origin.prompt || '',
            attachments: origin.attachments || [],
            ...inheritConnectedVisualDraftSettings(sourceDraft),
            ...(origin.imageRatio
              ? { imageRatio: origin.imageRatio, imageRatios: [origin.imageRatio] }
              : {}),
          },
        };
      });
    }

    setEdges(current => {
      const next = Array.isArray(current) ? current : [];
      return [...next, {
        id: `e-${sourceId}-${targetId}-${Date.now().toString(36)}`,
        source: sourceId,
        target: targetId,
        ...(origin.skipSourceContext ? { data: { skipSourceContext: true } } : {}),
      }, ...(origin.attachments || []).flatMap(attachment => {
        const sourceNodeId = 'sourceNodeId' in attachment ? String(attachment.sourceNodeId) : '';
        return sourceNodeId && sourceNodeId !== sourceId && !next.some(edge => edge.source === sourceNodeId && edge.target === targetId)
          ? [{ id: `e-${sourceNodeId}-${targetId}`, source: sourceNodeId, target: targetId }]
          : [];
      })];
    });
    // Downstream creation has one exit: once the new node reaches React Flow,
    // it becomes the sole selection and owns the only Composer. Activation
    // deliberately leaves the viewport untouched; the API only keeps a pending
    // selection when this call arrives before the controlled node has mounted.
    flowApiRef.current?.activateNode(targetId);
    return targetId;
  }

  function patchBasicNode(id: string, patch: Partial<CanvasBasicNode>) {
    const apply = () => {
      const current = basicNodesRef.current.find(item => item.id === id);
      if (!acceptsCanvasGenerationPatch(current?.generation, patch.generation)) return;
      const safePatch = canvasTextPatchWithCopyOnWrite(basicNodesRef.current, id, patch);
      const next = basicNodesRef.current.map(item => (item.id === id ? { ...item, ...safePatch } : item));
      basicNodesRef.current = next;
      setBasicNodes(next);
    };
    // Editor content and generation updates retain their own lifecycle.
    const fields = Object.keys(patch);
    if (fields.length && fields.every(key => key === 'width' || key === 'height')) history.run(apply);
    else apply();
  }

  function removeBasicNode(...args: Parameters<typeof removeBasicNodeImpl>): ReturnType<typeof removeBasicNodeImpl> {
    return history.run(() => removeBasicNodeImpl(...args));
  }

  function removeBasicNodeImpl(id: string) {
    const next = basicNodesRef.current.filter(item => item.id !== id);
    basicNodesRef.current = next;
    setBasicNodes(next);
    setEdges(current => (Array.isArray(current) ? current : []).filter(edge => edge.source !== id && edge.target !== id));

  }

  async function duplicateBasicNode(id: string): Promise<void> {
    const source = basicNodesRef.current.find(item => item.id === id);
    if (!source) return;
    if (source.kind === 'page') {
      const context = getCanvasHostContext();
      const version = JSON.stringify([source.projectFilePath, source.generation, source.resultHistory]);
      try {
        const patch = await duplicateCanvasPage(source, context, () => {
          const current = basicNodesRef.current.find(item => item.id === id);
          return getCanvasHostContext().projectId === context.projectId && Boolean(current)
            && JSON.stringify([current?.projectFilePath, current?.generation, current?.resultHistory]) === version;
        });
        if (patch) history.run(() => duplicateBasicNodeImpl(id, patch));
      } catch (error) {
        window.alert(error instanceof Error ? error.message : shell.workflow.opFailed);
      }
      return;
    }
    if (source.kind !== 'sketch') { history.run(() => duplicateBasicNodeImpl(id)); return; }
    const projectId = getCanvasHostContext().projectId;
    const destination = projectLayoutPath(PROJECT_LAYOUT.sketches, `canvas-${crypto.randomUUID()}.sketch.json`);
    try {
      if (!uiHost?.duplicateSketch) throw new Error(shell.workflow.opFailed);
      await uiHost.duplicateSketch(source.projectFilePath || `canvas-${id}.sketch.json`, destination, source.sketchPending === true);
      if (getCanvasHostContext().projectId !== projectId || !basicNodesRef.current.some(item => item.id === id)) return;
      history.run(() => duplicateBasicNodeImpl(id, { projectFilePath: destination, sketchPending: false }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : shell.workflow.opFailed);
    }
  }

  function duplicateBasicNodeImpl(id: string, patch?: Partial<CanvasBasicNode>) {
    const source = basicNodesRef.current.find(item => item.id === id);
    if (!source) return;
    let duplicate: CanvasBasicNode = {
      ...source,
      id: `basic-${source.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      x: source.x + 36,
      y: source.y + 36,
      ...patch,
      ...(source.storyboard ? { storyboard: cloneStoryboardPlan(source.storyboard) } : {}),
    };
    let sourceForNext = source;
    if (source.kind === 'text') {
      const shared = shareCanvasTextForDuplicate(source, duplicate);
      sourceForNext = shared.source;
      duplicate = shared.duplicate;
    }
    basicNodesRef.current = [
      ...basicNodesRef.current.map(item => item.id === source.id ? sourceForNext : item),
      duplicate,
    ];
    setBasicNodes(basicNodesRef.current);
    flowApiRef.current?.activateNode(duplicate.id);
  }

  async function pickImageForBasicNode(id: string, file: File) {
    const source = basicNodesRef.current.find(item => item.id === id);
    if (!source) return;
    const added = await addImagesFromFiles([file], { x: source.x, y: source.y });
    if (added) removeBasicNode(id);
  }

  function duplicateInstance(...args: Parameters<typeof duplicateInstanceImpl>): ReturnType<typeof duplicateInstanceImpl> {
    return history.run(() => duplicateInstanceImpl(...args));
  }

  /**
   * 复制一张能力卡（方案 / 视觉 / 视频），连同卡内那份草稿一起。
   *
   * 草稿才是用户真正配出来的东西——提示词、模型、比例、分辨率、附件、流程参数
   * 全在 taskDrafts[instanceId] 里，只克隆 instance 会得到一张空壳。所以这里
   * 一并把草稿按新 id 写一份。
   *
   * 有两类字段必须丢掉，否则副本会被当成原卡：
   *   - imageTaskId / activeImageTasks / visualRequestId：在途生成任务的回执
   *     地址，继承会让副本一直显示「生成中」，或把结果同时写进两张卡。
   *   - visualPhase：跟着上面那批任务走，一并回到 idle。
   *
   * 附件整份带走，但连线带来的那些（attachment.sourceNodeId 有值）会在下一轮
   * 连线同步里被自动摘掉——副本身上没有那条连线，留着就是悬空引用。用户手动
   * 传的附件没有 sourceNodeId，不受影响。这是期望行为，不是丢数据。
   */
  function duplicateInstanceImpl(instance: CanvasInstance) {
    const source = instancesRef.current.find(item => item.id === instance.id);
    if (!source) return;
    const duplicate: CanvasInstance = {
      ...source,
      id: `${source.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      x: source.x + 36,
      y: source.y + 36,
      ...(source.workflowConfig
        ? { workflowConfig: JSON.parse(JSON.stringify(source.workflowConfig)) as WorkflowEditorConfig }
        : {}),
    };
    const sourceDraft = safeTaskDrafts[source.id];
    if (sourceDraft) {
      const {
        imageTaskId: _imageTaskId,
        activeImageTasks: _activeImageTasks,
        visualRequestId: _visualRequestId,
        visualPhase: _visualPhase,
        ...draftConfig
      } = sourceDraft;
      updateDraft(duplicate.id, {
        ...draftConfig,
        attachments: [...(sourceDraft.attachments || [])],
        ...(sourceDraft.planParameters ? { planParameters: { ...sourceDraft.planParameters } } : {}),
        ...(sourceDraft.models ? { models: [...sourceDraft.models] } : {}),
        ...(sourceDraft.imageRatios ? { imageRatios: [...sourceDraft.imageRatios] } : {}),
      });
    }
    persistInstances([...instancesRef.current, duplicate]);
    flowApiRef.current?.activateNode(duplicate.id);
  }

  function onNodeRemove(...args: Parameters<typeof onNodeRemoveImpl>): ReturnType<typeof onNodeRemoveImpl> {
    return history.run(() => onNodeRemoveImpl(...args));
  }

  function onNodeRemoveImpl(instance: CanvasInstance) {
    const removedIds = new Set([
      instance.id,
      creativeNodeId(instance.id),
      topicNodeId(instance.id),
      articleNodeId(instance.id),
      evaluationNodeId(instance.id, 'creative'),
      evaluationNodeId(instance.id, 'topic'),
      evaluationNodeId(instance.id, 'product_sentence'),
      evaluationNodeId(instance.id, 'plan'),
    ]);
    persistInstances(instancesRef.current.filter(item => item.id !== instance.id));
    setImages(current => (Array.isArray(current) ? current : []).filter(image => !(
      image.sourceInstanceId === instance.id && image.embeddedInSource
    )));
    setEdges(current => (Array.isArray(current) ? current : []).filter(edge => !removedIds.has(edge.source) && !removedIds.has(edge.target)));
    delete creativePositionsRef.current[creativeNodeId(instance.id)];
    delete topicPositionsRef.current[topicNodeId(instance.id)];
    for (const id of Object.keys(productPositionsRef.current)) {
      if (id === productNodeId(instance.id) || id.startsWith(`${productNodeId(instance.id)}-round-`)) {
        delete productPositionsRef.current[id];
      }
    }
    delete articlePositionsRef.current[articleNodeId(instance.id)];
    for (const stage of ['creative', 'topic', 'product_sentence', 'plan'] as const) {
      delete evaluationPositionsRef.current[evaluationNodeId(instance.id, stage)];
    }
  }

  function showImageToast(id: string, message: string) {
    setImageToasts(current => ({ ...current, [id]: message }));
    if (imageToastTimers.current[id]) window.clearTimeout(imageToastTimers.current[id]);
    imageToastTimers.current[id] = window.setTimeout(() => {
      setImageToasts(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      delete imageToastTimers.current[id];
    }, 1800);
  }

  async function uploadImageFile(file: File, _instanceId = 'canvas-assets') {
    const context = getCanvasHostContext();
    const uploaded = await uploadCanvasAttachment(file, context);
    return { ...uploaded, src: projectFileUrl(uploaded.path, context) };
  }

  async function probeImageSize(src: string) {
    return new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 320, height: img.naturalHeight || 240 });
      img.onerror = () => resolve({ width: 320, height: 240 });
      img.src = src;
    });
  }

  async function addImagesFromFiles(files: File[], flowPosition: { x: number; y: number }) {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (!imageFiles.length) return false;
    try {
      const created: WorkbenchImage[] = [];
      for (const [index, file] of imageFiles.entries()) {
        const uploaded = await uploadImageFile(file);
        const size = await probeImageSize(uploaded.src);
        created.push({
          id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          src: uploaded.src,
          path: uploaded.path,
          name: uploaded.name,
          x: flowPosition.x + index * 36,
          y: flowPosition.y + index * 36,
          naturalWidth: size.width,
          naturalHeight: size.height,
        });
      }
      history.run(() => setImages(current => [...(Array.isArray(current) ? current : []), ...created]));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : shell.errors.imageUploadFailed;
      window.alert(message);
      return false;
    }
  }

  function addPersonalAssetTemplateToCanvas(
    file: ProjectFileDragPayload,
    flowPosition: { x: number; y: number },
  ) {
    const source = file.sourceAsset;
    const template = source?.template;
    if (!source || !template) return false;

    const title = source.name || file.name.split('/').pop() || file.name;
    const prompt = template.prompt.trim();
    if (source.kind === 'slides' || template.type === 'Slides') {
      const nodeId = addBasicNode(
        'page',
        'presentation',
        { x: flowPosition.x - 320, y: flowPosition.y - 180 },
        'none',
      );
      patchBasicNode(nodeId, {
        title,
        text: prompt,
        presentationOptions: {
          length: 'standard',
          template: template.id,
          templateTitle: title,
          templateDescription: source.description,
          templateReferencePath: template.referencePath,
          templatePrompt: prompt,
        },
      });
      return true;
    }

    if (
      source.kind === 'webpage'
      || source.kind === 'motion'
      || template.type === 'Prototype'
      || template.type === 'HyperFrames'
    ) {
      const nodeId = addBasicNode(
        'page',
        'html',
        { x: flowPosition.x - 260, y: flowPosition.y - 180 },
        'none',
      );
      patchBasicNode(nodeId, {
        title,
        text: prompt,
        webpageOptions: {
          template: template.id,
          templateTitle: title,
          templateDescription: source.description,
          templateReferencePath: template.referencePath,
          templatePrompt: prompt,
        },
      });
      return true;
    }

    const instanceKind: InstanceKind | null = source.kind === 'image' || template.type === 'Image'
      ? 'visual'
      : source.kind === 'video' || template.type === 'Video'
        ? 'video'
        : null;
    if (!instanceKind) return false;
    const placed = placeWithoutOverlap(flowPosition.x - 180, flowPosition.y - 120);
    const instance: CanvasInstance = {
      id: `${instanceKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: instanceKind,
      x: placed.x,
      y: placed.y,
      label: title,
    };
    history.run(() => persistInstances([...instancesRef.current, instance]));
    updateDraft(instance.id, {
      text: prompt,
      attachments: [],
      ...(instanceKind === 'visual' ? { rawPrompt: true } : {}),
    });
    flowApiRef.current?.activateNode(instance.id);
    return true;
  }

  async function addProjectFileToCanvas(
    file: ProjectFileDragPayload,
    flowPosition: { x: number; y: number },
    referenceTargetId?: string,
    shouldApply: () => boolean = () => true,
  ) {
    if (file.projectId !== getCanvasHostContext().projectId) {
      window.alert(shell.errors.onlyProjectFiles);
      return false;
    }
    const targetExists = () => shouldApply() && (!referenceTargetId || basicNodesRef.current.some(node => node.id === referenceTargetId));
    if (!targetExists()) return false;
    const finish = (sourceId: string) => {
      if (!referenceTargetId) { flowApiRef.current?.activateNode(sourceId); return; }
      setEdges(current => {
        if (current.some(edge => edge.source === sourceId && edge.target === referenceTargetId)) return current;
        const next = [...current, { id: `e-${sourceId}-${referenceTargetId}`, source: sourceId, target: referenceTargetId }];
        edgesRef.current = next;
        return next;
      });
      flowApiRef.current?.activateNode(referenceTargetId);
    };
    try {
      if (referenceTargetId) {
        const existing = basicNodesRef.current.find(node => node.id !== referenceTargetId && node.projectFilePath === file.name)
          || images.find(image => image.id !== referenceTargetId && image.path === file.name);
        if (existing) { history.run(() => finish(existing.id)); return true; }
      }
      if (!referenceTargetId && addPersonalAssetTemplateToCanvas(file, flowPosition)) return true;
      const title = file.sourceAsset?.name || file.name.split('/').pop() || file.name;
      if (/\.storyboard\.json$/i.test(file.name) || file.kind === 'video') {
        const script = /\.storyboard\.json$/i.test(file.name);
        let storyboard;
        if (script) {
          const response = await fetch(projectFileUrl(file.name));
          if (!response.ok) throw new Error(shell.errors.readStoryboardFailed);
          storyboard = parseSavedStoryboardPlan(await response.text());
        }
        const node: CanvasBasicNode = {
          id: `basic-${script ? 'storyboard' : 'video'}-${crypto.randomUUID()}`,
          kind: script ? 'storyboard' : 'video', title,
          x: flowPosition.x - 240, y: flowPosition.y - 80,
          projectFilePath: file.name, sourceMime: file.mime,
          ...(storyboard ? {storyboard, storyboardEntryMode: 'edit' as const} : {width:480,height:300,videoTask:{id:`import-${crypto.randomUUID()}`,status:'done' as const,path:file.name}}),
        };
        if (!targetExists()) return false;
        history.run(() => { basicNodesRef.current = [...basicNodesRef.current, node]; setBasicNodes(basicNodesRef.current); finish(node.id); });
        return true;
      }
      if (isCanvasArtifactFile(file)) {
        history.run(() => finish(addArtifactToCanvasImpl({ ...projectFileArtifactDescriptor(getCanvasHostContext().projectId, file), title }, flowPosition)));
        return true;
      }
      if (file.kind === 'image') {
        const src = imageFileUrl(file.name);
        const size = await probeImageSize(src);
        const image: WorkbenchImage = {
          id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          src,
          path: file.name,
          name: title,
          x: flowPosition.x,
          y: flowPosition.y,
          naturalWidth: size.width,
          naturalHeight: size.height,
        };
        if (!targetExists()) return false;
        history.run(() => { setImages(current => [...(Array.isArray(current) ? current : []), image]); finish(image.id); });
        return true;
      }

      if (file.kind === 'sketch') {
        const node: CanvasBasicNode = {
          id: `basic-sketch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'sketch', title: shell.workflow.sketch, projectFilePath: file.name,
          x: flowPosition.x - 210, y: flowPosition.y - 150, width: 420, height: 300,
        };
        history.run(() => { basicNodesRef.current = [...basicNodesRef.current, node]; setBasicNodes(basicNodesRef.current); finish(node.id); });
        return true;
      }
      const textual = ['text', 'code', 'html'].includes(file.kind)
        || (file.kind === 'document' && (/^text\//i.test(file.mime) || /\.(md|markdown|txt)$/i.test(file.name)));
      let text = '';
      if (textual) {
        const encodedPath = file.name.split('/').map(encodeURIComponent).join('/');
        const response = await projectFetch(`/text-preview/${encodedPath}?limit=120000`);
        const payload = await response.json().catch(() => null) as { text?: string; truncated?: boolean } | null;
        if (!response.ok || typeof payload?.text !== 'string') {
          throw new Error(shell.errors.readTitleFailed(title, response.status));
        }
        text = payload.text + (payload.truncated ? shell.content.truncatedCanvas : '');
      } else {
        text = shell.content.projectFileRef(file);
      }
      const kind: CanvasBasicNodeKind = file.kind === 'html' ? 'page' : 'text';
      const node: CanvasBasicNode = {
        id: `basic-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        x: flowPosition.x - (kind === 'text' ? TEXT_CARD_DEFAULT_WIDTH / 2 : HTML_PAGE_CARD_SIZE.width / 2),
        y: flowPosition.y - (kind === 'text' ? 60 : HTML_PAGE_CARD_SIZE.height / 2),
        width: kind === 'text' ? TEXT_CARD_DEFAULT_WIDTH : HTML_PAGE_CARD_SIZE.width,
        height: kind === 'text' ? TEXT_CARD_DEFAULT_HEIGHT : HTML_PAGE_CARD_SIZE.height,
        title,
        text,
        projectFilePath: file.name,
        sourceMime: file.mime,
      };
      if (!targetExists()) return false;
      history.run(() => { basicNodesRef.current = [...basicNodesRef.current, node]; setBasicNodes(basicNodesRef.current); finish(node.id); });
      return true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : shell.errors.cannotAddFile(file.name));
      return false;
    }
  }

  const addCollectedFileRef = React.useRef(addProjectFileToCanvas);
  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || !uiHost?.saveResource) return;
    const saveResource = uiHost.saveResource;
    const save = (event: Event) => {
      const detail = (event as CustomEvent).detail as { nodeId: string; resolve: () => void; reject: (error: Error) => void };
      event.stopPropagation();
      const basic = basicNodesRef.current.find(n => n.id === detail.nodeId);
      const image = imagesRef.current.find(n => n.id === detail.nodeId);
      let input: Parameters<NonNullable<typeof uiHost.saveResource>>[0] | undefined;
      if (image) input = { name: image.name || shell.labels.boardImage, filename: image.name || 'image.png', sourcePath: image.path, mime: 'image/png', url: image.path ? imageFileUrl(image.path) : image.src };
      else if (basic?.kind === 'text') input = { name: basic.title, filename: `${basic.title}.md`, mime: 'text/plain', text: basic.text || '', kind: 'text' };
      else if (basic?.storyboard) input = { name: basic.title, filename: `${basic.title}.storyboard.json`, mime: 'application/json', text: JSON.stringify(snapshotStoryboard(basic.storyboard, storyboardAssetsRef.current), null, 2), kind: 'script' };
      else if (basic) {
        const file = basic.projectFilePath || basic.videoResults?.find(v => v.id === basic.activeVideoResultId)?.path || basic.videoTask?.path || (basic.artifact?.resource.kind === 'project-file' ? basic.artifact.resource.path : undefined) || basic.generation?.previewPath;
        if (file) input = { name: basic.title, filename: file.split('/').pop()!, mime: basic.sourceMime || 'application/octet-stream', url: projectFileUrl(file), ...(basic.kind === 'page' ? {kind:basic.artifactFormat === 'presentation' ? 'slides' as const : 'webpage' as const} : {}) };
      }
      if (!input || (!input.url && input.text === undefined)) { detail.reject(new Error(shell.errors.finishBeforeSaveAsset)); return; }
      if (basic) input.sourcePath = basic.projectFilePath || basic.videoResults?.find(v => v.id === basic.activeVideoResultId)?.path || basic.videoTask?.path || (basic.artifact?.resource.kind === 'project-file' ? basic.artifact.resource.path : undefined) || basic.generation?.previewPath;
      void saveResource({ ...input, nodeId: detail.nodeId }).then(detail.resolve, detail.reject);
    };
    host.addEventListener('canvas:save-resource', save);
    return () => host.removeEventListener('canvas:save-resource', save);
  }, [uiHost]);
  addCollectedFileRef.current = addProjectFileToCanvas;
  React.useEffect(() => {
    const addFile = (event: Event) => {
      const file = parseProjectFileDragPayload(JSON.stringify((event as CustomEvent).detail ?? null));
      if (!file || file.projectId !== getCanvasHostContext().projectId) return;
      const rect = canvasHostRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const drop = (event as CustomEvent).detail as ProjectFileCanvasAddOptions & { onComplete?: (success: boolean) => void };
      const x = Number.isFinite(drop.clientX) ? drop.clientX! : rect.left + rect.width / 2;
      const y = Number.isFinite(drop.clientY) ? drop.clientY! : rect.top + rect.height / 2;
      const target = drop.referenceTargetId && basicNodesRef.current.find(node => node.id === drop.referenceTargetId);
      const position = target ? { x: target.x - TEXT_CARD_DEFAULT_WIDTH / 2 - 80, y: target.y + 60 } : toFlowPoint(x, y);
      void addCollectedFileRef.current(file, position, drop.referenceTargetId, drop.shouldApply).then(success => drop.onComplete?.(success));
    };
    window.addEventListener(PROJECT_FILE_ADD_TO_CANVAS_EVENT, addFile);
    return () => window.removeEventListener(PROJECT_FILE_ADD_TO_CANVAS_EVENT, addFile);
  }, []);

  function addArtifactToCanvas(...args: Parameters<typeof addArtifactToCanvasImpl>): ReturnType<typeof addArtifactToCanvasImpl> {
    return history.run(() => addArtifactToCanvasImpl(...args));
  }

  function addArtifactToCanvasImpl(
    artifact: CanvasArtifactLaunchRequest['artifact'],
    flowPosition: { x: number; y: number },
  ): string {
    if (artifact.renderer === 'image' && artifact.resource.kind === 'project-file') {
      const image: WorkbenchImage = {
        id: `img-${crypto.randomUUID()}`, name: artifact.title,
        path: artifact.resource.path, src: imageFileUrl(artifact.resource.path),
        x: flowPosition.x, y: flowPosition.y, status: 'ready',
      };
      setImages(current => [...current, image]);
      return image.id;
    }
    const node = createCanvasArtifactNode({
      id: `basic-artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      x: flowPosition.x - HTML_PAGE_CARD_SIZE.width / 2,
      y: flowPosition.y - HTML_PAGE_CARD_SIZE.height / 2,
      artifact,
    });
    basicNodesRef.current = [...basicNodesRef.current, node];
    setBasicNodes(basicNodesRef.current);
    flowApiRef.current?.activateNode(node.id);
    return node.id;
  }

  const consumeArtifactLaunch = useEffectEvent((request: CanvasArtifactLaunchRequest) => {
    if (consumedArtifactLaunchNonceRef.current === request.nonce) return;
    consumedArtifactLaunchNonceRef.current = request.nonce;
    addArtifactToCanvas(request.artifact, request.position ?? { x: 360, y: 240 });
    onArtifactLaunchConsumed?.(request.nonce);
  });

  React.useEffect(() => {
    if (!artifactLaunchRequest) return;
    consumeArtifactLaunch(artifactLaunchRequest);
  }, [artifactLaunchRequest, consumeArtifactLaunch]);

  function removeImage(...args: Parameters<typeof removeImageImpl>): ReturnType<typeof removeImageImpl> {
    return history.run(() => removeImageImpl(...args));
  }

  function removeImageImpl(id: string) {
    const image = imagesRef.current.find(item => item.id === id);
    const groupId = image?.groupId;
    setImages(current => (Array.isArray(current) ? current : []).filter(item => item.id !== id));
    setPromptCards(current => (Array.isArray(current) ? current : []).filter(card => card.imageId !== id));
    setEdges(current => (Array.isArray(current) ? current : []).filter(edge => edge.source !== id && edge.target !== id));
    setOrganizationGroups(current => removeOrganizationMembers([id], current));
    setImageToasts(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (!groupId) return;
    const group = imageGroupsRef.current.find(item => item.id === groupId);
    if (!group) return;
    const remaining = group.memberIds.filter(memberId => memberId !== id);
    const members = imagesRef.current.filter(item => remaining.includes(item.id));
    const memberNodes = members.map(item => ({ id: item.id, position: { x: item.x, y: item.y }, measured: getImageDisplaySize(item.naturalWidth, item.naturalHeight), data: {} }));
    const layout = moveRelativeGroupMembers(memberNodes.slice(0, 1).map(item => ({ id: item.id, ...item.position })), [{ ...group, layoutMode: 'free' as const, memberIds: remaining }], memberNodes);
    const placeById = new Map(layout.positions.map(item => [item.id, item]));
    setImageGroups(current => (Array.isArray(current) ? current : []).map(item => (
      item.id === groupId
        ? layout.groups[0]!
        : item
    )));
    setImages(current => (Array.isArray(current) ? current : []).map(item => {
      const place = placeById.get(item.id);
      return place ? { ...item, x: place.x, y: place.y } : item;
    }));
  }

  function duplicateImage(...args: Parameters<typeof duplicateImageImpl>): ReturnType<typeof duplicateImageImpl> {
    return history.run(() => duplicateImageImpl(...args));
  }

  /**
   * 复制一张图片节点：保留全部生成配置，素材文件本身共用不另存一份。
   *
   * 沿用基础卡 duplicateBasicNode 的约定 —— 新 id、右下偏移 36px、进历史栈、
   * 复制完激活新节点。差别在于图片带着一批「身份字段」，照搬会让副本被系统
   * 误认成原图：
   *
   *   - taskId / cutoutTaskId：指向生成任务。留着的话任务回调会把结果同时写进
   *     两个节点，或者让副本一直显示「生成中」。
   *   - groupId：副本会被当成参考图组成员，但组的 memberIds 里并没有它，
   *     位置计算会错乱（组内 x/y 是相对坐标）。
   *   - sourceInstanceId / embeddedInSource：标记「这是某张视觉母卡的首张结果」，
   *     副本继承会导致母卡内嵌显示错位。
   * 这些一律丢弃；用户可见的配置（提示词、模型、比例、分辨率、合成参数等）
   * 全部保留，避免复制动作改变原节点状态。
   */
  function duplicateImageImpl(id: string) {
    const source = imagesRef.current.find(item => item.id === id);
    if (!source) return;
    const {
      taskId: _taskId,
      cutoutTaskId: _cutoutTaskId,
      cutoutSourceImageId: _cutoutSourceImageId,
      groupId: _groupId,
      sourceInstanceId: _sourceInstanceId,
      embeddedInSource: _embeddedInSource,
      slotId: _slotId,
      outputIndex: _outputIndex,
      error: _error,
      ...config
    } = source;
    const duplicate: WorkbenchImage = {
      ...config,
      id: `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      x: source.x + 36,
      y: source.y + 36,
      status: 'ready',
      parentImageId: source.id,
    };
    setImages(current => [...(Array.isArray(current) ? current : []), duplicate]);
    flowApiRef.current?.activateNode(duplicate.id);
  }

  function groupSelectedImages(...args: Parameters<typeof groupSelectedImagesImpl>): ReturnType<typeof groupSelectedImagesImpl> {
    return history.run(() => groupSelectedImagesImpl(...args));
  }

  function groupSelectedImagesImpl(imageIds: string[], geometry?: GroupMemberGeometry[]) {
    const uniqueIds = [...new Set(imageIds)];
    if (uniqueIds.length < 2) return shell.errors.pickAtLeastTwoImages;
    const members = uniqueIds.map(id => imagesRef.current.find(item => item.id === id));
    if (members.some(item => !item)) return shell.errors.imageNotReady;
    for (const item of members) {
      const error = groupCandidateReason({ id: item!.id, type: 'imageAsset', parentId: item!.groupId, embedded: item!.embeddedInSource });
      if (error) return error;
    }
    const validMembers = members as WorkbenchImage[];
    const groupId = `img-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const liveGeometry = new Map((geometry ?? []).map(item => [item.id, item]));
    const layout = planGroupGeometry(groupId, validMembers.map(member => liveGeometry.get(member.id) ?? ({
      id: member.id, x: member.x, y: member.y,
      ...getImageDisplaySize(member.naturalWidth, member.naturalHeight),
    })));
    const group: ImageGroup = {
      ...layout.group,
      layoutMode: 'free',
    };
    const placeById = new Map(layout.placements.map(item => [item.id, item]));
    setImageGroups(current => [...(Array.isArray(current) ? current : []), group]);
    setImages(current => (Array.isArray(current) ? current : []).map(item => {
      const place = placeById.get(item.id);
      if (!place) return item;
      return { ...item, groupId, x: place.x, y: place.y };
    }));
    flowApiRef.current?.activateNode(groupId);
  }

  function duplicateImageGroup(...args: Parameters<typeof duplicateImageGroupImpl>): ReturnType<typeof duplicateImageGroupImpl> {
    return history.run(() => duplicateImageGroupImpl(...args));
  }

  /**
   * 复制整个参考图组：组本身 + 组内每一张图。
   *
   * 组和成员是两份状态（imageGroups / images），成员靠 groupId 回指。所以不能
   * 只克隆组——那样新组的 memberIds 指向老图，两个组会抢同一批图片，拖动其中
   * 一个另一个跟着动。这里给每张成员图也建副本，并把 memberIds 换成新 id。
   *
   * 成员的 x/y 是**相对组原点**的坐标（见 ungroupImages 里的 group.x + item.x），
   * 所以成员副本的 x/y 原样照抄，只有组自己偏移 36px。
   */
  function duplicateImageGroupImpl(groupId: string) {
    const source = imageGroupsRef.current.find(item => item.id === groupId);
    if (!source) return;
    const members = imagesRef.current.filter(item => source.memberIds.includes(item.id));
    if (!members.length) return;
    const stamp = Date.now().toString(36);
    const newGroupId = `group-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const copies = members.map((member, index) => {
      const {
        taskId: _taskId,
        cutoutTaskId: _cutoutTaskId,
        cutoutSourceImageId: _cutoutSourceImageId,
        sourceInstanceId: _sourceInstanceId,
        embeddedInSource: _embeddedInSource,
        slotId: _slotId,
        outputIndex: _outputIndex,
        error: _error,
        ...config
      } = member;
      return {
        ...config,
        id: `image-${stamp}-${index}-${Math.random().toString(36).slice(2, 5)}`,
        groupId: newGroupId,
        status: 'ready' as const,
        parentImageId: member.id,
      };
    });
    const duplicate: ImageGroup = {
      ...source,
      id: newGroupId,
      memberIds: copies.map(item => item.id),
      x: source.x + 36,
      y: source.y + 36,
    };
    setImages(current => [...(Array.isArray(current) ? current : []), ...copies]);
    setImageGroups(current => [...(Array.isArray(current) ? current : []), duplicate]);
    flowApiRef.current?.activateNode(duplicate.id);
  }

  function removeImageGroup(...args: Parameters<typeof removeImageGroupImpl>): ReturnType<typeof removeImageGroupImpl> {
    return history.run(() => removeImageGroupImpl(...args));
  }

  /**
   * 删除整个参考图组，连组内图片一起。
   *
   * 和「解散」是两件事：解散只是拆掉框，图片留在画布上（ungroupImages 会把相对
   * 坐标还原成绝对坐标）；删除是把这一组素材整体请出画布。两个入口都留着，
   * 语义不同。
   */
  function removeImageGroupImpl(groupId: string) {
    const group = imageGroupsRef.current.find(item => item.id === groupId);
    if (!group) return;
    const memberSet = new Set(group.memberIds);
    setImages(current => (Array.isArray(current) ? current : []).filter(item => !memberSet.has(item.id)));
    setImageGroups(current => (Array.isArray(current) ? current : []).filter(item => item.id !== groupId));
    setEdges(current => (Array.isArray(current) ? current : []).filter(edge => (
      edge.source !== groupId && edge.target !== groupId
      && !memberSet.has(edge.source) && !memberSet.has(edge.target)
    )));
  }

  function ungroupImages(...args: Parameters<typeof ungroupImagesImpl>): ReturnType<typeof ungroupImagesImpl> {
    return history.run(() => ungroupImagesImpl(...args));
  }

  function ungroupImagesImpl(groupId: string) {
    const group = imageGroupsRef.current.find(item => item.id === groupId);
    if (!group) return;
    const members = imagesRef.current.filter(item => group.memberIds.includes(item.id) && item.groupId === groupId);
    let plan: ReturnType<typeof planGroupDissolve<CanvasEdge>>;
    try {
      plan = planGroupDissolve(group, members, Array.isArray(edges) ? edges : []);
    } catch (error) {
      return error instanceof Error ? error.message : shell.errors.cannotUngroupSafely;
    }
    const positions = new Map(plan.positions.map(position => [position.id, position]));
    setImages(current => (Array.isArray(current) ? current : []).map(item => {
      const position = positions.get(item.id);
      if (!position || item.groupId !== groupId) return item;
      return {
        ...item,
        groupId: undefined,
        x: position.x,
        y: position.y,
      };
    }));
    setImageGroups(current => (Array.isArray(current) ? current : []).filter(item => item.id !== groupId));
    setEdges(plan.edges);
  }

  function generateVisualFromGroup(groupId: string, params: ContinueGenerateParams) {
    const group = imageGroupsRef.current.find(item => item.id === groupId);
    if (!group) return shell.errors.groupGone;
    let attachments: TaskAttachment[];
    try {
      // Preserve the existing entry cap, not a claim about every provider's capability.
      attachments = snapshotImageGroupReferences(group.memberIds, imagesRef.current, 8).map(item => ({ ...item, sourceNodeId: group.id }));
    } catch (error) {
      return error instanceof Error ? error.message : shell.errors.cannotReadGroup;
    }
    const sourceInstance: CanvasInstance = { id: group.id, kind: 'visual', x: group.x, y: group.y };
    const prevDraft = safeTaskDrafts[group.id] || { text: '', attachments: [] };
    const nextDraft: TaskDraft = {
      ...prevDraft,
      text: params.prompt || shell.prompts.fromAllReferences,
      attachments,
      models: (params.models.length ? [...params.models] : [defaultVisualModel]) as TaskDraft['models'],
      imageCount: params.count,
      imageRatios: [...params.ratios] as TaskDraft['imageRatios'],
      imageResolution: params.resolution as TaskDraft['imageResolution'],
      sourceImageId: undefined,
      sourceGroupId: group.id,
      rawPrompt: true,
    };
    updateDraft(sourceInstance.id, nextDraft);
    setFeedback(current => ({ ...current, [sourceInstance.id]: shell.prompts.generatingFromGroup(attachments.length) }));
    void generateImageDirect(sourceInstance, nextDraft);
  }

  async function replaceImage(id: string, file: File) {
    try {
      const uploaded = await uploadImageFile(file);
      const size = await probeImageSize(uploaded.src);
      commitCanvasImageEdit(history, setImages, id, {
        src: uploaded.src, path: uploaded.path, name: uploaded.name,
        naturalWidth: size.width, naturalHeight: size.height,
      });
      showImageToast(id, shell.toasts.replaced);
    } catch (error) {
      showImageToast(id, error instanceof Error ? error.message : shell.errors.replaceFailed);
    }
  }

  async function saveEditedImage(id: string, file: File, meta: { width: number; height: number }): Promise<void> {
    const sourcePath = imagesRef.current.find(item => item.id === id)?.path;
    const sourceProject = getCanvasHostContext().projectId;
    if (!sourcePath) throw new Error(shell.errors.originalMissing);
    setImageEditorSaving(true);
    try {
      const uploaded = await uploadImageFile(file);
      const previous = imagesRef.current.find(item => item.id === id);
      if (getCanvasHostContext().projectId !== sourceProject || previous?.path !== sourcePath) throw new Error('源图片已变化，未覆盖当前图片，请重新打开工具');
      const isShotVersion = previous?.path && basicNodes.some(node => node.storyboard?.shots.some(shot => ['first', 'last'].some(role => selectedStoryboardShotImage(storyboardFrame(shot, role as 'first' | 'last'), imagesRef.current)?.id === id)));
      const isAssetVersion = previous?.path && storyboardAssets.some(asset => asset.variants.some(variant => variant.referencePath === previous.path));
      if (isShotVersion) {
        setImages(current => [...current, { ...previous!, id: crypto.randomUUID(), embeddedInSource: false }]);
        setBasicNodes(current => current.map(node => !node.storyboard ? node : { ...node, storyboard: { ...node.storyboard, shots: node.storyboard.shots.map(shot => { let next = shot; for (const role of ['first', 'last'] as const) if (selectedStoryboardShotImage(storyboardFrame(shot, role), imagesRef.current)?.id === id) next = patchStoryboardFrame(next, role, { selectedImagePath: uploaded.path }); return next; }) } }));
      }
      if (previous?.path) setStoryboardAssets(current => current.map(asset => {
        if (!asset.variants.some(v => v.referencePath === previous.path)) return asset;
        return { ...asset, revision: asset.revision + 1, variants: asset.variants.map(variant => variant.referencePath !== previous.path ? variant : {
          ...variant, referencePath: uploaded.path, referenceNodeId: id,
          history: [...(variant.history || []).filter(h => h.path !== uploaded.path), { id: crypto.randomUUID(), path: uploaded.path }],
        }) };
      }));
      const patch = {
        src: uploaded.src, path: uploaded.path, name: uploaded.name,
        naturalWidth: meta.width, naturalHeight: meta.height,
      };
      if (isShotVersion || isAssetVersion) {
        // Storyboard edits belong to the existing linked version workflow above.
        // Do not introduce an image-only undo that leaves its selected path stale.
        setImages(current => current.map(image => image.id === id
          ? withCanvasResultHistory(image, { ...patch, replacementRequestId: undefined }, ['path', 'src', 'naturalWidth', 'naturalHeight'])
          : image));
      } else commitCanvasImageEdit(history, setImages, id, patch);
      showImageToast(id, shell.toasts.editSaved);
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(shell.errors.saveFailed);
      showImageToast(id, reason.message);
      throw reason;
    } finally {
      setImageEditorSaving(false);
    }
  }

  async function saveAnnotatedImageAsDerivative(
    id: string,
    file: File,
    meta: { width: number; height: number },
  ): Promise<void> {
    const source = imagesRef.current.find(item => item.id === id);
    if (!source) throw new Error(shell.errors.originalMissing);
    setImageEditorSaving(true);
    try {
      const uploaded = await uploadImageFile(file);
      const sourceInstance = source.sourceInstanceId
        ? instancesRef.current.find(instance => instance.id === source.sourceInstanceId)
        : findSourceInstanceForImage(source);
      const sourceDisplay = getImageDisplaySize(source.naturalWidth, source.naturalHeight);
      const sourceX = source.embeddedInSource && sourceInstance ? sourceInstance.x : source.x;
      const sourceY = source.embeddedInSource && sourceInstance ? sourceInstance.y : source.y;
      const targetX = sourceX + sourceDisplay.width + 96;
      let targetY = sourceY;
      const targetHeight = getImageDisplaySize(meta.width, meta.height).height;
      const visibleImages = imagesRef.current.filter(image => !image.embeddedInSource && !image.groupId);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const collision = visibleImages.find(image => {
          const size = getImageDisplaySize(image.naturalWidth, image.naturalHeight);
          return Math.abs(image.x - targetX) < 210
            && targetY < image.y + size.height + 48
            && targetY + targetHeight + 48 > image.y;
        });
        if (!collision) break;
        targetY = collision.y + getImageDisplaySize(collision.naturalWidth, collision.naturalHeight).height + 48;
      }

      const derivativeId = `img-annotated-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      if (!imagesRef.current.some(image => image.id === source.id)) return;
      const derivative: WorkbenchImage = {
        ...source,
        id: derivativeId,
        src: uploaded.src,
        path: uploaded.path,
        name: uploaded.name,
        x: targetX,
        y: targetY,
        naturalWidth: meta.width,
        naturalHeight: meta.height,
        status: 'ready',
        taskId: undefined,
        generationDraft: undefined,
        resultHistory: undefined,
        mediaRequest: undefined,
        mediaDelivery: undefined,
        replacementRequestId: undefined,
        error: undefined,
        slotId: undefined,
        outputIndex: undefined,
        sourceInstanceId: sourceInstance?.id || source.sourceInstanceId,
        embeddedInSource: false,
        parentImageId: source.id,
        parentGroupId: undefined,
        groupId: undefined,
        assetKind: 'generated',
      };
      history.run(() => setImages(current => [...(Array.isArray(current) ? current : []), derivative]));
      showImageToast(source.id, shell.toasts.annotatedSaved);
      showImageToast(derivativeId, shell.labels.annotatedVersion);
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(shell.errors.annotationSaveFailed);
      showImageToast(id, reason.message);
      throw reason;
    } finally {
      setImageEditorSaving(false);
    }
  }

  async function imageAsFile(image: WorkbenchImage): Promise<File> {
    const source = image.path ? imageFileUrl(image.path) : image.src;
    if (!source) throw new Error(shell.errors.imageFileMissing);
    const response = await fetch(source);
    if (!response.ok) throw new Error(shell.errors.imageReadFailed);
    const blob = await response.blob();
    return new File([blob], image.name || 'image.png', {
      type: blob.type || 'image/png',
    });
  }

  async function rotateImage(id: string, degrees: number) {
    const image = imagesRef.current.find(item => item.id === id);
    if (!image) return;
    setImageEditorSaving(true);
    try {
      const file = await imageAsFile(image);
      const bitmap = await createImageBitmap(file);
      const quarterTurns = ((Math.round(degrees / 90) % 4) + 4) % 4;
      const swapSides = quarterTurns % 2 === 1;
      const canvas = document.createElement('canvas');
      canvas.width = swapSides ? bitmap.height : bitmap.width;
      canvas.height = swapSides ? bitmap.width : bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(shell.errors.rotateUnsupported);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(quarterTurns * Math.PI / 2);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      bitmap.close();
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(shell.errors.rotateExportFailed);
      const base = image.name.replace(/\.[^.]+$/, '') || 'image';
      await saveEditedImage(
        id,
        new File([blob], `${base}-rotated.png`, { type: 'image/png' }),
        { width: canvas.width, height: canvas.height },
      );
      showImageToast(id, shell.toasts.rotatedRight90);
    } catch (error) {
      showImageToast(id, error instanceof Error ? error.message : shell.errors.rotateFailed);
    } finally {
      setImageEditorSaving(false);
    }
  }

  async function addImageToChat(id: string) {
    const image = imagesRef.current.find(item => item.id === id);
    if (!image) return;
    try {
      await stageHostChatAttachments([await imageAsFile(image)]);
      showImageToast(id, shell.toasts.addedToChat);
    } catch (error) {
      showImageToast(id, error instanceof Error ? error.message : shell.errors.addToChatFailed);
    }
  }

  /** 溯源：从某张图找到其所属视觉卡实例 */
  function findSourceInstanceForImage(image: WorkbenchImage): CanvasInstance | null {
    const instanceIds = new Set(instancesRef.current.map(item => item.id));
    let sourceInstanceId = image.sourceInstanceId;
    let cursor = image.id;
    const seen = new Set<string>();
    while (!sourceInstanceId && !seen.has(cursor)) {
      seen.add(cursor);
      const incoming = edgesRef.current.find(edge => edge.target === cursor);
      if (!incoming) break;
      if (instanceIds.has(incoming.source)) { sourceInstanceId = incoming.source; break; }
      cursor = incoming.source;
    }
    return instancesRef.current.find(item => item.id === sourceInstanceId) || null;
  }

  /** 标注 → 图生图：标注图是唯一参考；新建右侧视觉卡承载结果，不依赖历史归属卡。 */
  async function sendAnnotatedToAI(id: string, annotatedFile: File, instruction: string) {
    const image = imagesRef.current.find(item => item.id === id);
    if (!image) {
      const reason = new Error(shell.errors.annotationUnsupported);
      showImageToast(id, reason.message);
      throw reason;
    }
    setImageEditorSaving(true);
    try {
      // 标注导出图已同时包含原画面与修改指示，只传这一张，避免多参考图冲突。
      const annotated = await uploadImageFile(annotatedFile);
      const owner = findSourceInstanceForImage(image);
      const sourceDisplay = getImageDisplaySize(image.naturalWidth, image.naturalHeight);
      const sourceX = image.embeddedInSource && owner ? owner.x : image.x;
      const sourceY = image.embeddedInSource && owner ? owner.y : image.y;
      const placed = placeWithoutOverlap(sourceX + sourceDisplay.width + 120, sourceY);
      const targetId = `visual-annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const target = buildAnnotationRegenerateTarget({
        source: image,
        owner,
        annotated,
        instruction,
        targetId,
        targetX: placed.x,
        targetY: placed.y,
        edgeId: `e-${image.id}-${targetId}-${Date.now().toString(36)}`,
      });

      // 显式边是画布关系，生成任务本身作为目标卡的首图回填，不再反查旧母卡。
      const { targetInstance, edge, draft: nextDraft } = target;
      persistInstances([...instancesRef.current, targetInstance]);
      const nextEdges = [...edgesRef.current, edge];
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      updateDraft(targetId, nextDraft);
      showImageToast(id, shell.toasts.annotationEditing);
      await generateImageDirect(targetInstance, nextDraft);
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(shell.errors.submitFailed);
      showImageToast(id, reason.message);
      throw reason;
    } finally {
      setImageEditorSaving(false);
    }
  }

  async function downloadImage(id: string) {
    const image = imagesRef.current.find(item => item.id === id);
    if (!image?.path && !image?.src) return;
    try {
      const downloadUrl=image.path?imageFileUrl(image.path):resolveCanvasImageSrc(image.src!);
      if (uiHost?.downloadResource) {
        await uiHost.downloadResource({ url: downloadUrl, fileName: image.path || image.name || 'image', nodeId: id });
        return;
      }
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(shell.errors.downloadFailed);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = image.name || 'image';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showImageToast(id, error instanceof Error ? error.message : shell.errors.downloadFailed);
    }
  }

  function generateVisualFromImage(id: string, params: ContinueGenerateParams) {
    if (!isVisualModelEnabled(params.models[0] ?? defaultVisualModel)) throw new Error(shell.errors.modelUnavailable);
    const image = imagesRef.current.find(item => item.id === id);
    if (!image?.path) {
      showImageToast(id, shell.errors.continueGenUnsupported);
      return;
    }
    const instanceIds = new Set(instancesRef.current.map(item => item.id));
    let sourceInstanceId = image.sourceInstanceId;
    let cursor = image.id;
    const seen = new Set<string>();
    while (!sourceInstanceId && !seen.has(cursor)) {
      seen.add(cursor);
      const incoming = edgesRef.current.find(edge => edge.target === cursor);
      if (!incoming) break;
      if (instanceIds.has(incoming.source)) {
        sourceInstanceId = incoming.source;
        break;
      }
      cursor = incoming.source;
    }
    // Imported images have no visual parent. Use their own stable identity for
    // task ownership; do not create an extra canvas card merely to run a task.
    const sourceInstance: CanvasInstance = instancesRef.current.find(item => item.id === sourceInstanceId)
      || { id: image.id, kind: 'visual', x: image.x, y: image.y };
    const prevDraft = safeTaskDrafts[sourceInstance.id] || { text: '', attachments: [] };
    const nextDraft: TaskDraft = {
      ...prevDraft,
      text: params.prompt || shell.prompts.fromReference,
      replacement: undefined,
      attachments: [...new Map([...prevDraft.attachments.filter(ref => !ref.mimeType.startsWith('image/')), { name: image.name || 'reference.png', path: image.path, size: 0, mimeType: 'image/*' }, ...(params.references || [])].map(ref => [ref.path, ref])).values()],
      models: (params.models.length ? params.models : [defaultVisualModel]) as TaskDraft['models'],
      imageCount: params.count,
      imageRatios: params.ratios as TaskDraft['imageRatios'],
      imageResolution: params.resolution as TaskDraft['imageResolution'],
      sourceImageId: image.id,
      sourceGroupId: undefined,
      rawPrompt: true,
    };
    if (imageSubmissionLocksRef.current.has(sourceInstance.id)) return;
    updateDraft(sourceInstance.id, { ...nextDraft, replacement: undefined });
    if (!image.sourceInstanceId) {
      setImages(current => (Array.isArray(current) ? current : []).map(item => (
        item.id === image.id ? { ...item, sourceInstanceId: sourceInstance.id } : item
      )));
    }
    showImageToast(id, shell.toasts.newChildJob);
    void generateImageDirect(sourceInstance, nextDraft);
  }

  async function generateStoryboardAssetVersion(storyboardId: string, assetId: string, variantId: string, path: string, params: ContinueGenerateParams) {
    const key = `${assetId}/${variantId}`;
    if (storyboardGenerationLocksRef.current.has(key)) throw new Error(x.subjectSubmitting);
    storyboardGenerationLocksRef.current.add(key);
    let generationId: string | undefined;
    try {
      const attachments = storyboardVersionAttachments(path, params);
      const ratio = (['16:9', '9:16', '1:1', '4:3', '3:4'].includes(params.ratios[0] || '') ? params.ratios[0] : '16:9') as NonNullable<WorkbenchImage['ratio']>;
      const read = () => {
        const node = basicNodesRef.current.find(n => n.id === storyboardId);
        const asset = storyboardAssetsRef.current.find(a => a.id === assetId && a.ownerStoryboardId === storyboardId);
        return { node, asset, variant: asset?.variants.find(v => v.id === variantId) };
      };
      const activeId = read().variant?.generationNodeId;
      if (activeId && imagesRef.current.some(i => i.sourceInstanceId === activeId && i.status === 'generating')) throw new Error(x.subjectHasJob);
      await submitStoryboardVersion({
        valid: id => { const { node, asset, variant } = read(); return Boolean(node?.storyboard && asset && variant && (!id || variant.generationNodeId === id)); },
        create: () => {
          const { node } = read();
          generationId = addConnectedNode(storyboardId, 'image', { x: node!.x, y: node!.y, width: node!.width || 960, height: node!.height || 400, prompt: params.prompt, attachments, imageRatio: ratio, skipSourceContext: true });
          // The task is hidden inside this stack; keep selection and its composer here.
          flowApiRef.current?.activateNode(`storyboard-stack:${storyboardId}:${assetId}:${variantId}`);
          setFeedback(current => ({ ...current, [generationId!]: shell.toasts.submittingVersion }));
          return generationId;
        },
        bind: id => {
          const next = storyboardAssetsRef.current.map(a => a.id === assetId ? { ...a, variants: a.variants.map(v => v.id === variantId ? { ...v, generationNodeId: id } : v) } : a);
          storyboardAssetsRef.current = next;
          setStoryboardAssets(next);
        },
        persist: () => flushCanvas([STORYBOARD_ASSETS_STATE_KEY, 'workbenchInstances', 'workbenchEdges']),
        submit: async id => {
          const instance = instancesRef.current.find(i => i.id === id);
          if (!instance) throw new Error(x.jobNotCreated);
          await generateImageDirect(instance, { text: params.prompt, attachments, rawPrompt: true, models: params.models as TaskDraft['models'], imageCount: params.count, imageRatio: ratio, imageRatios: [ratio], imageResolution: params.resolution as TaskDraft['imageResolution'] });
          setFeedback(current => current[id] === shell.toasts.submittingVersion ? { ...current, [id]: '' } : current);
        },
      });
    } catch (error) {
      if (generationId) setFeedback(current => ({ ...current, [generationId!]: error instanceof Error ? error.message : x.genFailedRetry }));
      throw error;
    } finally { storyboardGenerationLocksRef.current.delete(key); }
  }

  /**
   * 统一解析某张图的提示词：优先用图片卡上已回填的字段，
   * 其次回读 /api/image-tasks/{taskId}，读到后回写到图片卡，避免每次都依赖任务文件。
   */
  async function resolveImagePrompt(id: string): Promise<{ prompt: string; negative?: string; resolution?: VisualResolution } | null> {
    const image = imagesRef.current.find(item => item.id === id);
    if (!image) return null;
    let task: ImageTask | null = null;
    let variant: { prompt?: string; negative?: string } | undefined = image.prompt
      ? { prompt: image.prompt, negative: image.negativePrompt }
      : undefined;
    if (image.taskId) {
      try {
        const response = await projectApiFetch(`/api/image-tasks/${encodeURIComponent(image.taskId)}`);
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error || shell.errors.readPromptFailed);
        task = payload.task as ImageTask;
        const variantIndex = Math.max(0, (task.slots?.find(slot => slot.slotId === image.slotId)?.variantIndex || 1) - 1);
        variant = task.retryContext?.variants?.[variantIndex] || task.retryContext?.variants?.[0] || variant;
      } catch (error) {
        if (!variant?.prompt?.trim()) throw error;
      }
    }
    const text = variant?.prompt?.trim() || image.prompt?.trim();
    if (!text) return null;
    const negative = variant?.negative || image.negativePrompt;
    const resolution = task?.resolution || image.resolution;
    setImages(current => (Array.isArray(current) ? current : []).map(item => (
      item.id === id
        ? {
            ...item,
            prompt: item.prompt || text,
            negativePrompt: item.negativePrompt || negative,
            resolution: item.resolution || resolution,
          }
        : item
    )));
    return { prompt: text, negative, resolution };
  }

  async function toggleImagePrompt(id: string) {
    const existing = promptCardsRef.current.find(card => card.imageId === id);
    if (existing) {
      setPromptCards(current => current.filter(card => card.id !== existing.id));
      return;
    }
    const image = imagesRef.current.find(item => item.id === id);
    if (!image?.taskId && !image?.prompt?.trim()) {
      showImageToast(id, shell.errors.noTraceablePrompt);
      return;
    }
    try {
      const resolved = await resolveImagePrompt(id);
      if (!resolved) throw new Error(shell.errors.noTraceablePrompt);
      const display = getImageDisplaySize(image.naturalWidth, image.naturalHeight);
      const promptHeight = 348;
      const card: WorkbenchPromptCard = {
        id: `prompt-${image.id}`,
        imageId: image.id,
        taskId: image.taskId || '',
        x: display.width + 12,
        y: (display.height - promptHeight) / 2,
        text: resolved.prompt,
        negativePrompt: resolved.negative,
        model: image.model,
        ratio: image.ratio,
        resolution: resolved.resolution,
      };
      setPromptCards(current => [...current.filter(item => item.imageId !== id), card]);
    } catch (error) {
      showImageToast(id, error instanceof Error ? error.message : shell.errors.readPromptFailed);
    }
  }

  async function retryImage(id: string) {
    const image = imagesRef.current.find(item => item.id === id);
    if (image?.assetKind === 'cutout' && image.cutoutSourceImageId) {
      setImages(current => current.filter(item => item.id !== id));
      await requestImageCutout(image.cutoutSourceImageId);
      return;
    }
    if (!image?.taskId || !image.slotId || (image.status !== 'failed' && !image.error)) {
      showImageToast(id, x.imageCannotRetry);
      return;
    }
    if (image.mediaRequest && image.taskId.startsWith('canvas-')) {
      const lockKey = `retry:${id}`;
      if (imageSubmissionLocksRef.current.has(lockKey)) return;
      imageSubmissionLocksRef.current.add(lockKey);
      try {
        const requestId = crypto.randomUUID();
        const output = projectLayoutPath(PROJECT_LAYOUT.images, `${id}-${requestId}.png`);
        const response = await submitMedia({ ...image.mediaRequest, clientRequestId: requestId, output,
          canvasDelivery: { nodeId: id, kind: 'image', basePath: image.path || '', baseVersion: image.replacementRequestId || '', fileUrl: imageFileUrl(output) },
        });
        const payload = await response.json();
        if (!response.ok || !payload.taskId) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || shell.toasts.retryFailed);
        showImageToast(id, x.submittedNewJob);
      } catch (error) { showImageToast(id, error instanceof Error ? error.message : shell.toasts.retryFailed); }
      finally { imageSubmissionLocksRef.current.delete(lockKey); }
      return;
    }
    setImages(current => (Array.isArray(current) ? current : []).map(item => (
      item.id === id ? { ...item, status: 'generating', error: '' } : item
    )));
    try {
      const response = await projectApiFetch(
        `/api/image-tasks/${encodeURIComponent(image.taskId)}/slots/${encodeURIComponent(image.slotId)}/retry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || shell.toasts.retryFailed);
      const sourceId = image.sourceInstanceId
        || edgesRef.current.find(edge => edge.target === image.id)?.source;
      const sourceInstance = instancesRef.current.find(item => item.id === sourceId);
      if (!sourceInstance) throw new Error(x.visualCardMissing);
      finalizingImageTasksRef.current.delete(image.taskId);
      finalizedImageTasksRef.current.delete(image.taskId);
      const draft = safeTaskDrafts[sourceInstance.id];
      appendActiveImageTask(sourceInstance.id, {
        taskId: image.taskId,
        parentImageId: image.parentImageId,
        parentGroupId: image.parentGroupId,
        business: draft?.visualBusiness,
        styleId: backendStyleId(draft?.visualStyleId),
        evalEnabled: draft?.visualEvalEnabled,
        models: draft?.models,
      });
    } catch (error) {
      setImages(current => (Array.isArray(current) ? current : []).map(item => (
        item.id === id
          ? { ...item, status: 'failed', error: error instanceof Error ? error.message : x.imageRetryFailed }
          : item
      )));
    }
  }

  /** Queue a transparent-background derivative without ever replacing the source image. */
  async function requestImageCutout(id: string) {
    const lockKey = `cutout:${id}`;
    if (imageSubmissionLocksRef.current.has(lockKey)) return;
    imageSubmissionLocksRef.current.add(lockKey);
    try { await requestImageCutoutUnlocked(id); }
    finally { imageSubmissionLocksRef.current.delete(lockKey); }
  }

  async function requestImageCutoutUnlocked(id: string) {
    const source = imagesRef.current.find(item => item.id === id);
    if (!source?.path) {
      showImageToast(id, x.noCutoutFile);
      return;
    }
    if (source.cutoutTaskId) {
      showImageToast(id, x.cutoutInProgress);
      return;
    }
    const context = getCanvasHostContext();
    const isCurrent = () => {
      const current = getCanvasHostContext();
      return current.projectId === context.projectId
        && current.workspaceContext?.workspaceId === context.workspaceContext?.workspaceId
        && current.workspaceContext?.workspaceMemberId === context.workspaceContext?.workspaceMemberId;
    };
    const owner = findSourceInstanceForImage(source);
    const draft = resolveConnectedVisualSourceDraft(safeTaskDrafts, source.id, owner?.id);
    let model: string;
    try { model = visualModelToNativeMediaModel(draft?.models?.[0] ?? defaultVisualModel); }
    catch { showImageToast(id, shell.errors.modelUnavailable); return; }
    const display = getImageDisplaySize(source.naturalWidth, source.naturalHeight);
    const derivativeId = `cutout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const output = projectLayoutPath(PROJECT_LAYOUT.images, `cutouts/${source.id}-${Date.now().toString(36)}.png`);
    const requestId = crypto.randomUUID();
    const taskId = `canvas-${requestId}`;
    const derivative: WorkbenchImage = {
      id: derivativeId, name: x.cutoutSuffixDot(source.name.replace(/(\.[^.]+)?$/, '') || shell.labels.image),
      x: source.x + display.width + 96, y: source.y,
      naturalWidth: source.naturalWidth, naturalHeight: source.naturalHeight,
      ratio: source.ratio, resolution: source.resolution, status: 'generating',
      taskId, cutoutTaskId: taskId, cutoutSourceImageId: source.id, parentImageId: source.id,
      model, prompt: x.keepSubjectTransparent, assetKind: 'cutout',
    };
    await submitCanvasCutout({
      isCurrent,
      stage: () => setImages(current => isCurrent() && current.some(item => item.id === source.id && !item.cutoutTaskId) ? [
        ...current.map(item => item.id === source.id ? { ...item, cutoutTaskId: taskId } : item), derivative,
      ] : current),
      flush: flushCanvas,
      exists: () => ((getCanvasSnapshot().workbenchImages ?? []) as WorkbenchImage[]).some(item => item.id === derivativeId && item.taskId === taskId),
      submit: () => submitMedia({
        surface: 'image', model, operation: 'cutout', clientRequestId: requestId,
        canvasDelivery: { nodeId: derivativeId, kind: 'image', basePath: '', baseVersion: '', fileUrl: projectFileUrl(output, context) },
        image: source.path, aspect: source.ratio || '1:1', output,
        slot: { id: derivativeId, kind: 'canvas-cutout', label: x.transparentCutout },
        lineage: { sourceNodeIds: [source.id], sourceAssetPath: source.path },
      }),
      accepted: () => showImageToast(source.id, x.cutoutPendingRight),
      failed: message => {
        setImages(current => isCurrent() ? failCanvasCutout(current, { sourceId: source.id, derivativeId, taskId }, message) : current);
        showImageToast(source.id, message);
      },
    });
  }

  // These handlers must follow the latest project and canvas state. Caching them
  // on the first render captures the empty state before the sidecar is loaded.
  const imageCallbacks = {
    onOpenApp: async (id: string) => {
      const context = getCanvasHostContext();
      await openCanvasImageEditor(context, id, imageAppHostRef.current,
        () => getCanvasHostContext().projectId === context.projectId && imagesRef.current.some(image => image.id === id));
    },
    referenceResources: images.filter(image => image.path && (!image.status || image.status === 'ready')).map(image => ({ id: image.id, name: image.name, path: image.path, src: image.src, kind: 'image' as const })),
    onUploadReference: uploadImageFile,
    onDraftChange: (id: string, draft: ContinueGenerateParams) => setImages(current => current.map(image => image.id === id ? { ...image, generationDraft: draft } : image)),
    // 画布内裁剪完成：直接替换该节点图片，不再打开弹窗
    onCropCommit: (id: string, file: File, meta: { width: number; height: number }) => saveEditedImage(id, file, meta),
    onAnnotationCommit: (id: string, file: File, meta: { width: number; height: number }) => saveAnnotatedImageAsDerivative(id, file, meta),
    onRotate: (id: string) => { void rotateImage(id, 90); },
    onLayer: (id: string, direction: 'front'|'back'|'up'|'down') => history.run(() => setImages(current => {
      const source = current.find(image => image.id === id); if (!source) return current;
      const siblings = current.filter(image => image.groupId === source.groupId && !image.embeddedInSource)
        .map((image,index) => ({image,index})).sort((a,b) => (a.image.zIndex ?? 0)-(b.image.zIndex ?? 0)||a.index-b.index).map(entry => entry.image);
      const index = siblings.findIndex(image => image.id === id); if (index < 0) return current;
      const target = direction === 'front' ? siblings.length-1 : direction === 'back' ? 0 : Math.max(0,Math.min(siblings.length-1,index+(direction==='up'?1:-1)));
      siblings.splice(index,1); siblings.splice(target,0,source);
      const ranks = new Map(siblings.map((image,rank) => [image.id,rank]));
      return current.map(image => ranks.has(image.id) ? {...image,zIndex:ranks.get(image.id)!} : image);
    })),
    onCutout: (id: string) => { void requestImageCutout(id); },
    onAddToChat: (id: string) => { void addImageToChat(id); },
    onSendAnnotatedToAI: (id: string, file: File, instruction: string) => sendAnnotatedToAI(id, file, instruction),
    onReplace: (id: string, file: File) => { void replaceImage(id, file); },
    onDownload: (id: string) => { void downloadImage(id); },
    onGenerate: generateVisualFromImage,
    onRemove: removeImage,
    onDuplicate: duplicateImage,
    onRetry: (id: string) => { void retryImage(id); },
    onAddConnectedNode: addConnectedNode,
  };

  function updateDraft(instanceId: string, update: Partial<TaskDraft>) {
    setTaskDrafts(current => {
      const prev = normalizeTaskDrafts(current)[instanceId] || { text: '', attachments: [] };
      return {
        ...normalizeTaskDrafts(current),
        [instanceId]: {
          ...prev,
          text: prev.text || '',
          attachments: prev.attachments || [],
          ...update,
        },
      };
    });
  }

  function appendActiveImageTask(instanceId: string, task: ActiveImageTask) {
    setTaskDrafts(current => {
      const drafts = normalizeTaskDrafts(current);
      const previous = drafts[instanceId] || { text: '', attachments: [] };
      const active = previous.activeImageTasks || [];
      if (active.some(item => item.taskId === task.taskId)) return current;
      return {
        ...drafts,
        [instanceId]: {
          ...previous,
          activeImageTasks: [...active, task],
          imageTaskId: undefined,
        },
      };
    });
  }

  function removeActiveImageTask(instanceId: string, taskId: string) {
    setTaskDrafts(current => {
      const drafts = normalizeTaskDrafts(current);
      const previous = drafts[instanceId];
      if (!previous) return current;
      return {
        ...drafts,
        [instanceId]: {
          ...previous,
          activeImageTasks: (previous.activeImageTasks || []).filter(item => item.taskId !== taskId),
          imageTaskId: previous.imageTaskId === taskId ? undefined : previous.imageTaskId,
        },
      };
    });
  }

  /**
   * 给附件生成 AI 可直接执行的读法。
   * 关键：Read 工具会直接拒绝 docx/xlsx/pdf 等二进制（报 "cannot read binary files"），
   * 笼统写「去读附件」等于让 AI 撞墙后放弃。按扩展名给确定命令，AI 照抄即可。
   * 一律用系统自带或项目已依赖的工具，不引入新依赖、不写死本机路径。
   */
  function attachmentReadHint(name: string): string {
    const ext = name.toLowerCase().split('.').pop() || '';
    if (['md', 'txt', 'json', 'csv', 'log', 'yml', 'yaml'].includes(ext)) {
      return x.readWithReadTool;
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      return x.viewWithReadTool;
    }
    if (['docx', 'doc', 'odt', 'rtf', 'wordml'].includes(ext)) {
      return x.readDocViaTextutil;
    }
    if (['xlsx', 'xlsm'].includes(ext)) {
      return x.readXlsxHint;
    }
    if (ext === 'pdf') {
      return x.readPdfHint;
    }
    return shell.agentHints.probeType;
  }

  /** 把附件清单渲染成指令片段：显式列出路径 + 读法，不让 AI 去 intake JSON 里挖 */
  function attachmentInstruction(attachments: TaskAttachment[]): string {
    if (!attachments.length) return '';
    const lines = attachments.map((item, index) => item.content !== undefined
      ? shell.content.attachmentInline(index + 1, item.name, item.content.slice(0, 60_000))
      : shell.content.attachmentPath(index + 1, item.name, item.path, attachmentReadHint(item.name)));
    return [
      shell.content.attachmentMustRead(attachments.length),
      ...lines,
      shell.agentHints.replacePath,
    ].join('\n');
  }

  function imageTaskAttachments(attachments: readonly TaskAttachment[]): TaskAttachment[] {
    return attachments.filter(attachment => attachment.mimeType.startsWith('image/'));
  }

  async function textAttachmentContext(attachments: readonly TaskAttachment[]): Promise<string> {
    const invalid = attachments.find(item => item.validationError);
    if (invalid) throw new Error(invalid.validationError);
    const textual = attachments.filter(attachment => !attachment.mimeType.startsWith('image/'));
    if (textual.length === 0) return '';
    const sections = await Promise.all(textual.map(async attachment => {
      const content = attachment.content !== undefined
        ? attachment.content
        : await (async () => {
            const response = await fetch(projectFileUrl(attachment.path));
            if (!response.ok) throw new Error(shell.errors.linkedAttachmentHttp(attachment.name, response.status));
            return response.text();
          })();
      const limited = content.length > 60_000 ? shell.content.truncatedGeneric(content.slice(0, 60_000)) : content;
      return shell.content.attachmentBlock(attachment.name, limited);
    }));
    return sections.join('\n\n');
  }

  async function addAttachments(
    instanceId: string,
    files: ReferenceUploadFiles,
  ): Promise<readonly TaskAttachment[] | false> {
    if (!files?.length) return false;
    setFeedback(current => ({ ...current, [instanceId]: shell.toasts.savingAttachments }));
    try {
      const context = getCanvasHostContext();
      const saved = await Promise.all([...files].map(file => uploadCanvasAttachment(file, context)));
      if (getCanvasHostContext().projectId !== context.projectId) throw new Error(shell.errors.projectSwitched);
      setTaskDrafts(current => {
        const drafts = normalizeTaskDrafts(current);
        const draft = drafts[instanceId] || { text: '', attachments: [] };
        return { ...drafts, [instanceId]: { ...draft, attachments: [...draft.attachments, ...saved] } };
      });
      setFeedback(currentFeedback => ({ ...currentFeedback, [instanceId]: shell.toasts.addedAttachments(saved.length) }));
      return saved;
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(shell.errors.attachmentSaveFailed);
      setFeedback(current => ({ ...current, [instanceId]: reason.message }));
      // Picker owners keep their selection open and show this specific error.
      throw reason;
    }
  }

  function removeAttachment(instanceId: string, path: string) {
    const draft = safeTaskDrafts[instanceId] || { text: '', attachments: [] };
    updateDraft(instanceId, { attachments: draft.attachments.filter(item => item.path !== path) });
  }

  async function sendTask(instance: CanvasInstance, draftOverride?: TaskDraft) {
    const draft = draftOverride || safeTaskDrafts[instance.id] || { text: '', attachments: [] };
    const text = draft.text.trim();
    const isVisual = instance.kind === 'visual';
    if (isVisual) {
      // 图片节点统一走通用媒体生成路径。
      await generateImageDirect(instance, {
        ...draft,
        visualBusiness: undefined,
        visualStyleId: undefined,
        visualAssetId: undefined,
        visualAssetPath: undefined,
        visualAssetPromptPath: undefined,
        visualAssetTitle: undefined,
        visualAssetThumbnailPath: undefined,
        visualEvalEnabled: false,
        rawPrompt: true,
      });
      return;
    }
    // 视觉卡在上面已全部 return；其它通用任务走 Intake。
    if (!text && !draft.attachments.length) {
      setFeedback(current => ({ ...current, [instance.id]: shell.errors.needTaskOrAttachment }));
      return;
    }
    const meta = cardMeta(canvasLocale)[instance.kind];
    setSendingId(instance.id);
    setFeedback(current => ({ ...current, [instance.id]: shell.toasts.sendingToAi }));
    try {
      const message = [
        text || shell.prompts.startWithAttachments(meta.title),
        attachmentInstruction(draft.attachments),
      ].filter(Boolean).join('\n\n');
      await submitAgentTask(message);
      updateDraft(instance.id, { text: '', attachments: [] });
      setFeedback(current => ({
        ...current,
        [instance.id]: shell.toasts.sentToAi,
      }));
    } catch (error) {
      setFeedback(current => ({ ...current, [instance.id]: error instanceof Error ? error.message : shell.errors.sendFailed }));
    } finally {
      setSendingId('');
    }
  }

  function findNextGeneratedImagePosition(
    instance: CanvasInstance,
    occupied: WorkbenchImage[],
    parentImageId?: string,
  ) {
    const CELL_W = 420;
    const COL_GAP = 48;
    const ROW_GAP = 48;
    const COLUMNS = 3;
    const owner = organizationGroups.find(group => group.memberIds.includes(parentImageId || instance.id))
      || imageGroupsRef.current.find(group => group.memberIds.includes(parentImageId || instance.id))
      || storyboardGalleries.find(group => group.members.some(member => member.id === (parentImageId || instance.id)));
    if (owner) {
      const x = owner.x + owner.width + 96;
      let y = owner.y;
      for (const image of occupied.filter(image => !image.groupId).sort((a, b) => a.y - b.y)) {
        const size = getImageDisplaySize(image.naturalWidth, image.naturalHeight);
        if (x < image.x + size.width + 48 && x + CELL_W + 48 > image.x && y < image.y + size.height + 48 && y + 500 > image.y) y = image.y + size.height + 48;
      }
      return { x, y };
    }
    if (parentImageId) {
      const byId = new Map(occupied.map(image => [image.id, image]));
      const parent = byId.get(parentImageId);
      if (parent) {
        const parentSize = getImageDisplaySize(parent.naturalWidth, parent.naturalHeight);
        const columnX = resolveChildImageColumnX({
          instanceX: instance.x,
          sourceCardWidth: CELL_W,
          parentX: parent.x,
          parentWidth: parentSize.width,
          parentEmbeddedInSource: parent.embeddedInSource,
          gap: 96,
        });
        const siblings = occupied
          .filter(image => !image.groupId && image.parentImageId === parentImageId)
          .sort((a, b) => a.y - b.y);
        let y = siblings.length
          ? Math.max(...siblings.map(image => (
              image.y + getImageDisplaySize(image.naturalWidth, image.naturalHeight).height + ROW_GAP
            )))
          : parent.y;
        const columnImages = occupied
          .filter(image => !image.groupId && Math.abs(image.x - columnX) < CELL_W / 2)
          .sort((a, b) => a.y - b.y);
        for (const image of columnImages) {
          const height = getImageDisplaySize(image.naturalWidth, image.naturalHeight).height;
          if (y + 238 <= image.y || y >= image.y + height + ROW_GAP) continue;
          y = image.y + height + ROW_GAP;
        }
        return { x: columnX, y };
      }
    }
    const belongsToInstance = (image: WorkbenchImage) => (
      (image.sourceInstanceId === instance.id && !image.parentImageId)
      || edgesRef.current.some(edge => edge.source === instance.id && edge.target === image.id)
    );
    const owned = occupied.filter(image => !image.groupId && belongsToInstance(image));
    const startX = owned.length
      ? Math.min(...owned.map(image => image.x))
      : instance.x + 420 + 96;
    const startY = owned.length
      ? Math.min(...owned.map(image => image.y))
      : instance.y;
    const colStep = CELL_W + COL_GAP;
    const rowLevels = [...new Set(owned.map(image => image.y))]
      .sort((a, b) => a - b);
    const measuredRowSteps = rowLevels
      .slice(1)
      .map((level, index) => {
        const previous = rowLevels[index];
        return previous === undefined ? 0 : level - previous;
      })
      .filter(step => step > 4);
    const ratioHeight: Record<NonNullable<WorkbenchImage['ratio']>, number> = {
      '1:1': 320,
      '3:4': 360,
      '4:3': 315,
      '9:16': 360,
      '16:9': 236,
    };
    const estimatedCardHeight = Math.max(
      238,
      ...owned.map(image => (
        image.naturalWidth && image.naturalHeight
          ? getImageDisplaySize(image.naturalWidth, image.naturalHeight).height + 2
          : (image.ratio ? ratioHeight[image.ratio] : 236) + 2
      )),
    );
    const rowStep = measuredRowSteps.length
      ? Math.min(...measuredRowSteps)
      : estimatedCardHeight + ROW_GAP;
    const usedSlots = new Set(owned.map(image => {
      const col = Math.max(0, Math.min(COLUMNS - 1, Math.round((image.x - startX) / colStep)));
      const row = Math.max(0, Math.round((image.y - startY) / rowStep));
      return row * COLUMNS + col;
    }));

    for (let slot = 0; slot < 300; slot += 1) {
      if (usedSlots.has(slot)) continue;
      return {
        x: startX + (slot % COLUMNS) * colStep,
        y: startY + Math.floor(slot / COLUMNS) * rowStep,
      };
    }
    return { x: startX, y: startY + 100 * rowStep };
  }

  async function syncImageTaskSlots(
    instance: CanvasInstance,
    task: ImageTask,
    parentImageId?: string,
    _taskBusiness?: VisualBusiness,
    parentGroupId?: string,
    shouldApply: () => boolean = () => true,
    embedFirstOutput?: boolean,
    replacement?: ActiveImageTask['replacement'],
  ) {
    if (replacement && !task.slots?.length && task.outputs?.length) {
      task = { ...task, slots: task.outputs.map((output, index) => ({
        slotId: output.slotId || `${task.id}-${index}`, variantIndex: 1, variant: '',
        model: output.model, outputIndex: index + 1, status: 'completed' as const,
        path: output.path, name: output.name, error: '',
      })) };
    }
    if (!task.slots?.length) return;
    const completedSizes = new Map<string, { width: number; height: number }>();
    await Promise.all(task.slots.map(async slot => {
      const current = imagesRef.current.find(image => image.slotId === slot.slotId);
      if (slot.status !== 'completed' || !slot.path || current?.status === 'ready') return;
      completedSizes.set(slot.slotId, await probeImageSize(imageFileUrl(slot.path)));
    }));

    if (!shouldApply()) return;
    setImages(current => {
      if (!shouldApply()) return current;
      const source = Array.isArray(current) ? current : [];
      if (replacement) {
        // No placeholder/child node for an in-card edit. Deleted or superseded
        // targets stay untouched; failures leave the previous result visible.
        return applyCanvasImageReplacement(source, replacement, task.slots!.flatMap(slot => {
          if (slot.status !== 'completed' || !slot.path) return [];
          const size = completedSizes.get(slot.slotId);
          return [{ path: slot.path, src: imageFileUrl(slot.path), naturalWidth: size?.width, naturalHeight: size?.height }];
        }));
      }
      const bySlot = new Map(source.map(image => [image.slotId, image]));
      const occupied = [...source];
      let hasEmbeddedPrimary = source.some(image => (
        image.sourceInstanceId === instance.id && image.embeddedInSource
      ));
      const slotImages = task.slots!.map((slot, slotIndex): WorkbenchImage => {
        const existing = bySlot.get(slot.slotId);
        const size = completedSizes.get(slot.slotId);
        const incomingStatus = slot.status === 'completed'
          ? 'ready'
          : slot.status === 'failed'
            ? 'failed'
            : 'generating';
        const status = existing?.status === 'ready' && incomingStatus !== 'ready'
          ? 'ready'
          : existing?.status === 'failed' && incomingStatus === 'generating'
            ? 'failed'
            : incomingStatus;
        const completedPath = slot.status === 'completed' ? slot.path : undefined;
        const variantIndex = Math.max(0, (slot.variantIndex || 1) - 1);
        const variantPrompt = task.retryContext?.variants?.[variantIndex] || task.retryContext?.variants?.[0];
        const parentGroup = parentGroupId
          ? imageGroupsRef.current.find(group => group.id === parentGroupId)
          : undefined;
        const position = existing
          ? { x: existing.x, y: existing.y }
          : parentGroup
            ? {
                x: parentGroup.x + parentGroup.width + 48,
                y: parentGroup.y + task.slots!.findIndex(item => item.slotId === slot.slotId) * 408,
              }
            : findNextGeneratedImagePosition(instance, occupied, parentImageId);
        const embeddedInSource = existing ? Boolean(existing.embeddedInSource) : Boolean(
          (
            !parentImageId
            && !parentGroupId
            && !isGroupedOutputSource(instance.id, parentImageId, parentGroupId)
            && (embedFirstOutput === undefined
              ? !hasEmbeddedPrimary
              : embedFirstOutput && slotIndex === 0)
          ),
        );
        if (embeddedInSource) hasEmbeddedPrimary = true;
        const image: WorkbenchImage = {
          id: existing?.id || `img-slot-${slot.slotId}`,
          src: completedPath ? imageFileUrl(completedPath) : existing?.src,
          path: completedPath || existing?.path,
          name: slot.name || `${slot.variant} · ${slot.model} · ${slot.outputIndex}`,
          x: position.x,
          y: position.y,
          naturalWidth: size?.width || existing?.naturalWidth,
          naturalHeight: size?.height || existing?.naturalHeight,
          status,
          taskId: task.id,
          slotId: slot.slotId,
          ratio: slot.ratio || task.ratio || task.ratios?.[0] || '9:16',
          model: slot.model,
          variant: slot.variant,
          outputIndex: slot.outputIndex,
          prompt: existing?.prompt || variantPrompt?.prompt,
          negativePrompt: existing?.negativePrompt || variantPrompt?.negative,
          resolution: existing?.resolution || task.resolution,
          error: status === 'ready' ? undefined : slot.error || existing?.error,
          sourceInstanceId: existing?.sourceInstanceId || instance.id,
          embeddedInSource,
          parentImageId: existing?.parentImageId || parentImageId,
          parentGroupId: existing?.parentGroupId || parentGroupId,
          excludeFromAutoGroup: existing ? existing.excludeFromAutoGroup : isGroupedOutputSource(instance.id, parentImageId, parentGroupId),
          assetKind: existing?.assetKind || 'generated',
        };
        if (!existing) occupied.push(image);
        return image;
      });
      const slotIds = new Set(task.slots!.map(slot => slot.slotId));
      const replaceEmbeddedPrimary = embedFirstOutput === true && !parentImageId && !parentGroupId
        && !isGroupedOutputSource(instance.id, parentImageId, parentGroupId);
      return [
        ...source.filter(image => (
          !slotIds.has(image.slotId || '')
          && !(replaceEmbeddedPrimary && image.sourceInstanceId === instance.id && image.embeddedInSource)
        )),
        ...slotImages,
      ];
    });

  }

  function isGroupedOutputSource(instanceId: string, parentImageId?: string, parentGroupId?: string) {
    const ids = new Set([instanceId, parentImageId].filter(Boolean));
    return Boolean(parentGroupId)
      || [...organizationGroups, ...imageGroupsRef.current].some(group => group.memberIds.some(id => ids.has(id)))
      || storyboardGalleries.some(group => group.members.some(member => ids.has(member.id)));
  }

  async function generateNativeImageDirectUnlocked(instance: CanvasInstance, draft: TaskDraft) {
    let linkedTextContext = '';
    try {
      linkedTextContext = await textAttachmentContext(draft.attachments);
    } catch (error) {
      setFeedback(current => ({ ...current, [instance.id]: error instanceof Error ? error.message : shell.errors.linkedAttachmentFailed }));
      return;
    }
    const imageAttachments = imageTaskAttachments(draft.attachments);
    const basePrompt = draft.text.trim() || (imageAttachments.length
      ? shell.prompts.fromReference
      : linkedTextContext ? shell.prompts.fromText : '');
    const prompt = [basePrompt, linkedTextContext].filter(Boolean).join('\n\n');
    if (!prompt) {
      setFeedback(current => ({ ...current, [instance.id]: shell.errors.needPromptOrReference }));
      return;
    }
    const model = draft.models?.[0] || defaultVisualModel;
    let modelId: string;
    try { modelId = visualModelToNativeMediaModel(model); }
    catch { setFeedback(current => ({ ...current, [instance.id]: shell.errors.modelUnavailable })); return; }
    const ratio = draft.imageRatios?.[0] || draft.imageRatio || '1:1';
    const resolution = draft.imageResolution || '2K';
    const count = Math.min(4, Math.max(1, draft.imageCount || 1));
    const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const jobs = Array.from({ length: count }, (_, outputIndex) => ({ ratio, outputIndex }));
    const generationParent = resolveGenerationParent({
      instanceId: instance.id,
      sourceImageId: draft.sourceImageId,
      sourceGroupId: draft.sourceGroupId,
      images: imagesRef.current,
      edges: edgesRef.current,
      hasEmbeddedOutput: imagesRef.current.some(image => image.sourceInstanceId === instance.id && image.embeddedInSource && image.path),
    });
    const requestLineage = resolveImageGenerationLineage({
      instanceId: instance.id,
      sourceImageId: generationParent.parentImageId,
      sourceGroupId: generationParent.parentGroupId,
      outputIndex: 0,
    });
    if (requestLineage.markSourceCardBusy) {
      setSendingId(instance.id);
      setFeedback(current => ({ ...current, [instance.id]: shell.toasts.imageJobQueued }));
    } else if (requestLineage.parentImageId) showImageToast(requestLineage.parentImageId, shell.toasts.newChildJob);
    try {
      const accepted: Array<{ task: NativeMediaTask; tracked: ActiveImageTask }> = [];
      for (const [jobIndex, job] of jobs.entries()) {
        const lineage = resolveImageGenerationLineage({
          instanceId: instance.id,
          sourceImageId: generationParent.parentImageId,
          sourceGroupId: generationParent.parentGroupId,
          outputIndex: jobIndex,
        });
        const ratioKey = job.ratio.replace(':', 'x');
        const outputPath = projectLayoutPath(PROJECT_LAYOUT.images, `${instance.id}-${batchId}-${ratioKey}-${job.outputIndex + 1}.png`);
        const requestId = crypto.randomUUID();
        const predictedTaskId = `canvas-${requestId}`;
        const tracked: ActiveImageTask = {
          taskId: predictedTaskId, nativeMedia: true, backendOwned: true,
          embedInSource: lineage.embedInSource, parentImageId: lineage.parentImageId, parentGroupId: lineage.parentGroupId,
          models: [model], ratio: job.ratio, resolution, modelId, outputPath, startedAt: Date.now(),
        };
        await persistImageTarget(flushCanvas, async () => {
          appendActiveImageTask(instance.id, tracked);
          await syncImageTaskSlots(instance, nativeMediaTaskAsImageTask({ taskId: predictedTaskId, status: 'queued' }, tracked),
            tracked.parentImageId, undefined, tracked.parentGroupId, () => true, tracked.embedInSource);
        }, () => {
          removeActiveImageTask(instance.id, predictedTaskId);
          setImages(current => current.filter(image => image.taskId !== predictedTaskId || image.status === 'ready'));
        });
        const targetId = `img-slot-media-${predictedTaskId}`;
        const target = (getCanvasSnapshot().workbenchImages as WorkbenchImage[]).find(image => image.id === targetId);
        if (!target) throw new Error(shell.errors.targetDeletedBeforeRun);
        const response = await submitMedia({
          surface: 'image', model: modelId, prompt, aspect: job.ratio, resolution, output: outputPath,
          clientRequestId: requestId,
          canvasDelivery: { nodeId: targetId, kind: 'image', basePath: target.path || '', baseVersion: target.replacementRequestId || '', fileUrl: imageFileUrl(outputPath) },
          ...(imageAttachments.length ? { images: imageAttachments.map(item => item.path) } : {}),
          slot: { id: `${instance.id}-${batchId}-${ratioKey}-${job.outputIndex + 1}`, kind: 'canvas-image', label: shell.content.imageIndex(job.outputIndex + 1) },
          lineage: { sourceNodeIds: [lineage.sourceNodeId] },
        });
        const payload = await response.json().catch(() => null) as NativeMediaTask | { error?: string | { message?: string } } | null;
        if (!response.ok || !payload || !('taskId' in payload)) {
          const responseError = payload && 'error' in payload ? (typeof payload.error === 'string' ? payload.error : payload.error?.message) : '';
          throw new Error(responseError || shell.errors.createImageJobHttp(response.status));
        }
        accepted.push({ task: payload, tracked });
        if (!payload.canvasDeliveryOwned) await syncImageTaskSlots(
          instance, nativeMediaTaskAsImageTask(payload, tracked), tracked.parentImageId,
          undefined, tracked.parentGroupId, () => true, tracked.embedInSource,
        );
      }
      if (requestLineage.parentImageId) showImageToast(requestLineage.parentImageId, shell.toasts.createdCardsOnRight(accepted.length));
      else setFeedback(current => ({ ...current, [instance.id]: shell.toasts.submittedImagesGenerating(accepted.length) }));
    } catch (error) {
      const message = shell.errors.createImageJob(error instanceof Error ? error.message : shell.errors.unknownError);
      if (requestLineage.parentImageId) showImageToast(requestLineage.parentImageId, message);
      else setFeedback(current => ({ ...current, [instance.id]: message }));
    } finally {
      if (requestLineage.markSourceCardBusy) setSendingId('');
    }
  }

  async function generateImageDirect(instance: CanvasInstance, draftOverride?: TaskDraft) {
    if (imageSubmissionLocksRef.current.has(instance.id)) return;
    imageSubmissionLocksRef.current.add(instance.id);
    // New requests always create independent outputs. A persisted replacement
    // draft must not revive the old in-card version workflow; already accepted
    // legacy tasks keep their delivery targets through ActiveImageTask.
    const draft = draftOverride || safeTaskDrafts[instance.id] || { text: '', attachments: [] };
    try { await generateImageDirectUnlocked(instance, { ...draft, replacement: undefined }); }
    finally { imageSubmissionLocksRef.current.delete(instance.id); }
  }

  async function generateImageDirectUnlocked(instance: CanvasInstance, draftOverride?: TaskDraft) {
    await generateNativeImageDirectUnlocked(instance, draftOverride || safeTaskDrafts[instance.id] || { text: '', attachments: [] });
  }

  React.useEffect(() => {
    const standaloneImageOwners: CanvasInstance[] = imagesRef.current
      .filter(image => safeTaskDrafts[image.id]?.activeImageTasks?.length && !instances.some(instance => instance.id === image.id))
      .map(image => ({ id: image.id, kind: 'visual', x: image.x, y: image.y }));
    const groupOwners: CanvasInstance[] = imageGroups.filter(group => safeTaskDrafts[group.id]?.activeImageTasks?.length).map(group => ({ id: group.id, kind: 'visual', x: group.x, y: group.y }));
    const pendingTasks = [...instances, ...standaloneImageOwners, ...groupOwners]
      .filter(instance => instance.kind === 'visual')
      .flatMap(instance => {
        const draft = safeTaskDrafts[instance.id];
        const active = [...(draft?.activeImageTasks || [])];
        if (draft?.imageTaskId && !active.some(item => item.taskId === draft.imageTaskId)) {
          active.push({
            taskId: draft.imageTaskId,
            parentImageId: draft.sourceImageId,
            parentGroupId: draft.sourceGroupId,
            business: draft.visualBusiness,
            styleId: draft.visualStyleId,
            evalEnabled: draft.visualEvalEnabled,
            models: draft.models,
          });
        }
        return active.map(task => ({ instance, task }));
      });
    if (!pendingTasks.length) return;
    let disposed = false;
    let polling = false;
    const controller = new AbortController();
    const poll = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        await Promise.all(pendingTasks.map(async ({ instance, task: tracked }) => {
          if (
            finalizingImageTasksRef.current.has(tracked.taskId)
            || finalizedImageTasksRef.current.has(tracked.taskId)
          ) return;
          let keepActiveTask = false;
          let terminalTask = false;
          try {
            let task: ImageTask;
            if (tracked.nativeMedia) {
              const response = await projectFetch(`/media/tasks?includeDone=1&taskIds=${encodeURIComponent(tracked.taskId)}`, { signal: controller.signal });
              const payload = await response.json().catch(() => null) as { tasks?: NativeMediaTask[]; error?: string } | null;
              if (!response.ok || !payload) throw new Error(payload?.error || shell.errors.queryImageJobFailed);
              let nativeTask = payload.tasks?.find(item => item.taskId === tracked.taskId);
              if (!nativeTask) {
                // Legacy versions expired task rows. Retain the existing
                // deterministic-file fallback for those historical tasks;
                // new task receipts remain durable across refresh/restart.
                const filesResponse = await projectFetch('/files', { signal: controller.signal });
                const filesPayload = await filesResponse.json().catch(() => null) as { files?: ProjectFile[] } | null;
                if (!filesResponse.ok || !filesPayload) throw new Error(shell.errors.queryImageOutputFailed);
                const recoveredFile = recoverNativeImageOutput(
                  filesPayload.files || [],
                  tracked.outputPath,
                  instance.id,
                );
                if (recoveredFile) {
                  nativeTask = {
                    taskId: tracked.taskId,
                    status: 'done',
                    model: tracked.modelId,
                    aspect: tracked.ratio,
                    resolution: tracked.resolution,
                    file: {
                      name: recoveredFile.path || recoveredFile.name,
                      mime: recoveredFile.mime,
                    },
                  };
                } else if (tracked.startedAt && Date.now() - tracked.startedAt > 15 * 60 * 1000) {
                  nativeTask = {
                    taskId: tracked.taskId,
                    status: 'failed',
                    error: shell.errors.jobEndedNoOutput,
                  };
                } else {
                  // A failed pre-dispatch save in older clients left a predicted
                  // task in the draft even though the server never accepted it.
                  // Keep the draft, but release that phantom task's busy state.
                  try { await flushCanvas(); }
                  catch (error) {
                    if ((error as { status?: number }).status === 409) {
                      terminalTask = true;
                      await syncImageTaskSlots(instance, nativeMediaTaskAsImageTask({
                        taskId: tracked.taskId, status: 'failed',
                        error: error instanceof Error ? error.message : shell.errors.queryImageJobFailed,
                      }, tracked), tracked.parentImageId, tracked.business, tracked.parentGroupId,
                      () => !disposed, tracked.embedInSource, tracked.replacement);
                    }
                    throw error;
                  }
                  throw new Error(shell.errors.jobNotSynced);
                }
              }
              if (tracked.backendOwned && nativeTask.canvasDelivery?.status === 'pending') return;
              if (tracked.backendOwned && nativeTask.canvasDelivery?.error) nativeTask = {
                ...nativeTask, status: 'failed', error: nativeTask.canvasDelivery.error,
              };
              task = nativeMediaTaskAsImageTask(nativeTask, tracked);
            } else {
              const response = await projectApiFetch(
                `/api/image-tasks/${encodeURIComponent(tracked.taskId)}`,
                { signal: controller.signal },
              );
              const payload = await response.json();
              if (!response.ok || payload.ok === false) throw new Error(payload.error || shell.errors.queryImageJobFailed);
              task = payload.task as ImageTask;
            }
            if (disposed) return;
            if (!tracked.backendOwned) await syncImageTaskSlots(
              instance,
              task,
              tracked.parentImageId,
              tracked.business,
              tracked.parentGroupId,
              () => !disposed,
              tracked.embedInSource,
              tracked.replacement,
            );
            if (disposed) return;
            if (disposed || !['completed', 'failed'].includes(task.status)) return;

            terminalTask = true;
            finalizingImageTasksRef.current.add(tracked.taskId);
            if (!disposed) {
              const completedCount = task.slots?.length
                ? task.slots.filter(slot => slot.status === 'completed').length
                : task.outputs.length;
              const message = task.status === 'completed'
                ? tracked.replacement ? shell.toasts.generatedVersions(completedCount) : shell.toasts.generatedImagesContinue(completedCount)
                : shell.errors.roundFailed(localizeDaemonMessage(task.error || (tracked.replacement ? shell.errors.roundFailedKeepOriginal : shell.errors.roundFailedSeeCard)));
              if (tracked.parentImageId) showImageToast(tracked.parentImageId, message);
              else setFeedback(current => ({ ...current, [instance.id]: message }));
            }
          } catch (error) {
            if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
              const message = error instanceof Error ? error.message : shell.errors.restoreImageJobFailed;
              if (tracked.parentImageId) showImageToast(tracked.parentImageId, message);
              else setFeedback(current => ({ ...current, [instance.id]: message }));
            }
          } finally {
            finalizingImageTasksRef.current.delete(tracked.taskId);
            // 任务已进入终态就必须退出源卡的 busy 计数。
            // 交付失败只影响结果卡，不能让已完成的来源节点永久显示“生成中”。
            if (!disposed && terminalTask && !keepActiveTask) {
              removeActiveImageTask(instance.id, tracked.taskId);
            }
          }
        }));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, taskDrafts, imageGroups]);

  const cardCallbacks = React.useMemo(() => ({
    onRemove: onNodeRemove,
    onDuplicate: duplicateInstance,
    onDraftChange: (instanceId: string, text: string) => updateDraft(instanceId, { text }),
    onDraftPatch: (instanceId: string, patch: Partial<TaskDraft>) => updateDraft(instanceId, patch),
    onAddAttachments: (instanceId: string, files: ReferenceUploadFiles) => addAttachments(instanceId, files),
    onRemoveAttachment: removeAttachment,
    onSend: (instance: CanvasInstance, draftOverride?: TaskDraft) => { void sendTask(instance, draftOverride); },
    onAnalyze: (instance: CanvasInstance) => { void sendTask(instance); },
    onAddConnectedNode: addConnectedNode,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [safeTaskDrafts, sendingId, edges, projectPath]);

  const pendingReportIds = React.useMemo(() => new Set(basicNodes.filter(isPendingReportStoryboard).map(node => node.id)), [basicNodes]);
  const flowNodes = React.useMemo(() => {
    const cards = instances.filter(instance => instance.kind !== 'plan').map(instance => {
      const meta = cardMeta(canvasLocale)[instance.kind];
      const storedDraft = safeTaskDrafts[instance.id] || { text: '', attachments: [] };
      const draft: TaskDraft = instance.kind === 'visual' && !storedDraft.models?.length
        ? { ...storedDraft, models: [defaultVisualModel] }
        : storedDraft;
      const state = getInstanceState(sendingId === instance.id, canvasLocale);
      const primaryImage = (Array.isArray(images) ? images : []).find(image => (
        image.sourceInstanceId === instance.id && image.embeddedInSource
      ));
      return buildCardNode({
        instance,
        projectPath,
        meta,
        state,
        statusMeta: statusMeta(canvasLocale)[state.status],
        draft,
        feedback: feedback[instance.id],
        isSending: sendingId === instance.id || (
          instance.kind === 'visual' && draft.visualPhase === 'planning'
        ),
        isGeneratingCreative: false,
        isBoundToCase: false,
        autoReviewEnabled: Boolean(draft.autoReview),
        autoReviewBusy: false,
        primaryImage,
        primaryImageToast: primaryImage ? imageToasts[primaryImage.id] : undefined,
        primaryImageCropSaving: imageEditorSaving,
        primaryImageActions: {
          onRetry: imageCallbacks.onRetry,
          onReplace: imageCallbacks.onReplace,
          onDownload: imageCallbacks.onDownload,
          onGenerate: imageCallbacks.onGenerate,
          onTogglePrompt: (id: string) => { void toggleImagePrompt(id); },
          onRemove: imageCallbacks.onRemove,
          onCropCommit: imageCallbacks.onCropCommit,
          onAnnotationCommit: imageCallbacks.onAnnotationCommit,
          onRotate: imageCallbacks.onRotate,
          onAddToChat: imageCallbacks.onAddToChat,
          onSendAnnotatedToAI: imageCallbacks.onSendAnnotatedToAI,
        },
        canvasResources: (Array.isArray(images) ? images : [])
          .filter(image => image.status !== 'generating' && Boolean(image.path))
          .map(image => ({
            id: image.id,
            name: image.name,
            path: image.path,
            src: image.src,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          })),
        callbacks: cardCallbacks,
      });
    });

    const retiredPlanIds = new Set(instances.filter(instance => instance.kind === 'plan').map(instance => instance.id));
    const workflowStages = workflowArtifacts
      .filter((artifact) => workflowResultSupportsSurface(artifact, 'canvas')
        && !dismissedWorkflowResults[artifact.id]
        && !retiredPlanIds.has(artifact.parentNodeId || ''))
      .map((artifact) => {
      const id = workflowStageNodeId(artifact.id);
      const parentId = artifact.parentResultId
        ? workflowStageNodeId(artifact.parentResultId)
        : artifact.parentNodeId;
      return buildWorkflowStageNode({
        artifact,
        parentId,
        position: workflowStagePositionsRef.current[id]
          ?? resolvedWorkflowArtifactPositions[artifact.id],
        busy: workflowArtifactBusyId === artifact.id
          || Object.values(pendingWorkflowGenerations).some(pending => (
            pending.sourceArtifactId === artifact.id
          )),
        onInteract: interaction => interactWithWorkflowArtifact(artifact, interaction),
        onRemove: () => removeWorkflowResult(artifact.id),
      });
      });

    const groupNodes = (Array.isArray(imageGroups) ? imageGroups : []).map(group => buildImageGroupNode({
      group,
      members: imagesRef.current.filter(image => group.memberIds.includes(image.id)),
      callbacks: {
        onRename: (id, name) => history.run(() => setImageGroups(current => current.map(group => group.id === id ? { ...group, name } : group))),
        onGenerate: generateVisualFromGroup,
        onUngroup: (id) => ungroupImages(id),
        onDuplicate: (id) => duplicateImageGroup(id),
        onRemove: (id) => removeImageGroup(id),
      },
    }));

    const galleryMembership = new Map(storyboardGalleries.flatMap(gallery => gallery.members.map(member => [member.id, { gallery, member }] as const)));
    const stackedImageIds = new Set(storyboardGalleries.flatMap(gallery => gallery.members.flatMap(member => [...(member.versions?.map(version => version.id) || []), ...(member.absorbedIds || [])])));
    // A stack owns its task even before the first placeholder arrives.
    for (const gallery of storyboardGalleries) for (const member of gallery.members) {
      const generationId = storyboardAssets.find(a => a.id === member.assetId)?.variants.find(v => v.id === member.variantId)?.generationNodeId;
      if (generationId) stackedImageIds.add(generationId);
    }
    const focusedShot = storyboardRelation?.kind === 'shot' ? basicNodes.find(node => node.id === storyboardRelation.storyboardId)?.storyboard?.shots.find(shot => shot.id === storyboardRelation.id) : undefined;
    const focusedAssetIds = new Set([...(focusedShot?.characters || []).map(ref => ref.assetId), ...(focusedShot?.scene ? [focusedShot.scene.assetId] : [])]);
    const stackNodes = storyboardGalleries.flatMap(gallery => gallery.members.filter(member => member.versions).map(member => {
      const ownerShot = basicNodes.find(node => node.id === gallery.storyboardId)?.storyboard?.shots.find(shot => shot.id === member.shotId);
      const assetVariant = storyboardAssets.find(a => a.id === member.assetId)?.variants.find(v => v.id === member.variantId);
      const assetTasks = assetVariant?.generationNodeId ? images.filter(image => image.sourceInstanceId === assetVariant.generationNodeId) : [];
      const selectedPath = (ownerShot ? selectedStoryboardShotImage(storyboardFrame(ownerShot, member.frame), images)?.path : storyboardAssets.find(a => a.id === member.assetId)?.variants.find(v => v.id === member.variantId)?.referencePath) || member.versions![0]?.path;
      const selectedImage = (ownerShot ? selectedStoryboardShotImage(storyboardFrame(ownerShot, member.frame), images) : images.find(image => image.path === selectedPath)) || (selectedPath ? { id: member.versions!.find(version => version.path === selectedPath)!.id, path: selectedPath, name: member.name, status: 'ready' as const, x: gallery.x + member.x, y: gallery.y + member.y } as WorkbenchImage : undefined);
      return ({
      id: member.id, type: 'storyboardImageStack', parentId: gallery.id,
      position: { x: member.x, y: member.y }, style: { width: member.width, height: member.height },
      draggable: true, deletable: false,
      data: { name: member.name, versions: member.versions!, selectedPath,
        ...storyboardStackStatus(assetTasks, feedback[assetVariant?.generationNodeId || ''] || (assetVariant?.generationNodeId && !assetTasks.length && !assetVariant.history?.some(h => h.nodeId === assetVariant.generationNodeId)
          ? safeTaskDrafts[assetVariant.generationNodeId]?.activeImageTasks?.length ? shell.toasts.generatingWaitSync : shell.errors.noJobFound
          : '')),
        relationState: focusedShot && gallery.storyboardId === storyboardRelation?.storyboardId ? ((member.shotId ? member.shotId === focusedShot.id : focusedAssetIds.has(member.assetId!)) ? 'related' : 'muted') : undefined,
        editor: selectedImage && (selectedImage.src || selectedImage.path) ? { ...buildImageNode({ image: { ...selectedImage, groupId: undefined, src: selectedImage.src || imageFileUrl(selectedImage.path!), x: gallery.x + member.x, y: gallery.y + member.y }, cropSaving: imageEditorSaving, callbacks: { ...imageCallbacks, onTogglePrompt: (id: string) => { void toggleImagePrompt(id); } } }).data,
          ...(member.assetId && member.variantId && selectedPath ? {
            onGenerate: (_id: string, params: ContinueGenerateParams) => generateStoryboardAssetVersion(gallery.storyboardId, member.assetId!, member.variantId!, selectedPath, params),
            referenceResources: images.filter(image => image.path && image.status !== 'generating' && image.status !== 'failed').map(image => ({ id: image.id, name: image.name || shell.labels.image, path: image.path, src: image.src, kind: 'image' as const })),
            onUploadReference: uploadImageFile,
          } : {}),
          onNaturalSize: (width: number, height: number) => setImages(current => current.some(image => image.id === selectedImage.id) ? current.map(image => image.id === selectedImage.id && (image.naturalWidth !== width || image.naturalHeight !== height) ? { ...image, naturalWidth: width, naturalHeight: height } : image) : [...current, { ...selectedImage, naturalWidth: width, naturalHeight: height }]),
        } : undefined,
        onSelect: (path: string) => {
          if (ownerShot) {
            setBasicNodes(current => current.map(node => node.id !== gallery.storyboardId || !node.storyboard ? node : { ...node, storyboard: { ...node.storyboard, shots: node.storyboard.shots.map(shot => shot.id === ownerShot.id ? patchStoryboardFrame(shot, member.frame || 'first', { selectedImagePath: path }) : shot) } }));
            return;
          }
          setImages(current => current.some(image => image.path === path) ? current : [...current, { id: crypto.randomUUID(), path, src: imageFileUrl(path), name: member.name, x: gallery.x + member.x, y: gallery.y + member.y, status: 'ready' }]);
          setStoryboardAssets(current => current.map(asset => asset.id !== member.assetId ? asset : {
          ...asset, activeVariantId: member.variantId, revision: asset.revision + 1,
          variants: asset.variants.map(variant => variant.id !== member.variantId ? variant : { ...variant, referencePath: path, referenceNodeId: undefined }),
        })); },
      },
    }); }));
    const relationShots = basicNodes.find(node => node.id === storyboardRelation?.storyboardId)?.storyboard?.shots || [];
    const relatedGalleryMembers = new Set(storyboardRelationGalleryLinks(storyboardGalleries, relationShots, storyboardAssets, storyboardRelation).map(link => link.memberId));
    const galleryNodes = storyboardGalleries.map(gallery => ({ id: gallery.id, type: 'storyboardGallery', position: { x: gallery.x, y: gallery.y }, style: { width: gallery.width, height: gallery.height }, draggable: true, dragHandle: '.node-drag-surface', selectable: true, deletable: false, data: gallery }));
    const imageNodes = (Array.isArray(images) ? images : [])
      .filter(image => !image.embeddedInSource && !stackedImageIds.has(image.id))
      .map(image => {
        const membership = galleryMembership.get(image.id);
        const imageNode = buildImageNode({
          image: membership ? { ...image, name: membership.member.name, x: membership.member.x, y: membership.member.y } : image,
          toast: imageToasts[image.id],
          cropSaving: imageEditorSaving,
          cutoutBusy: Boolean(image.cutoutTaskId),
          callbacks: {
            ...imageCallbacks,
            onTogglePrompt: (id: string) => { void toggleImagePrompt(id); },
          },
        });
        return membership ? {
          ...imageNode,
          parentId: membership.gallery.id,
          extent: undefined,
          draggable: true,
          className: `${imageNode.className || ''}${relatedGalleryMembers.has(image.id) ? ' storyboard-gallery-member-related' : ''}`.trim(),
        } : imageNode;
      });

    const canvasMediaResources: CanvasReferenceResource[] = [
      ...(Array.isArray(images) ? images : [])
        .filter(image => image.status !== 'generating' && Boolean(image.path))
        .map(image => ({
          id: image.id,
          name: image.name,
          path: image.path,
          src: image.src,
          kind: 'image' as const,
          mimeType: 'image/*',
        })),
      ...(Array.isArray(basicNodes) ? basicNodes : []).flatMap(node => {
        const activeVideo = node.kind === 'video'
          ? node.videoResults?.find(result => result.id === node.activeVideoResultId) ?? node.videoResults?.at(-1)
          : undefined;
        const path = node.projectFilePath || activeVideo?.path || node.videoTask?.path;
        const mimeType = node.sourceMime || (node.kind === 'video' && path ? 'video/mp4' : '');
        const kind = (mimeType.startsWith('image/')
          ? 'image'
          : mimeType.startsWith('video/')
            ? 'video'
            : mimeType.startsWith('audio/')
              ? 'audio'
              : null) as CanvasReferenceResource['kind'] | null;
        if (!path || !kind) return [];
        return [{ id: node.id, name: node.title || path.split('/').at(-1) || shell.labels.material, path, kind, mimeType }];
      }),
    ];
    const liveArtifactProgress = new Map((artifactGenerationProgress ?? []).map(result => [result.binding.requestId, result]));
    const basicCanvasNodes = (Array.isArray(basicNodes) ? basicNodes : []).filter(node => !isPendingReportStoryboard(node)).map(node => buildBasicCanvasNode({
      node,
      storyboardLibrary: {
        storyboardId: node.id,
        defaultVisualStyle: node.storyboard?.visualStyle,
        relation: storyboardRelation?.storyboardId === node.id ? storyboardRelation : undefined,
        pinnedRelation: pinnedStoryboardRelation?.storyboardId === node.id ? pinnedStoryboardRelation : undefined,
        onHoverRelation: target => hoverStoryboardRelation(target ? { ...target, storyboardId: node.id } : undefined),
        onPinRelation: target => pinStoryboardRelation(target ? { ...target, storyboardId: node.id } : undefined),
        onClearRelation: clearStoryboardRelation,
        onSetShotAssociation: (assetId, shotId, linked) => {
          const asset = storyboardAssets.find(item => item.id === assetId);
          if (!asset) return;
          setBasicNodes(current => current.map(item => item.id !== node.id || !item.storyboard ? item : { ...item, storyboard: { ...item.storyboard, shots: item.storyboard.shots.map(shot => shot.id === shotId ? setStoryboardAssetAssociation(shot, asset, linked) : shot) } }));
        },
        onRemove: assetId => {
          const asset = storyboardAssets.find(item => item.id === assetId);
          if (!asset) return;
          setBasicNodes(current => current.map(item => item.id !== node.id || !item.storyboard ? item : { ...item, storyboard: {
            ...item.storyboard, assets: item.storyboard.assets?.filter(seed => seed.id !== assetId && !(seed.kind === asset.kind && seed.name.trim().normalize('NFKC').toLocaleLowerCase() === asset.name.trim().normalize('NFKC').toLocaleLowerCase())),
            shots: item.storyboard.shots.map(shot => setStoryboardAssetAssociation(shot, asset, false)),
          } }));
          clearStoryboardRelation();
        },
        onArrangeRelated: () => setStoryboardGroupPositions(current => Object.fromEntries(Object.entries(current).filter(([id]) => !(['character', 'scene', 'shot'] as const).some(kind => id === `storyboard-gallery:v2:${node.id}:${kind}` || id === storyboardGroupId(node.id, kind))))),
        imageNodeIds: instances.filter(i => i.kind === 'visual').map(i => i.id),
        onUseShotImage: (shotId, path, frame) => {
          if (!path.trim()) throw new Error(shell.errors.imagePathEmpty);
          const target = basicNodesRef.current.find(n => n.id === node.id)?.storyboard?.shots.find(s => s.id === shotId);
          if (!target || (frame === 'last' && !target.tailFrame)) throw new Error(shell.errors.shotOrLastFrameRemoved);
          const id = `shot-import-${crypto.randomUUID()}`;
          const existing = imagesRef.current.find(image => image.path === path);
          setImages(current => [...current, { ...existing, id, sourceInstanceId: id, embeddedInSource: false, groupId: undefined, excludeFromAutoGroup: false, name: existing?.name || shell.labels.storyboardImage, path, src: imageFileUrl(path), status: 'ready', x: node.x, y: node.y }]);
          setBasicNodes(current => current.map(n => n.id !== node.id || !n.storyboard ? n : { ...n, storyboard: { ...n.storyboard, shots: n.storyboard.shots.map(shot => {
            if (shot.id !== shotId || (frame === 'last' && !shot.tailFrame)) return shot;
            const state = storyboardFrame(shot, frame);
            return patchStoryboardFrame(shot, frame, { imageNodeId: id, selectedImagePath: path, imageNodeHistoryIds: [...new Set([...(state.imageNodeHistoryIds || []), ...(state.imageNodeId ? [state.imageNodeId] : [])])] });
          }) } }));
        },
        onFocusShotImage: (shotId, frame) => { const id = `storyboard-stack:${node.id}:shot:${shotId}${frame === 'last' ? ':last' : ''}`; flowApiRef.current?.activateNode(id); flowApiRef.current?.focusNode(id); },
        onCreateShotVideo: shotId => {
          const shot = node.storyboard?.shots.find(s => s.id === shotId);
          if (!shot) return;
          const frames = storyboardVideoFrames(shot, imagesRef.current);
          const id = shot.videoNodeId && basicNodesRef.current.some(n => n.id === shot.videoNodeId) ? shot.videoNodeId : addConnectedNode(node.id, 'video', { x: node.x, y: node.y, width: node.width || 960, height: node.height || 400, skipSourceContext: true });
          patchBasicNode(id, { title: shell.content.shotVideo(String(node.storyboard!.shots.indexOf(shot) + 1).padStart(2, '0')), videoMode: frames.mode, videoAspect: node.storyboard!.aspectRatio, videoLength: shot.durationSec, videoCameraMove: shot.cameraMove, text: shot.description, storyboardVideoSource: { storyboardId: node.id, shotId }, storyboardVideoFrames: frames.images.map((image, index) => ({ sourceNodeId: image.id, name: index ? shell.frames.last : shell.frames.first, path: image.path!, mimeType: 'image/png', size: 0 })) });
          setBasicNodes(current => current.map(n => n.id !== node.id || !n.storyboard ? n : { ...n, storyboard: { ...n.storyboard, shots: n.storyboard.shots.map(s => s.id === shotId ? { ...s, videoNodeId: id } : s) } }));
          flowApiRef.current?.activateNode(id); flowApiRef.current?.focusNode(id);
          if (basicNodesRef.current.find(n => n.id === id)?.videoTask?.status !== 'running') patchBasicNode(id, { videoSubmitRequestId: crypto.randomUUID() });
        },
        onGenerateShot: async (shotId, inputPrompt, count, frame = 'first', imageRatio) => {
          const shot = node.storyboard?.shots.find(item => item.id === shotId);
          if (!shot || !node.storyboard || !inputPrompt.trim()) throw new Error(shell.errors.shotOrPromptEmpty);
          const key = `${node.id}/shot/${shotId}/${frame}`;
          if (storyboardGenerationLocksRef.current.has(key)) return;
          storyboardGenerationLocksRef.current.add(key);
          try {
            const refs = storyboardShotReferences(shot, storyboardAssets);
            const references = refs.map(({ asset, variant }) => ({ assetId: asset.id, name: asset.name, revision: asset.revision, path: variant?.referencePath || storyboardReferenceImage(variant, imagesRef.current)?.path }));
            const attachments = references.flatMap(ref => ref.path ? [{ name: shell.content.refImage(ref.name), path: ref.path, mimeType: 'image/png', size: 0 }] : []);
            const prompt = [inputPrompt.trim(), storyboardReferenceContext(shot, storyboardAssets), storyboardReferenceImageLabels(references, storyboardAssets)].filter(Boolean).join('\n\n');
            const ratio = imageRatio ?? storyboardFrame(shot, frame).imageRatio ?? node.storyboard.aspectRatio;
            const imageNodeId = addConnectedNode(node.id, 'image', { x: node.x, y: node.y, width: node.width || 960, height: node.height || 400, prompt, attachments, imageRatio: ratio, skipSourceContext: true });
            setBasicNodes(current => current.map(item => item.id !== node.id || !item.storyboard ? item : { ...item, storyboard: { ...item.storyboard, shots: item.storyboard.shots.map(s => s.id !== shotId ? s : patchStoryboardFrame(s, frame, { imageNodeId,
              imageRatio: ratio,
              selectedImagePath: selectedStoryboardShotImage(storyboardFrame(s, frame), imagesRef.current)?.path,
              imageSources: { ...storyboardFrame(s, frame).imageSources, [imageNodeId]: { prompt, references } },
              imageNodeHistoryIds: [...new Set([...(storyboardFrame(s, frame).imageNodeHistoryIds || []), ...(storyboardFrame(s, frame).imageNodeId ? [storyboardFrame(s, frame).imageNodeId!] : [])])],
              imageAssetRevisions: Object.fromEntries(references.map(ref => [ref.assetId, ref.revision])),
            })) } }));
            const instance = instancesRef.current.find(item => item.id === imageNodeId);
            if (!instance) throw new Error(shell.errors.storyboardNodeCreateFailed);
            await sendTask(instance, { text: prompt, attachments, models: [defaultVisualModel], imageRatio: ratio, imageRatios: [ratio], imageCount: count === 2 || count === 4 ? count : 1 });
          } finally { storyboardGenerationLocksRef.current.delete(key); }
        },
        assets: assetsForStoryboard(node.storyboard, storyboardAssets),
        images,
        feedback,
        onUpload: uploadImageFile,
        onSave: asset => {
          setStoryboardAssets(current => current.some(a => a.id === asset.id) ? current.map(a => a.id === asset.id ? asset : a) : [...current, asset]);
          setBasicNodes(current => current.map(item => item.id !== node.id || !item.storyboard ? item : { ...item, storyboard: {
            ...item.storyboard, assets: [...(item.storyboard.assets || []).filter(a => a.id !== asset.id), asset],
          } }));
        },
        onGenerate: async (asset, variantId) => {
          const lockKey = `${asset.id}/${variantId}`;
          if (storyboardGenerationLocksRef.current.has(lockKey)) return;
          storyboardGenerationLocksRef.current.add(lockKey);
          let submittingId: string | undefined;
          try {
          const prompt = storyboardAssetPrompt(asset, variantId, node.storyboard?.visualStyle);
          const attachments = storyboardAssetGenerationAttachments(asset, variantId);
          const variant = asset.variants.find(v => v.id === variantId);
          const ratio = storyboardAssetImageRatio(asset, variantId);
          const imageCount = variant?.imageCount === 2 || variant?.imageCount === 4 ? variant.imageCount : 1;
          const generationNodeId = addConnectedNode(node.id, 'image', { x: node.x, y: node.y, width: node.width || 960, height: node.height || 400, prompt, attachments, imageRatio: ratio, skipSourceContext: true });
          submittingId = generationNodeId;
          setFeedback(current => ({ ...current, [generationNodeId]: shell.toasts.submittingVersion }));
          setStoryboardAssets(current => current.map(a => a.id === asset.id ? { ...a, variants: a.variants.map(v => v.id === variantId ? { ...v, generationNodeId } : v) } : a));
          await flushCanvas([STORYBOARD_ASSETS_STATE_KEY, 'workbenchInstances', 'workbenchEdges', 'workbenchTaskDrafts']);
          const instance = instancesRef.current.find(i => i.id === generationNodeId);
          if (!instance) throw new Error(shell.errors.referenceNodeCreateFailed);
          requestAnimationFrame(() => flowApiRef.current?.activateNode(`storyboard-stack:${node.id}:${asset.id}:${variantId}`));
          await sendTask(instance, { text: prompt, attachments, models: [defaultVisualModel], imageRatio: ratio, imageRatios: [ratio], imageCount });
          } catch (error) {
            if (submittingId) setFeedback(current => ({ ...current, [submittingId!]: x.genFailedDetail(error instanceof Error ? error.message : x.pleaseRetry) }));
            throw error;
          } finally {
            storyboardGenerationLocksRef.current.delete(lockKey);
          }
        },
      },
      generationProgress: node.generation ? liveArtifactProgress.get(node.generation.requestId) : undefined,
      onSelect: id => { flowApiRef.current?.activateNode(id); },
      onFocus: id => { flowApiRef.current?.focusNode(id); },
      onPatch: patchBasicNode,
      onRemoveReference: (targetId, sourceId) => history.run(() => setEdges(current => current.filter(edge => edge.target !== targetId || edge.source !== sourceId))),
      onRemove: removeBasicNode,
      onDuplicate: duplicateBasicNode,
      onPickImage: (id, file) => { void pickImageForBasicNode(id, file); },
      canvasMediaResources,
      onAddConnectedNode: addConnectedNode,
      onAddUpstreamTextNode: addUpstreamTextNode,
    }));

    const regenerationPendings = Object.values(pendingWorkflowGenerations).map(pending => (
      buildWorkflowPendingNode({
        instanceId: pending.stepRunId,
        nodeId: workflowRegenerationPendingNodeId(pending.stepRunId),
        title: pending.title,
        hint: pending.error || (pending.selectedIds.length > 0
          ? shell.toasts.generatingFromSelection
          : shell.toasts.regeneratingGroup),
        status: pending.error ? 'failed' : 'generating',
        position: pending.position,
        parentId: workflowStageNodeId(pending.sourceArtifactId),
      })
    ));

    const initialWorkflowPending = workflowPendingRequest
      && (workflowPendingRequest.mode === 'delivery'
        ? !deliveryPendingHasMaterialized(workflowPendingRequest, basicNodes)
        : !workflowArtifacts.some(artifact => (
            artifact.workflowRunId === workflowPendingRequest.runId
            && artifact.sourceStepRunId === workflowPendingRequest.stepRunId
          )))
      ? [buildWorkflowPendingNode({
          instanceId: workflowPendingRequest.stepRunId,
          nodeId: workflowInitialPendingNodeId(workflowPendingRequest.stepRunId),
          title: workflowPendingRequest.title,
          hint: workflowPendingRequest.hint || (workflowPendingRequest.mode === 'delivery'
            ? x.generatingWorkflowTitle(workflowPendingRequest.title)
            : shell.toasts.generatingFirstResult),
          position: workflowStagePositionsRef.current[
            workflowInitialPendingNodeId(workflowPendingRequest.stepRunId)
          ] ?? workflowPendingArtifactPosition({
            pending: workflowPendingRequest,
            stagePositions: workflowStagePositionsRef.current,
            resolvedPositions: resolvedWorkflowArtifactPositions,
            basicNodes,
            instances,
          }),
        })]
      : [];

    const assetGroupNodes = basicCanvasNodes.flatMap(item => {
      const data = item.data as BasicCanvasNodeData;
      if (data.node.kind !== 'storyboard' || !data.node.storyboard || !data.storyboardLibrary) return [];
      const shots = data.node.storyboard.shots;
      return (['character', 'scene'] as const).map((kind, index) => ({
        id: storyboardGroupId(item.id, kind), type: 'storyboardAssetGroup',
        position: storyboardGroupPositions[storyboardGroupId(item.id, kind)] || { x: item.position.x - 460 - 80, y: item.position.y + index * (370 + 80) },
        style: { width: 460 }, draggable: true, deletable: false,
        data: { kind, title: kind === 'character' ? shell.labels.subjectGroup : shell.labels.sceneGroup, library: data.storyboardLibrary, shots },
      }));
    });
    const arrangedCards = cards.filter(card => !stackedImageIds.has(card.id)).map(card => {
      const membership = galleryMembership.get(card.id);
      return membership ? {
        ...card,
        parentId: membership.gallery.id,
        position: { x: membership.member.x, y: membership.member.y },
        className: `${card.className || ''}${relatedGalleryMembers.has(card.id) ? ' storyboard-gallery-member-related' : ''}`.trim(),
      } : card;
    });
    const arrangedAssetGroups = assetGroupNodes.map(card => {
      const membership = galleryMembership.get(card.id);
      if (membership) return { ...card, parentId: membership.gallery.id, draggable: true, position: { x: membership.member.x, y: membership.member.y } };
      return card;
    });
    return [...galleryNodes, ...stackNodes, ...arrangedCards, ...initialWorkflowPending, ...regenerationPendings, ...workflowStages, ...groupNodes, ...imageNodes, ...basicCanvasNodes, ...arrangedAssetGroups];
  }, [dismissedWorkflowResults, removeWorkflowResult, storyboardGalleries, storyboardGroupPositions, storyboardRelation, pinnedStoryboardRelation, hoverStoryboardRelation, pinStoryboardRelation, clearStoryboardRelation, storyboardAssets, setStoryboardAssets, instances, images, promptCards, imageGroups, basicNodes, artifactGenerationProgress, imageToasts, workflowArtifacts, workflowArtifactBusyId, workflowPendingRequest, pendingWorkflowGenerations, resolvedWorkflowArtifactPositions, safeTaskDrafts, feedback, sendingId, cardCallbacks, imageCallbacks, projectPath, edges, defaultVisualModel]);

  const workflowMemberNodes = React.useMemo<import('@xyflow/react').Node[]>(() => [
    ...flowNodes,
    ...workflowRuns.flatMap(snapshot => snapshot.clarification ? [{
      id: workflowQuestionNodeId(snapshot.run.id), type: 'workflowQuestion', position: { x: 0, y: 0 },
      style: { width: 720 }, draggable: true, deletable: false,
      data: { content: uiHost?.renderWorkflowQuestion?.(snapshot) },
    }] : []),
  ], [flowNodes, workflowRuns, uiHost]);
  const workflowOwners = React.useMemo(() => {
    const owners = workflowNodeOwners(workflowMemberNodes, workflowArtifacts, workflowRuns);
    const runIds = new Set(workflowRuns.map(snapshot => snapshot.run.id));
    if (workflowPendingRequest && runIds.has(workflowPendingRequest.runId)) owners.set(workflowInitialPendingNodeId(workflowPendingRequest.stepRunId), workflowPendingRequest.runId);
    for (const pending of Object.values(pendingWorkflowGenerations)) if (pending.workflowRunId && runIds.has(pending.workflowRunId)) owners.set(workflowRegenerationPendingNodeId(pending.stepRunId), pending.workflowRunId);
    return owners;
  }, [workflowMemberNodes, workflowArtifacts, workflowRuns, workflowPendingRequest, pendingWorkflowGenerations]);
  React.useEffect(() => {
    setWorkflowGroups(current => reconcileWorkflowGroups(current, workflowRuns, workflowMemberNodes, workflowOwners));
  }, [workflowRuns, workflowMemberNodes, workflowOwners, setWorkflowGroups]);
  const workflowRunEdges = React.useMemo(() => workflowRunConnections(workflowMemberNodes, workflowArtifacts, workflowRuns), [workflowMemberNodes, workflowArtifacts, workflowRuns]);
  const workflowCanvasEdges = React.useMemo(() => {
    // Replace only generated provenance within projected runs. User-drawn and unrelated edges survive.
    const projectedTargets = new Set(workflowRunEdges.map(edge => edge.target));
    const kept = edges.filter(edge => !(edge.id.startsWith('chain-') && projectedTargets.has(edge.target) && workflowOwners.get(edge.source) === workflowOwners.get(edge.target)));
    return [...kept, ...workflowRunEdges.filter(projected => !kept.some(edge => edge.source === projected.source && edge.target === projected.target))];
  }, [edges, workflowRunEdges, workflowOwners]);
  const groupedWorkflowNodes = React.useMemo(() => {
    const groups: import('@xyflow/react').Node[] = workflowRuns.flatMap(snapshot => {
      const layout = workflowGroups[snapshot.run.id];
      if (!layout || layout.dismissed) return [];
      const stepTargets: Record<string, string[]> = {};
      for (const definition of snapshot.definition.steps) {
        const step = snapshot.steps.filter(s => s.stepId === definition.id).sort((a,b) => b.sequence-a.sequence)[0];
        if (!step) continue;
        const artifactTargets = workflowArtifacts.filter(a => a.workflowRunId === snapshot.run.id && (a.sourceStepRunId === step.id || a.resultDefinitionId === definition.id)).map(a => workflowStageNodeId(a.id));
        stepTargets[definition.id] = [...new Set([...artifactTargets, ...step.artifactRefs.filter(ref => ref.startsWith('canvas-node:')).map(ref => ref.slice(12)), ...(snapshot.clarification?.stepRunId === step.id ? [workflowQuestionNodeId(snapshot.run.id)] : [])])];
      }
      return [{ id: workflowRunGroupId(snapshot.run.id), type: 'workflowRunGroup', position: { x: layout.x, y: layout.y },
        draggable: true, deletable: true, dragHandle: '.node-drag-surface', zIndex: -1,
        data: { snapshot, layout, syncError: workflowRunsError, stepTargets,
          onRemove: () => history.run(() => {
            const dismissed = { ...layout, dismissed: true };
            const removed = dismissedWorkflowNodeIds({ [snapshot.run.id]: dismissed }, workflowMemberNodes, workflowOwners);
            removed.add(workflowRunGroupId(snapshot.run.id));
            setWorkflowGroups(current => ({ ...current, [snapshot.run.id]: { ...current[snapshot.run.id]!, dismissed: true } }));
            setEdges(current => current.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
          }),
          onArrange: () => setWorkflowGroups(current => ({ ...current, [snapshot.run.id]: { ...current[snapshot.run.id]!, layoutVersion: 3, members: arrangeWorkflowMembers(workflowMemberNodes.filter(node => workflowOwners.get(node.id) === snapshot.run.id && !node.parentId && !layout.detached?.includes(node.id)), snapshot) } })),
          onToggle: () => setWorkflowGroups(current => ({ ...current, [snapshot.run.id]: { ...current[snapshot.run.id]!, collapsed: !current[snapshot.run.id]?.collapsed } })),
          onAttach: (nodeId: string) => setWorkflowGroups(current => {
            const group = current[snapshot.run.id]!;
            const detached = (group.detached ?? []).filter(id => id !== nodeId);
            return { ...current, [snapshot.run.id]: { ...group, detached, members: arrangeWorkflowMembers(workflowMemberNodes.filter(node => workflowOwners.get(node.id) === snapshot.run.id && !node.parentId && !detached.includes(node.id)), snapshot) } };
          }),
          onDetach: (nodeId: string) => {
            const point = layout.members[nodeId];
            if (!point || layout.detached?.includes(nodeId)) return;
            onNodePositionsCommit([{ id: nodeId, ...point }]);
            setWorkflowGroups(current => ({ ...current, [snapshot.run.id]: { ...current[snapshot.run.id]!, detached: [...(current[snapshot.run.id]?.detached ?? []), nodeId] } }));
          },
          onControl: async (action: string, stepRunId?: string) => {
            const response = await platformFetch(`/api/workflow-graph-runs/${encodeURIComponent(snapshot.run.id)}/execution`, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action, stepRunId, ...(action === 'cancel' ? {} : { snapshot: uiHost?.getExecutionSnapshot?.() }) }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error?.message || 'Workflow action failed');
          },
        } }];
    });
    const dismissed = dismissedWorkflowNodeIds(workflowGroups, workflowMemberNodes, workflowOwners);
    return [...groups, ...workflowMemberNodes.filter(node => !dismissed.has(node.id)).map(node => {
      const runId = workflowOwners.get(node.id);
      const layout = runId ? workflowGroups[runId] : undefined;
      const point = layout?.members[node.id];
      if (!layout || !point || node.parentId || layout.detached?.includes(node.id)) return node;
      return { ...node, parentId: workflowRunGroupId(runId!), position: point, hidden: !!layout.collapsed };
    })];
  }, [workflowRuns, workflowGroups, workflowMemberNodes, workflowOwners, workflowArtifacts, workflowRunsError, uiHost, setWorkflowGroups, setEdges, history]);

  function onNodePositionsCommit(positions: Array<{ id: string; x: number; y: number }>) {
    const workflowMove = workflowGroupMoves(positions, workflowGroups);
    positions = workflowMove.positions;
    if (workflowMove.groups !== workflowGroups) setWorkflowGroups(current => ({ ...current, ...workflowMove.groups }));
    const legacy = moveRelativeGroupMembers(positions, imageGroups, flowNodes.map(node => {
      const image = images.find(item => item.id === node.id && item.groupId);
      return image ? { ...node, measured: getImageDisplaySize(image.naturalWidth, image.naturalHeight) } : node;
    }));
    positions = legacy.positions;
    if (legacy.groups.some((group, index) => group !== imageGroups[index])) setImageGroups(legacy.groups);
    const organization = organizationMove(positions, organizationGroups, flowNodes);
    positions = organization.positions;
    if (organization.groups.some((group, index) => group !== organizationGroups[index])) setOrganizationGroups(organization.groups);
    const galleryMembers = new Map(storyboardGalleries.flatMap(gallery => gallery.members.map(member => [member.id, gallery] as const)));
    if (positions.some(p => galleryMembers.has(p.id) || storyboardGalleries.some(group => group.id === p.id))) {
      setStoryboardGroupPositions(current => commitGalleryPositions(storyboardGalleries, current, positions));
    }
    const assetPositions = positions.filter(p => p.id.startsWith('storyboard-assets:') && !galleryMembers.has(p.id));
    if (assetPositions.length) setStoryboardGroupPositions(current => ({ ...current, ...Object.fromEntries(assetPositions.map(p => [p.id, { x: p.x, y: p.y }])) }));
    positions = positions.filter(p => !galleryMembers.has(p.id));
    const byId = new Map(positions.map(item => [item.id, item]));
    setInstances(current => {
      let changed = false;
      const nextItems = current.map(item => {
        const next = byId.get(item.id);
        if (!next || (item.x === next.x && item.y === next.y)) return item;
        changed = true;
        return { ...item, x: next.x, y: next.y };
      });
      return changed ? nextItems : current;
    });
    setImageGroups(current => {
      const source = Array.isArray(current) ? current : [];
      let changed = false;
      const nextItems = source.map(item => {
        const next = byId.get(item.id);
        if (!next || (item.x === next.x && item.y === next.y)) return item;
        changed = true;
        return { ...item, x: next.x, y: next.y };
      });
      return changed ? nextItems : source;
    });
    setImages(current => {
      const source = Array.isArray(current) ? current : [];
      let changed = false;
      const nextItems = source.map(item => {
        const next = byId.get(item.id);
        if (!next || (item.x === next.x && item.y === next.y)) return item;
        changed = true;
        return { ...item, x: next.x, y: next.y };
      });
      return changed ? nextItems : source;
    });
    setPromptCards(current => {
      const source = Array.isArray(current) ? current : [];
      let changed = false;
      const nextItems = source.map(item => {
        const next = byId.get(item.id);
        if (!next || (item.x === next.x && item.y === next.y)) return item;
        changed = true;
        return { ...item, x: next.x, y: next.y };
      });
      return changed ? nextItems : source;
    });
    setBasicNodes(current => {
      const source = Array.isArray(current) ? current : [];
      let changed = false;
      const nextItems = source.map(item => {
        const next = byId.get(item.id);
        if (!next || (item.x === next.x && item.y === next.y)) return item;
        changed = true;
        return { ...item, x: next.x, y: next.y };
      });
      return changed ? nextItems : source;
    });
    for (const pos of positions) {
      if (pos.id.startsWith('creative-')) {
        creativePositionsRef.current[pos.id] = { x: pos.x, y: pos.y };
      }
      if (pos.id.startsWith('topic-')) {
        topicPositionsRef.current[pos.id] = { x: pos.x, y: pos.y };
      }
      if (pos.id.startsWith('product-')) {
        productPositionsRef.current[pos.id] = { x: pos.x, y: pos.y };
      }
      if (pos.id.startsWith('article-')) {
        articlePositionsRef.current[pos.id] = { x: pos.x, y: pos.y };
      }
      if (pos.id.startsWith('evaluation-')) {
        evaluationPositionsRef.current[pos.id] = { x: pos.x, y: pos.y };
      }
    }
    const initialPendingId = workflowPendingRequest
      ? workflowInitialPendingNodeId(workflowPendingRequest.stepRunId)
      : '';
    const workflowPositions = positions.filter(pos => (
      pos.id.startsWith('workflow-result-') || pos.id === initialPendingId
    ));
    if (workflowPositions.length > 0) {
      // `workflowStagePositionsRef.current` normally points at the same object
      // returned by useCanvasState. Mutating it in place makes the functional
      // setter believe nothing changed, so CanvasCompat never sends its PATCH.
      // Keep the immediate read path fast, but publish a fresh object.
      const nextWorkflowPositionRef = { ...workflowStagePositionsRef.current };
      for (const pos of workflowPositions) {
        nextWorkflowPositionRef[pos.id] = { x: pos.x, y: pos.y };
      }
      workflowStagePositionsRef.current = nextWorkflowPositionRef;
      setWorkflowStagePositions(current => {
        let changed = false;
        const next = { ...(current || {}) };
        for (const pos of workflowPositions) {
          if (next[pos.id]?.x === pos.x && next[pos.id]?.y === pos.y) continue;
          next[pos.id] = { x: pos.x, y: pos.y };
          changed = true;
        }
        return changed ? next : current;
      });
    }
    const pendingByNodeId = new Map(Object.values(pendingWorkflowGenerations).map(pending => [
      workflowRegenerationPendingNodeId(pending.stepRunId),
      pending.stepRunId,
    ]));
    if (positions.some(pos => pendingByNodeId.has(pos.id))) {
      setPendingWorkflowGenerations(current => {
        let changed = false;
        const next = { ...current };
        for (const pos of positions) {
          const stepRunId = pendingByNodeId.get(pos.id);
          if (!stepRunId || !next[stepRunId]) continue;
          if (next[stepRunId].position.x === pos.x && next[stepRunId].position.y === pos.y) continue;
          next[stepRunId] = { ...next[stepRunId], position: { x: pos.x, y: pos.y } };
          changed = true;
        }
        return changed ? next : current;
      });
    }
  }

  const placeNewReportResult = useEffectEvent(() => {
    // One branch per commit so the next branch sees the updated occupied area.
    const pending = basicNodes.find(node => node.storyboardInitialLayoutPending && node.storyboard?.shots?.length);
    if (!pending) return;
    const positions = placeNewStoryboardBranch(flowNodes, pending.id);
    if (!positions.length) return;
    onNodePositionsCommit(positions);
    setBasicNodes(current => current.map(node => node.id === pending.id ? { ...node, storyboardInitialLayoutPending: false } : node));
  });
  React.useEffect(() => { placeNewReportResult(); }, [basicNodes, flowNodes, placeNewReportResult]);

  const hiddenCaseNodeIds = new Set(instances.filter(instance => instance.kind === 'plan')
    .flatMap(instance => [instance.id, articleNodeId(instance.id)]));
  const visibleCaseEdge = (edge: CanvasEdge) => !hiddenCaseNodeIds.has(edge.source) && !hiddenCaseNodeIds.has(edge.target);
  return (
    <main className="flow-home">
      <section
        ref={canvasHostRef}
        className="flow-canvas-host"
        data-storyboard-relation={Boolean(storyboardRelation)}
        onPointerDownCapture={event => { if ((event.target as HTMLElement).classList?.contains('react-flow__pane')) clearStoryboardRelation(); }}
        onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) clearStoryboardRelation(); }}
        aria-label={shell.view.freeCanvas}
      >
        <PersistedCanvasSurface
          nodes={[
            ...organizationGroups.map(group => ({
              id: group.id, type: 'organizationGroup', position: { x: group.x, y: group.y },
              style: { width: group.width, height: group.height }, dragHandle: '.node-drag-surface',
              data: { group, count: group.memberIds.filter(id => flowNodes.some(node => node.id === id)).length,
                referenceReady: group.memberIds.length > 0 && group.memberIds.every(id => {
                  const refs = resolveCanvasSourceAttachments({ sourceNodeId: id, basicNodes, images });
                  return refs.length > 0 && refs.every(item => item.mimeType.startsWith('image/'));
                }),
                onRename: (name: string) => history.run(() => setOrganizationGroups(current => current.map(item => item.id === group.id ? { ...item, name } : item))),
                onAddNode: (kind: CanvasNodeCreationKind) => {
                  if (!group.memberIds.length || !group.memberIds.every(id => {
                    const refs = resolveCanvasSourceAttachments({ sourceNodeId: id, basicNodes, images });
                    return refs.length && refs.every(item => item.mimeType.startsWith('image/'));
                  })) return shell.errors.groupRefNeedsImages;
                  addConnectedNode(group.id, kind, { x: group.x, y: group.y, width: group.width, height: group.height });
                },
                onDissolve: () => history.run(() => {
                  try {
                  const plan = planGroupDissolve(group, group.memberIds.map(id => ({ id, x: 0, y: 0 })), edges);
                  setEdges(plan.edges);
                  setOrganizationGroups(current => current.filter(item => item.id !== group.id));
                  } catch (error) { return error instanceof Error ? error.message : shell.errors.cannotUngroup; }
                }),
              },
            })),
            ...organizationMembers(groupedWorkflowNodes, organizationGroups),
          ]}
          edges={[...visibleStoryboardEdges(workflowCanvasEdges, basicNodes, storyboardAssets, images), ...storyboardGroupChainEdges(basicNodes, storyboardGalleries, storyboardGroupPositions)].filter(edge => visibleCaseEdge(edge) && !pendingReportIds.has(edge.source) && !pendingReportIds.has(edge.target))}
          apiRef={flowApiRef}
          interactionMode={effectiveTool}
          onInteractionModeChange={setCanvasTool}
          edgesVisible={canvasEdgesVisible}
          background={canvasBackground}
          tone={canvasTone}
          empty={groupedWorkflowNodes.length === 0}
          onEdgesChangePersist={next => setEdges(current => {
            const visibleIds = new Set(visibleStoryboardEdges(current, basicNodes, storyboardAssets, images).filter(visibleCaseEdge).map(edge => edge.id));
            const retained = next.filter(edge => !edge.id.startsWith('chain-storyboard-assets:'));
            const nextIds = new Set(retained.map(edge => edge.id));
            return [...retained, ...current.filter(edge => !visibleIds.has(edge.id) && !nextIds.has(edge.id))];
          })}
          onNodePositionsCommit={onNodePositionsCommit}
          priorLayout={canvasPriorLayout}
          onPriorLayoutPersist={setCanvasPriorLayout}
          onFilesDrop={(files, flowPosition) => { void addImagesFromFiles(files, flowPosition); }}
          onDocumentsDrop={onDocumentsDrop}
          onProjectFileDrop={(file, flowPosition) => { void addProjectFileToCanvas(file, flowPosition); }}
          onAddNode={addNodeFromCatalog}
          onGroupSelectedImages={groupSelectedImages}
          onGroupSelection={selected => {
            const selectedGroups = selected.filter(node => node.type === 'organizationGroup' || node.type === 'imageGroup');
            if (selectedGroups.length) {
              if (selectedGroups.length !== 1) return shell.errors.oneGroupOnly;
              const legacy = imageGroups.find(group => group.id === selectedGroups[0]!.id);
              if (legacy) {
                const incoming = selected.filter(node => node.id !== legacy.id && !legacy.memberIds.includes(node.id));
                if (incoming.some(node => node.type !== 'imageAsset')) return shell.errors.refGroupImagesOnly;
                const next = addOrganizationMembers(legacy.id, incoming, [...organizationGroups, ...imageGroups.map(item => ({ ...item, name: item.name || shell.labels.referenceGroup }))], edges).find(item => item.id === legacy.id)!;
                const added = new Map(incoming.map(node => [node.id, node.position]));
                history.run(() => {
                  setImages(current => current.map(image => {
                    const position = added.get(image.id);
                    if (position) return { ...image, groupId: legacy.id, x: position.x - next.x, y: position.y - next.y };
                    return image.groupId === legacy.id ? { ...image, x: image.x + legacy.x - next.x, y: image.y + legacy.y - next.y } : image;
                  }));
                  setImageGroups(current => current.map(group => group.id === legacy.id ? { ...group, ...next, layoutMode: 'free' } : group));
                });
                flowApiRef.current?.activateNode(legacy.id);
                return;
              }
              const allGroups = [...organizationGroups, ...imageGroups.map(item => ({ ...item, name: item.name || shell.labels.referenceGroup }))];
              const next = addOrganizationMembers(selectedGroups[0]!.id, selected, allGroups, edges).filter(item => organizationGroups.some(group => group.id === item.id));
              history.run(() => setOrganizationGroups(next));
              flowApiRef.current?.activateNode(selectedGroups[0]!.id);
              return;
            }
            // Preserve the established pure-image reference-group workflow.
            if (selected.every(node => node.type === 'imageAsset' && !node.parentId)) {
              return groupSelectedImages(selected.map(node => node.id), selected.map(node => ({ id: node.id, ...node.position, width: node.measured?.width ?? node.width ?? 0, height: node.measured?.height ?? node.height ?? 0 })));
            }
            const group = createOrganizationGroup(`organization-${globalThis.crypto.randomUUID()}`, selected, organizationGroups);
            history.run(() => setOrganizationGroups(current => [...current, group]));
            flowApiRef.current?.activateNode(group.id);
          }}
          onRemoveGroupMembers={ids => history.run(() => {
            const removed = new Set(ids);
            const byId = new Map(imageGroups.map(group => [group.id, group]));
            setImages(current => current.map(image => {
              const group = image.groupId ? byId.get(image.groupId) : undefined;
              return group && removed.has(image.id) ? { ...image, groupId: undefined, x: group.x + image.x, y: group.y + image.y } : image;
            }));
            setImageGroups(current => current.map(group => group.memberIds.some(id => removed.has(id)) ? { ...group, layoutMode: 'free', memberIds: group.memberIds.filter(id => !removed.has(id)) } : group));
            setOrganizationGroups(current => removeOrganizationMembers(ids, current));
          })}
        />
        {canvasEdgesVisible && <StoryboardRelationOverlay hostRef={canvasHostRef} focus={storyboardRelation} shots={basicNodes.find(n => n.id === storyboardRelation?.storyboardId)?.storyboard?.shots || []} assets={storyboardAssets} galleries={storyboardGalleries} />}
      </section>

      <ProductionCanvasViewToolbar
        apiRef={flowApiRef}
        background={canvasBackground}
        tone={canvasTone}
        onBackgroundChange={setCanvasBackground}
        onToneChange={setCanvasTone}
        connectionsVisible={canvasEdgesVisible}
        onConnectionsVisibleChange={setCanvasEdgesVisible}
      />
      <footer className="capability-dock" data-canvas-composer-obstacle>
        <div className="dock-workflow-anchor">
          <CanvasAddNodeMenu
            open={workflowMenuOpen}
            onOpenChange={setWorkflowMenuOpen}
            trigger={<Button variant="primary" size="icon" className={`dock-primary bezier-tooltip${workflowMenuOpen ? ' is-active' : ''}`} data-tooltip={addNodeChrome.addNode} data-tooltip-placement="top" aria-label={addNodeChrome.startWorkflow}><Icon name="plus" size={18} strokeWidth={1.6} /></Button>}
            onAddNode={kind => addNodeFromCatalog(kind)}
          />
        </div>
        <div className="dock-mode-anchor" onPointerEnter={event => { if (event.pointerType !== 'touch') keepToolModeOpen(); }} onPointerLeave={scheduleToolModeClose}>
          {renderPopover({
            open: toolModeMenuOpen,
            onOpenChange: setToolModeMenuOpen,
            ariaLabel: shell.tools.mode,
            contentClassName: 'dock-mode-popover',
            wrapDomainMenu: false,
            role: 'dialog',
            side: 'top',
            align: 'center',
            sideOffset: 8,
            trigger: <Button variant="ghost" size="icon" className="dock-mode-button bezier-tooltip" data-tooltip={effectiveTool === 'hand' ? shell.tools.handTip : shell.tools.selectTip} data-tooltip-placement="top" aria-label={shell.tools.switchMode}><ToolIcon name={effectiveTool === 'hand' ? 'hand' : 'pointer'} /></Button>,
            children: <div className="dock-mode-options" onPointerEnter={keepToolModeOpen} onPointerLeave={scheduleToolModeClose}>
              {(['pointer', 'hand'] as const).map(mode => <Button key={mode} variant="ghost" className="dock-mode-option bezier-tooltip" aria-pressed={canvasTool === mode} data-tooltip={mode === 'pointer' ? shell.tools.selectHint : shell.tools.handHint} data-tooltip-placement="top" onClick={() => { setCanvasTool(mode); setToolModeMenuOpen(false); }}><ToolIcon name={mode === 'pointer' ? 'pointer' : 'hand'} /><span>{mode === 'pointer' ? shell.tools.select : shell.tools.hand}</span><small>{mode === 'pointer' ? 'V' : 'H'}</small></Button>)}
            </div>,
          })}
        </div>
        <span className="dock-divider" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon"
          className={`dock-assets-button bezier-tooltip${projectAssetsOpen ? ' is-active' : ''}`}
          onClick={() => window.dispatchEvent(new CustomEvent('bezier-design:toggle-project-assets'))}
          aria-label={shell.view.projectAssets}
          aria-pressed={projectAssetsOpen}
          data-tooltip={projectAssetsOpen ? shell.view.collapseAssets : shell.view.openAssets}
          data-tooltip-placement="top"
        >
          <ToolIcon name="folder" />
        </Button>
      </footer>

    </main>
  );
}



export default function Workbench({
  workflowRuns = EMPTY_WORKFLOW_RUNS,
  workflowRunsError,
  workflowArtifacts = EMPTY_WORKFLOW_ARTIFACTS,
  onWorkflowArtifactsRefresh,
  workflowPendingRequest,
  nodeCreationRequest,
  onNodeCreationConsumed,
  onDocumentsDrop,
  artifactLaunchRequest,
  onArtifactLaunchConsumed,
  imageGenerationLaunchRequest,
  onImageGenerationLaunchConsumed,
  presentationGenerationLaunchRequest,
  onPresentationGenerationLaunchConsumed,
  textDocumentChange,
  textGenerationResults,
  artifactGenerationResults,
  artifactGenerationProgress,
}: {
  workflowRuns?: WorkflowCanvasRun[];
  workflowRunsError?: string;
  workflowArtifacts?: WorkflowResultArtifact[];
  onWorkflowArtifactsRefresh?: () => Promise<void> | void;
  activeAgentId?: string;
  workflowPendingRequest?: CanvasWorkflowPendingRequest | null;
  nodeCreationRequest?: CanvasNodeCreationRequest | null;
  onNodeCreationConsumed?: (nonce: string, nodeId: string) => void;
  onDocumentsDrop?: (files: File[], flowPosition: { x: number; y: number }) => void;
  artifactLaunchRequest?: CanvasArtifactLaunchRequest | null;
  onArtifactLaunchConsumed?: (nonce: string) => void;
  imageGenerationLaunchRequest?: CanvasImageGenerationLaunchRequest | null;
  onImageGenerationLaunchConsumed?: (nonce: string) => void;
  presentationGenerationLaunchRequest?: CanvasPresentationGenerationLaunchRequest | null;
  onPresentationGenerationLaunchConsumed?: (nonce: string) => void;
  textDocumentChange?: TextDocumentChange | null;
  textGenerationResults?: CanvasTextGenerationResult[];
  artifactGenerationResults?: CanvasArtifactGenerationResult[];
  artifactGenerationProgress?: CanvasArtifactGenerationResult[];
}) {
  const [instances, setInstances] = useCanvasState<CanvasInstance[]>('workbenchInstances', []);
  const [images, setImages] = useCanvasState<WorkbenchImage[]>('workbenchImages', []);
  const [promptCards, setPromptCards] = useCanvasState<WorkbenchPromptCard[]>('workbenchPromptCards', []);
  const [basicNodes, setBasicNodes] = useCanvasState<CanvasBasicNode[]>('workbenchBasicNodes', []);
  const [imageGroups, setImageGroups] = useCanvasState<ImageGroup[]>('workbenchImageGroups', []);
  const [edges, setEdges] = useCanvasState<CanvasEdge[]>('workbenchEdges', []);
  const [taskDrafts, setTaskDrafts] = useCanvasState<TaskDrafts>('workbenchTaskDrafts', {});
  // Match the visible media picker default; chat identity never selects a billed provider.
  // Available per-card choices remain authoritative; new cards use discovery.
  const mediaCatalog = useCanvasMediaCatalog();
  const defaultVisualModel = resolveVisualModelSelection(undefined, mediaCatalog);
  const [projectPath] = useCanvasState('projectPath', '');


  return (
    <div className="workbench-shell">

        <div className="home-layer">
          <FlowHome
          workflowRuns={workflowRuns}
          workflowRunsError={workflowRunsError}
          workflowArtifacts={workflowArtifacts}
          onWorkflowArtifactsRefresh={onWorkflowArtifactsRefresh}
          projectPath={projectPath}
          defaultVisualModel={defaultVisualModel}
          instances={instances}
          setInstances={setInstances}
          images={images}
          setImages={setImages}
          promptCards={promptCards}
          setPromptCards={setPromptCards}
          basicNodes={basicNodes}
          setBasicNodes={setBasicNodes}
          imageGroups={imageGroups}
          setImageGroups={setImageGroups}
          edges={edges}
          setEdges={setEdges}
          taskDrafts={taskDrafts}
          setTaskDrafts={setTaskDrafts}
          workflowPendingRequest={workflowPendingRequest}
          nodeCreationRequest={nodeCreationRequest}
          onNodeCreationConsumed={onNodeCreationConsumed}
          onDocumentsDrop={onDocumentsDrop}
          artifactLaunchRequest={artifactLaunchRequest}
          onArtifactLaunchConsumed={onArtifactLaunchConsumed}
          imageGenerationLaunchRequest={imageGenerationLaunchRequest}
          onImageGenerationLaunchConsumed={onImageGenerationLaunchConsumed}
          presentationGenerationLaunchRequest={presentationGenerationLaunchRequest}
          onPresentationGenerationLaunchConsumed={onPresentationGenerationLaunchConsumed}
          textDocumentChange={textDocumentChange}
          textGenerationResults={textGenerationResults}
          artifactGenerationResults={artifactGenerationResults}
          artifactGenerationProgress={artifactGenerationProgress}
          />
        </div>

    </div>
  );
}
