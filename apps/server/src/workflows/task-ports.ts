import type { CanvasTaskReceipt, CanvasTaskRequest, ExecutionSnapshot } from '@bezier/contracts';
import type { ProjectRegistry } from '../storage/project-registry.js';
import type { WorkflowExecutionPorts, WorkflowChildRun } from './execution.js';
import { parseExecutionSnapshot } from './execution-snapshot.js';

/** Transient execution authority is never included in durable task requests. */
export interface WorkflowTaskContext {
  execution?: ExecutionSnapshot;
  systemPrompt?: string;
  skillIds?: string[];
}
export interface WorkflowTaskPort {
  submit(projectId: string, request: CanvasTaskRequest, context?: WorkflowTaskContext): Promise<CanvasTaskReceipt>;
  findByRequestId(projectId: string, requestId: string): CanvasTaskReceipt | null;
  getById(id: string): CanvasTaskReceipt | null;
  cancel(projectId: string, id: string): Promise<CanvasTaskReceipt | null>;
}
export interface WorkflowExecutionAuthority {
  authorizeExecution?: (projectId: string, headers: Record<string, string>) => Promise<void>;
  knowledge?: (references: string[]) => Promise<string>;
}
function child(receipt: CanvasTaskReceipt | null): WorkflowChildRun | null {
  if (!receipt) return null;
  return { id: receipt.id, clientRequestId: receipt.requestId,
    status: receipt.status === 'cancelled' ? 'canceled' : receipt.status === 'interrupted' ? 'failed' : receipt.status,
    ...(receipt.result?.content !== undefined ? { assistantText: receipt.result.content } : {}),
    ...(receipt.error ? { error: receipt.error } : {}),
    ...(receipt.status === 'interrupted' ? { errorCode: 'AGENT_TASK_INTERRUPTED' } : {}),
  };
}
export function createTaskWorkflowPorts(tasks: WorkflowTaskPort, registry: ProjectRegistry, authority: WorkflowExecutionAuthority = {}): WorkflowExecutionPorts {
  return {
    async authorize(projectId, headers) {
      if (!registry.get(projectId)) throw new Error('Workflow project does not exist');
      await authority.authorizeExecution?.(projectId, headers);
    },
    findChild: (projectId, requestId) => child(tasks.findByRequestId(projectId, requestId)),
    child: id => child(tasks.getById(id)),
    async cancel(id) { const receipt = tasks.getById(id); if (receipt) await tasks.cancel(receipt.projectId, id); },
    async knowledge(references) {
      if (!references.length) return '';
      if (!authority.knowledge) throw new Error('Workflow knowledge adapter is unavailable');
      return authority.knowledge(references);
    },
    async dispatch(body) {
      if (typeof body.projectId !== 'string' || typeof body.clientRequestId !== 'string' || typeof body.message !== 'string') throw new Error('Invalid workflow task dispatch');
      const execution = parseExecutionSnapshot(body.byokProvider
        ? { mode: 'api', model: body.model, byokProvider: body.byokProvider }
        : { mode: 'cli', agentId: body.agentId || 'host-adapter', ...(body.model ? { model: body.model } : {}), ...(body.reasoning ? { reasoning: body.reasoning } : {}), ...(body.serviceTier ? { serviceTier: body.serviceTier } : {}) });
      const context = body.context && typeof body.context === 'object' ? body.context as Record<string, unknown> : {};
      const skillIds = Array.isArray(context.skillIds) ? context.skillIds.filter((id): id is string => typeof id === 'string') : [];
      const inputPaths = Array.isArray(body.inputPaths) ? body.inputPaths.filter((value): value is string => typeof value === 'string') : [];
      const receipt = await tasks.submit(body.projectId, { requestId: body.clientRequestId, prompt: body.message, ...(inputPaths.length ? { inputPaths } : {}) }, {
        ...(execution ? { execution } : {}), ...(typeof body.systemPrompt === 'string' ? { systemPrompt: body.systemPrompt } : {}), skillIds,
      });
      return { runId: receipt.id };
    },
  };
}
