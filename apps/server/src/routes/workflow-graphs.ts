import { parseWorkflowAssistantScope, workflowConfigurationRevision, assertWorkflowChangesPersisted, workflowValueEqual, type WorkflowAssistantApplyRequest, type WorkflowPropertyDiff } from '@bezier/contracts';
import { prepareWorkflowAssistantEdit } from '../workflows/assistant-editing.js';
import type { Express, Response } from 'express';
import path from 'node:path';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type {
  WorkflowAssistantMessage,
  WorkflowAssistantRequest,
  WorkflowAssistantResponse,
} from '@bezier/contracts';
import type { AuthorizeProjectRequest, WorkflowAssistantPort } from '../workflows/ports.js';
import {
  parseWorkflowAssistantResponse,
  workflowAssistantPrompt,
} from '../workflows/assistant-prompt.js';
import { parseExecutionSnapshot } from '../workflows/execution-snapshot.js';
import { loadWorkflowDesignSkill, validateWorkflowAssistantBindings } from '../workflows/design-skill.js';
import { GenericWorkflowGraphService, type WorkflowGraphConfig } from '../workflows/generic-graph.js';
import type { WorkflowExecutionService } from '../workflows/execution.js';
import { WorkflowResultError } from '../workflows/results.js';
import type { WorkflowExecutionRequest } from '@bezier/contracts';
import {
  createWorkflowPackageJson,
  readWorkflowPackageJson,
  renderWorkflowCompatibilityMarkdown,
  renderWorkflowEditorMarkdown,
  updateWorkflowPackageFromMarkdown,
  updateWorkflowPackageGraph,
  workflowGraphConfigFromPackage,
  workflowPackageJsonFile,
  writeWorkflowPackageJson,
} from '../workflows/workflow-package-json.js';

async function resolveWorkflowSnapshot(request: WorkflowExecutionRequest, deps: WorkflowGraphRouteDeps) {
  const snapshot = parseExecutionSnapshot(request.snapshot);
  if (snapshot) return snapshot;
  const agentId = request.agentId?.trim() || (deps.execution ? 'host-adapter' : undefined);
  if (!agentId) return undefined; // Explicit external/manual hand-off, not managed execution.
  return parseExecutionSnapshot({ mode: 'cli', agentId, ...(request.model ? { model: request.model } : {}) });
}

type StartMetadataField = 'workflowName' | 'description' | 'triggerScenarios';
export type WorkflowGraphRouteDeps = {
  assistant?: WorkflowAssistantPort;
  media?: import('../workflows/assistant-editing.js').WorkflowMediaCatalog;
  skillCatalog?: Array<{ id: string; description: string }>;
  service: GenericWorkflowGraphService;
  execution?: WorkflowExecutionService;
  authorizeProjectRequest: AuthorizeProjectRequest;
  dataDir: string;
  workflowsDir: string;
  builtInSkillsDir?: string;
  isWorkflowEnabled?: (workflowId: string) => boolean;
};

/** CRUD + explicit state-machine hand-offs for canvas-authored workflows. */
export function registerWorkflowGraphRoutes(
  app: Express,
  deps: WorkflowGraphRouteDeps,
): void {
  const runOneShotAgent = (input: Parameters<WorkflowAssistantPort['complete']>[0]) => {
    if (!deps.assistant) throw Object.assign(new Error('Workflow assistant adapter is unavailable'), { code: 'AGENT_ADAPTER_UNAVAILABLE' });
    return deps.assistant.complete(input);
  };
  const workflowEnabled = (workflowId: string) => deps.isWorkflowEnabled?.(workflowId) !== false;
  const rejectDisabledWorkflow = (workflowId: string, res: Response) => {
    if (workflowEnabled(workflowId)) return false;
    res.status(404).json({ error: { code: 'WORKFLOW_NOT_FOUND', message: '工作流未找到' } });
    return true;
  };

  app.get('/api/workflow-graphs', (_req, res) => res.json({
    workflows: deps.service.listConfigs().filter((workflow) => workflowEnabled(workflow.id)),
  }));
  app.get('/api/workflow-graphs/:workflowId/workflow-md', async (req, res) => {
    const workflowId = req.params.workflowId;
    if (rejectDisabledWorkflow(workflowId, res)) return;
    const workflowPackage = await readAnyWorkflowPackageJson(deps, workflowId);
    if (workflowPackage) {
      const packageRoot = await readBuiltInWorkflowPackageJson(deps, workflowId)
        ? deps.workflowsDir
        : customWorkflowsDir(deps);
      return res.json({
        markdown: renderWorkflowEditorMarkdown(workflowPackage),
        file: workflowPackageJsonFile(packageRoot, workflowId),
        source: 'workflow.json',
      });
    }
    const file = await workflowMarkdownFile(deps, workflowId);
    try {
      res.json({ markdown: await readFile(file, 'utf8'), file });
      return;
    } catch {
      const config = deps.service.getConfig(workflowId);
      const markdown = config?.nodes?.find(node => node.kind === 'start')?.startConfig?.workflowMarkdown;
      if (markdown) return res.json({ markdown, file });
      return res.status(404).json({ error: { code: 'WORKFLOW_MD_NOT_FOUND', message: 'WORKFLOW.md 未找到' } });
    }
  });
  app.post('/api/workflow-graphs/expand-start-metadata', async (req, res) => {
    if (!deps.assistant) return res.status(503).json({ error: { code: 'AGENT_ADAPTER_UNAVAILABLE', message: 'Workflow assistant adapter is unavailable' } });
    const body = req.body as Record<string, unknown> | undefined;
    const workflowName = textValue(body?.workflowName, 120);
    const description = textValue(body?.description, 1_200);
    const triggerScenarios = stringList(body?.triggerScenarios, 8, 300);
    const field = startMetadataField(body?.field);
    if (!field) {
      return res.status(400).json({ error: { code: 'WORKFLOW_METADATA_FIELD_INVALID', message: '请选择要扩写的字段。' } });
    }
    if ((field === 'workflowName' && !workflowName)
      || (field === 'description' && !description)
      || (field === 'triggerScenarios' && triggerScenarios.length === 0)) {
      return res.status(400).json({ error: { code: 'WORKFLOW_METADATA_REQUIRED', message: '先写下这个字段的内容，AI 才能扩写。' } });
    }
    try {
      const result = await runOneShotAgent({
        ...(body?.execution !== undefined ? { execution: parseExecutionSnapshot(body.execution)! } : {}),
        timeoutMs: 90_000,
        prompt: workflowMetadataExpansionPrompt({ field, workflowName, description, triggerScenarios }),
      });
      res.json({ expansion: parseWorkflowMetadataExpansion(result.text, field), agentId: result.agentId });
    } catch (error) {
      res.status(502).json({ error: { code: 'WORKFLOW_METADATA_EXPANSION_FAILED', message: error instanceof Error ? error.message : 'AI 扩写失败，请稍后重试。' } });
    }
  });
  app.get('/api/workflow-graphs/:workflowId/assistant/options', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    try {
      if (!deps.assistant?.options) throw new Error('Agent model-discovery adapter is unavailable');
      res.json(await deps.assistant.options(textValue(req.query.agentId, 100) || undefined));
    } catch (error) {
      res.status(503).json({ error: { message: error instanceof Error ? error.message : '无法读取当前 Agent 的模型' } });
    }
  });
  app.post('/api/workflow-graphs/:workflowId/assistant', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    if (!deps.assistant) return res.status(503).json({ error: { code: 'AGENT_ADAPTER_UNAVAILABLE', message: 'Workflow assistant adapter is unavailable' } });
    const body = req.body as WorkflowAssistantRequest | undefined;
    const message = textValue(body?.message, 8_000);
    if (!message) {
      return res.status(400).json({ error: { code: 'WORKFLOW_ASSISTANT_MESSAGE_REQUIRED', message: '先告诉助手你想生成或修改什么。' } });
    }
    if (!body?.workflow || typeof body.workflow !== 'object' || Array.isArray(body.workflow)) {
      return res.status(400).json({ error: { code: 'WORKFLOW_ASSISTANT_GRAPH_REQUIRED', message: '当前画布还没有可分析的工作流。' } });
    }
    const workflow = body.workflow as unknown as WorkflowGraphConfig;
    if (workflow.id !== req.params.workflowId) {
      return res.status(400).json({ error: { code: 'WORKFLOW_ID_MISMATCH', message: '工作流 ID 不匹配' } });
    }
    const history = workflowAssistantHistory(body.history);
    try {
      if (!deps.builtInSkillsDir) throw new Error('工作流设计 Skill 未配置，不能生成方案');
      const scope = parseWorkflowAssistantScope(body?.scope);
      if (scope.mode === 'node' && !workflow.nodes?.some(node => node.id === scope.nodeId)) throw new Error('目标卡片已不存在');
      const current = await currentAssistantGraph(deps, workflow.id);
      const persistedRevision = workflowConfigurationRevision(current);
      if (body.persistedRevision !== undefined) {
        if (typeof body.persistedRevision !== 'string' || body.persistedRevision !== persistedRevision) {
          return res.status(409).json({ error: { code: 'WORKFLOW_STALE_PROPOSAL', message: '工作流已被修改，请刷新后重新生成方案。' } });
        }
      } else if (current && workflowConfigurationRevision(workflow) !== persistedRevision) {
        return res.status(409).json({ error: { code: 'WORKFLOW_STALE_PROPOSAL', message: '工作流已被修改，请刷新后重新生成方案。' } });
      }
      const skill = await loadWorkflowDesignSkill(deps.builtInSkillsDir, deps.skillCatalog);
      const execution = parseExecutionSnapshot(body.execution);
      const agentId = execution?.mode === 'api' ? 'byok-opencode' : execution?.agentId || textValue(body.agentId, 100) || 'host-adapter';
      const model = execution?.model || textValue(body.model, 200) || 'default';
      const result = await runOneShotAgent({
        agentId,
        model,
        ...(execution ? { execution } : {}),
        timeoutMs: 180_000,
        prompt: workflowAssistantPrompt({ message, workflow, history, skill, scope, ...(deps.media ? { media: deps.media } : {}) }),
      });
      const parsed = parseWorkflowAssistantResponse(result.text, workflow.id);
      const edit = prepareWorkflowAssistantEdit({ ...(deps.media ? { media: deps.media } : {}), workflow, ...(body.scope ? { scope } : {}), ...(parsed.changes ? { changes: parsed.changes } : {}), ...(parsed.proposal ? { proposal: parsed.proposal } : {}) });
      if (edit) validateWorkflowAssistantBindings(edit.workflow, workflow, skill);
      const proposal = edit ? deps.service.validateRunnableConfig({ ...edit.workflow, id: workflow.id, version: 2, updatedAt: new Date().toISOString() }) : undefined;
      if (edit && proposal) assertWorkflowChangesPersisted(edit.workflow, proposal, edit.diff);
      const response: WorkflowAssistantResponse = {
        reply: parsed.reply, summary: parsed.summary, agentId: result.agentId, persistedRevision,
        ...(parsed.changes ? { changes: parsed.changes } : {}),
        ...(edit ? { diff: edit.diff } : {}),
        ...(proposal ? { proposal: proposal as unknown as NonNullable<WorkflowAssistantResponse['proposal']> } : {}),
      };
      return res.json({ ...response, model, skill: { id: skill.id, digest: skill.digest } });
    } catch (error) {
      return res.status(502).json({
        error: {
          code: 'WORKFLOW_ASSISTANT_FAILED',
          message: error instanceof Error ? error.message : '工作流助手暂时不可用，请稍后重试。',
        },
      });
    }
  });
  app.post('/api/workflow-graphs/:workflowId/assistant/apply', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    try {
      await withWorkflowWrite(req.params.workflowId, async () => {
        const body = req.body as WorkflowAssistantApplyRequest;
        const base = body.workflow as unknown as WorkflowGraphConfig;
        if (base?.id !== req.params.workflowId) throw new Error('工作流 ID 不匹配');
        const current = await currentAssistantGraph(deps, base.id);
        if (typeof body.persistedRevision !== 'string' || body.persistedRevision !== workflowConfigurationRevision(current)) {
          return res.status(409).json({ error: { code: 'WORKFLOW_STALE_PROPOSAL', message: '工作流已被修改，请重新生成方案，避免覆盖其他修改。' } });
        }
        const scope = parseWorkflowAssistantScope(body.scope);
        const edit = prepareWorkflowAssistantEdit({ ...(deps.media ? { media: deps.media } : {}), workflow: base, scope,
          ...(body.changes ? { changes: body.changes } : { proposal: body.proposal as unknown as WorkflowGraphConfig }) });
        if (!edit) throw new Error('没有需要应用的修改');
        if (!deps.builtInSkillsDir) throw new Error('工作流设计 Skill 未配置');
        validateWorkflowAssistantBindings(edit.workflow, base, await loadWorkflowDesignSkill(deps.builtInSkillsDir, deps.skillCatalog));
        const validated = deps.service.validateRunnableConfig(edit.workflow);
        assertWorkflowChangesPersisted(edit.workflow, validated, edit.diff);
        const workflow = await persistWorkflowGraph(deps, validated, { expected: validated, diff: edit.diff });
        res.json({ workflow, diff: edit.diff, verified: true,
          persistedRevision: workflowConfigurationRevision(await currentAssistantGraph(deps, base.id)) });
      });
    } catch (error) {
      res.status(400).json({ error: { code: 'WORKFLOW_APPLY_FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  app.get('/api/workflow-graphs/:workflowId', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    const result = await withWorkflowWrite(req.params.workflowId, async () => {
      const workflowPackage = await readAnyWorkflowPackageJson(deps, req.params.workflowId);
      const workflow = workflowPackage && workflowPackage.graph.nodes.length > 1
        ? deps.service.saveConfig(workflowGraphConfigFromPackage(workflowPackage) as WorkflowGraphConfig)
        : deps.service.getConfig(req.params.workflowId);
      if (!workflow) return undefined;
      return { workflow, persistedRevision: workflowConfigurationRevision(await currentAssistantGraph(deps, req.params.workflowId)) };
    });
    if (!result) return res.status(404).json({ error: { code: 'WORKFLOW_NOT_FOUND', message: '工作流未找到' } });
    res.json(result);
  });
  app.put('/api/workflow-graphs/:workflowId', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    try {
      const body = req.body as WorkflowGraphConfig;
      if (!body || body.id !== req.params.workflowId) return res.status(400).json({ error: { code: 'WORKFLOW_ID_MISMATCH', message: '工作流 ID 不匹配' } });
      const result = await withWorkflowWrite(body.id, async () => {
        const workflow = await persistWorkflowGraph(deps, body);
        return { workflow, persistedRevision: workflowConfigurationRevision(await currentAssistantGraph(deps, body.id)) };
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: { code: 'WORKFLOW_CONFIG_INVALID', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  app.delete('/api/workflow-graphs/:workflowId', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    if (!deps.service.deleteConfig(req.params.workflowId)) return res.status(404).end();
    await deleteCustomWorkflowMarkdown(deps, req.params.workflowId);
    return res.status(204).end();
  });

  app.post('/api/projects/:projectId/workflow-graphs/:workflowId/runs', async (req, res) => {
    if (rejectDisabledWorkflow(req.params.workflowId, res)) return;
    if (!deps.execution) return res.status(503).json({ error: { code: 'AGENT_ADAPTER_UNAVAILABLE', message: 'Configure a workflow execution adapter before starting a run' } });
    if (!await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    try {
      const execution = req.body?.execution ?? {};
      if (typeof execution !== 'object' || Array.isArray(execution)) throw new Error('工作流执行参数无效');
      for (const key of ['conversationId', 'agentId', 'model', 'rootPrompt', 'taskExecutionId']) {
        if (execution[key] !== undefined && typeof execution[key] !== 'string') throw new Error('工作流执行参数无效');
      }
      const snapshot = await resolveWorkflowSnapshot(execution, deps);
      execution.snapshot = snapshot;
      const workflowPackage = await readAnyWorkflowPackageJson(deps, req.params.workflowId);
      if (workflowPackage && workflowPackage.graph.nodes.length > 1) {
        deps.service.saveConfig(workflowGraphConfigFromPackage(workflowPackage) as WorkflowGraphConfig);
      }
      const started = deps.service.startOrResumeActive({ projectId: req.params.projectId, workflowId: req.params.workflowId, value: req.body?.value,
        ...(typeof req.body?.requestId === 'string' && req.body.requestId ? { requestId: req.body.requestId } : {}) });
      if (deps.execution) {
        const headers: Record<string, string> = {};
        for (const key of ['x-canvas-authority-id']) { const value = req.get(key); if (value) headers[key] = value; }
        await deps.execution.accept(started.snapshot.run.id, execution, headers);
      }
      res.status(started.reused ? 200 : 201).json({ run: started.snapshot.run, next: started.next, reused: started.reused });
    } catch (error) {
      res.status(error instanceof Error && error.message.includes('未找到') ? 404 : 400).json({ error: { code: 'WORKFLOW_RUN_START_FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  app.get('/api/projects/:projectId/workflow-graph-runs', async (req, res) => {
    if (!await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
    const runs = deps.service.listProjectRuns(req.params.projectId)
      .filter(({ run }) => !deps.isWorkflowEnabled || deps.isWorkflowEnabled(run.workflowId))
      .map(({ run, definition, steps }) => {
        const clarification = deps.execution?.clarification(run.id);
        return { run, definition, steps, ...(clarification ? { clarification } : {}), execution: deps.execution?.status(run.id) ?? { managed: false } };
      });
    const response: import('@bezier/contracts').WorkflowCanvasRunsResponse = { runs };
    res.json(response);
  });

  app.get('/api/projects/:projectId/workflow-graph-runs/active', async (req, res) => {
    if (!await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
    const active = deps.service.getActiveProjectRun(req.params.projectId);
    if (!active) return res.status(404).json({ error: { code: 'WORKFLOW_ACTIVE_RUN_NOT_FOUND', message: '没有可恢复的工作流' } });
    return res.json({ run: active.snapshot.run, next: active.next, execution: deps.execution?.status(active.snapshot.run.id) ?? { managed: false } });
  });
  app.get('/api/workflow-graph-runs/:runId', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'read' })) return;
    const resumable = deps.service.current(snapshot.run.id);
    res.json({
      run: resumable.snapshot.run,
      steps: resumable.snapshot.steps,
      definition: resumable.snapshot.definition,
      ...(resumable ? { next: resumable.next } : {}),
      execution: deps.execution?.status(snapshot.run.id) ?? { managed: false },
    });
  });
  app.post('/api/workflow-graph-runs/:runId/execution', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    if (!deps.execution) return res.status(503).json({ error: { message: '后台执行尚未就绪' } });
    try {
      const action = req.body?.action ?? 'start';
      if (!['start', 'recover', 'retry', 'cancel'].includes(action)) throw new WorkflowResultError(400, 'WORKFLOW_ACTION_INVALID', '不支持的执行动作');
      const headers: Record<string, string> = {};
      for (const key of ['x-canvas-authority-id']) {
        const value = req.get(key); if (value) headers[key] = value;
      }
      const config: WorkflowExecutionRequest = {};
      for (const key of ['conversationId', 'agentId', 'model', 'rootPrompt', 'taskExecutionId'] as const) {
        if (req.body?.[key] !== undefined) {
          if (typeof req.body[key] !== 'string') throw new WorkflowResultError(400, 'WORKFLOW_CONFIG_INVALID', '执行参数必须是文本');
          config[key] = req.body[key];
        }
      }
      const executionSnapshot = parseExecutionSnapshot(req.body?.snapshot);
      if (executionSnapshot) config.snapshot = executionSnapshot;
      else if (!deps.execution.owns(snapshot.run.id)) { const resolved = await resolveWorkflowSnapshot(config, deps); if (resolved) config.snapshot = resolved; }
      const accepted = await deps.execution.accept(snapshot.run.id, config, headers, action === 'start');
      const result = action === 'start' ? accepted : await deps.execution.control(snapshot.run.id, action, req.body?.stepRunId);
      return res.json({ run: result.snapshot.run, next: result.next, execution: result.execution });
    } catch (error) {
      return res.status(error instanceof WorkflowResultError ? error.status : 400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });
  app.post('/api/workflow-graph-runs/:runId/clarification', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    try {
      const submitted = deps.service.submitClarification({ runId: snapshot.run.id, stepRunId: String(req.body?.stepRunId || ''), values: req.body?.values ?? {} });
      const result = await deps.service.completeAutomaticDelivery(snapshot.run.id, submitted.next, submitted.snapshot);
      res.json({ run: result.snapshot.run, next: result.next, ...(result.artifact ? { artifact: result.artifact } : {}) });
    } catch (error) { res.status(400).json({ error: { code: 'WORKFLOW_CLARIFICATION_FAILED', message: error instanceof Error ? error.message : String(error) } }); }
  });
  app.post('/api/workflow-graph-runs/:runId/agent-output', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    if (deps.execution?.owns(snapshot.run.id)) return res.status(409).json({ error: { code: 'WORKFLOW_BACKEND_OWNED', message: '结果由后台接收，请刷新当前任务' } });
    try {
      const result = await deps.service.completeAgentAndDelivery({
        runId: snapshot.run.id,
        stepRunId: String(req.body?.stepRunId || ''),
        output: req.body?.output ?? {},
      });
      res.json({
        run: result.snapshot.run,
        next: result.next,
        ...(result.artifact ? { artifact: result.artifact } : {}),
      });
    } catch (error) { res.status(400).json({ error: { code: 'WORKFLOW_AGENT_OUTPUT_FAILED', message: error instanceof Error ? error.message : String(error) } }); }
  });
  app.post('/api/workflow-graph-runs/:runId/agent-failure', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    if (deps.execution?.owns(snapshot.run.id)) return res.status(409).json({ error: { code: 'WORKFLOW_BACKEND_OWNED', message: '执行状态由后台维护，请刷新当前任务' } });
    try {
      const message = textValue(req.body?.message, 2_000) || 'Agent 执行失败';
      const run = deps.service.failAgent({
        runId: snapshot.run.id,
        stepRunId: String(req.body?.stepRunId || ''),
        error: {
          code: textValue(req.body?.code, 120) || 'AGENT_RUN_FAILED',
          message,
          retryable: req.body?.retryable === true,
        },
      });
      res.json({ run: run.run });
    } catch (error) { res.status(400).json({ error: { code: 'WORKFLOW_AGENT_FAILURE_FAILED', message: error instanceof Error ? error.message : String(error) } }); }
  });
  app.post('/api/workflow-graph-runs/:runId/artifact', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    try {
      const result = await deps.service.completeDelivery({
        runId: snapshot.run.id,
        stepRunId: String(req.body?.stepRunId || ''),
      });
      res.json({ run: result.snapshot.run, next: result.next, artifact: result.artifact });
    } catch (error) {
      res.status(400).json({ error: { code: 'WORKFLOW_ARTIFACT_FAILED', message: error instanceof Error ? error.message : String(error) } });
    }
  });
  app.post('/api/workflow-graph-runs/:runId/branch', async (req, res) => {
    const snapshot = deps.service.getRun(req.params.runId);
    if (!snapshot) return res.status(404).json({ error: { code: 'WORKFLOW_RUN_NOT_FOUND', message: '运行记录未找到' } });
    if (!await deps.authorizeProjectRequest(req, res, snapshot.run.projectId, { mode: 'write', capability: 'writeFiles' })) return;
    if (deps.execution?.owns(snapshot.run.id)) return res.status(409).json({ error: { code: 'WORKFLOW_BACKEND_OWNED', message: '执行分支由后台接续，请刷新当前任务' } });
    try {
      const stepRunId = String(req.body?.stepRunId || '');
      if (typeof req.body?.decision === 'string') {
        const selected = deps.service.resolveBranchDecision({
          runId: snapshot.run.id,
          stepRunId,
          decision: req.body.decision,
        });
        const result = await deps.service.completeAutomaticDelivery(snapshot.run.id, selected.next, selected.snapshot);
        res.json({ run: result.snapshot.run, next: result.next, decision: selected.decision, ...(result.artifact ? { artifact: result.artifact } : {}) });
        return;
      }
      const selected = deps.service.chooseBranch({
        runId: snapshot.run.id,
        stepRunId,
        routeId: String(req.body?.routeId || ''),
        value: req.body?.value,
      });
      const result = await deps.service.completeAutomaticDelivery(snapshot.run.id, selected.next, selected.snapshot);
      res.json({ run: result.snapshot.run, next: result.next, ...(result.artifact ? { artifact: result.artifact } : {}) });
    } catch (error) { res.status(400).json({ error: { code: 'WORKFLOW_BRANCH_FAILED', message: error instanceof Error ? error.message : String(error) } }); }
  });
}

function withStartMarkdown(config: WorkflowGraphConfig, markdown: string): WorkflowGraphConfig {
  return {
    ...config,
    ...(config.nodes ? { nodes: config.nodes.map(node => node.kind === 'start'
      ? { ...node, startConfig: { ...node.startConfig, workflowMarkdown: markdown } }
      : node) } : {}),
  };
}

function isWorkflowId(value: string): boolean { return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value); }
async function workflowMarkdownFile(deps: WorkflowGraphRouteDeps, workflowId: string): Promise<string> {
  if (!isWorkflowId(workflowId)) throw new Error('工作流 ID 无效');
  const builtIn = path.join(deps.workflowsDir, workflowId, 'WORKFLOW.md');
  if (deps.isWorkflowEnabled?.(workflowId) !== false) {
    try {
      if ((await stat(builtIn)).isFile()) return builtIn;
    } catch { /* custom canvas workflow */ }
  }
  return path.join(deps.dataDir, 'workflow-graphs', workflowId, 'WORKFLOW.md');
}
async function writeWorkflowMarkdown(deps: WorkflowGraphRouteDeps, workflowId: string, markdown: string | undefined): Promise<void> {
  if (!markdown?.trim()) return;
  const file = await workflowMarkdownFile(deps, workflowId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, markdown.trimEnd() + '\n', 'utf8');
}
async function deleteCustomWorkflowMarkdown(deps: { dataDir: string }, workflowId: string): Promise<void> {
  if (!isWorkflowId(workflowId)) return;
  await rm(path.join(deps.dataDir, 'workflow-graphs', workflowId), { recursive: true, force: true });
}

function customWorkflowsDir(deps: { dataDir: string }): string {
  return path.join(deps.dataDir, 'workflow-graphs');
}

async function readAnyWorkflowPackageJson(
  deps: WorkflowGraphRouteDeps,
  workflowId: string,
) {
  return await readBuiltInWorkflowPackageJson(deps, workflowId)
    ?? await readWorkflowPackageJson(customWorkflowsDir(deps), workflowId);
}

async function readBuiltInWorkflowPackageJson(deps: WorkflowGraphRouteDeps, workflowId: string) {
  if (deps.isWorkflowEnabled?.(workflowId) === false) return null;
  return readWorkflowPackageJson(deps.workflowsDir, workflowId);
}

function workflowMetadataExpansionPrompt(input: { field: StartMetadataField; workflowName: string; description: string; triggerScenarios: string[] }): string {
  const target = input.field === 'workflowName'
    ? '{"workflowName":"4-16字、清楚专业的工作流名称"}'
    : input.field === 'description'
      ? '{"description":"40-110字，以“当用户需要…时使用；流程会…并产出…”写清适用条件、执行内容和交付结果"}'
      : '{"triggerScenarios":["3-5条用户可能会说的话"]}';
  return [
    '你是工作流产品编辑。把用户的简写整理成可配置的工作流元信息。',
    '只能依据给出的内容，不要虚构业务事实、目标人群、交付物或平台能力。',
    '返回严格 JSON，不要 Markdown，不要解释：',
    target,
    '只返回要扩写的那个字段。适用条件与产出必须自然、专业但不官腔；用户表达示例是用户可能说出的完整口语诉求，不是标签或关键词。',
    '',
    `工作流名称：${input.workflowName || '未填写'}`,
    `当前说明：${input.description || '未填写'}`,
    `当前触发场景：${input.triggerScenarios.length ? input.triggerScenarios.join('；') : '未填写'}`,
  ].join('\n');
}

function parseWorkflowMetadataExpansion(raw: string, field: StartMetadataField): Partial<{ workflowName: string; description: string; triggerScenarios: string[] }> {
  const text = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('AI 没有返回可用的流程元信息。');
  const value = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>;
  if (field === 'workflowName') {
    const workflowName = textValue(value.workflowName, 120);
    if (!workflowName) throw new Error('AI 没有返回可用的工作流名称。');
    return { workflowName };
  }
  if (field === 'description') {
    const description = textValue(value.description, 1_200);
    if (!description) throw new Error('AI 没有返回可用的工作流说明。');
    return { description };
  }
  const triggerScenarios = stringList(value.triggerScenarios, 5, 300);
  if (triggerScenarios.length === 0) throw new Error('AI 没有返回可用的用户触发场景。');
  return { triggerScenarios };
}

function startMetadataField(value: unknown): StartMetadataField | null {
  return value === 'workflowName' || value === 'description' || value === 'triggerScenarios' ? value : null;
}

function textValue(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => textValue(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function workflowAssistantHistory(value: unknown): WorkflowAssistantMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WorkflowAssistantMessage[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const role = (item as Record<string, unknown>).role;
    const content = textValue((item as Record<string, unknown>).content, 2_000);
    return (role === 'user' || role === 'assistant') && content ? [{ role, content }] : [];
  }).slice(-8);
}

async function currentAssistantGraph(deps: WorkflowGraphRouteDeps, id: string): Promise<WorkflowGraphConfig | null> {
  const pkg = await readAnyWorkflowPackageJson(deps, id);
  return pkg ? workflowGraphConfigFromPackage(pkg) as WorkflowGraphConfig : deps.service.getConfig(id);
}
async function persistWorkflowGraph(deps: WorkflowGraphRouteDeps, body: WorkflowGraphConfig, verification?: { expected: WorkflowGraphConfig; diff: WorkflowPropertyDiff[] }): Promise<WorkflowGraphConfig> {
  const builtInPackage = await readBuiltInWorkflowPackageJson(deps, body.id);
  const currentPackage = builtInPackage ?? await readWorkflowPackageJson(customWorkflowsDir(deps), body.id);
  const submittedMarkdown = body.nodes?.find(node => node.kind === 'start')?.startConfig?.workflowMarkdown;
  const packageBase = currentPackage ?? createWorkflowPackageJson(body);
  const metadataPackage = submittedMarkdown
    ? updateWorkflowPackageFromMarkdown(packageBase, submittedMarkdown)
    : packageBase;
  const nextPackage = updateWorkflowPackageGraph(metadataPackage, body);
  // workflow.json is the durable source of truth. Return that exact graph
  // so the editor never claims to have saved a shape that will vanish on
  // reload. Legacy delivery cards may be migrated, but authored result
  // cards remain independent graph nodes.
  const durableBody = workflowGraphConfigFromPackage(nextPackage) as WorkflowGraphConfig;
  const normalizedBody = withStartMarkdown(durableBody, renderWorkflowEditorMarkdown(nextPackage));
  if (verification) {
    assertWorkflowChangesPersisted(verification.expected, normalizedBody, verification.diff);
    if (!workflowValueEqual(verification.expected.edges, normalizedBody.edges)) throw new Error('保存后的连线与方案不一致，未应用');
    if (!workflowValueEqual(verification.expected.nodes?.map(n => n.id).sort(), normalizedBody.nodes?.map(n => n.id).sort())) throw new Error('保存后的卡片列表与方案不一致，未应用');
  }
  const workflow = deps.service.saveConfig(normalizedBody);
  const markdown = workflow.nodes?.find(node => node.kind === 'start')?.startConfig?.workflowMarkdown;
  await writeWorkflowPackageJson(builtInPackage ? deps.workflowsDir : customWorkflowsDir(deps), nextPackage);
  await writeWorkflowMarkdown(deps, workflow.id, builtInPackage
    ? renderWorkflowCompatibilityMarkdown(nextPackage)
    : markdown);
  if (verification) {
    const reloaded = await currentAssistantGraph(deps, body.id);
    assertWorkflowChangesPersisted(verification.expected, reloaded, verification.diff);
  }
  return workflow;
}

const workflowWrites = new Map<string, Promise<unknown>>();
async function withWorkflowWrite<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = workflowWrites.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  workflowWrites.set(id, next);
  try { return await next; } finally { if (workflowWrites.get(id) === next) workflowWrites.delete(id); }
}
