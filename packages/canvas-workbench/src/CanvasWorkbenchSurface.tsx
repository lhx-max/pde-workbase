'use client';

/**
 * DA 与 OEM 产品的统一画布宿主。
 *
 * 职责边界很窄——**只做注入和包裹，不做业务**：
 * 1. 注入运行时上下文（projectId + Workspace 身份），供画布 API 拼真实路径；
 * 2. 注入宿主能力（AI 任务提交、附件暂存、视图导航），替换原版的 iframe 桥；
 * 3. 挂上 `.canvas-workbench` 作用域根，让画布领域样式生效且不外溢；
 * 4. 套上原版的状态 Provider，把画布状态落到 DA daemon。
 *
 * 画布和存储共用一套标准。
 */

import { useMemo } from 'react';
import type { WorkflowResultArtifact, WorkspaceCollabContext } from '@bezier/contracts';

import Workbench from './Workbench';
import { CanvasCompatProvider } from './platform/canvas-compat';
import { CanvasTeamKindAvailability } from './platform/kind-availability';
import { setCanvasHostContext, platformFetchWithContext, type CanvasTransport } from './platform/api-base';
import { WorkflowApiProvider } from '@bezier/workbench-ui';
import { setCanvasObjectStager, type CanvasObjectReference } from './platform/object-bridge';
import {
  setAgentTaskSubmitter,
  setHostChatAttachmentStager,
  setHostConversationReader,
  type AgentTaskDisplay,
  type CanvasArtifactGenerationResult,
  type CanvasTextGenerationResult,
  type HostConversationMessage,
} from './platform/agent-bridge';
import {
  setArtifactOpener,
  setTextDocumentOpener,
  type ArtifactOpener,
  type TextDocumentChange,
  type TextDocumentOpener,
} from './platform/artifact-bridge';
import { setViewNavigator, type ViewName } from './app/router';
import { CanvasUiHostProvider, type CanvasUiHost } from './platform/ui-host';
import type { CanvasImageGenerationLaunchRequest } from './workbench/image-generation-launch';
import type { CanvasPresentationGenerationLaunchRequest } from './workbench/presentation-generation-launch';
import type { CanvasArtifactLaunchRequest } from './workbench/canvas-artifact';
import type { CanvasNodeCreationRequest } from './workbench/canvas-node-catalog';

import './canvas-workbench.css';
import '@bezier/workbench-ui/styles.css';

import { CanvasLocaleProvider } from './platform/canvas-locale';
const EMPTY_MODULES: readonly string[] = [];
export type CanvasWorkbenchSurfaceProps = {
  nodeCreationRequest?: CanvasNodeCreationRequest | null;
  onNodeCreationConsumed?: (nonce: string, nodeId: string) => void;
  /** OS document drops (md/txt/docx) — host opens the doc app bound to a new
   * card at the drop position; images keep their own drop channel. */
  onDocumentsDrop?: (files: File[], flowPosition: { x: number; y: number }) => void;
  projectId: string;
  /** Independently configurable transport, auth and resource URLs. Never persisted. */
  transport?: CanvasTransport;
  /** Host-owned workflow projection. The canvas must not start a second poll. */
  workflowRuns?: import("@bezier/contracts").WorkflowCanvasRun[];
  workflowRunsError?: string;
  workflowArtifacts?: WorkflowResultArtifact[];
  onWorkflowArtifactsRefresh?: () => Promise<void> | void;
  onInteractionActiveChange?: (active: boolean) => void;
  /** 宿主提供公共 Popover / Dialog 壳，画板包只保留领域内容。 */
  uiHost: CanvasUiHost;
  /** Active product locale. Omitted keeps the historical Chinese canvas chrome. */
  locale?: string | null;
  businessModules?: readonly string[];
  disabledMediaProviders?: readonly string[];
  /** 宿主当前 Agent；只用于画布内尚未手动选择过的能力默认值。 */
  activeAgentId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
  /**
   * 把画布生成的 AI 指令交给宿主的对话运行时执行。
   *
   * 原版靠 `postMessage` 递给外层 iframe；原生挂载后由宿主直接接管。
   */
  onSubmitAgentTask?: (
    text: string,
    display?: AgentTaskDisplay,
    attachments?: File[],
  ) => Promise<void>;
  /** 把画布图片暂存到当前对话输入框，不直接发送。 */
  onStageChatAttachments?: (attachments: File[]) => Promise<void>;
  onStageCanvasObject?: (reference: CanvasObjectReference) => void;
  /**
   * 读宿主当前对话的全部消息，供建档时归档原始指令与澄清问答（脚本提取，
   * 禁止 AI 总结改写）。不传则归档跳过，不阻断建档。
   */
  readHostConversation?: () => HostConversationMessage[];
  /** 画布内的「返回首页」等导航动作交回宿主路由。 */
  onNavigate?: (view: ViewName, extra?: Record<string, string>) => void;
  /** 打开最终产物对应的项目文件或实时产物 Tab。 */
  onOpenArtifact?: ArtifactOpener;
  /** 创建或聚焦画布文本节点绑定的 Markdown 文档，并返回文档真实内容。 */
  onOpenTextDocument?: TextDocumentOpener;
  /** 文档标签最近一次成功保存；画布重新挂载后也会补发。 */
  textDocumentChange?: TextDocumentChange | null;
  /** Terminal host-chat responses ready to be applied to their bound nodes. */
  textGenerationResults?: CanvasTextGenerationResult[];
  artifactGenerationResults?: CanvasArtifactGenerationResult[];
  /** Ephemeral live progress; never persisted into the canvas document. */
  artifactGenerationProgress?: CanvasArtifactGenerationResult[];
  /** 通用工作流正在生成；在首份结果或直接交付物落盘前显示原位骨架卡。 */
  workflowPendingRequest?: CanvasWorkflowPendingRequest | null;
  /** One-shot request from a generator to place its completed output onto the canvas. */
  artifactLaunchRequest?: CanvasArtifactLaunchRequest | null;
  onArtifactLaunchConsumed?: (nonce: string) => void;
  /** One-shot Home -> canvas image task, executed by the normal image card. */
  imageGenerationLaunchRequest?: CanvasImageGenerationLaunchRequest | null;
  onImageGenerationLaunchConsumed?: (nonce: string) => void;
  /** One-shot Home -> canvas PPT task, executed by the normal PPT card. */
  presentationGenerationLaunchRequest?: CanvasPresentationGenerationLaunchRequest | null;
  onPresentationGenerationLaunchConsumed?: (nonce: string) => void;
};

export type CanvasWorkflowPendingRequest = {
  runId: string;
  workflowId: string;
  stepRunId: string;
  title: string;
  hint?: string;
  /** `initial` 由第一张结果卡接管；`delivery` 由最终画布交付物接管。 */
  mode?: 'initial' | 'delivery';
  /** 直接交付物的上游确认结果，用于预占服务端会采用的同一坐标槽。 */
  parentResultId?: string;
  /** 上游结果中实际参与本次交付的子项。 */
  parentItemIds?: string[];
  /** 只有这个交付节点落盘后，才隐藏对应的载入卡。 */
  deliveryNodeId?: string;
  /** 服务端完成交付后返回的稳定画布节点 ID。 */
  artifactCanvasNodeId?: string;
};

export function CanvasWorkbenchSurface({
  projectId,
  transport,
  workflowRuns,
  workflowRunsError,
  workflowArtifacts,
  onWorkflowArtifactsRefresh,
  onInteractionActiveChange,
  uiHost,
  locale,
  activeAgentId,
  workspaceContext,
  onSubmitAgentTask,
  onStageChatAttachments,
  onStageCanvasObject,
  readHostConversation,
  onNavigate,
  onOpenArtifact,
  onOpenTextDocument,
  nodeCreationRequest,
  onNodeCreationConsumed,
  onDocumentsDrop,
  textDocumentChange,
  textGenerationResults,
  artifactGenerationResults,
  artifactGenerationProgress,
  workflowPendingRequest,
  artifactLaunchRequest,
  onArtifactLaunchConsumed,
  imageGenerationLaunchRequest,
  onImageGenerationLaunchConsumed,
  presentationGenerationLaunchRequest,
  onPresentationGenerationLaunchConsumed,
  businessModules = EMPTY_MODULES,
  disabledMediaProviders = EMPTY_MODULES,
}: CanvasWorkbenchSurfaceProps) {
  // 注入发生在**渲染阶段**，而不是 useEffect 里。
  //
  // 这是必须的：React 的 effect 是自底向上跑的，子组件（如 Workbench 里的
  // FlowHome）的挂载 effect 早于本组件的 effect，那时若上下文还没就位，
  // 子树的 projectApiFetch 会直接抛 "host context is not initialized"。
  //
  // 同理，这里**不做**卸载清空。清空看似干净，实际会开一个致命的空窗：
  // StrictMode 与 Fast Refresh 都会「挂载 → 清理 → 再挂载」，而卸载清理跑在
  // 子组件 effect 之后，于是刚注入好的上下文被随后的清理抹掉，下一轮子树请求
  // 立刻炸。上下文是按 projectId 幂等覆盖的模块级单例，读它的只有画布子树，
  // 留着不清不会污染任何人——留着才是对的。
  const canvasHostContext = useMemo(() => {
    const context = { projectId, workspaceContext, businessModules, disabledMediaProviders, transport };
    setCanvasHostContext(context);
    return context;
  }, [projectId, workspaceContext, businessModules, disabledMediaProviders, transport]);

  useMemo(() => {
    setAgentTaskSubmitter(onSubmitAgentTask ?? null);
    setHostChatAttachmentStager(onStageChatAttachments ?? null);
    setCanvasObjectStager(onStageCanvasObject ?? null);
    setHostConversationReader(readHostConversation ?? null);
    setViewNavigator(onNavigate ?? null);
    setArtifactOpener(onOpenArtifact ?? null);
    setTextDocumentOpener(onOpenTextDocument ?? null);
  }, [onSubmitAgentTask, onStageChatAttachments, onStageCanvasObject, readHostConversation, onNavigate, onOpenArtifact, onOpenTextDocument]);

  const workflowRequest = useMemo(() => (path: string, init?: RequestInit) => platformFetchWithContext(canvasHostContext, path, init), [canvasHostContext]);

  return (
    <div className="canvas-workbench" data-testid="canvas-workbench-surface">
      <WorkflowApiProvider request={workflowRequest}>
      <CanvasLocaleProvider locale={locale}>
      <CanvasUiHostProvider value={uiHost}>
      <CanvasTeamKindAvailability context={canvasHostContext}>
        <CanvasCompatProvider
          key={projectId}
          requestContext={canvasHostContext}
          onInteractionActiveChange={onInteractionActiveChange}
        >
          <Workbench
            workflowRuns={workflowRuns}
            workflowRunsError={workflowRunsError}
            workflowArtifacts={workflowArtifacts}
            onWorkflowArtifactsRefresh={onWorkflowArtifactsRefresh}
            activeAgentId={activeAgentId}
            nodeCreationRequest={nodeCreationRequest}
            onNodeCreationConsumed={onNodeCreationConsumed}
            onDocumentsDrop={onDocumentsDrop}
            workflowPendingRequest={workflowPendingRequest}
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
        </CanvasCompatProvider>
      </CanvasTeamKindAvailability>
      </CanvasUiHostProvider>
      </CanvasLocaleProvider>
      </WorkflowApiProvider>
    </div>
  );
}

export default CanvasWorkbenchSurface;
