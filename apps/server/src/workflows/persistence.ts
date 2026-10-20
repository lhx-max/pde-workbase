import { randomUUID } from 'node:crypto';
import type { Database } from '../storage/database.js';
import type {
  JsonValue,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowStepRunStatus,
} from '@bezier/contracts';

interface RawRun {
  id: string;
  businessKey: string | null;
  workflowId: string;
  definitionVersion: string;
  definitionDigest: string;
  projectId: string;
  status: WorkflowRunStatus;
  inputJson: string;
  inputVersionJson: string | null;
  variablesJson: string;
  terminationJson: string | null;
  createdAt: number;
  updatedAt: number;
}

interface RawStepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  sequence: number;
  iteration: number;
  attempt: number;
  status: WorkflowStepRunStatus;
  inputJson: string;
  inputSnapshotJson: string | null;
  outputJson: string | null;
  childRunId: string | null;
  interactionId: string | null;
  wakeAt: number | null;
  selectedRouteJson: string | null;
  artifactRefsJson: string;
  errorJson: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface WorkflowRunSnapshot {
  run: WorkflowRun;
  definition: WorkflowDefinition;
  steps: WorkflowStepRun[];
}

export interface WorkflowRunBinding {
  workflowRunId: string;
  taskRunId: string;
  businessKey: string;
  role: string;
  createdAt: number;
}

export function migrateWorkflows(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_execution_owners (
      run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL, headers_json TEXT NOT NULL, error TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_execution_steps (
      step_run_id TEXT PRIMARY KEY REFERENCES workflow_step_runs(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      request_json TEXT NOT NULL, child_run_id TEXT, settled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS workflow_execution_actions (
      action_key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      response_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_start_requests (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      PRIMARY KEY(project_id, request_id)
    );
    -- Editable definitions live separately from immutable run snapshots.  A
    -- published run must keep its original definition even after its canvas is
    -- changed, which is why this is intentionally not folded into
    -- workflow_definitions below.
    CREATE TABLE IF NOT EXISTS workflow_graph_configs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      digest TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      definition_version TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(workflow_id, definition_version, digest)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      business_key TEXT,
      workflow_id TEXT NOT NULL,
      definition_version TEXT NOT NULL,
      definition_digest TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN
        ('pending','running','awaiting-input','waiting','succeeded',
         'terminated','failed','cancelled')),
      input_json TEXT NOT NULL,
      variables_json TEXT NOT NULL DEFAULT '{}',
      termination_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(definition_digest) REFERENCES workflow_definitions(digest)
    );

    CREATE TABLE IF NOT EXISTS workflow_step_runs (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      iteration INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN
        ('pending','blocked','running','awaiting-input','waiting',
         'succeeded','failed','skipped','cancelled')),
      input_json TEXT NOT NULL,
      output_json TEXT,
      child_run_id TEXT,
      interaction_id TEXT,
      wake_at INTEGER,
      selected_route_json TEXT,
      artifact_refs_json TEXT NOT NULL DEFAULT '[]',
      error_json TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workflow_run_id, step_id, iteration, attempt),
      FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_run_id TEXT NOT NULL,
      step_run_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(step_run_id) REFERENCES workflow_step_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
      ON workflow_runs(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
      ON workflow_runs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_claim
      ON workflow_step_runs(workflow_run_id, status, sequence);
    CREATE INDEX IF NOT EXISTS idx_workflow_events_run
      ON workflow_events(workflow_run_id, id);

    CREATE TABLE IF NOT EXISTS workflow_run_task_runs (
      workflow_run_id TEXT NOT NULL,
      task_run_id TEXT NOT NULL UNIQUE,
      business_key TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(workflow_run_id, task_run_id),
      FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_signals (
      workflow_run_id TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(workflow_run_id, signal_type, idempotency_key),
      FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_result_artifacts (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      result_definition_id TEXT NOT NULL,
      source_step_run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      adapter_id TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(source_step_run_id) REFERENCES workflow_step_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_result_artifact_versions (
      result_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      artifact_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(result_id, version),
      FOREIGN KEY(result_id) REFERENCES workflow_result_artifacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_result_interactions (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      expected_version INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT,
      error_json TEXT,
      status TEXT NOT NULL CHECK (status IN ('accepted','completed','failed')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(result_id, idempotency_key),
      FOREIGN KEY(result_id) REFERENCES workflow_result_artifacts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_results_project
      ON workflow_result_artifacts(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_result_interactions_result
      ON workflow_result_interactions(result_id, created_at);
  `);
  const stepColumns = db.prepare('PRAGMA table_info(workflow_step_runs)').all() as Array<{ name: string }>;
  if (!stepColumns.some(column => column.name === 'input_snapshot_json')) {
    db.exec('ALTER TABLE workflow_step_runs ADD COLUMN input_snapshot_json TEXT');
  }
  migrateAppendOnlyWorkflowResults(db);
  const resultInteractionColumns = db.prepare(
    `PRAGMA table_info(workflow_result_interactions)`,
  ).all() as Array<{ name: string }>;
  if (!resultInteractionColumns.some((column) => column.name === 'request_digest')) {
    db.exec(`ALTER TABLE workflow_result_interactions ADD COLUMN request_digest TEXT NOT NULL DEFAULT ''`);
  }
  if (!resultInteractionColumns.some((column) => column.name === 'error_json')) {
    db.exec(`ALTER TABLE workflow_result_interactions ADD COLUMN error_json TEXT`);
  }
  const columns = db.prepare(`PRAGMA table_info(workflow_runs)`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'input_version_json')) db.exec('ALTER TABLE workflow_runs ADD COLUMN input_version_json TEXT');
  if (!columns.some((column) => column.name === 'business_key')) {
    db.exec(`ALTER TABLE workflow_runs ADD COLUMN business_key TEXT`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_business_key
      ON workflow_runs(project_id, business_key)
      WHERE business_key IS NOT NULL
  `);
}

/**
 * Older databases enforced one result per workflow node. Result history is an
 * append-only stream now, so remove that table-level uniqueness constraint
 * while preserving every existing artifact and all child foreign keys.
 */
function migrateAppendOnlyWorkflowResults(db: Database): void {
  const table = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workflow_result_artifacts'`,
  ).get() as { sql?: string } | undefined;
  if (!table?.sql?.includes('UNIQUE(workflow_run_id, result_definition_id)')) return;

  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE workflow_result_artifacts RENAME TO workflow_result_artifacts_legacy;
        CREATE TABLE workflow_result_artifacts (
          id TEXT PRIMARY KEY,
          workflow_run_id TEXT NOT NULL,
          result_definition_id TEXT NOT NULL,
          source_step_run_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          adapter_id TEXT NOT NULL,
          artifact_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(source_step_run_id) REFERENCES workflow_step_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        INSERT INTO workflow_result_artifacts
          (id, workflow_run_id, result_definition_id, source_step_run_id, project_id,
           version, adapter_id, artifact_json, created_at, updated_at)
        SELECT id, workflow_run_id, result_definition_id, source_step_run_id, project_id,
               version, adapter_id, artifact_json, created_at, updated_at
          FROM workflow_result_artifacts_legacy;
        DROP TABLE workflow_result_artifacts_legacy;
        CREATE INDEX IF NOT EXISTS idx_workflow_results_project
          ON workflow_result_artifacts(project_id, updated_at DESC);
      `);
    }).immediate();
  } finally {
    db.pragma('legacy_alter_table = OFF');
    if (foreignKeys) db.pragma('foreign_keys = ON');
  }
}

export function createWorkflowRun(
  db: Database,
  input: {
    projectId: string;
    definition: WorkflowDefinition;
    value: JsonValue;
    variables?: Record<string, JsonValue>;
    now?: number;
    runId?: string;
    businessKey?: string;
  },
): WorkflowRunSnapshot {
  const doctor = input.definition.steps.length > 0;
  if (!doctor) throw new Error('Cannot create a run for an empty workflow');
  const now = input.now ?? Date.now();
  const runId = input.runId ?? randomUUID();
  const variables = input.variables ?? (
    isJsonObject(input.value) ? input.value : {}
  );

  db.transaction(() => {
    const definitionJson = JSON.stringify(input.definition);
    const existing = db.prepare(
      `SELECT definition_json AS definitionJson
         FROM workflow_definitions WHERE digest = ?`,
    ).get(input.definition.digest) as { definitionJson: string } | undefined;
    if (existing && existing.definitionJson !== definitionJson) {
      throw new Error(`Workflow digest collision: ${input.definition.digest}`);
    }
    db.prepare(
      `INSERT OR IGNORE INTO workflow_definitions
         (digest, workflow_id, definition_version, definition_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      input.definition.digest,
      input.definition.id,
      input.definition.version,
      definitionJson,
      now,
    );
    db.prepare(
      `INSERT INTO workflow_runs
         (id, business_key, workflow_id, definition_version, definition_digest, project_id,
          status, input_json, variables_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).run(
      runId,
      input.businessKey ?? null,
      input.definition.id,
      input.definition.version,
      input.definition.digest,
      input.projectId,
      JSON.stringify(input.value),
      JSON.stringify(variables),
      now,
      now,
    );

    const insertStep = db.prepare(
      `INSERT INTO workflow_step_runs
         (id, workflow_run_id, step_id, sequence, iteration, attempt, status,
          input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    );
    const stepIndexes = new Map(
      input.definition.steps.map((step, index) => [step.id, index]),
    );
    const routeTargets = new Set(
      input.definition.steps.flatMap((step, sourceIndex) =>
        (step.routes ?? [])
          .filter((route) => (stepIndexes.get(route.to) ?? -1) > sourceIndex)
          .map((route) => route.to)),
    );
    for (const [index, step] of input.definition.steps.entries()) {
      insertStep.run(
        randomUUID(),
        runId,
        step.id,
        index + 1,
        step.dependsOn.length === 0 && !routeTargets.has(step.id) ? 'pending' : 'blocked',
        JSON.stringify(input.value),
        now,
        now,
      );
    }
    appendWorkflowEvent(db, runId, null, 'run.created', {
      definitionDigest: input.definition.digest,
    }, now);
  })();

  return requireWorkflowRun(db, runId);
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getWorkflowRun(
  db: Database,
  runId: string,
): WorkflowRunSnapshot | null {
  if (!db.inTransaction) {
    return db.transaction(() => getWorkflowRun(db, runId)).deferred() as WorkflowRunSnapshot | null;
  }
  const raw = db.prepare(
    `SELECT id, business_key AS businessKey, workflow_id AS workflowId,
            definition_version AS definitionVersion,
            definition_digest AS definitionDigest,
            project_id AS projectId, status, input_json AS inputJson,
            input_version_json AS inputVersionJson, variables_json AS variablesJson,
            termination_json AS terminationJson,
            created_at AS createdAt, updated_at AS updatedAt
       FROM workflow_runs WHERE id = ?`,
  ).get(runId) as RawRun | undefined;
  if (!raw) return null;
  const definitionRow = db.prepare(
    `SELECT definition_json AS definitionJson
       FROM workflow_definitions WHERE digest = ?`,
  ).get(raw.definitionDigest) as { definitionJson: string } | undefined;
  if (!definitionRow) throw new Error(`Missing workflow definition: ${raw.definitionDigest}`);
  const steps = db.prepare(
    `SELECT id, workflow_run_id AS workflowRunId, step_id AS stepId,
            sequence, iteration, attempt, status, input_json AS inputJson, input_snapshot_json AS inputSnapshotJson,
            output_json AS outputJson, child_run_id AS childRunId,
            interaction_id AS interactionId, wake_at AS wakeAt,
            selected_route_json AS selectedRouteJson,
            artifact_refs_json AS artifactRefsJson, error_json AS errorJson,
            started_at AS startedAt, finished_at AS finishedAt
       FROM workflow_step_runs
      WHERE workflow_run_id = ?
      ORDER BY sequence, iteration, attempt`,
  ).all(runId) as RawStepRun[];
  return {
    run: normalizeRun(raw),
    definition: JSON.parse(definitionRow.definitionJson) as WorkflowDefinition,
    steps: steps.map(normalizeStepRun),
  };
}

export function getWorkflowRunByBusinessKey(
  db: Database,
  projectId: string,
  businessKey: string,
): WorkflowRunSnapshot | null {
  const row = db.prepare(
    `SELECT id FROM workflow_runs WHERE project_id = ? AND business_key = ?`,
  ).get(projectId, businessKey) as { id: string } | undefined;
  return row ? getWorkflowRun(db, row.id) : null;
}

export function bindWorkflowTaskRun(
  db: Database,
  input: Omit<WorkflowRunBinding, 'createdAt'> & { now?: number },
): WorkflowRunBinding {
  const snapshot = requireWorkflowRun(db, input.workflowRunId);
  if (snapshot.run.businessKey !== input.businessKey) {
    throw new Error('Workflow business key mismatch');
  }
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO workflow_run_task_runs
       (workflow_run_id, task_run_id, business_key, role, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.workflowRunId, input.taskRunId, input.businessKey, input.role, now);
  const row = db.prepare(
    `SELECT workflow_run_id AS workflowRunId, task_run_id AS taskRunId,
            business_key AS businessKey, role, created_at AS createdAt
       FROM workflow_run_task_runs WHERE task_run_id = ?`,
  ).get(input.taskRunId) as WorkflowRunBinding | undefined;
  if (!row
    || row.workflowRunId !== input.workflowRunId
    || row.businessKey !== input.businessKey
    || row.role !== input.role) {
    throw new Error('Task run is already bound to another workflow');
  }
  return row;
}

export function latestWorkflowTaskRun(
  db: Database,
  workflowRunId: string,
): WorkflowRunBinding | null {
  return (db.prepare(
    `SELECT workflow_run_id AS workflowRunId, task_run_id AS taskRunId,
            business_key AS businessKey, role, created_at AS createdAt
       FROM workflow_run_task_runs
      WHERE workflow_run_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(workflowRunId) as WorkflowRunBinding | undefined) ?? null;
}

export function recordWorkflowSignal(
  db: Database,
  input: {
    workflowRunId: string;
    signalType: string;
    idempotencyKey: string;
    payloadDigest: string;
    payload: JsonValue;
    now?: number;
  },
): 'created' | 'replayed' {
  const now = input.now ?? Date.now();
  const result = db.prepare(
    `INSERT OR IGNORE INTO workflow_signals
       (workflow_run_id, signal_type, idempotency_key, payload_digest, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.workflowRunId,
    input.signalType,
    input.idempotencyKey,
    input.payloadDigest,
    JSON.stringify(input.payload),
    now,
  );
  if (result.changes === 1) return 'created';
  const existing = db.prepare(
    `SELECT payload_digest AS payloadDigest FROM workflow_signals
      WHERE workflow_run_id = ? AND signal_type = ? AND idempotency_key = ?`,
  ).get(
    input.workflowRunId,
    input.signalType,
    input.idempotencyKey,
  ) as { payloadDigest: string } | undefined;
  if (existing?.payloadDigest !== input.payloadDigest) {
    throw new Error('Workflow signal idempotency conflict');
  }
  return 'replayed';
}

export function getWorkflowSignal(
  db: Database,
  workflowRunId: string,
  signalType: string,
): { idempotencyKey: string; payload: JsonValue; createdAt: number } | null {
  const row = db.prepare(
    `SELECT idempotency_key AS idempotencyKey, payload_json AS payloadJson,
            created_at AS createdAt
       FROM workflow_signals
      WHERE workflow_run_id = ? AND signal_type = ?
      ORDER BY created_at DESC LIMIT 1`,
  ).get(workflowRunId, signalType) as {
    idempotencyKey: string;
    payloadJson: string;
    createdAt: number;
  } | undefined;
  return row
    ? {
        idempotencyKey: row.idempotencyKey,
        payload: JSON.parse(row.payloadJson) as JsonValue,
        createdAt: row.createdAt,
      }
    : null;
}

export function requireWorkflowRun(
  db: Database,
  runId: string,
): WorkflowRunSnapshot {
  const snapshot = getWorkflowRun(db, runId);
  if (!snapshot) throw new Error(`Workflow run not found: ${runId}`);
  return snapshot;
}

export function appendWorkflowEvent(
  db: Database,
  runId: string,
  stepRunId: string | null,
  eventType: string,
  payload: JsonValue,
  now: number = Date.now(),
): void {
  db.prepare(
    `INSERT INTO workflow_events
       (workflow_run_id, step_run_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, stepRunId, eventType, JSON.stringify(payload), now);
}

export function reconcileWorkflowRuns(
  db: Database,
  now: number = Date.now(),
): number {
  return db.transaction(() => {
    const running = db.prepare(
      `SELECT id, workflow_run_id AS workflowRunId
         FROM workflow_step_runs WHERE status = 'running'
         AND NOT EXISTS (SELECT 1 FROM workflow_execution_owners WHERE run_id = workflow_run_id)`,
    ).all() as Array<{ id: string; workflowRunId: string }>;
    const error = JSON.stringify({
      code: 'DAEMON_RESTART',
      message: 'The daemon restarted while this step was running',
      retryable: false,
    });
    const finishStep = db.prepare(
      `UPDATE workflow_step_runs
          SET status = 'failed', error_json = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'`,
    );
    const failRun = db.prepare(
      `UPDATE workflow_runs
          SET status = 'failed', termination_json = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending','running','waiting','awaiting-input')`,
    );
    const termination = JSON.stringify({
      kind: 'system-error',
      code: 'DAEMON_RESTART',
      message: 'Execution stopped safely after daemon restart',
    });
    const affectedRuns = new Set<string>();
    for (const step of running) {
      if (finishStep.run(error, now, now, step.id).changes === 0) continue;
      affectedRuns.add(step.workflowRunId);
      appendWorkflowEvent(db, step.workflowRunId, step.id, 'step.interrupted', {}, now);
    }
    for (const runId of affectedRuns) {
      failRun.run(termination, now, runId);
      db.prepare(
        `UPDATE workflow_step_runs
            SET status = 'cancelled', finished_at = ?, updated_at = ?
          WHERE workflow_run_id = ?
            AND status IN ('pending','blocked','awaiting-input','waiting')`,
      ).run(now, now, runId);
      appendWorkflowEvent(db, runId, null, 'run.interrupted', {}, now);
    }
    return affectedRuns.size;
  })() as number;
}

export function listProjectWorkflowRunIds(db: Database, projectId: string): string[] {
  return (db.prepare('SELECT id FROM workflow_runs WHERE project_id = ? ORDER BY created_at, id').all(projectId) as Array<{ id: string }>).map(row => row.id);
}

export function listActiveWorkflowRunIds(db: Database): string[] {
  return (db.prepare(
    `SELECT id FROM workflow_runs
      WHERE status IN ('pending','running','awaiting-input','waiting')
      ORDER BY updated_at`,
  ).all() as Array<{ id: string }>).map((row) => row.id);
}

function normalizeRun(raw: RawRun): WorkflowRun {
  return {
    id: raw.id,
    ...(raw.businessKey ? { businessKey: raw.businessKey } : {}),
    workflowId: raw.workflowId,
    definitionVersion: raw.definitionVersion,
    definitionDigest: raw.definitionDigest,
    projectId: raw.projectId,
    status: raw.status,
    input: JSON.parse(raw.inputJson) as JsonValue,
    ...(raw.inputVersionJson ? { inputVersion: JSON.parse(raw.inputVersionJson) as JsonValue } : {}),
    variables: JSON.parse(raw.variablesJson) as Record<string, JsonValue>,
    createdAt: new Date(raw.createdAt).toISOString(),
    updatedAt: new Date(raw.updatedAt).toISOString(),
    ...(raw.terminationJson
      ? {
          termination: JSON.parse(raw.terminationJson) as NonNullable<
            WorkflowRun['termination']
          >,
        }
      : {}),
  };
}

function normalizeStepRun(raw: RawStepRun): WorkflowStepRun {
  return {
    id: raw.id,
    workflowRunId: raw.workflowRunId,
    stepId: raw.stepId,
    sequence: raw.sequence,
    iteration: raw.iteration,
    attempt: raw.attempt,
    status: raw.status,
    input: JSON.parse(raw.inputJson) as JsonValue,
    ...(raw.inputSnapshotJson ? { inputSnapshot: JSON.parse(raw.inputSnapshotJson) as NonNullable<WorkflowStepRun['inputSnapshot']> } : {}),
    ...(raw.outputJson ? { output: JSON.parse(raw.outputJson) as JsonValue } : {}),
    ...(raw.childRunId ? { childRunId: raw.childRunId } : {}),
    ...(raw.interactionId ? { interactionId: raw.interactionId } : {}),
    ...(raw.wakeAt !== null ? { wakeAt: new Date(raw.wakeAt).toISOString() } : {}),
    ...(raw.selectedRouteJson
      ? { selectedRoute: JSON.parse(raw.selectedRouteJson) as NonNullable<WorkflowStepRun['selectedRoute']> }
      : {}),
    artifactRefs: JSON.parse(raw.artifactRefsJson) as string[],
    ...(raw.errorJson
      ? { error: JSON.parse(raw.errorJson) as NonNullable<WorkflowStepRun['error']> }
      : {}),
    ...(raw.startedAt !== null ? { startedAt: new Date(raw.startedAt).toISOString() } : {}),
    ...(raw.finishedAt !== null ? { finishedAt: new Date(raw.finishedAt).toISOString() } : {}),
  };
}
