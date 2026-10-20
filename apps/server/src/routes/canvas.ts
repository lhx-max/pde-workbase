import type { Express, RequestHandler } from 'express';
import type { CanvasNodeHistoryResponse, CanvasContextSummaryResponse } from '@bezier/contracts';
import type { CanvasStateService } from '../canvas/state.js';
import { CanvasStateError } from '../canvas/errors.js';
import type { ProjectLedger } from '../project-ledger/service.js';
import type { WorkflowResultArtifact } from '@bezier/contracts';
type ToolTokenGrant = { projectId: string };
interface WorkflowResultService {
  list(input: {projectId: string}): WorkflowResultArtifact[];
  get(id: string): {artifact: WorkflowResultArtifact} | null | undefined;
}
import { recordCanvasNodeReconciliation, workflowResultCanvasNode } from '../canvas/context.js';
import { canvasStateRelativePath } from '../project-layout.js';

export interface RegisterCanvasStateRoutesDeps {
  canvasState?: CanvasStateService;
  ledger?: ProjectLedger;
  workflowResults?: WorkflowResultService;
  resolveProjectRoot?: (projectId: string) => string | null | Promise<string | null>;
  authorizeProjectRequest?: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], projectId: string, options: { mode: 'read' } | { mode: 'write'; capability: 'writeFiles' }) => Promise<boolean>;
  authorizeToolRequest?: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], operation: string) => ToolTokenGrant | null;
}

export function registerCanvasStateRoutes(
  app: Express,
  deps: RegisterCanvasStateRoutesDeps,
): void {
  app.get<{ projectId: string }>('/api/projects/:projectId/canvas/state', async (req, res) => {
    try {
      if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
      if (deps.authorizeProjectRequest
        && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
      const result = await deps.canvasState.read(req.params.projectId);
      // 画布恢复 pending card 需要本地项目路径，自动填入项目磁盘路径。
      if (!result.state?.projectPath && deps.resolveProjectRoot) {
        const projectPath = await deps.resolveProjectRoot(req.params.projectId);
        if (projectPath) {
          result.state = { ...result.state, projectPath, cloudProjectId: req.params.projectId };
        }
      }
      res.json({ ok: true, ...result });
    } catch (error) {
      sendCanvasError(res, error);
    }
  });

  app.get<{ projectId: string }>('/api/projects/:projectId/canvas/revision', async (req, res) => {
    try {
      if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
      if (deps.authorizeProjectRequest
        && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
      res.json({ ok: true, revision: await deps.canvasState.revision(req.params.projectId) });
    } catch (error) {
      sendCanvasError(res, error);
    }
  });

  app.get<{ projectId: string }>('/api/projects/:projectId/canvas/context', async (req, res) => {
    if (deps.authorizeProjectRequest
      && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
    await sendCanvasContext(res, deps, req.params.projectId);
  });

  app.get<{ projectId: string; nodeId: string }>('/api/projects/:projectId/canvas/nodes/:nodeId/history', async (req, res) => {
    if (deps.authorizeProjectRequest
      && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
    await sendCanvasNodeHistory(
      res,
      deps,
      req.params.projectId,
      req.params.nodeId,
      positiveInt(req.query.limit, 100),
    );
  });

  app.get('/api/tools/canvas/context', async (req, res) => {
    const grant = deps.authorizeToolRequest?.(req, res, 'canvas:read');
    if (!grant) { if (!res.headersSent) res.status(403).json({error:{code:'CANVAS_TOOL_AUTH_UNAVAILABLE',message:'Tool authorization is not configured'}}); return; }
    await sendCanvasContext(res, deps, grant.projectId);
  });

  app.get<{ nodeId: string }>('/api/tools/canvas/history/:nodeId', async (req, res) => {
    const grant = deps.authorizeToolRequest?.(req, res, 'canvas:read');
    if (!grant) { if (!res.headersSent) res.status(403).json({error:{code:'CANVAS_TOOL_AUTH_UNAVAILABLE',message:'Tool authorization is not configured'}}); return; }
    await sendCanvasNodeHistory(
      res,
      deps,
      grant.projectId,
      req.params.nodeId,
      positiveInt(req.query.limit, 100),
    );
  });

  app.patch<{ projectId: string }>('/api/projects/:projectId/canvas/state', async (req, res) => {
    try {
      if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
      if (deps.authorizeProjectRequest
        && !await deps.authorizeProjectRequest(
          req,
          res,
          req.params.projectId,
          { mode: 'write', capability: 'writeFiles' },
        )) return;
      const body = (req.body ?? {}) as {
        changes?: Record<string, unknown>;
        key?: string;
        value?: unknown;
        expectedRevision?: number;
        base?: Record<string, unknown>;
      };
      // 原版同时支持批量 `changes` 和单键 `key/value`，两种都要接。
      const changes = body.changes ?? (body.key ? { [body.key]: body.value } : undefined);
      if (!changes) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'missing changes');
      const result = await deps.canvasState.patch(req.params.projectId, changes, {
        ...(Number.isFinite(body.expectedRevision) ? { expectedRevision: body.expectedRevision } : {}),
        ...(body.base && typeof body.base === 'object' && !Array.isArray(body.base)
          ? { base: body.base }
          : {}),
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendCanvasError(res, error);
    }
  });
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function sendCanvasContext(
  res: Parameters<RequestHandler>[1],
  deps: RegisterCanvasStateRoutesDeps,
  projectId: string,
): Promise<void> {
  try {
    if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
    const response: CanvasContextSummaryResponse = {
      summary: await deps.canvasState.context(projectId, deps.workflowResults?.list({ projectId }) ?? []),
    };
    res.json(response);
  } catch (error) {
    sendCanvasError(res, error);
  }
}

async function sendCanvasNodeHistory(
  res: Parameters<RequestHandler>[1],
  deps: RegisterCanvasStateRoutesDeps,
  projectId: string,
  nodeId: string,
  limit: number,
): Promise<void> {
  try {
    if (!deps.canvasState || !deps.ledger) {
      throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas history is unavailable');
    }
    const workflowResultId = nodeId.startsWith('workflow-result-')
      ? nodeId.slice('workflow-result-'.length)
      : null;
    const workflowArtifactCandidate = workflowResultId
      ? deps.workflowResults?.get(workflowResultId)?.artifact
      : undefined;
    const workflowArtifact = workflowArtifactCandidate?.projectId === projectId
      ? workflowArtifactCandidate
      : undefined;
    const node = workflowArtifact
      ? workflowResultCanvasNode(workflowArtifact)
      : await deps.canvasState.node(projectId, nodeId);
    let events = workflowResultId
      ? deps.ledger.listEntityHistory(projectId, 'workflow_result', workflowResultId, limit)
      : deps.ledger.listEntityHistory(
          projectId,
          'canvas_node',
          nodeId,
          limit,
          { correlationIds: node?.taskIds ?? [], fileNames: node?.outputPaths ?? [] },
        );
    if (node && !workflowResultId && events.length === 0) {
      const root = await deps.resolveProjectRoot?.(projectId);
      recordCanvasNodeReconciliation(projectId, node, root ? canvasStateRelativePath(root) : undefined);
      events = deps.ledger.listEntityHistory(
        projectId,
        'canvas_node',
        nodeId,
        limit,
        { correlationIds: node.taskIds, fileNames: node.outputPaths },
      );
    }
    if (!node && events.length === 0) {
      res.status(404).json({ error: { code: 'CANVAS_NODE_NOT_FOUND', message: 'canvas node not found' } });
      return;
    }
    const response: CanvasNodeHistoryResponse = { projectId, nodeId, node, events };
    res.json(response);
  } catch (error) {
    sendCanvasError(res, error);
  }
}

function sendCanvasError(res: Parameters<RequestHandler>[1], error: unknown): void {
  if (error instanceof CanvasStateError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    return;
  }
  res.status(500).json({ error: { code: 'CANVAS_STORAGE_ERROR', message: 'Unable to persist canvas state' } });
}
