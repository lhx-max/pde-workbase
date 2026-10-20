import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../storage/database.js';
import { parseWorkflowReport } from '@bezier/contracts';
import { executionSnapshotIdentity } from '../workflows/execution-snapshot.js';
import type {
  WorkflowResultArtifact,
  WorkflowResultInteractionRequest,
  WorkflowResultInteractionResponse,
} from '@bezier/contracts';

export interface WorkflowResultAdapterContext {
  artifact: WorkflowResultArtifact;
  request: WorkflowResultInteractionRequest;
  interactionId: string;
}

export type WorkflowResultAdapter = (
  context: WorkflowResultAdapterContext,
) => Promise<Omit<WorkflowResultInteractionResponse, 'resultId' | 'interactionId'>>;

interface RawArtifact {
  artifactJson: string;
  adapterId: string;
}

/** Older generic reports predate the edit action; preserve their data/version while exposing the current contract. */
function readArtifact(row: RawArtifact): WorkflowResultArtifact {
  const artifact = JSON.parse(row.artifactJson) as WorkflowResultArtifact;
  if (row.adapterId === 'workflow.generic' && artifact.surfaces?.includes('canvas')
    && artifact.items?.some(item => item.data && typeof item.data === 'object' && !Array.isArray(item.data) && parseWorkflowReport(item.data.report))
    && !artifact.actions.some(action => action.id === 'edit-report')) {
    artifact.actions.push({ id: 'edit-report', capability: 'edit', label: '保存方案', completion: 'keep-active' });
    if (!artifact.capabilities.includes('edit')) artifact.capabilities.push('edit');
  }
  return artifact;
}

interface RawInteraction {
  id: string;
  requestDigest: string;
  responseJson: string | null;
  errorJson: string | null;
  status: 'accepted' | 'completed' | 'failed';
}

export class WorkflowResultService {
  private readonly adapters = new Map<string, WorkflowResultAdapter>();
  private readonly activeInteractions = new Set<string>();

  constructor(private readonly db: Database) {}

  registerAdapter(id: string, adapter: WorkflowResultAdapter): void {
    if (!/^[a-z][a-z0-9.-]+$/.test(id)) throw new Error(`Invalid workflow result adapter id: ${id}`);
    if (this.adapters.has(id)) throw new Error(`Duplicate workflow result adapter: ${id}`);
    this.adapters.set(id, adapter);
  }

  publish(input: {
    artifact: WorkflowResultArtifact;
    adapterId: string;
    now?: number;
  }): WorkflowResultArtifact {
    if (!this.adapters.has(input.adapterId)) {
      throw new Error(`Workflow result adapter is not registered: ${input.adapterId}`);
    }
    const now = input.now ?? Date.now();
    const artifactJson = JSON.stringify(input.artifact);
    this.db.transaction(() => {
      const existing = this.db.prepare(
        `SELECT workflow_run_id AS workflowRunId,
                result_definition_id AS resultDefinitionId,
                version
           FROM workflow_result_artifacts
          WHERE id = ?`,
      ).get(input.artifact.id) as {
        workflowRunId: string;
        resultDefinitionId: string;
        version: number;
      } | undefined;
      if (
        existing
        && (
          existing.workflowRunId !== input.artifact.workflowRunId
          || existing.resultDefinitionId !== input.artifact.resultDefinitionId
        )
      ) {
        throw new Error(`Workflow result identity collision: ${input.artifact.id}`);
      }
      if (existing && input.artifact.version <= existing.version) {
        throw new Error(`Workflow result version must increase: ${input.artifact.id}`);
      }
      this.db.prepare(
        `INSERT INTO workflow_result_artifacts
           (id, workflow_run_id, result_definition_id, source_step_run_id, project_id,
            version, adapter_id, artifact_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_step_run_id = excluded.source_step_run_id,
           project_id = excluded.project_id,
           version = excluded.version,
           adapter_id = excluded.adapter_id,
           artifact_json = excluded.artifact_json,
           updated_at = excluded.updated_at`,
      ).run(
        input.artifact.id,
        input.artifact.workflowRunId,
        input.artifact.resultDefinitionId,
        input.artifact.sourceStepRunId,
        input.artifact.projectId,
        input.artifact.version,
        input.adapterId,
        artifactJson,
        now,
        now,
      );
      this.db.prepare(
        `INSERT INTO workflow_result_artifact_versions
           (result_id, version, artifact_json, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(input.artifact.id, input.artifact.version, artifactJson, now);
    }).immediate();
    return input.artifact;
  }

  get(resultId: string): { artifact: WorkflowResultArtifact; adapterId: string } | null {
    const row = this.db.prepare(
      `SELECT artifact_json AS artifactJson, adapter_id AS adapterId
         FROM workflow_result_artifacts WHERE id = ?`,
    ).get(resultId) as RawArtifact | undefined;
    return row
      ? { artifact: readArtifact(row), adapterId: row.adapterId }
      : null;
  }

  list(input: {
    projectId: string;
    workflowRunId?: string;
  }): WorkflowResultArtifact[] {
    const rows = input.workflowRunId
      ? this.db.prepare(
          `SELECT artifact_json AS artifactJson, adapter_id AS adapterId
             FROM workflow_result_artifacts
            WHERE project_id = ? AND workflow_run_id = ?
            ORDER BY created_at ASC, id ASC`,
        ).all(input.projectId, input.workflowRunId)
      : this.db.prepare(
          `SELECT artifact_json AS artifactJson, adapter_id AS adapterId
             FROM workflow_result_artifacts
            WHERE project_id = ?
            ORDER BY created_at ASC, id ASC`,
        ).all(input.projectId);
    return (rows as RawArtifact[]).map(readArtifact);
  }

  async interact(request: WorkflowResultInteractionRequest): Promise<WorkflowResultInteractionResponse> {
    const stored = this.get(request.resultId);
    if (!stored) throw new WorkflowResultError(404, 'WORKFLOW_RESULT_NOT_FOUND', 'Result not found');
    if (!request.idempotencyKey.trim()) {
      throw new WorkflowResultError(400, 'WORKFLOW_RESULT_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key is required');
    }
    const requestDigest = digestRequest(request);
    let replay = this.db.prepare(
      `SELECT id, request_digest AS requestDigest, response_json AS responseJson,
              error_json AS errorJson, status
         FROM workflow_result_interactions
        WHERE result_id = ? AND idempotency_key = ?`,
    ).get(request.resultId, request.idempotencyKey) as RawInteraction | undefined;
    if (!replay && stored.adapterId === 'workflow.generic') {
      replay = this.db.prepare(`SELECT id, request_digest AS requestDigest, response_json AS responseJson,
        error_json AS errorJson, status FROM workflow_result_interactions WHERE result_id = ? AND request_digest = ? ORDER BY created_at DESC LIMIT 1`)
        .get(request.resultId, requestDigest) as RawInteraction | undefined;
    }
    if (replay) {
      if (replay.requestDigest !== requestDigest) {
        throw new WorkflowResultError(
          409,
          'WORKFLOW_RESULT_IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different request',
        );
      }
      if (replay.responseJson) {
        return JSON.parse(replay.responseJson) as WorkflowResultInteractionResponse;
      }
      if (replay.status === 'failed' && stored.adapterId !== 'workflow.generic') {
        const error = parseStoredError(replay.errorJson);
        throw new WorkflowResultError(error.status, error.code, error.message, error.details);
      }
      if (stored.adapterId !== 'workflow.generic' || this.activeInteractions.has(replay.id)) {
        throw new WorkflowResultError(409, 'WORKFLOW_RESULT_INTERACTION_PENDING', 'Interaction is already running');
      }
    }
    if (request.expectedVersion !== stored.artifact.version) {
      throw new WorkflowResultError(409, 'WORKFLOW_RESULT_VERSION_CONFLICT', 'Result has changed', {
        expectedVersion: request.expectedVersion,
        actualVersion: stored.artifact.version,
      });
    }
    const interactionArtifact: WorkflowResultArtifact = { ...stored.artifact };
    const hasChatContract = stored.artifact.chatSelection !== undefined
      || stored.artifact.chatActions !== undefined
      || stored.artifact.chatFeedback !== undefined;
    if (request.surface === 'chat' && hasChatContract) {
      interactionArtifact.actions = stored.artifact.chatActions ?? [];
      if (stored.artifact.chatSelection) interactionArtifact.selection = stored.artifact.chatSelection;
      else delete interactionArtifact.selection;
      if (stored.artifact.chatFeedback) interactionArtifact.feedback = stored.artifact.chatFeedback;
      else delete interactionArtifact.feedback;
    }
    const action = interactionArtifact.actions.find((item) => item.id === request.actionId);
    if (!action) throw new WorkflowResultError(400, 'WORKFLOW_RESULT_ACTION_INVALID', 'Action is not available');
    validateInteraction(interactionArtifact, action.id, request);

    const adapter = this.adapters.get(stored.adapterId);
    if (!adapter) throw new WorkflowResultError(500, 'WORKFLOW_RESULT_ADAPTER_MISSING', 'Result adapter is unavailable');
    const interactionId = replay?.id ?? randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT OR IGNORE INTO workflow_result_interactions
         (id, result_id, action_id, expected_version, idempotency_key, request_digest,
          request_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    ).run(
      interactionId,
      request.resultId,
      request.actionId,
      request.expectedVersion,
      request.idempotencyKey,
      requestDigest,
      JSON.stringify({ ...request, ...(request.execution ? { execution: executionSnapshotIdentity(request.execution) } : {}) }),
      now,
      now,
    );
    this.activeInteractions.add(interactionId);
    try {
      const result = await adapter({ artifact: stored.artifact, request, interactionId });
      const response: WorkflowResultInteractionResponse = {
        ...result,
        ok: result.ok !== false,
        resultId: request.resultId,
        interactionId,
      };
      this.db.prepare(
        `UPDATE workflow_result_interactions
            SET status = ?, response_json = ?, updated_at = ? WHERE id = ?`,
      ).run(response.state, JSON.stringify(response), Date.now(), interactionId);
      // Regeneration produces a new result identity when the Agent finishes.
      // The source card is an immutable historical output: do not overwrite
      // its selection, feedback or state just because it started a child run.
      if (action.capability !== 'regenerate') {
        const nextState = action.completion === 'keep-active'
          ? 'active'
          : action.completion === 'lock-card'
            ? 'locked'
            : response.state === 'completed'
              ? 'completed'
              : stored.artifact.state ?? 'active';
        const nextArtifact: WorkflowResultArtifact = {
          // An edit adapter may publish a newer content version during this interaction.
          ...(action.capability === 'edit' ? this.get(request.resultId)?.artifact ?? stored.artifact : stored.artifact),
          state: nextState,
          selectedIds: request.selectedIds ?? [],
          feedbackValue: request.feedback ?? '',
        };
        this.db.prepare(
          `UPDATE workflow_result_artifacts
              SET artifact_json = ?, updated_at = ? WHERE id = ?`,
        ).run(JSON.stringify(nextArtifact), Date.now(), request.resultId);
      }
      return response;
    } catch (error) {
      const storedError = normalizeStoredError(error);
      this.db.prepare(
        `UPDATE workflow_result_interactions
            SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?`,
      ).run(JSON.stringify(storedError), Date.now(), interactionId);
      throw error;
    } finally { this.activeInteractions.delete(interactionId); }
  }
}

export class WorkflowResultError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function validateInteraction(
  artifact: WorkflowResultArtifact,
  actionId: string,
  request: WorkflowResultInteractionRequest,
): void {
  const action = artifact.actions.find((item) => item.id === actionId)!;
  const selectedIds = request.selectedIds ?? [];
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_SELECTION_INVALID', 'Selection contains duplicate items');
  }
  const availableIds = new Set((artifact.items ?? []).map((item) => item.id));
  if (selectedIds.some((id) => !availableIds.has(id))) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_SELECTION_INVALID', 'Selection contains an unknown item');
  }
  const count = selectedIds.length;
  if (artifact.selection?.mode === 'single' && count > 1) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_SELECTION_INVALID', 'Only one item can be selected');
  }
  if (artifact.selection?.mode === 'none' && count > 0) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_SELECTION_INVALID', 'This result does not accept selection');
  }
  if (artifact.selection?.max !== undefined && count > artifact.selection.max) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_SELECTION_INVALID', 'Too many items selected');
  }
  const hasFeedback = Boolean(request.feedback?.trim());
  if (action.when?.minSelection !== undefined && count < action.when.minSelection) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_ACTION_CONDITION', 'Not enough items selected');
  }
  if (action.when?.maxSelection !== undefined && count > action.when.maxSelection) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_ACTION_CONDITION', 'Too many items selected for this action');
  }
  if (action.when?.feedback === 'present' && !hasFeedback) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_ACTION_CONDITION', 'Feedback is required');
  }
  if (action.when?.feedback === 'empty' && hasFeedback) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_ACTION_CONDITION', 'Feedback is not accepted by this action');
  }
  if (artifact.feedback?.required && !hasFeedback) {
    throw new WorkflowResultError(400, 'WORKFLOW_RESULT_FEEDBACK_REQUIRED', 'Feedback is required');
  }
}

function digestRequest(request: WorkflowResultInteractionRequest): string {
  return createHash('sha256').update(JSON.stringify({
    resultId: request.resultId,
    actionId: request.actionId,
    expectedVersion: request.expectedVersion,
    selectedIds: request.selectedIds ?? [],
    feedback: request.feedback ?? '',
    surface: request.surface ?? 'canvas',
    // 编辑入参也要进摘要：否则同一个 idempotencyKey 配不同的字段改动会被当成
    // 重放直接返回上一次的响应，第二次改动静默丢失。
    itemId: request.itemId ?? '',
    patch: request.patch ?? {},
    ...(request.execution ? { execution: executionSnapshotIdentity(request.execution) } : {}),
  })).digest('hex');
}

function normalizeStoredError(error: unknown): {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof WorkflowResultError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    status: 500,
    code: 'WORKFLOW_RESULT_ADAPTER_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

function parseStoredError(value: string | null): ReturnType<typeof normalizeStoredError> {
  if (!value) return {
    status: 500,
    code: 'WORKFLOW_RESULT_ADAPTER_ERROR',
    message: 'Workflow result interaction failed',
  };
  try {
    return JSON.parse(value) as ReturnType<typeof normalizeStoredError>;
  } catch {
    return {
      status: 500,
      code: 'WORKFLOW_RESULT_ADAPTER_ERROR',
      message: 'Workflow result interaction failed',
    };
  }
}
