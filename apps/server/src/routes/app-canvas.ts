import { randomUUID } from 'node:crypto';
import { canvasOperationSchema, canvasOperationsJsonSchema, CANVAS_CARD_KINDS, type CanvasOperationReceipt } from '@bezier/contracts';
import type { Express, Request, Response } from 'express';
import type { CanvasStateService } from '../canvas/state.js';
import { CanvasStateError } from '../canvas/errors.js';
import { listCardOps, listRegisteredCardKinds, listRegisteredCardApps, listRegisteredPacks } from '../canvas/card-ops.js';
import { CARD_CAPABILITY_MATRIX, CARD_CREATE_ACTIONS } from '../canvas/card-capability-matrix.js';
import { canvasCardChangesAfter, subscribeCanvasCardChanges, type CanvasCardChange } from '../canvas/card-events.js';
import type { AppRegistryStore } from '../storage/app-registry.js';
import type { BindingStore } from '../storage/bindings.js';
import type { AuditLog } from '../storage/audit-log.js';
import type { CanvasFileContent } from '../canvas/persistence.js';
import type { AppEntitlementStore } from '../storage/app-entitlements.js';
import { appVisibleToTenant, ownsTenantAsset, tenantOf } from '../tenant.js';

type Authorize = (req: Request, res: Response, projectId: string, access?: { mode: 'read' | 'write'; capability?: string }) => Promise<boolean>;

interface Registry {
  create(input: { id?: string; name: string; metadata?: unknown; teamId?: string; createdBy?: string }): { id: string };
  get?(id: string): { id: string; teamId?: string } | null;
  archive?(id: string): { id: string };
  list?(): { id: string; name: string; createdAt: number; updatedAt: number; teamId?: string }[];
  update?(id: string, input: { name?: string }): { id: string; name: string };
  delete?(id: string): void;
}

/** Generic App-protocol facade over the canvas implementation.
 * instanceId currently resolves to projectId 1:1; keep resolution here so a
 * multi-canvas registry can replace it without touching the wire shape. */
const resolveInstanceId = (instanceId: string): string => instanceId;

const requestId = () => `req_${randomUUID()}`;

/** Platform-declared core-kind → editor-App associations. A kind listed here
 * keeps light editing on canvas; deep editing opens the named App via the
 * card↔App interop protocol. Native kinds (image/video/storyboard) have no App. */
const CORE_EDITOR_APPS: Record<string, string> = {
  text: 'doc',
  sketch: 'sketch',
  page: 'page',
  presentation: 'slides',
};

function sendAppError(res: Response, error: unknown): void {
  const err = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', String(error));
  res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.status >= 500, ...(err.details ? { details: err.details } : {}) }, requestId: requestId() });
}

export interface RegisterAppCanvasRoutesDeps {
  canvasState: CanvasStateService;
  registry: Registry;
  authorizeProjectRequest?: Authorize;
  /** App catalog — resolves kind→app→endpoint for open-editor. */
  appRegistry?: AppRegistryStore;
  /** Central card↔App binding index (data-model §三). */
  bindings?: BindingStore;
  audit?: AuditLog;
  entitlements?: AppEntitlementStore;
  /** Canvas-owned file channel — external Apps read/write the same files
   * the cards point at (`projectFilePath`). Text payloads in v1. */
  content?: CanvasFileContent;
  /** Entity history for node timeline queries. */
  ledger?: { listEntityHistory(projectId: string, entity: string, entityId: string, limit: number, options?: { correlationIds?: string[]; fileNames?: string[] }): unknown[] };
}

export function registerAppCanvasRoutes(app: Express, deps: RegisterAppCanvasRoutesDeps): void {
  const requireAppAccess = async (req: Request, appId: string) => {
    const registered = await deps.appRegistry?.get(appId);
    if (registered && !appVisibleToTenant(registered, tenantOf(req))) {
      throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'App belongs to another team');
    }
    if (deps.entitlements?.resolve(appId, tenantOf(req)) === 'deny') {
      throw new CanvasStateError(403, 'TENANT_FORBIDDEN', 'App denied for this tenant');
    }
  };
  app.use('/api/apps/canvas', (req, res, next) => {
    if (deps.entitlements?.resolve('canvas', tenantOf(req)) === 'deny') {
      sendAppError(res, new CanvasStateError(403, 'TENANT_FORBIDDEN', 'App denied for this tenant'));
      return;
    }
    next();
  });
  /** Every instance-scoped route is tenant-gated: an asset owned by another
   * team is a 403, not a leak. Projects without a stamped tenant belong to
   * 'local'. */
  app.use('/api/apps/canvas/instances/:instanceId', (req, res, next) => {
    const project = deps.registry.get?.(req.params.instanceId) ?? null;
    if (project && !ownsTenantAsset(project, tenantOf(req))) {
      sendAppError(res, new CanvasStateError(403, 'TENANT_FORBIDDEN', 'Asset belongs to another team'));
      return;
    }
    next();
  });
  const authorize = deps.authorizeProjectRequest ?? (async () => true);

  /** App detail: capability declaration consumed by management side (COI). */
  app.get('/api/apps/canvas', async (_req, res) => {
    try {
      const actions = [...(canvasOperationSchema.options.map(option => option.shape.type.value) as string[]), ...listCardOps()]
        .map(actionId => ({ actionId, target: 'instance' }));
      res.json({ requestId: requestId(), data: {
        appId: 'canvas', protocolVersion: 1,
        nodeKinds: CANVAS_CARD_KINDS,
        cardKinds: listRegisteredCardKinds(),
        editorApps: { ...CORE_EDITOR_APPS, ...listRegisteredCardApps() },
        cardPacks: listRegisteredPacks().map(pack => ({ packId: pack.packId, team: pack.team, name: pack.name, kinds: pack.kinds, ops: pack.ops, editorApps: pack.editorApps })),
        actions: [{ actionId: 'canvas.create', target: 'app' },
          { actionId: 'canvas.rename', target: 'instance' }, { actionId: 'canvas.delete', target: 'instance' }, { actionId: 'canvas.duplicate', target: 'instance', available: false },
          ...actions],
        endpoints: {
          instances: 'GET /api/apps/canvas/instances',
          state: 'GET /api/apps/canvas/instances/{id}/state',
          revision: 'GET /api/apps/canvas/instances/{id}/revision',
          context: 'GET /api/apps/canvas/instances/{id}/context',
          node: 'GET /api/apps/canvas/instances/{id}/nodes/{nodeId}',
          nodeHistory: 'GET /api/apps/canvas/instances/{id}/nodes/{nodeId}/history',
          operations: 'POST /api/apps/canvas/instances/{id}/operations',
          operationReceipt: 'GET /api/apps/canvas/instances/{id}/operations/{operationId}',
        },
        createActions: CARD_CREATE_ACTIONS,
        cardCapabilities: CARD_CAPABILITY_MATRIX,
        events: { method: 'GET', path: '/api/apps/canvas/instances/{instanceId}/events', query: { after: 'eventCursor' }, types: ['card.created', 'card.updated', 'card.deleted'] },
        requestSchema: canvasOperationsJsonSchema,
        requiresExpectedRevision: true, maxBatchSize: 100, execution: 'synchronous',
        // Agent task execution belongs to the manage side. Until a real
        // executor channel is wired, report unavailable so hosts hide card
        // AI composers instead of accepting input nobody can run.
        agentRuntime: { available: false, reason: '未接入管理侧 Agent 执行通道（任务提交端点未挂载）' },
      } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Permissions (P19): canvas has its own card-grant model; the external
   * team-permission provider is not wired yet — report both honestly. */
  app.get('/api/apps/canvas/permissions', (_req, res) => {
    res.json({ requestId: requestId(), data: {
      available: true, provider: 'internal-card-grants',
      scope: 'card kind availability per team/project via card_grants',
      teamPermissionsProvider: { available: false, configured: Boolean(process.env.TEAM_PERMISSIONS_URL?.trim()),
        reason: '团队权限 API 地址与返回格式尚未提供，接线保留未启用' },
    } });
  });

  /** App-level action: create a canvas instance. */
  app.post<{ actionId: string }>('/api/apps/canvas/actions/:actionId', async (req, res) => {
    try {
      if (req.params.actionId !== 'canvas.create') throw new CanvasStateError(404, 'CANVAS_ACTION_NOT_FOUND', `Unknown app-level action: ${req.params.actionId}`);
      const name = typeof req.body?.input?.name === 'string' ? req.body.input.name : undefined;
      const id = typeof req.body?.input?.instanceId === 'string' ? req.body.input.instanceId : `canvas-${randomUUID().slice(0, 12)}`;
      if (!await authorize(req, res, id, { mode: 'write' })) return;
      const tenant = tenantOf(req);
      const project = deps.registry.create({ id, name: name ?? '新画布', teamId: tenant.teamId, createdBy: tenant.userId });
      deps.audit?.record({ actor: tenant, action: 'canvas.create', appId: 'canvas', targetId: project.id, status: 'succeeded', summary: name ?? '新画布' });
      res.status(201).json({ requestId: requestId(), data: { receiptId: req.get('idempotency-key') ?? null, status: 'succeeded', result: { instanceId: project.id } } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Card change stream. `after` is the eventCursor already applied.
   * A fallen-out cursor returns ready.resync so the caller re-reads state. */
  app.get<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/events', async (req, res) => {
    let unsubscribe = () => {};
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      const pending: CanvasCardChange[] = [];
      let live = false;
      const send = (event: string, payload: unknown) => {
        if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      unsubscribe = subscribeCanvasCardChanges(projectId, (event) => {
        if (!live) pending.push(event);
        else send(event.type, event);
      });
      const current = await deps.canvasState.read(projectId);
      const after = typeof req.query.after === 'string' && req.query.after !== '' ? Number(req.query.after) : current.revision;
      if (!Number.isFinite(after)) throw new CanvasStateError(400, 'BAD_REQUEST', 'after must be a revision cursor');
      const replay = canvasCardChangesAfter(projectId, after);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      send('ready', { instanceId: req.params.instanceId, cursor: String(current.revision), resync: replay.resync });
      const mark = (event: { type: string; nodeId: string; cursor: string }) => `${event.type}:${event.nodeId}:${event.cursor}`;
      const sent = new Set<string>();
      if (!replay.resync) {
        for (const event of replay.events) { sent.add(mark(event)); send(event.type, event); }
      }
      live = true;
      if (!replay.resync) {
        for (const event of pending) {
          const key = mark(event);
          if (sent.has(key) || event.revision <= after) continue;
          sent.add(key);
          send(event.type, event);
        }
      }
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 20_000);
      heartbeat.unref();
      const cleanup = () => { clearInterval(heartbeat); unsubscribe(); };
      res.once('close', cleanup);
      res.once('finish', cleanup);
    } catch (error) {
      unsubscribe();
      if (!res.headersSent) sendAppError(res, error);
      else res.end();
    }
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

  /** Instance list (P5). */
  app.get('/api/apps/canvas/instances', async (req, res) => {
    try {
      const teamId = tenantOf(req).teamId;
      const instances = (deps.registry.list?.() ?? []).filter(p => (p.teamId ?? 'local') === teamId).map(p => ({ instanceId: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt }));
      res.json({ requestId: requestId(), data: { instances } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Card↔App binding index (data-model §三). Apps report their bindings
   * here; governance reads this instead of scraping App-side metadata. */
  app.get<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/bindings', async (req, res) => {
    try {
      if (!await authorize(req, res, req.params.instanceId, { mode: 'read' })) return;
      res.json({ requestId: requestId(), data: { bindings: deps.bindings?.list({ canvasInstanceId: req.params.instanceId, includeArchived: req.query.all === '1' }) ?? [] } });
    } catch (error) { sendAppError(res, error); }
  });
  app.put<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/bindings', async (req, res) => {
    try {
      if (!await authorize(req, res, req.params.instanceId, { mode: 'write' })) return;
      if (!deps.bindings) throw new CanvasStateError(501, 'BINDINGS_UNAVAILABLE', 'binding store not configured');
      const body = (req.body ?? {}) as { nodeId?: string; kind?: string; appId?: string; appInstanceId?: string; mirrorPath?: string };
      if (!body.nodeId || !body.appId || !body.appInstanceId) throw new CanvasStateError(400, 'BAD_REQUEST', 'nodeId, appId and appInstanceId are required');
      await requireAppAccess(req, body.appId);
      const row = deps.bindings.upsert({
        canvasInstanceId: req.params.instanceId, nodeId: body.nodeId,
        ...(body.kind ? { kind: body.kind } : {}), appId: body.appId, appInstanceId: body.appInstanceId,
        ...(body.mirrorPath ? { mirrorPath: body.mirrorPath } : {}),
        teamId: tenantOf(req).teamId,
      });
      deps.audit?.record({ actor: tenantOf(req), action: 'binding.upsert', appId: body.appId, targetId: row.bindingId, status: 'succeeded', summary: `${req.params.instanceId}/${body.nodeId}→${body.appInstanceId}` });
      res.json({ requestId: requestId(), data: { binding: row } });
    } catch (error) { sendAppError(res, error); }
  });
  /** Archive bindings for a card — Apps call this when their bound asset is
   * archived (doc.archive), or the host uses it internally on node.delete. */
  app.delete<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/bindings', async (req, res) => {
    try {
      if (!await authorize(req, res, req.params.instanceId, { mode: 'write' })) return;
      const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined;
      const count = deps.bindings?.archive(req.params.instanceId, nodeId) ?? 0;
      res.json({ requestId: requestId(), data: { archived: count } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Revision only (P8). */
  app.get<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/revision', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      res.json({ requestId: requestId(), data: { instanceId: req.params.instanceId, revision: await deps.canvasState.revision(projectId) } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Instance summary for agents (P9). */
  app.get<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/context', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      res.json({ requestId: requestId(), data: { instanceId: req.params.instanceId, summary: await deps.canvasState.context(projectId) } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Single node read (P10) and node history (P11). */
  app.get<{ instanceId: string; nodeId: string }>('/api/apps/canvas/instances/:instanceId/nodes/:nodeId', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      const node = await deps.canvasState.node(projectId, req.params.nodeId);
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', `Node not found: ${req.params.nodeId}`);
      res.json({ requestId: requestId(), data: { nodeId: req.params.nodeId, node } });
    } catch (error) { sendAppError(res, error); }
  });

  app.get<{ instanceId: string; nodeId: string }>('/api/apps/canvas/instances/:instanceId/nodes/:nodeId/history', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      if (!deps.ledger) throw new CanvasStateError(503, 'CANVAS_HISTORY_UNAVAILABLE', 'node history is unavailable');
      const limit = Number(req.query.limit);
      const node = await deps.canvasState.node(projectId, req.params.nodeId);
      const events = deps.ledger.listEntityHistory(projectId, 'canvas_node', req.params.nodeId,
        Number.isSafeInteger(limit) && limit > 0 ? limit : 100,
        { correlationIds: node?.taskIds ?? [], fileNames: node?.outputPaths ?? [] });
      if (!node && events.length === 0) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', `Node not found: ${req.params.nodeId}`);
      res.json({ requestId: requestId(), data: { nodeId: req.params.nodeId, node, events } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Batch operations (P12) — canonical write shape. Atomic multi-op apply,
   * one revision per batch. Same semantics as the legacy /operations route. */
  app.post<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/operations', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
      const response = await deps.canvasState.applyOperations(projectId, req.body);
      res.json({ requestId: requestId(), data: { receipt: response.receipt, revision: response.revision, state: response.state, replayed: response.replayed, eventCursor: String(response.revision) } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Operation receipt lookup (P14). */
  app.get<{ instanceId: string; operationId: string }>('/api/apps/canvas/instances/:instanceId/operations/:operationId', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      res.json({ requestId: requestId(), data: { receipt: await deps.canvasState.operation(projectId, req.params.operationId) } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Instance action: single semantic operation mapped into the operations batch. */
  app.post<{ instanceId: string; actionId: string }>('/api/apps/canvas/instances/:instanceId/actions/:actionId', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      const actionId = req.params.actionId;
      const input = req.body?.input && typeof req.body.input === 'object' ? req.body.input : {};
      if (actionId === 'canvas.rename' || actionId === 'canvas.delete') {
        if (!await authorize(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
        if (actionId === 'canvas.rename') {
          const name = typeof input.name === 'string' ? input.name : '';
          if (!name.trim()) throw new CanvasStateError(400, 'BAD_REQUEST', 'input.name is required');
          const project = deps.registry.update?.(projectId, { name });
          if (!project) throw new CanvasStateError(503, 'CANVAS_REGISTRY_UNAVAILABLE', 'rename is unavailable');
          res.json({ requestId: requestId(), data: { receiptId: req.get('idempotency-key') ?? null, status: 'succeeded', result: { instanceId: project.id, name: project.name } } });
          return;
        }
        // Archive — never physically delete an instance (spec §3.0); its
        // files and bindings stay recoverable. Its card↔App bindings archive too.
        deps.registry.archive ? deps.registry.archive(projectId) : deps.registry.delete?.(projectId);
        deps.bindings?.archive(projectId, undefined, 'canvas_archived');
        deps.audit?.record({ actor: tenantOf(req), action: 'canvas.archive', appId: 'canvas', targetId: projectId, status: 'succeeded' });
        res.json({ requestId: requestId(), data: { receiptId: req.get('idempotency-key') ?? null, status: 'succeeded', result: { instanceId: projectId, archived: true } } });
        return;
      }
      if (actionId === 'canvas.duplicate') throw new CanvasStateError(501, 'CANVAS_ACTION_UNAVAILABLE', 'canvas.duplicate is not implemented yet');
      if (!await authorize(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
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

  /** Open-editor: resolve a card to its editor App. Returns the App
   * descriptor + the shared file handle so the caller (UI or manage Agent)
   * can open or invoke the App. 404 APP_NOT_INSTALLED when the kind has no
   * editor association or the App isn't registered. */
  app.post<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/open-editor', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId : '';
      if (!nodeId) throw new CanvasStateError(400, 'BAD_REQUEST', 'nodeId is required');
      const snapshot = await deps.canvasState.read(projectId);
      const nodes = (snapshot.state.workbenchBasicNodes ?? []) as { id: string; kind?: string; projectFilePath?: string; text?: string; data?: Record<string, unknown> }[];
      const node = nodes.find(n => n.id === nodeId);
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', `Node not found: ${nodeId}`);
      const kind = node.kind ?? 'text';
      const appId = { ...CORE_EDITOR_APPS, ...listRegisteredCardApps() }[kind];
      if (!appId) throw new CanvasStateError(404, 'APP_NOT_INSTALLED', `Kind ${kind} has no editor App`);
      const app = deps.appRegistry ? await deps.appRegistry.get(appId) : null;
      if (!app || app.status !== 'active') throw new CanvasStateError(404, 'APP_NOT_INSTALLED', `Editor App '${appId}' is not registered`);
      await requireAppAccess(req, appId);
      const filePath = node.projectFilePath
        ?? (typeof node.data?.projectFilePath === 'string' ? node.data.projectFilePath : undefined);
      const sketchId = kind === 'sketch' && typeof node.data?.sketchId === 'string' ? node.data.sketchId : undefined;
      res.json({ requestId: requestId(), data: { appId, endpoint: app.endpoint, nodeId, kind, filePath: filePath ?? null, ...(sketchId ? { sketchId } : {}) } });
    } catch (error) { sendAppError(res, error); }
  });

  /** Shared file channel: external Apps read/write the exact file a card
   * points at (`projectFilePath`). Query `path` is required; paths are
   * project-relative and must not escape the canvas root. */
  const filePath = (req: Request): string => {
    const value = typeof req.query.path === 'string' ? req.query.path : '';
    if (!value || value.includes('..') || value.startsWith('/')) throw new CanvasStateError(400, 'BAD_REQUEST', 'a project-relative path is required');
    return value;
  };

  app.get<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/files', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'read' })) return;
      if (!deps.content) throw new CanvasStateError(503, 'CANVAS_FILES_UNAVAILABLE', 'file channel is not configured');
      const content = await deps.content.read(projectId, filePath(req));
      if (content === null) throw new CanvasStateError(404, 'CANVAS_FILE_NOT_FOUND', 'File not found');
      res.json({ requestId: requestId(), data: { content } });
    } catch (error) { sendAppError(res, error); }
  });

  app.put<{ instanceId: string }>('/api/apps/canvas/instances/:instanceId/files', async (req, res) => {
    try {
      const projectId = resolveInstanceId(req.params.instanceId);
      if (!await authorize(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
      if (!deps.content) throw new CanvasStateError(503, 'CANVAS_FILES_UNAVAILABLE', 'file channel is not configured');
      const content = typeof req.body?.content === 'string' ? req.body.content : null;
      if (content === null) throw new CanvasStateError(400, 'BAD_REQUEST', 'content (string) is required');
      const path = filePath(req);
      const expectedRevision: unknown = req.body?.expectedRevision;
      if (expectedRevision !== undefined && (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
        throw new CanvasStateError(400, 'BAD_REQUEST', 'expectedRevision must be a nonnegative safe integer');
      }
      const snapshot = await deps.canvasState.writeTextMirror(projectId, path, content, expectedRevision as number | undefined);
      res.json({ requestId: requestId(), data: { path, status: 'written', revision: snapshot.revision } });
    } catch (error) { sendAppError(res, error); }
  });
}
