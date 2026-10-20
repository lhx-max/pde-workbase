'use client';

import type { CanvasArtifactGenerationBinding, CanvasTextGenerationBinding, CanvasTaskExecutionContext } from '@bezier/contracts';
import { cr } from '../locales/canvas-remainder';
import { getCanvasHostContext } from './api-base';
import { awaitCanvasGenerationBinding } from './canvas-persistence';

/**
 * 画布 → 宿主对话的任务提交桥。
 *
 * 早期实现跑在 iframe 里，靠 `postMessage` 把 AI 指令递给外层。
 * 原生挂载后 `window.parent === window`，桥换成直接回调宿主。
 * 业务调用点统一走 `submitAgentTask(text, display, attachments)`；
 * 宿主负责把本地文件上传成对话可消费的项目附件。
 */

export type AgentTaskDisplay = {
  /** Portable source evidence, never host permissions or execution credentials. */
  executionContext?: CanvasTaskExecutionContext;
  /** Explicitly authorized project files; the server pins only these input bytes. */
  inputPaths?: string[];
  kind: 'instruction-card';
  title: string;
  summary?: string;
  /** Short user-facing operation; the full text remains execution-only. */
  visiblePrompt?: string;
  /** Route the terminal assistant response back to its originating text node. */
  canvasTextGeneration?: CanvasTextGenerationBinding;
  canvasArtifactGeneration?: CanvasArtifactGenerationBinding;
  /** Run-scoped design system selected by a canvas webpage node. */
  designSystemId?: string;
  /** Stable target state captured before the Agent starts mutating artifacts. */
  taskContext?: {
    targetLabel?: string;
    baseVersionSource?: string;
    baseVersionKind?: 'target-snapshot' | 'submission-input';
  };
  workflowBinding?: {
    workflowRunId: string;
    businessKey: string;
    role: 'creative-initial' | 'workflow-stage';
  };
  runArchive?: {
    instanceId: string;
    stage: 'creative' | 'topic' | 'product' | 'article' | 'evaluation';
    trigger: string;
    sourceRevision?: number;
    commitResult?: boolean;
    selectionId?: string;
    confirmedIds?: string[];
    feedback?: string;
    targetItemId?: string;
    targetRound?: number;
  };
  /**
   * A canvas result action may restart/advance a graph Agent step.  The host
   * owns the actual chat run, so this binding tells it exactly which terminal
   * response must be written back to the workflow runtime.
   */
  genericWorkflow?: {
    runId: string;
    workflowId: string;
    stepRunId: string;
    nodeTitle: string;
    expectsCandidates: boolean;
    outputFormat?: 'json' | 'markdown';
  };
};

export type CanvasTextGenerationResult = {
  runId?: string;
  binding: CanvasTextGenerationBinding;
  assistantMessageId: string;
  status: 'succeeded' | 'failed' | 'canceled';
  content?: string;
  error?: string;
};

export type CanvasArtifactGenerationResult = {
  binding: CanvasArtifactGenerationBinding;
  assistantMessageId: string;
  status: 'running' | 'succeeded' | 'failed' | 'canceled';
  /** Successful writes to the stable preview file. Drives iframe refresh only. */
  previewRevision?: number;
  /** Short factual status from the live agent event stream. */
  detail?: string;
  /** Final project-relative file path to bind back to the originating card. */
  outputPath?: string;
  error?: string;
};

export type AgentTaskSubmitter = (
  text: string,
  display?: AgentTaskDisplay,
  attachments?: File[],
) => Promise<void>;

export type HostChatAttachmentStager = (files: File[]) => Promise<void>;

/**
 * 宿主对话里的一条消息（role + 纯文本）。建档时用它做 intake 归档——
 * 由脚本从这段原文里精确切出原始指令与澄清问答，禁止 AI 总结改写。
 * 结构刻意压到最小，与 daemon 的 IntakeSessionMessage 对齐，桥两端不耦合完整
 * ChatMessage 类型。
 */
export type HostConversationMessage = {
  role: 'user' | 'assistant' | string;
  text: string;
};

/** 宿主注入的「读当前对话全部消息」实现；未连接对话运行时时为空。 */
export type HostConversationReader = () => HostConversationMessage[];

let submitter: AgentTaskSubmitter | null = null;
let conversationReader: HostConversationReader | null = null;
let attachmentStager: HostChatAttachmentStager | null = null;

/** 宿主（CanvasWorkbenchSurface）挂载时注入真实提交实现。 */
export function setAgentTaskSubmitter(next: AgentTaskSubmitter | null): void {
  submitter = next;
}

/** 宿主挂载时注入「读当前对话消息」实现，供建档时归档原始指令与澄清问答。 */
export function setHostConversationReader(next: HostConversationReader | null): void {
  conversationReader = next;
}

/** 宿主注入当前对话输入框的附件暂存能力；只暂存，不直接发送。 */
export function setHostChatAttachmentStager(next: HostChatAttachmentStager | null): void {
  attachmentStager = next;
}

export function stageHostChatAttachments(files: File[]): Promise<void> {
  if (files.length === 0) return Promise.resolve();
  if (!attachmentStager) {
    return Promise.reject(new Error(cr().boardNoComposer));
  }
  return attachmentStager(files);
}

/**
 * 读取宿主当前对话的全部消息。未连接对话运行时（或宿主未提供）时返回空数组，
 * 归档随之跳过——不阻断建档主流程。
 */
export function readHostConversation(): HostConversationMessage[] {
  if (!conversationReader) return [];
  try {
    const messages = conversationReader();
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

export async function submitAgentTask(
  text: string,
  display?: AgentTaskDisplay,
  attachments: File[] = [],
): Promise<void> {
  const prompt = text.trim();
  if (!prompt && attachments.length === 0) {
    return Promise.reject(new Error(cr().sendEmpty));
  }
  if (!submitter) {
    return Promise.reject(new Error(cr().boardNoRuntime));
  }
  const submit = submitter;
  const binding = display?.canvasTextGeneration ?? display?.canvasArtifactGeneration;
  if (binding) {
    await awaitCanvasGenerationBinding(getCanvasHostContext().projectId, binding.nodeId, binding.requestId);
  }
  return submit(prompt, display, attachments);
}
