import type { Express } from 'express';
import { parseExecutionSnapshot } from '../workflows/execution-snapshot.js';
import type { AuthorizeProjectRequest } from '../workflows/ports.js';
import type { WorkflowExecutionService } from '../workflows/execution.js';
import {
  WorkflowResultError,
  WorkflowResultService,
} from '../workflows/results.js';

export function registerWorkflowResultRoutes(
  app: Express,
  deps: {
    service: WorkflowResultService;
    authorizeProjectRequest: AuthorizeProjectRequest;
    execution?: Pick<WorkflowExecutionService, 'owns' | 'advance'>;
  },
): void {
  app.get('/api/projects/:projectId/workflow-results', async (req, res) => {
    if (!await deps.authorizeProjectRequest(
      req,
      res,
      req.params.projectId,
      { mode: 'read' },
    )) return;
    const workflowRunId = typeof req.query.workflowRunId === 'string'
      ? req.query.workflowRunId.trim()
      : '';
    res.json({
      artifacts: deps.service.list({
        projectId: req.params.projectId,
        ...(workflowRunId ? { workflowRunId } : {}),
      }),
    });
  });

  app.get('/api/workflow-results/:resultId', async (req, res) => {
    const stored = deps.service.get(req.params.resultId);
    if (!stored) {
      return res.status(404).json({
        error: { code: 'WORKFLOW_RESULT_NOT_FOUND', message: 'Result not found' },
      });
    }
    if (!await deps.authorizeProjectRequest(
      req,
      res,
      stored.artifact.projectId,
      { mode: 'read' },
    )) return;
    res.json({ artifact: stored.artifact });
  });

  app.post('/api/workflow-results/:resultId/interactions', async (req, res) => {
    try {
      const stored = deps.service.get(req.params.resultId);
      if (!stored) return res.status(404).json({ error: { code: 'WORKFLOW_RESULT_NOT_FOUND', message: 'Result not found' } });
      if (!await deps.authorizeProjectRequest(
        req,
        res,
        stored.artifact.projectId,
        { mode: 'write', capability: 'writeFiles' },
      )) return;
      const body = req.body ?? {};
      const execution = parseExecutionSnapshot(body.execution);
      const result = await deps.service.interact({
        ...(execution ? { execution } : {}),
        resultId: req.params.resultId,
        actionId: String(body.actionId || ''),
        expectedVersion: Number(body.expectedVersion),
        selectedIds: Array.isArray(body.selectedIds) ? body.selectedIds.map(String) : [],
        feedback: typeof body.feedback === 'string' ? body.feedback : '',
        ...(body.surface === 'chat' || body.surface === 'canvas' ? { surface: body.surface } : {}),
        // 编辑类动作的入参：被改的单项 + 字段补丁。
        // 值一律收成字符串——卡面上的编辑框只会产出文本，
        // 类型转换（可空、数字等）由适配器按领域模型决定。
        ...(typeof body.itemId === 'string' && body.itemId.trim()
          ? { itemId: body.itemId.trim() }
          : {}),
        ...(body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
          ? {
              patch: Object.fromEntries(
                Object.entries(body.patch as Record<string, unknown>)
                  .map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')]),
              ),
            }
          : {}),
        idempotencyKey: String(body.idempotencyKey || ''),
      });
      const workflow = result.runMetadata?.genericWorkflow;
      const runId = workflow && typeof workflow === 'object' && !Array.isArray(workflow)
        && typeof workflow.runId === 'string' ? workflow.runId : undefined;
      if (runId && deps.execution?.owns(runId)) {
        // Generic results also serve external/manual executors. Only the HTTP
        // composition knows this run is backend-owned: resume its existing
        // lifecycle and never ask the browser to dispatch a detached duplicate.
        // Strip from a response copy so persisted interaction replay stays intact.
        await deps.execution.advance(runId);
        const { agentPrompt: _externalPrompt, ...managedResult } = result;
        return res.json(managedResult);
      }
      res.json(result);
    } catch (error) {
      if (error instanceof WorkflowResultError) {
        return res.status(error.status).json({
          error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        });
      }
      res.status(500).json({
        error: { code: 'WORKFLOW_RESULT_INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
