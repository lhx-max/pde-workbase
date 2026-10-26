import { createHash } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { ProjectMetadata } from '@bezier/contracts';
import { CanvasStateError } from '../canvas/errors.js';
import type { CanvasStateService } from '../canvas/state.js';
import { canonical } from '../canvas/merge.js';
import type { ProjectRegistry } from '../storage/project-registry.js';
import { ProjectSerialLock } from '../storage/project-serial-lock.js';
import { runWithRequestTenant, type TenantContext } from '../tenant.js';

/** Kit actor/headers are development input, NOT authentication credentials.
 * Install behind the server's existing Host/Origin/auth middleware. This first
 * release is local-only: remote/production callers fail closed by default.
 */
export interface CanvasProviderOptions {
  providerLocalDevelopment?: boolean | undefined;
}
export interface RegisterCanvasProviderRoutesDeps extends CanvasProviderOptions {
  verifiedActor?:(req:Request)=>TenantContext|undefined;
  canvasState: CanvasStateService;
  registry: Pick<ProjectRegistry, 'get' | 'create'> & {
    /** Optional durability barrier: registries that schedule persistence
     * asynchronously (cloud metadata writes) are flushed before a create is
     * acknowledged, so a reported success means the mapping actually landed. */
    flush?(): Promise<void> | void;
  };
  authorizeProjectRequest: (req: Request, res: Response, projectId: string,
    access: { mode: 'read' | 'write'; capability?: string }) => boolean | Promise<boolean>;
}

const actions = new Set(['canvas.create', 'canvas.read', 'canvas.operations', 'canvas.context']);
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
/** Canonical Provider project id: `ma-` + the first 32 hex chars of the sha256
 * over the canonical ['canvas', tenant, application, pid] tuple — 35 chars,
 * inside the 36-char Appwrite documentId limit that the cloud registry and
 * canvas persistence use for documentId. The stored canvasProvider mapping is
 * still verified in full before the id is trusted, so a truncated-digest
 * collision can never silently adopt another tuple's project. */
export const canvasProviderProjectId = (tenantId: string, applicationId: string, providerInstanceId: string): string =>
  `ma-${digest(['canvas', tenantId, applicationId, providerInstanceId]).slice(0, 32)}`;
/** Legacy addressing only: pre-compact ids used the full 64-hex digest (67
 * chars, over the Appwrite limit). Existing local mappings stay resolvable
 * under identical validation, but the form is never assigned to new projects
 * and is never migrated to the compact form. */
export const legacyCanvasProviderProjectId = (tenantId: string, applicationId: string, providerInstanceId: string): string =>
  `ma-${digest(['canvas', tenantId, applicationId, providerInstanceId])}`;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bad = (message: string): never => { throw new CanvasStateError(400, 'PROVIDER_INVALID_REQUEST', message); };
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\u0000-\u001f\u007f]/u.test(value)) return bad(`${field} must be a non-empty string (max 1000)`);
  return value;
};
interface Envelope {
  protocolVersion: '1.0'; requestId: string; idempotencyKey: string;
  applicationId: string; applicationVersion: string; applicationInstanceId: string;
  providerInstanceId: string; actionId: string; bizId?: string; sessionId?: string;
  actor: { tenantId: string; userId: string }; expectedRevision?: number;
  input: Record<string, unknown>;
}
function envelope(req: Request): Envelope {
  const body: unknown = req.body;
  if (!object(body)) return bad('JSON object required');
  if (body.protocolVersion !== '1.0') return bad('protocolVersion must be 1.0');
  for (const field of ['requestId', 'applicationId', 'applicationVersion', 'applicationInstanceId', 'providerInstanceId', 'actionId']) text(body[field], field);
  if (body.providerInstanceId !== req.params.providerInstanceId || body.actionId !== req.params.actionId) return bad('Path and envelope identifiers must match');
  if (!object(body.actor)) return bad('actor required in explicit local development mode');
  const tenantId = text(body.actor.tenantId, 'actor.tenantId');
  const userId = text(body.actor.userId, 'actor.userId');
  if (tenantId !== tenantId.trim() || userId !== userId.trim()) return bad('actor identifiers cannot have surrounding whitespace');
  if (body.expectedRevision !== undefined && (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) <= 0)) return bad('expectedRevision must be a positive safe integer');
  if (body.input !== undefined && !object(body.input)) return bad('input must be an object');
  for (const field of ['bizId', 'sessionId']) if (body[field] !== undefined) text(body[field], field);
  return { ...body, input: body.input ?? {}, idempotencyKey: text(body.idempotencyKey ?? body.requestId, 'idempotencyKey') } as Envelope;
}

function requireLocal(req: Request, enabled: boolean | undefined): void {
  if (enabled !== true) throw new CanvasStateError(503, 'PROVIDER_UNAVAILABLE', 'Provider requires explicit local development mode; no verified remote provider authorizer is configured');
  const remote = req.socket.remoteAddress;
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') throw new CanvasStateError(403, 'PROVIDER_LOCAL_ONLY', 'Provider development mode requires a loopback peer');
  let host: URL;
  try { host = new URL(`http://${req.get('host') ?? ''}`); } catch { throw new CanvasStateError(403, 'HOST_FORBIDDEN', 'Invalid Host'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) throw new CanvasStateError(403, 'HOST_FORBIDDEN', 'Provider development mode requires a loopback Host');
  const origin = req.get('origin');
  if (origin) {
    let allowed = false;
    try { const url = new URL(origin); allowed = ['http:', 'https:'].includes(url.protocol) && url.host === host.host; } catch { /* fail closed */ }
    if (!allowed) throw new CanvasStateError(403, 'ORIGIN_FORBIDDEN', 'Cross-origin Provider requests are forbidden');
  }
  // A proxy in front of loopback is not an authenticated provider gateway.
  if (req.get('forwarded') || req.get('x-forwarded-for') || req.get('x-forwarded-host')) throw new CanvasStateError(403, 'PROVIDER_LOCAL_ONLY', 'Forwarded requests are not allowed in development mode');
}
interface ProviderResponse {
  protocolVersion: '1.0'; actionId: string; providerInstanceId: string;
  revision: number; summary: string; data: Record<string, unknown>;
}
/** Reversible projection: the empty canvas has core revision zero, but MA
 * requires positive safe integers. Never invent a second revision counter. */
const providerRevision = (canvasRevision: number): number => {
  const value = canvasRevision + 1;
  if (!Number.isSafeInteger(value) || value <= 0) throw new CanvasStateError(500, 'PROVIDER_INVALID_REVISION', 'Invalid stored revision');
  return value;
};

/** Provider identity is NOT a direct project-id alias. Mapping is persistent in
 * registry metadata and namespaced by tenant + registered application + pid.
 * Operations reuse the service's real CAS and durable receipt journal, including
 * races with UI/COI writes. No second canvas state or receipt store is created.
 * Rename/delete are deliberately unavailable until registry CAS is supported.
 */
export function registerCanvasProviderRoutes(app: Express, deps: RegisterCanvasProviderRoutesDeps): void {
  const lock = new ProjectSerialLock();
  app.post('/open-platform/v1/instances/:providerInstanceId/actions/:actionId', async (req, res) => {
    try {
      const verified=deps.verifiedActor?.(req);
      if(!verified)requireLocal(req, deps.providerLocalDevelopment);
      const body = envelope(req);
      if(verified&&(body.actor.tenantId!==verified.teamId||body.actor.userId!==verified.userId||body.applicationId!==verified.applicationId||body.applicationInstanceId!==verified.applicationInstanceId||body.providerInstanceId!==verified.providerInstanceId||body.bizId!==verified.bizId))throw new CanvasStateError(403,'PROVIDER_ACTOR_MISMATCH','Provider envelope does not match verified MA identity and instance');
      if (!actions.has(body.actionId)) throw new CanvasStateError(404, 'PROVIDER_ACTION_NOT_FOUND', 'Unknown canvas Provider action');
      if (body.actionId === 'canvas.operations') {
        if (body.expectedRevision === undefined) return bad('canvas.operations requires expectedRevision from canvas.read');
        if (!Array.isArray(body.input.operations)) return bad('input.operations must be an array');
        if (Object.keys(body.input).some(key => key !== 'operations')) return bad('canvas.operations only accepts input.operations; operationId/baseRevision are Provider-owned');
      }
      const tenant: TenantContext = verified??{ teamId: body.actor.tenantId, userId: body.actor.userId };
      // Header/body ambiguity is rejected, rather than silently choosing an actor.
      if ((req.get('x-team-id') && req.get('x-team-id') !== tenant.teamId) || (req.get('x-user-id') && req.get('x-user-id') !== tenant.userId)) throw new CanvasStateError(403, 'PROVIDER_ACTOR_MISMATCH', 'Actor and local identity headers disagree');
      req.headers['x-team-id'] = tenant.teamId; req.headers['x-user-id'] = tenant.userId;
      const canonicalId = canvasProviderProjectId(tenant.teamId, body.applicationId, body.providerInstanceId);
      const legacyId = legacyCanvasProviderProjectId(tenant.teamId, body.applicationId, body.providerInstanceId);
      const readOnly = body.actionId === 'canvas.read' || body.actionId === 'canvas.context';
      const response = await runWithRequestTenant(tenant, () => lock.run(canonicalId, async () => {
        // Resolve before authorizing: an existing compact mapping wins; else an
        // existing legacy full-digest mapping is reused under the same full
        // validation; else the compact id is the create target. A read never
        // creates, nothing is migrated, and no other pid is aliased.
        let project = deps.registry.get(canonicalId) ?? deps.registry.get(legacyId);
        const projectId = project?.id ?? canonicalId;
        // Existing authorizer must explicitly recognize the Provider create path.
        // Never create a project before it has accepted the request.
        if (!await deps.authorizeProjectRequest(req, res, projectId, { mode: readOnly ? 'read' : 'write', ...(!readOnly ? { capability: 'writeFiles' } : {}) })) {
          if (!res.headersSent) res.status(403).json({ error: { code: 'PROVIDER_FORBIDDEN', message: 'Project authorization denied' } });
          return undefined;
        }
        if (!project && body.actionId !== 'canvas.create') throw new CanvasStateError(404, 'PROVIDER_INSTANCE_NOT_FOUND', 'Provider instance not found');
        const mapping = { protocolVersion: '1.0', applicationId: body.applicationId, providerInstanceId: body.providerInstanceId, tenantId: tenant.teamId };
        if (project) {
          const metadata = project.metadata as (ProjectMetadata & { canvasProvider?: unknown }) | undefined;
          if (project.teamId !== tenant.teamId || canonical(metadata?.canvasProvider) !== canonical(mapping)) throw new CanvasStateError(403, 'PROVIDER_MAPPING_FORBIDDEN', 'Project is not owned by this Provider mapping');
          if (project.archivedAt && !readOnly) throw new CanvasStateError(409, 'CANVAS_ARCHIVED', 'Archived canvas is read-only');
        } else {
          if (body.expectedRevision !== undefined) throw new CanvasStateError(409, 'PROVIDER_REVISION_CONFLICT', 'A new instance has no previous revision');
          const name = body.input.name === undefined ? '新画布' : text(body.input.name, 'input.name');
          const metadata: ProjectMetadata & { canvasProvider: typeof mapping; canvasProviderCreation: Record<string, unknown> } = {
            kind: 'other', canvasProvider: mapping,
            canvasProviderCreation: { applicationVersion: body.applicationVersion, applicationInstanceId: body.applicationInstanceId, bizId: body.bizId, sessionId: body.sessionId, requestId: body.requestId, idempotencyKey: body.idempotencyKey },
          };
          project = deps.registry.create({ id: projectId, name, teamId: tenant.teamId, createdBy: tenant.userId, metadata });
        }
        // A cloud registry schedules the mapping write asynchronously; a create
        // ack — fresh or replayed — claims that mapping is durable, so the
        // flush barrier runs before the new instance is read or acknowledged.
        // A still-pending or failed earlier write surfaces here as 5xx instead
        // of faking success.
        if (body.actionId === 'canvas.create') await deps.registry.flush?.();
        const respond = (revision: number, summary: string, data: Record<string, unknown>): ProviderResponse => ({ protocolVersion: '1.0', actionId: body.actionId, providerInstanceId: body.providerInstanceId, revision: providerRevision(revision), summary: summary.slice(0, 2000), data: { canvasInstanceId: projectId, ...data } });
        if (body.actionId === 'canvas.operations') {
          // Scope by project and actor: a reused key cannot replay across tenants,
          // applications, provider instances, or users. Core checks replay BEFORE CAS.
          const operationId = `ma-${digest([projectId, tenant.userId, body.idempotencyKey])}`;
          const applied = await deps.canvasState.applyOperations(projectId, { operationId, baseRevision: body.expectedRevision! - 1, operations: body.input.operations });
          // Replays return the OLD receipt, not today's revision or state.
          return respond(applied.receipt.revision, '画布操作已应用', { receipt: applied.receipt });
        }
        if (body.actionId === 'canvas.context') {
          const context = await deps.canvasState.context(projectId);
          if (body.expectedRevision !== undefined && body.expectedRevision !== providerRevision(context.revision)) throw new CanvasStateError(409, 'PROVIDER_REVISION_CONFLICT', 'Canvas revision changed', { actualRevision: providerRevision(context.revision) });
          return respond(context.revision, `画布「${project.name}」上下文`, { context });
        }
        const current = await deps.canvasState.read(projectId);
        if (body.actionId === 'canvas.read') {
          if (body.expectedRevision !== undefined && body.expectedRevision !== providerRevision(current.revision)) throw new CanvasStateError(409, 'PROVIDER_REVISION_CONFLICT', 'Canvas revision changed', { actualRevision: providerRevision(current.revision) });
          return respond(current.revision, `画布「${project.name}」已读取`, { state: current.state, name: project.name, archived: Boolean(project.archivedAt) });
        }
        // Create is idempotent by pid, including fresh keys after edits. Metadata
        // and the original name are retained; no supplied state is ever adopted.
        return respond(current.revision, `画布「${project.name}」已创建`, { name: project.name });
      }));
      if (response && !res.headersSent) res.json(response);
    } catch (error) {
      if (res.headersSent) return;
      const failure = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'PROVIDER_STORAGE_ERROR', 'Provider storage operation failed');
      const code = failure.code === 'CANVAS_REVISION_CONFLICT' ? 'PROVIDER_REVISION_CONFLICT' : failure.code === 'CANVAS_OPERATION_ID_CONFLICT' ? 'PROVIDER_IDEMPOTENCY_CONFLICT' : failure.code;
      const details = failure.details ? { ...failure.details } : undefined;
      if (code === 'PROVIDER_REVISION_CONFLICT' && failure.code === 'CANVAS_REVISION_CONFLICT' && details && typeof details.actualRevision === 'number') details.actualRevision = providerRevision(details.actualRevision);
      res.status(failure.status).json({ error: { code, message: failure.message, ...(details ? { details } : {}) } });
    }
  });
  // No anonymous GET snapshot endpoint: use identity- and project-gated canvas.read.
}
