import { canvasOperationsJsonSchema, canvasOperationSchema, CANVAS_CARD_KINDS } from '@bezier/contracts';
import type { Express, RequestHandler } from 'express';
import type { CanvasNodeHistoryResponse, CanvasContextSummaryResponse } from '@bezier/contracts';
import type { CanvasStateService } from '../canvas/state.js';
import { CanvasStateError } from '../canvas/errors.js';
import type { ProjectLedger } from '../project-ledger/service.js';
type ToolTokenGrant = { projectId: string };
import { recordCanvasNodeReconciliation } from '../canvas/context.js';
import { canvasStateRelativePath } from '../project-layout.js';
import { listCardOps } from '../canvas/card-ops.js';

export interface RegisterCanvasStateRoutesDeps {
  canvasState?: CanvasStateService;
  ledger?: ProjectLedger;
  resolveProjectRoot?: (projectId: string) => string | null | Promise<string | null>;
  authorizeProjectRequest?: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], projectId: string, options: { mode: 'read' } | { mode: 'write'; capability: 'writeFiles' }) => Promise<boolean>;
  authorizeToolRequest?: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], operation: string) => ToolTokenGrant | null;
}

export function registerCanvasStateRoutes(
  app: Express,
  deps: RegisterCanvasStateRoutesDeps,
): void {
  app.get<{ projectId: string }>('/api/projects/:projectId/canvas/capabilities', async (req, res) => {
    try {
      if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
      if (deps.authorizeProjectRequest && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
      await deps.canvasState.revision(req.params.projectId);
      res.json({ protocolVersion: 1, nodeKinds: CANVAS_CARD_KINDS, scope: 'ordinary card content operations require ungrouped cards; relations/layout supports organization groups; workflow-owned cards and attached storyboard children require dedicated adapters',
        operations: [...canvasOperationSchema.options.map(option => option.shape.type.value), ...listCardOps()],
        storyboard: {shots:['add','update','move','duplicate','delete','references'], maxShots:50, assetReferences:'existing storyboard-owned or unowned assets; kind and variant checked'},
        video: {formats:['mp4'],generate:`/api/projects/${encodeURIComponent(req.params.projectId)}/media/generate`,tasks:`/api/projects/${encodeURIComponent(req.params.projectId)}/media/tasks`,export:`/api/projects/${encodeURIComponent(req.params.projectId)}/files/:path`},
        sketch: { formats: [1,2], edit: 'sketch.update (expectedPath, expectedContent)', read: 'GET /api/projects/:id/files/:path', export: { json: 'GET /api/projects/:id/files/:path', png: 'browser editor' } },
        relationsLayout: { operations: ['group.create','group.rename','group.add','group.remove','group.dissolve','group.move','layout.arrange'], scope: 'ordinary cards and organization groups; excludes nested, legacy image groups and business-owned cards', layoutModes: ['left','center-x','right','top','center-y','bottom','distribute-x','distribute-y','row','column','grid','flow'], coordinates: 'world', groupPadding: 16 },
        document: {edit:'POST /api/projects/:id/files (project-file upload)',versions:'GET /api/projects/:id/files/:path/versions',generate:'POST /api/projects/:id/agent/tasks (requires configured agent adapter)',export:{html:'GET /api/projects/:id/files/:path'},renderedExportsRequire:'desktop-renderer',renderedExports:'unavailable'},
        image: { transforms:['crop','rotate'], source:deps.canvasState.hasOperationImageAssets?['project-file','personal-asset-version']:['project-file'], assetVersionSource:deps.canvasState.hasOperationImageAssets?'available':'unavailable until asset library adapter is attached',
          generate:`/api/projects/${encodeURIComponent(req.params.projectId)}/media/generate`, models:'/api/media/models', tasks:`/api/projects/${encodeURIComponent(req.params.projectId)}/media/tasks`,
          saveAsset:'/api/asset-library/upload', export:`/api/projects/${encodeURIComponent(req.params.projectId)}/files/:path` },
        requestSchema: canvasOperationsJsonSchema, requiresBaseRevision: true, maxBatchSize: 100, execution: 'synchronous', storageConcurrency: 'single-server' });
    } catch (error) { sendCanvasError(res, error); }
  });
  app.post<{ projectId: string }>('/api/projects/:projectId/canvas/operations', async (req, res) => {
    try {
      if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
      if (deps.authorizeProjectRequest && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'write', capability: 'writeFiles' })) return;
      res.json(await deps.canvasState.applyOperations(req.params.projectId, req.body));
    } catch (error) { sendCanvasError(res, error); }
  });
  app.get<{ projectId: string; operationId: string }>('/api/projects/:projectId/canvas/operations/:operationId', async (req, res) => {
    try {
      if (!deps.canvasState) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'canvas state is unavailable');
      if (deps.authorizeProjectRequest && !await deps.authorizeProjectRequest(req, res, req.params.projectId, { mode: 'read' })) return;
      res.json({ receipt: await deps.canvasState.operation(req.params.projectId, req.params.operationId) });
    } catch (error) { sendCanvasError(res, error); }
  });

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
      summary: await deps.canvasState.context(projectId),
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
    const node = await deps.canvasState.node(projectId, nodeId);
    let events = deps.ledger.listEntityHistory(
      projectId,
      'canvas_node',
      nodeId,
      limit,
      { correlationIds: node?.taskIds ?? [], fileNames: node?.outputPaths ?? [] },
    );
    if (node && events.length === 0) {
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
