import { randomUUID } from 'node:crypto';
import { canvasOperationSchema, canvasOperationsJsonSchema, CANVAS_CARD_KINDS, type CanvasOperationReceipt } from '@bezier/contracts';
import type { Express, Request, Response } from 'express';
import type { CanvasStateService } from '../canvas/state.js';
import { CanvasStateError } from '../canvas/errors.js';

type Authorize = (req: Request, res: Response, projectId: string, access?: { mode: 'read' | 'write'; capability?: string }) => Promise<boolean>;

interface Registry {
  create(input: { id?: string; name: string; metadata?: unknown }): { id: string };
}

/** Generic App-protocol facade over the canvas implementation.
 * instanceId currently resolves to projectId 1:1; keep resolution here so a
 * multi-canvas registry can replace it without touching the wire shape. */
const resolveInstanceId = (instanceId: string): string => instanceId;

const requestId = () => `req_${randomUUID()}`;

function sendAppError(res: Response, error: unknown): void {
  const err = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', String(error));
  res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.status >= 500, ...(err.details ? { details: err.details } : {}) }, requestId: requestId() });
}

export interface RegisterAppCanvasRoutesDeps {
  canvasState: CanvasStateService;
  registry: Registry;
  authorizeProjectRequest?: Authorize;
}

export function registerAppCanvasRoutes(app: Express, deps: RegisterAppCanvasRoutesDeps): void {
  const authorize = deps.authorizeProjectRequest ?? (async () => true);

  /** App detail: capability declaration consumed by management side (COI). */
  app.get('/api/apps/canvas', async (_req, res) => {
    try {
      const actions = (canvasOperationSchema.options.map(option => option.shape.type.value) as string[])
        .map(actionId => ({ actionId, target: 'instance' }));
      res.json({ requestId: requestId(), data: {
        appId: 'canvas', protocolVersion: 1,
        nodeKinds: CANVAS_CARD_KINDS,
        actions: [{ actionId: 'canvas.create', target: 'app' }, ...actions],
        requestSchema: canvasOperationsJsonSchema,
        requiresExpectedRevision: true, maxBatchSize: 100, execution: 'synchronous',
      } });
    } catch (error) { sendAppError(res, error); }
  });

  /** App-level action: create a canvas instance. */
  app.post<{ actionId: string }>('/api/apps/canvas/actions/:actionId', async (req, res) => {
    try {
      if (req.params.actionId !== 'canvas.create') throw new CanvasStateError(404, 'CANVAS_ACTION_NOT_FOUND', `Unknown app-level action: ${req.params.actionId}`);
      const name = typeof req.body?.input?.name === 'string' ? req.body.input.name : undefined;
      const id = typeof req.body?.input?.instanceId === 'string' ? req.body.input.instanceId : `canvas-${randomUUID().slice(0, 12)}`;
      if (!await authorize(req, res, id, { mode: 'write' })) return;
      const project = deps.registry.create({ id, name: name ?? '新画布' });
      res.status(201).json({ requestId: requestId(), data: { receiptId: req.get('idempotency-key') ?? null, status: 'succeeded', result: { instanceId: project.id } } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Instance state: latest authored JSON state plus revision. */
  app.get<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/state', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      const current = await deps.canvasState.read(projectId);
      res.json({ requestId: requestId(), data: { instanceId: req.params.instanceId, revision: current.revision, state: current.state, eventCursor: String(current.revision) } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Instance action: single semantic operation mapped into the operations batch. */
  app.post<{ instanceId: string; actionId: string }>('/api/apps/canvas/instances/:instanceId/actions/:actionId', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
      const input = req.body?.input && typeof req.body.input === 'object' ? req.body.input : {};
      const operationId = req.get('idempotency-key') ?? `op-${randomUUID()}`;
      const baseRevision = typeof req.body?.expectedRevision === 'number' ? req.body.expectedRevision : await deps.canvasState.revision(projectId);
      const response = await deps.canvasState.applyOperations(projectId, {
        operationId, baseRevision,
        operations: [{ type: req.params.actionId, ...input }],
      });
      const receipt: CanvasOperationReceipt = response.receipt;
      res.json({ requestId: requestId(), data: {
        receiptId: receipt.operationId, status: 'succeeded',
        result: { revision: response.revision, state: response.state },
        revision: response.revision, replayed: response.replayed,
        eventCursor: String(response.revision),
      } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Execution receipt lookup by the caller-issued operation id. */
  app.get<{ instanceId: string; receiptId: string }>('/api/apps/canvas/instances/:instanceId/action-receipts/:receiptId', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      const receipt = await deps.canvasState.operation(projectId, req.params.receiptId);
      res.json({ requestId: requestId(), data: { receiptId: receipt.operationId, status: receipt.status === 'applied' ? 'succeeded' : 'noop', result: receipt } });
    } catch (error) { sendAppError(res, error); }
  });
}
