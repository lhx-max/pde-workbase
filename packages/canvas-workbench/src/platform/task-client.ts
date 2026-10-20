import type { CanvasTaskReceipt, CanvasTaskRequest, CanvasTaskResponse, WorkflowCanvasRun } from '@bezier/contracts';
import type { AgentTaskDisplay, AgentTaskSubmitter, CanvasArtifactGenerationResult, CanvasTextGenerationResult } from './agent-bridge';
import { apiErrorMessage, platformFetchWithContext, projectFetch, type CanvasHostContext } from './api-base';
import { uploadCanvasAttachment } from './canvas-file-upload';

export interface CanvasTaskClientOptions {
  context: CanvasHostContext;
  pollIntervalMs?: number;
  onTask?: (task: CanvasTaskReceipt, display?: AgentTaskDisplay) => void;
  onTextResult?: (result: CanvasTextGenerationResult) => void;
  onArtifactResult?: (result: CanvasArtifactGenerationResult) => void;
  onError?: (error: Error, taskId?: string) => void;
}

/** Client monitoring is disposable; the server owns execution and durable delivery. */
export function createCanvasTaskSubmitter(options: CanvasTaskClientOptions) {
  const context = options.context;
  const monitors = new Map<string, AbortController>();
  const bindings = new Map<string, { display?: AgentTaskDisplay; requestId: string }>();
  let disposed = false;
  const terminal = (task: CanvasTaskReceipt) => !['queued', 'running'].includes(task.status);
  const route = (id: string) => `/agent/tasks/${encodeURIComponent(id)}`;

  async function request(path: string, init?: RequestInit, expected?: { id?: string; requestId?: string }): Promise<CanvasTaskReceipt> {
    const response = await projectFetch(path, init, context);
    const payload = await response.json().catch(() => null) as (CanvasTaskResponse & { error?: unknown }) | null;
    if (!response.ok || !payload?.task?.id) throw new Error(apiErrorMessage(payload?.error, `Canvas task request failed (${response.status})`));
    if (payload.task.projectId !== context.projectId) throw new Error('Canvas task belongs to a different project');
    if (expected?.id && payload.task.id !== expected.id) throw new Error('Canvas task identity does not match the requested task');
    if (expected?.requestId && payload.task.requestId !== expected.requestId) throw new Error('Canvas task request identity does not match the submission');
    if (!['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(payload.task.status)) throw new Error('Canvas task response has an invalid status');
    return payload.task;
  }

  function publish(task: CanvasTaskReceipt, display?: AgentTaskDisplay) {
    if (disposed) return;
    options.onTask?.(task, display);
    const failedDelivery = task.deliveryState === 'delivery_failed';
    const status = task.status === 'succeeded' && !failedDelivery ? 'succeeded'
      : task.status === 'cancelled' ? 'canceled' : terminal(task) ? 'failed' : 'running';
    const artifactBinding = display?.canvasArtifactGeneration;
    if (artifactBinding) options.onArtifactResult?.({
      binding: artifactBinding,
      // Compatibility field in the original canvas renderer; identity is a task, never a message.
      assistantMessageId: task.id,
      status,
      ...(task.result?.file ? { outputPath: task.result.file } : {}),
      ...(task.error ? { error: task.error } : {}),
    });
    const textBinding = display?.canvasTextGeneration;
    if (textBinding && status !== 'running') options.onTextResult?.({
      binding: textBinding, runId: task.id, assistantMessageId: task.id, status,
      ...(task.result?.content !== undefined ? { content: task.result.content } : {}),
      ...(task.error ? { error: task.error } : {}),
    });
  }

  function wait(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Math.max(100, options.pollIntervalMs ?? 750));
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }

  function monitor(task: CanvasTaskReceipt, display?: AgentTaskDisplay) {
    monitors.get(task.id)?.abort();
    monitors.delete(task.id);
    bindings.set(task.id, { display, requestId: task.requestId });
    publish(task, display);
    if (terminal(task) || disposed) { bindings.delete(task.id); return; }
    const controller = new AbortController();
    monitors.set(task.id, controller);
    void (async () => {
      try {
        while (!controller.signal.aborted && !disposed) {
          await wait(controller.signal);
          if (controller.signal.aborted || disposed) break;
          try {
            const next = await request(route(task.id), { signal: controller.signal }, { id: task.id, requestId: task.requestId });
            if (controller.signal.aborted || disposed) break;
            publish(next, display);
            if (terminal(next)) { bindings.delete(task.id); break; }
          } catch (cause) {
            if (controller.signal.aborted || disposed) break;
            // A network failure is not an execution failure. Never resubmit the paid task.
            options.onError?.(cause instanceof Error ? cause : new Error(String(cause)), task.id);
          }
        }
      } finally {
        if (monitors.get(task.id) === controller) monitors.delete(task.id);
      }
    })();
  }

  const submit: AgentTaskSubmitter = async (text, display, attachments = []) => {
    if (disposed) throw new Error('Canvas task client is disposed');
    if (!text.trim()) throw new Error('Canvas task prompt is empty');
    if (display?.workflowBinding || display?.runArchive) {
      throw new Error('This workflow-specific archive requires a configured host task adapter');
    }
    if (display?.genericWorkflow) {
      // A graph continuation belongs to its existing durable executor, never a detached paid task.
      if (attachments.length || display.inputPaths?.length || display.executionContext) throw new Error('Workflow continuation inputs and context must be bound through its verified input snapshot');
      const binding = display.genericWorkflow;
      const path = `/api/workflow-graph-runs/${encodeURIComponent(binding.runId)}`;
      const current = await platformFetchWithContext(context, path);
      const snapshot = await current.json().catch(() => null) as (Partial<WorkflowCanvasRun> & { error?: unknown }) | null;
      if (!current.ok || !snapshot?.run) throw new Error(apiErrorMessage(snapshot?.error, 'Workflow run is unavailable'));
      if (snapshot.run.id !== binding.runId || snapshot.run.projectId !== context.projectId
        || snapshot.run.workflowId !== binding.workflowId || !snapshot.steps?.some(step => step.id === binding.stepRunId)) {
        throw new Error('Workflow continuation does not belong to this project, run and step');
      }
      if (disposed) throw new Error('Canvas task client is disposed');
      const resumed = await platformFetchWithContext(context, `${path}/execution`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recover', stepRunId: binding.stepRunId }),
      });
      const result = await resumed.json().catch(() => null) as { run?: WorkflowCanvasRun['run']; error?: unknown } | null;
      if (!resumed.ok || result?.run?.id !== binding.runId || result.run.projectId !== context.projectId) {
        throw new Error(apiErrorMessage(result?.error, 'Workflow continuation was not accepted'));
      }
      return;
    }
    const uploads = await Promise.all(attachments.map(file => uploadCanvasAttachment(file, context)));
    if (disposed) throw new Error('Canvas task client is disposed');
    const inputPaths = [...new Set([...(display?.inputPaths ?? []), ...uploads.map(file => file.path)])];
    const body: CanvasTaskRequest = {
      ...(display?.executionContext ? { executionContext: display.executionContext } : {}),
      requestId: display?.canvasTextGeneration?.requestId ?? display?.canvasArtifactGeneration?.requestId ?? crypto.randomUUID(),
      prompt: text,
      ...(display?.designSystemId ? { designSystemId: display.designSystemId } : {}),
      ...(display?.taskContext ? { taskContext: display.taskContext } : {}),
      ...(display?.canvasTextGeneration ? { canvasTextGeneration: display.canvasTextGeneration } : {}),
      ...(display?.canvasArtifactGeneration ? { canvasArtifactGeneration: display.canvasArtifactGeneration } : {}),
      ...(inputPaths.length ? { inputPaths } : {}),
    };
    const task = await request('/agent/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, { requestId: body.requestId });
    // Acceptance resolves immediately; subsequent updates do not block the UI event handler.
    monitor(task, display);
  };

  return {
    submit,
    async cancel(taskId: string) {
      if (disposed) throw new Error('Canvas task client is disposed');
      const binding = bindings.get(taskId);
      const task = await request(route(taskId), { method: 'DELETE' }, { id: taskId, requestId: binding?.requestId });
      monitor(task, binding?.display);
      return task;
    },
    async recover(taskId: string, display?: AgentTaskDisplay) {
      if (disposed) throw new Error('Canvas task client is disposed');
      const requestId = display?.canvasTextGeneration?.requestId ?? display?.canvasArtifactGeneration?.requestId;
      const task = await request(route(taskId), undefined, { id: taskId, requestId });
      monitor(task, display);
      return task;
    },
    dispose() {
      disposed = true;
      for (const controller of monitors.values()) controller.abort();
      monitors.clear();
      bindings.clear();
    },
  };
}
