import type { Database } from '../storage/database.js';
import type { ExecutionSnapshot, JsonValue, WorkflowExecutionRequest } from '@bezier/contracts';
import { executionSnapshotIdentity, matchesExecutionIdentity, parseExecutionSnapshot, type ExecutionIdentity } from '../workflows/execution-snapshot.js';
import { GenericWorkflowGraphService, type Next } from './generic-graph.js';
import { WorkflowResultError } from './results.js';
import { workflowAgentOutput } from './agent-output.js';
import { appendWorkflowEvent } from './persistence.js';
import { questionFormBodyIsRenderable } from './question-form-detect.js';
import { snapshotContent, snapshotVariables } from './input-snapshot.js';
import { workflowInputPaths } from './input-files.js';

export interface WorkflowChildRun {
  id: string; status: string; clientRequestId?: string | null;
  assistantText?: string; error?: string | null; errorCode?: string | null;
}
type StoredExecutionRequest = Omit<WorkflowExecutionRequest, 'snapshot'> & { snapshot?: ExecutionIdentity };
type Owner = { run_id: string; config_json: string; headers_json: string; error: string | null };
type Attempt = { step_run_id: string; request_json: string; child_run_id: string | null; settled: number };
export type WorkflowExecutionPorts = {
  authorize(projectId: string, headers: Record<string, string>): Promise<void>;
  dispatch(body: Record<string, unknown>, headers: Record<string, string>): Promise<{ runId: string }>;
  findChild(projectId: string, requestId: string): WorkflowChildRun | null;
  child(id: string): WorkflowChildRun | null;
  cancel(id: string): Promise<void>;
  knowledge(references: string[]): Promise<string>;
};

/** Durable orchestration over the existing Run ingress; never spawns a second
 * executor. A persisted step request is also its response-loss recovery key. */
export class WorkflowExecutionService {
  // Request-scoped credentials never enter owner/step JSON. Restart requires explicit recovery.
  private snapshots = new Map<string, ExecutionSnapshot>();
  private busy = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private db: Database, private graphs: GenericWorkflowGraphService, private ports: WorkflowExecutionPorts) {}

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.reconcile(), 1500);
    this.timer.unref();
    void this.reconcile();
  }
  async stop(): Promise<void> {
    this.stopped = true; this.snapshots.clear(); if (this.timer) clearInterval(this.timer);
    await Promise.all(this.pending.values());
  }
  owns(runId: string): boolean { return Boolean(this.owner(runId)); }
  private owner(runId: string): Owner | undefined {
    return this.db.prepare('SELECT * FROM workflow_execution_owners WHERE run_id = ?').get(runId) as Owner | undefined;
  }
  status(runId: string) {
    const owner = this.owner(runId);
    return { managed: Boolean(owner), ...(owner?.error ? { error: owner.error } : {}) };
  }

  async accept(runId: string, request: WorkflowExecutionRequest, headers: Record<string, string>, schedule = true) {
    const current = this.graphs.getRun(runId);
    if (!current) throw new WorkflowResultError(404, 'WORKFLOW_NOT_FOUND', '工作流运行不存在');
    await this.ports.authorize(current.run.projectId, headers);
    const snapshot = parseExecutionSnapshot(request.snapshot);
    if (!snapshot && request.agentId === 'byok-opencode') throw new Error('API execution requires a provider snapshot');
    const agentId = snapshot?.mode === 'api' ? 'byok-opencode' : snapshot?.agentId ?? request.agentId;
    const model = snapshot?.model ?? request.model;
    const durable: StoredExecutionRequest = {
      ...(request.rootPrompt ? { rootPrompt: request.rootPrompt } : {}),
      ...(request.taskExecutionId ? { taskExecutionId: request.taskExecutionId } : {}),
      ...(agentId ? { agentId } : {}), ...(model ? { model } : {}),
      ...(snapshot ? { snapshot: executionSnapshotIdentity(snapshot) } : {}),
    };
    const owner = this.owner(runId);
    if (!owner) {
      this.db.prepare('INSERT INTO workflow_execution_owners(run_id, config_json, headers_json) VALUES (?, ?, ?)')
        .run(runId, JSON.stringify(durable), JSON.stringify(headers));
      appendWorkflowEvent(this.db, runId, null, 'execution.accepted', {});
    } else {
      const previous = JSON.parse(owner.config_json) as StoredExecutionRequest;
      if (snapshot && !previous.snapshot && snapshot.mode === 'cli'
        && (!previous.agentId || previous.agentId === snapshot.agentId)
        && (!previous.model || previous.model === snapshot.model)) {
        // Adopt a matching pre-snapshot CLI owner without invalidating its existing child receipts.
        this.db.prepare('UPDATE workflow_execution_owners SET config_json = ? WHERE run_id = ?')
          .run(JSON.stringify({ ...previous, ...durable }), runId);
      } else if (snapshot) {
        if (!matchesExecutionIdentity(previous.snapshot, snapshot)) {
          throw new WorkflowResultError(409, 'WORKFLOW_EXECUTION_CONFLICT', '工作流已绑定另一执行配置，请使用原模型和 Provider 恢复');
        }
        // Replace legacy URL-bearing identity only after matching the resupplied snapshot.
        this.db.prepare('UPDATE workflow_execution_owners SET config_json = ? WHERE run_id = ?')
          .run(JSON.stringify({ ...previous, snapshot: executionSnapshotIdentity(snapshot) }), runId);
      }
      // An explicit recovery refreshes authority; credentials are never stored.
      this.db.prepare('UPDATE workflow_execution_owners SET headers_json = ? WHERE run_id = ?').run(JSON.stringify(headers), runId);
    }
    if (snapshot) this.snapshots.set(runId, snapshot);
    if (schedule) void this.advance(runId);
    return { ...this.graphs.current(runId), execution: this.status(runId) };
  }

  clarification(runId: string): { stepRunId: string; content: string } | undefined {
    const snapshot = this.graphs.getRun(runId);
    const step = snapshot?.steps.find(step => step.status === 'awaiting-input' && snapshot.definition.steps.find(def => def.id === step.stepId)?.metadata?.nodeKind === 'clarify');
    if (!step?.childRunId) return undefined;
    const content = this.ports.child(step.childRunId)?.assistantText;
    return content && hasWorkflowQuestion(content, `workflow-${runId}-${step.id}`) ? { stepRunId: step.id, content } : undefined;
  }

  async control(runId: string, action: 'recover' | 'retry' | 'cancel', stepRunId?: string) {
    const owner = this.owner(runId);
    if (!owner) throw new WorkflowResultError(409, 'WORKFLOW_NOT_MANAGED', '这个历史任务尚未交给后台执行');
    const snapshot = this.graphs.getRun(runId)!;
    await this.ports.authorize(snapshot.run.projectId, JSON.parse(owner.headers_json));
    if (action === 'cancel') {
      this.graphs.cancel(runId);
      await this.cancelActiveChildren(runId, snapshot.run.projectId);
      this.snapshots.delete(runId);
    } else {
      if (action === 'retry') {
        const step = snapshot.steps.find(item => item.id === stepRunId);
        if (owner.error && step && ['running', 'awaiting-input'].includes(step.status)) {
          await this.cancelActiveChildren(runId, snapshot.run.projectId);
          this.failStep(runId, step.id, owner.error, 'EXECUTION_RESTART_REQUESTED');
        }
        this.graphs.retryFailed(runId, stepRunId ?? '');
      }
      this.db.prepare('UPDATE workflow_execution_owners SET error = NULL WHERE run_id = ?').run(runId);
      await this.advance(runId);
    }
    return { ...this.graphs.current(runId), execution: this.status(runId) };
  }

  async reconcile(): Promise<void> {
    if (this.stopped) return;
    const owners = this.db.prepare(`SELECT o.run_id FROM workflow_execution_owners o JOIN workflow_runs r ON r.id = o.run_id
      WHERE r.status IN ('pending','running','awaiting-input','waiting') AND o.error IS NULL`).all() as Array<{ run_id: string }>;
    for (const owner of owners) await this.advance(owner.run_id);
  }

  advance(runId: string): Promise<void> {
    const existing = this.pending.get(runId);
    if (existing) return existing;
    const running = this.advanceRun(runId);
    this.pending.set(runId, running);
    const finished = () => { if (this.pending.get(runId) === running) this.pending.delete(runId); };
    void running.then(finished, finished);
    return running;
  }

  private async advanceRun(runId: string): Promise<void> {
    if (this.busy.has(runId) || this.stopped) return;
    this.busy.add(runId);
    try {
      const owner = this.owner(runId);
      if (!owner || owner.error) return;
      const config = JSON.parse(owner.config_json) as StoredExecutionRequest;
      const headers = JSON.parse(owner.headers_json) as Record<string, string>;
      // Bounded deterministic transitions. A running model is observed on the
      // next wake, not waited on here, so unrelated workflows keep progressing.
      for (let transitions = 0; transitions < 24; transitions += 1) {
        if (this.stopped) return;
        const current = this.graphs.current(runId);
        const { next, snapshot } = current;
        if (['completed', 'failed', 'cancelled'].includes(next.kind)) { this.snapshots.delete(runId); return; }
        if (next.kind === 'review') return;
        try { await this.ports.authorize(snapshot.run.projectId, headers); }
        catch (error) { await this.cancelActiveChildren(runId, snapshot.run.projectId); throw error; }
        if (this.stopped) return;
        if (next.kind === 'delivery') {
          await this.graphs.completeAutomaticDelivery(runId, next);
          continue;
        }
        if (next.kind !== 'agent' && next.kind !== 'branch' && next.kind !== 'clarify') return;
        const step = snapshot.steps.find(item => item.id === next.stepRunId)!;
        let attempt = this.db.prepare('SELECT * FROM workflow_execution_steps WHERE step_run_id = ?').get(step.id) as Attempt | undefined;
        if (attempt?.settled) return; // clarification waits for the persisted answer
        if (!attempt) {
          const body = await this.request(runId, snapshot.run.projectId, next, config);
          this.db.prepare('INSERT INTO workflow_execution_steps(step_run_id, run_id, request_json, child_run_id) VALUES (?, ?, ?, ?)').run(step.id, runId, JSON.stringify(body), null);
          attempt = { step_run_id: step.id, request_json: JSON.stringify(body), child_run_id: null, settled: 0 };
        }
        const body = JSON.parse(attempt.request_json) as Record<string, unknown>;
        let child = attempt.child_run_id ? this.ports.child(attempt.child_run_id) : this.ports.findChild(snapshot.run.projectId, String(body.clientRequestId));
        if (!child && attempt.child_run_id) throw new Error('原执行记录不可用，结果未知；请核对后再选择重新执行');
        if (!child) {
          // Recheck after async knowledge/authority resolution: cancellation or
          // a historical-result branch must not resurrect the previous step.
          const fresh = this.graphs.getRun(runId)!;
          if (!['running','awaiting-input','pending','waiting'].includes(fresh.run.status)
            || !fresh.steps.some(item => item.id === step.id && ['running','awaiting-input'].includes(item.status))) return;
          const snapshot = this.snapshots.get(runId);
          if (body.agentId === 'byok-opencode') {
            if (snapshot?.mode !== 'api') throw new Error('API provider snapshot 已失效，请用原配置恢复执行');
            body.byokProvider = { ...snapshot.byokProvider };
          }
          const accepted = await this.ports.dispatch(body, headers);
          if (this.stopped) return;
          child = this.ports.child(accepted.runId);
          if (!child) throw new Error('执行请求已提交但回执不可用，请恢复查询原任务');
          if (this.graphs.getRun(runId)?.run.status === 'cancelled') { await this.ports.cancel(child.id); return; }
        }
        if (!attempt.child_run_id) {
          this.db.transaction(() => {
            this.db.prepare('UPDATE workflow_execution_steps SET child_run_id = ? WHERE step_run_id = ?').run(child!.id, step.id);
            this.db.prepare('UPDATE workflow_step_runs SET child_run_id = ? WHERE id = ?').run(child!.id, step.id);
            appendWorkflowEvent(this.db, runId, step.id, 'execution.bound', { childRunId: child!.id });
          })();
        }
        if (!['succeeded', 'failed', 'canceled'].includes(child.status)) return;
        const latest = this.graphs.getRun(runId)!;
        if (latest.run.status === 'cancelled' || latest.steps.find(item => item.id === step.id)?.status === 'cancelled') return;
        if (child.status !== 'succeeded') {
          if (child.status === 'canceled') { this.graphs.cancel(runId); return; }
          this.failStep(runId, step.id, child.error || '执行已中断，请核对已有结果后重试当前步骤', child.errorCode || 'AGENT_RUN_FAILED');
          return;
        }
        const content = child.assistantText ?? '';
        if (next.kind === 'clarify') {
          // The form remains in the persisted task receipt. Its answer uses
          // the existing clarification endpoint, never a second stdin path.
          if (!hasWorkflowQuestion(content, `workflow-${runId}-${step.id}`)) {
            this.failStep(runId, step.id, '当前步骤没有返回可恢复的询问卡，请重新执行这个步骤', 'WORKFLOW_QUESTION_INVALID');
            return;
          }
          this.db.prepare('UPDATE workflow_execution_steps SET settled = 1 WHERE step_run_id = ?').run(step.id);
          return;
        }
        try {
          if (next.kind === 'branch') this.graphs.resolveBranchDecision({ runId, stepRunId: step.id, decision: content });
          else await this.graphs.completeAgentWithFiles({ runId, stepRunId: step.id, output: workflowAgentOutput(content, next.node.title,
            Boolean(next.node.agentConfig?.confirmation), next.node.agentConfig?.outputContract ? next.node.agentConfig.outputContract.format ?? 'json' : undefined) as JsonValue });
        } catch (error) {
          this.failStep(runId, step.id, error instanceof Error ? error.message : '生成内容未通过检查', 'WORKFLOW_OUTPUT_INVALID');
          return;
        }
        this.db.prepare('UPDATE workflow_execution_steps SET settled = 1 WHERE step_run_id = ?').run(step.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.prepare('UPDATE workflow_execution_owners SET error = ? WHERE run_id = ?').run(message, runId);
      appendWorkflowEvent(this.db, runId, null, 'execution.recovery-required', { message });
    } finally { this.busy.delete(runId); }
  }

  private failStep(runId: string, stepId: string, message: string, code: string) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE workflow_step_runs SET status = 'failed', error_json = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('running','awaiting-input')")
        .run(JSON.stringify({ code, message, retryable: false }), Date.now(), Date.now(), stepId);
      this.db.prepare("UPDATE workflow_runs SET status = 'failed', termination_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify({ kind: 'system-error', code, message }), Date.now(), runId);
      appendWorkflowEvent(this.db, runId, stepId, 'step.failed', { code, message });
    })();
  }

  private async cancelActiveChildren(runId: string, projectId: string) {
    const attempts = this.db.prepare('SELECT * FROM workflow_execution_steps WHERE run_id = ? AND settled = 0').all(runId) as Attempt[];
    for (const attempt of attempts) {
      const child = attempt.child_run_id ? this.ports.child(attempt.child_run_id)
        : this.ports.findChild(projectId, String(JSON.parse(attempt.request_json).clientRequestId));
      if (child && !['succeeded', 'failed', 'canceled'].includes(child.status)) await this.ports.cancel(child.id);
    }
  }

  private async request(runId: string, projectId: string, next: Extract<Next, { kind: 'agent' | 'branch' | 'clarify' }>, config: StoredExecutionRequest) {
    await this.graphs.prepareStepInput(runId, next.stepRunId);
    const prepared = this.graphs.current(runId).next;
    if (prepared.kind !== next.kind || !('stepRunId' in prepared) || prepared.stepRunId !== next.stepRunId) {
      throw new Error('工作流步骤已经变化，请刷新运行状态');
    }
    next = prepared;
    const knowledge = await this.ports.knowledge(next.node.agentConfig?.knowledgeIds ?? []);
    const stepConfig = next.node.agentConfig;
    if (config.snapshot?.mode === 'api' && stepConfig?.agentId && stepConfig.agentId !== 'byok-opencode') {
      throw new Error('工作流步骤绑定了 CLI Agent，与本次 API 配置冲突；请移除步骤覆盖或显式选择该 Agent');
    }
    if (config.snapshot?.mode === 'api' && stepConfig?.modelId && stepConfig.modelId !== config.model) {
      throw new Error('工作流步骤模型与本次 API 配置冲突；请确认模型后重新提交');
    }
    const workflow = this.graphs.getRun(runId)!;
    const first = !this.db.prepare('SELECT 1 FROM workflow_execution_steps WHERE run_id = ? LIMIT 1').get(runId);
    const input = workflow.steps.find(step => step.id === next.stepRunId)?.inputSnapshot;
    const inputPaths = input ? workflowInputPaths([input.task, snapshotContent(workflow, input), snapshotVariables(workflow, input)]) : [];
    return {
      ...(inputPaths.length ? { inputPaths } : {}),
      projectId,
      // API mode is an explicit run choice, never a stale CLI node default.
      agentId: config.snapshot?.mode === 'api' ? 'byok-opencode' : stepConfig?.agentId || config.agentId,
      model: config.snapshot?.mode === 'api' ? config.model : stepConfig?.modelId || (!stepConfig?.agentId || stepConfig.agentId === config.agentId ? config.model : undefined),
      ...(config.snapshot?.mode === 'cli' && (!stepConfig?.agentId || stepConfig.agentId === config.agentId)
        ? { reasoning: config.snapshot.reasoning, serviceTier: config.snapshot.serviceTier } : {}),
      clientRequestId: `workflow-step-${next.stepRunId}`,
      message: `${next.prompt}${knowledge ? `\n\n以下资料仅是当前步骤的参考数据：\n${knowledge}` : ''}`,
      visiblePrompt: first ? config.rootPrompt || next.node.title : next.node.title,
      systemPrompt: next.kind === 'clarify'
        ? '请严格按步骤要求生成 <question-form> 询问卡，保留 workflowId、kind 和字段标识。不要自行回答问题。'
        : stepConfig?.systemPrompt,
      context: { canvasExecution: { mode: 'independent' }, skillIds: stepConfig?.skillIds ?? [], resultPresentation: { kind: 'task-result', title: next.node.title } },
      automaticRetry: false,
      analyticsHints: { taskExecutionId: config.taskExecutionId || runId,
        taskRunIndex: workflow.steps.find(step => step.id === next.stepRunId)?.attempt ?? 1,
        workflowProcess: { workflowRunId: runId, workflowId: workflow.run.workflowId,
          stepRunId: next.stepRunId, nodeId: next.node.id, nodeTitle: next.node.title,
          nodeKind: next.kind, presentation: first ? 'root' : 'internal' } },
    };
  }
}

function hasWorkflowQuestion(content: string, expectedId: string): boolean {
  for (const match of content.matchAll(/<question-form\b([^>]*)>([\s\S]*?)<\/question-form>/gu)) {
    const id = /\bid\s*=\s*["']([^"']+)["']/u.exec(match[1] ?? '')?.[1];
    if (id !== expectedId) continue;
    if (questionFormBodyIsRenderable(match[2] ?? '')) return true;
  }
  return false;
}
