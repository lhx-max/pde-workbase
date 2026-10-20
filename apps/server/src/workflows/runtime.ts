import { activeInputParent, captureStepInput } from './input-snapshot.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../storage/database.js';
import {
  diagnoseWorkflowDefinition,
  type JsonValue,
  type WorkflowDefinition,
  type WorkflowStepRun,
} from '@bezier/contracts';
import {
  appendWorkflowEvent,
  createWorkflowRun,
  listActiveWorkflowRunIds,
  requireWorkflowRun,
  type WorkflowRunSnapshot,
} from './persistence.js';

const ACTIVE_RUN_STATUSES = new Set(['pending', 'running', 'awaiting-input', 'waiting']);
const SATISFIED_STEP_STATUSES = new Set(['succeeded', 'skipped']);
const PHASE_TWO_STEP_KINDS = new Set(['agent', 'action', 'eval', 'publish', 'terminate']);

export class WorkflowRuntime {
  constructor(private readonly db: Database) {}

  create(input: {
    projectId: string;
    definition: WorkflowDefinition;
    value: JsonValue;
    variables?: Record<string, JsonValue>;
    runId?: string;
    businessKey?: string;
    now?: number;
  }): WorkflowRunSnapshot {
    const doctor = diagnoseWorkflowDefinition(input.definition);
    if (!doctor.valid) {
      throw new Error(`Invalid workflow definition: ${doctor.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => item.code)
        .join(', ')}`);
    }
    if (input.definition.steps.length > input.definition.limits.maxStepRuns) {
      throw new Error('Workflow definition exceeds its step run budget');
    }
    const unsupportedKind = input.definition.steps.find(
      (step) => !PHASE_TWO_STEP_KINDS.has(step.kind),
    );
    if (unsupportedKind) {
      throw new Error(`Workflow step kind is not supported by this runtime: ${unsupportedKind.kind}`);
    }
    if (input.definition.limits.maxCost !== undefined) {
      throw new Error('Workflow cost budgets are not supported by this runtime');
    }
    const snapshot = createWorkflowRun(this.db, input);
    return this.advance(snapshot.run.id, input.now);
  }

  get(runId: string): WorkflowRunSnapshot {
    return requireWorkflowRun(this.db, runId);
  }

  ensureStepSucceeded(
    runId: string,
    stepId: string,
    input: {
      output: JsonValue;
      childRunId?: string;
      artifactRefs?: string[];
      now?: number;
    },
  ): WorkflowRunSnapshot {
    const snapshot = this.get(runId);
    const step = latestStepRuns(snapshot.steps).get(stepId);
    if (!step) throw new Error(`Workflow step definition not found: ${stepId}`);
    if (step.status === 'succeeded' || step.status === 'skipped') return snapshot;
    if (step.status !== 'pending' && step.status !== 'running') {
      throw new Error(`Workflow step cannot be completed: ${stepId} (${step.status})`);
    }
    if (step.status === 'pending') this.claim(runId, step.id, input.now);
    return this.complete(runId, step.id, input);
  }

  sweepExpired(now: number = Date.now()): number {
    let expired = 0;
    for (const runId of listActiveWorkflowRunIds(this.db)) {
      this.db.transaction(() => {
        const snapshot = requireWorkflowRun(this.db, runId);
        if (this.expireIfNeeded(snapshot, now)) expired += 1;
      }).immediate();
    }
    return expired;
  }

  claim(
    runId: string,
    stepRunId: string,
    now: number = Date.now(),
    inputOverride?: JsonValue,
  ): WorkflowStepRun {
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) {
        throw new Error(`Workflow run is not active: ${snapshot.run.status}`);
      }
      if (this.expireIfNeeded(snapshot, now)) return;
      const step = snapshot.steps.find((item) => item.id === stepRunId);
      if (!step || step.status !== 'pending') {
        throw new Error(`Workflow step is not claimable: ${stepRunId}`);
      }
      this.captureInput(snapshot, step, now);
      const result = this.db.prepare(
        `UPDATE workflow_step_runs
            SET status = 'running', input_json = ?, started_at = ?, updated_at = ?
          WHERE id = ? AND workflow_run_id = ? AND status = 'pending'`,
      ).run(JSON.stringify(inputOverride ?? step.input), now, now, stepRunId, runId);
      if (result.changes !== 1) throw new Error(`Workflow step claim conflict: ${stepRunId}`);
      const runUpdate = this.db.prepare(
        `UPDATE workflow_runs
            SET status = 'running', updated_at = ?
          WHERE id = ? AND status IN ('pending','running','waiting','awaiting-input')`,
      ).run(now, runId);
      if (runUpdate.changes !== 1) throw new Error(`Workflow run claim conflict: ${runId}`);
      appendWorkflowEvent(this.db, runId, stepRunId, 'step.claimed', {}, now);
    }).immediate();
    return requireStep(this.get(runId), stepRunId);
  }

  /**
   * A human-input boundary is a real run state, not a convention in the UI.
   * The generic workflow coordinator uses this for clarification and review
   * nodes; domain coordinators can keep completing their own action steps.
   */
  awaitInput(runId: string, stepRunId: string, now: number = Date.now()): WorkflowRunSnapshot {
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) {
        throw new Error(`Workflow run is not active: ${snapshot.run.status}`);
      }
      const step = requireStep(snapshot, stepRunId);
      if (step.status !== 'pending' && step.status !== 'running' && step.status !== 'awaiting-input') {
        throw new Error(`Workflow step cannot await input: ${stepRunId} (${step.status})`);
      }
      this.captureInput(snapshot, step, now);
      if (step.status !== 'awaiting-input') {
        this.db.prepare(
          `UPDATE workflow_step_runs
              SET status = 'awaiting-input', started_at = COALESCE(started_at, ?), updated_at = ?
            WHERE id = ? AND workflow_run_id = ? AND status IN ('pending','running')`,
        ).run(now, now, stepRunId, runId);
      }
      this.db.prepare(
        `UPDATE workflow_runs
            SET status = 'awaiting-input', updated_at = ?
          WHERE id = ? AND status IN ('pending','running','waiting','awaiting-input')`,
      ).run(now, runId);
      if (step.status !== 'awaiting-input') {
        appendWorkflowEvent(this.db, runId, stepRunId, 'step.awaiting-input', {}, now);
      }
    }).immediate();
    return requireWorkflowRun(this.db, runId);
  }

  private captureInput(snapshot: WorkflowRunSnapshot, step: WorkflowStepRun, now: number): void {
    if (step.inputSnapshot) return;
    const input = captureStepInput(snapshot, step, now);
    if (!input) return;
    this.db.prepare('UPDATE workflow_step_runs SET input_snapshot_json = ? WHERE id = ? AND input_snapshot_json IS NULL')
      .run(JSON.stringify(input), step.id);
    appendWorkflowEvent(this.db, snapshot.run.id, step.id, 'step.input-captured', {
      sources: input.upstream.map(source => source.stepRunId),
    }, now);
  }

  /** The user explicitly chose a historical result at an unfinished review gate. */
  bindReviewSource(runId: string, stepRunId: string, sourceStepRunId: string): WorkflowRunSnapshot {
    this.db.transaction(() => {
      const snapshot = this.get(runId);
      const step = requireStep(snapshot, stepRunId);
      const definition = requireStepDefinition(snapshot.definition, step.stepId);
      const source = requireStep(snapshot, sourceStepRunId);
      if (definition.metadata?.nodeKind !== 'review' || step.status !== 'awaiting-input' || !definition.dependsOn.includes(source.stepId)) {
        throw new Error('历史结果与确认步骤不匹配');
      }
      const input = captureStepInput(snapshot, step, Date.now(), source);
      if (input) this.db.prepare('UPDATE workflow_step_runs SET input_snapshot_json = ? WHERE id = ?')
        .run(JSON.stringify(input), step.id);
    }).immediate();
    return this.get(runId);
  }

  /**
   * Schedule a fresh attempt for a completed step without advancing any
   * waiting review step. Result regeneration uses this to rerun the exact
   * upstream Agent while the human-confirmation boundary remains active.
   */
  requeueStep(
    runId: string,
    stepId: string,
    now: number = Date.now(),
    inputOverride?: JsonValue,
    sourceStepRunId?: string,
  ): WorkflowStepRun {
    let nextId = '';
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) {
        throw new Error(`Workflow run is not active: ${snapshot.run.status}`);
      }
      const previous = latestStepRuns(snapshot.steps).get(stepId);
      if (!previous || previous.status !== 'succeeded') {
        throw new Error(`Workflow step cannot be regenerated: ${stepId}`);
      }
      if (snapshot.steps.length >= snapshot.definition.limits.maxStepRuns) {
        throw new Error('Workflow exceeded its step run budget');
      }
      nextId = randomUUID();
      this.db.prepare(
        `INSERT INTO workflow_step_runs
           (id, workflow_run_id, step_id, sequence, iteration, attempt, status,
            input_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(
        nextId,
        runId,
        previous.stepId,
        previous.sequence,
        previous.iteration,
        previous.attempt + 1,
        JSON.stringify(inputOverride ?? previous.input),
        now,
        now,
      );
      const source = sourceStepRunId ? requireStep(snapshot, sourceStepRunId) : previous;
      if (source.stepId !== stepId) throw new Error('重跑输入来源不匹配');
      if (source.inputSnapshot) this.db.prepare('UPDATE workflow_step_runs SET input_snapshot_json = ? WHERE id = ?').run(JSON.stringify(source.inputSnapshot), nextId);
      appendWorkflowEvent(this.db, runId, nextId, 'step.regenerate-scheduled', {
        previousStepRunId: previous.id,
        attempt: previous.attempt + 1,
      }, now);
    }).immediate();
    return requireStep(this.get(runId), nextId);
  }

  /**
   * Start a new serial branch from a step that already has run history.
   *
   * The newest attempt may be failed or cancelled (for example after a daemon
   * restart). A historical result card still points at an earlier successful
   * source attempt, so recovery must not reject the whole branch merely
   * because a newer attempt failed. The caller is responsible for validating
   * the historical source that authorises the replay.
   */
  requeueFromStep(
    runId: string,
    stepId: string,
    now: number = Date.now(),
    inputOverride?: JsonValue,
    sourceStepRunId?: string,
  ): WorkflowStepRun[] {
    const insertedIds: string[] = [];
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      const previousByStep = latestStepRuns(snapshot.steps);
      const previous = previousByStep.get(stepId);
      if (!previous) {
        throw new Error(`Workflow step cannot start a new branch: ${stepId}`);
      }
      const branch = forwardSlice(snapshot.definition, stepId);
      if (branch.length === 0) throw new Error(`Workflow branch is empty: ${stepId}`);
      if (snapshot.steps.length + branch.length > snapshot.definition.limits.maxStepRuns) {
        throw new Error('Workflow exceeded its step run budget');
      }

      const branchStepIds = branch.map(step => step.id);
      const placeholders = branchStepIds.map(() => '?').join(', ');
      this.db.prepare(
        `UPDATE workflow_step_runs
            SET status = 'cancelled', finished_at = ?, updated_at = ?
          WHERE workflow_run_id = ?
            AND step_id IN (${placeholders})
            AND status IN ('pending','blocked','running','awaiting-input','waiting')`,
      ).run(now, now, runId, ...branchStepIds);

      const insert = this.db.prepare(
        `INSERT INTO workflow_step_runs
           (id, workflow_run_id, step_id, sequence, iteration, attempt, status,
            input_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const definition of branch) {
        const latest = previousByStep.get(definition.id);
        if (!latest) throw new Error(`Workflow step has no prior attempt: ${definition.id}`);
        const id = randomUUID();
        insertedIds.push(id);
        const source = definition.id === stepId && sourceStepRunId ? requireStep(snapshot, sourceStepRunId) : latest;
        if (source.stepId !== definition.id) throw new Error('重跑输入来源不匹配');
        insert.run(
          id,
          runId,
          definition.id,
          latest.sequence,
          latest.iteration,
          latest.attempt + 1,
          definition.id === stepId ? 'pending' : 'blocked',
          JSON.stringify(definition.id === stepId ? inputOverride ?? source.input : snapshot.run.input),
          now,
          now,
        );
      }
      const sourceInput = sourceStepRunId ? requireStep(snapshot, sourceStepRunId).inputSnapshot : previous.inputSnapshot;
      if (sourceInput) this.db.prepare('UPDATE workflow_step_runs SET input_snapshot_json = ? WHERE id = ?').run(JSON.stringify(sourceInput), insertedIds[0]!);
      this.db.prepare(
        `UPDATE workflow_runs
            SET status = 'pending', termination_json = NULL, updated_at = ?
          WHERE id = ?`,
      ).run(now, runId);
      appendWorkflowEvent(this.db, runId, insertedIds[0] ?? null, 'branch.reopened', {
        fromStepId: stepId,
        steps: branchStepIds,
      }, now);
    }).immediate();
    const snapshot = this.get(runId);
    return insertedIds.map(id => requireStep(snapshot, id));
  }

  complete(
    runId: string,
    stepRunId: string,
    input: {
      output: JsonValue;
      selectedRouteId?: string;
      artifactRefs?: string[];
      childRunId?: string;
      now?: number;
    },
  ): WorkflowRunSnapshot {
    const now = input.now ?? Date.now();
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) {
        throw new Error(`Workflow run is not active: ${snapshot.run.status}`);
      }
      if (this.expireIfNeeded(snapshot, now)) return;
      const stepRun = requireStep(snapshot, stepRunId);
      const definition = requireStepDefinition(snapshot.definition, stepRun.stepId);
      if (stepRun.status !== 'running' && stepRun.status !== 'awaiting-input') {
        throw new Error(`Workflow step is not running: ${stepRunId}`);
      }
      const route = selectRoute(definition.routes ?? [], input.selectedRouteId);
      const selectedRoute = route
        ? {
            routeId: route.id,
            evaluatorVersion: 'manual-v1',
            inputDigest: digestJson(input.output),
          }
        : null;
      const result = this.db.prepare(
        `UPDATE workflow_step_runs
            SET status = 'succeeded', output_json = ?, child_run_id = ?,
                selected_route_json = ?, artifact_refs_json = ?,
                finished_at = ?, updated_at = ?
          WHERE id = ? AND workflow_run_id = ? AND status IN ('running','awaiting-input')`,
      ).run(
        JSON.stringify(input.output),
        input.childRunId ?? stepRun.childRunId ?? null,
        selectedRoute ? JSON.stringify(selectedRoute) : null,
        JSON.stringify(input.artifactRefs ?? []),
        now,
        now,
        stepRunId,
        runId,
      );
      if (result.changes !== 1) throw new Error(`Workflow step completion conflict: ${stepRunId}`);
      const variables = mergeWorkflowStepOutput(
        snapshot.run.variables,
        definition.id,
        input.output,
      );
      this.db.prepare(
        `UPDATE workflow_runs
            SET variables_json = ?, updated_at = ?
          WHERE id = ? AND status IN ('pending','running','waiting','awaiting-input')`,
      ).run(JSON.stringify(variables), now, runId);
      appendWorkflowEvent(this.db, runId, stepRunId, 'step.succeeded', {
        ...(route ? { routeId: route.id } : {}),
      }, now);
      if (route && isBackEdge(snapshot.definition, definition.id, route.to)) {
        this.enqueueLoop(
          snapshot,
          route.to,
          definition.id,
          route.id,
          route.maxIterations,
          now,
        );
      } else if (route && stepRun.iteration > 1) {
        this.enqueueContinuation(
          snapshot,
          route.to,
          stepRun.iteration,
          now,
        );
      }
    }).immediate();
    return this.advance(runId, now);
  }

  fail(
    runId: string,
    stepRunId: string,
    error: { code: string; message: string; retryable: boolean },
    now: number = Date.now(),
  ): WorkflowRunSnapshot {
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) {
        throw new Error(`Workflow run is not active: ${snapshot.run.status}`);
      }
      if (this.expireIfNeeded(snapshot, now)) return;
      const stepRun = requireStep(snapshot, stepRunId);
      const definition = requireStepDefinition(snapshot.definition, stepRun.stepId);
      if (stepRun.status !== 'running') {
        throw new Error(`Workflow step is not running: ${stepRunId}`);
      }
      const result = this.db.prepare(
        `UPDATE workflow_step_runs
            SET status = 'failed', error_json = ?, finished_at = ?, updated_at = ?
          WHERE id = ? AND workflow_run_id = ? AND status = 'running'`,
      ).run(JSON.stringify(error), now, now, stepRunId, runId);
      if (result.changes !== 1) throw new Error(`Workflow step failure conflict: ${stepRunId}`);
      appendWorkflowEvent(this.db, runId, stepRunId, 'step.failed', { code: error.code }, now);

      if (
        definition.failurePolicy.kind === 'retry'
        && error.retryable
        && stepRun.attempt < definition.failurePolicy.maxAttempts
      ) {
        if (snapshot.steps.length >= snapshot.definition.limits.maxStepRuns) {
          terminateRun(this.db, runId, 'terminated', {
            kind: 'limit-exceeded',
            code: 'MAX_STEP_RUNS',
            message: 'Workflow exceeded its step run budget',
          }, now);
          return;
        }
        this.db.prepare(
          `INSERT INTO workflow_step_runs
             (id, workflow_run_id, step_id, sequence, iteration, attempt, status,
              input_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        ).run(
          randomUUID(),
          runId,
          stepRun.stepId,
          stepRun.sequence,
          stepRun.iteration,
          stepRun.attempt + 1,
          JSON.stringify(stepRun.input),
          now,
          now,
        );
        appendWorkflowEvent(this.db, runId, stepRunId, 'step.retry-scheduled', {
          attempt: stepRun.attempt + 1,
        }, now);
      } else if (definition.failurePolicy.kind === 'skip') {
        this.db.prepare(
          `UPDATE workflow_step_runs
              SET status = 'skipped', updated_at = ?
            WHERE id = ? AND status = 'failed'`,
        ).run(now, stepRunId);
      } else {
        terminateRun(this.db, runId, 'failed', {
          kind: 'system-error',
          code: error.code,
          message: error.message,
        }, now);
      }
    }).immediate();
    return this.advance(runId, now);
  }

  cancel(runId: string, now: number = Date.now()): WorkflowRunSnapshot {
    this.db.transaction(() => {
      const snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) return;
      this.db.prepare(
        `UPDATE workflow_step_runs
            SET status = 'cancelled', finished_at = ?, updated_at = ?
          WHERE workflow_run_id = ?
            AND status IN ('pending','blocked','running','awaiting-input','waiting')`,
      ).run(now, now, runId);
      terminateRun(this.db, runId, 'cancelled', {
        kind: 'business-stop',
        code: 'USER_CANCELLED',
        message: 'Workflow run was cancelled',
      }, now);
    }).immediate();
    return requireWorkflowRun(this.db, runId);
  }

  private advance(runId: string, now: number = Date.now()): WorkflowRunSnapshot {
    this.db.transaction(() => {
      let snapshot = requireWorkflowRun(this.db, runId);
      if (!ACTIVE_RUN_STATUSES.has(snapshot.run.status)) return;
      if (this.expireIfNeeded(snapshot, now)) return;
      // A selected branch can skip one path and immediately unblock a later
      // merge node. Re-evaluate until the graph reaches a fixed point so the
      // merge does not remain blocked behind a status changed in this pass.
      let changed = true;
      while (changed) {
        changed = false;
        snapshot = requireWorkflowRun(this.db, runId);
        const latest = latestStepRuns(snapshot.steps);
        for (const step of snapshot.definition.steps) {
          const stepRun = latest.get(step.id);
          if (!stepRun || stepRun.status !== 'blocked') continue;
          const dependencies = step.dependsOn.map((dependency) => latest.get(dependency));
          if (dependencies.some((dependency) => !dependency)) continue;
          if (!dependencies.every((dependency) => SATISFIED_STEP_STATUSES.has(dependency!.status))) {
            continue;
          }
          const flowParents = step.metadata?.dataflowVersion === 1 ? dependencies.filter((parent): parent is WorkflowStepRun => !!parent && parent.status === 'succeeded' && activeInputParent(snapshot, parent, step.id)) : undefined;
          const routeState = flowParents ? (step.dependsOn.length && !flowParents.length ? 'not-selected' : 'selected') : routeSelectionState(snapshot, step.id);
          if (routeState === 'undecided') continue;
          if (routeState === 'not-selected') {
            this.db.prepare(
              `UPDATE workflow_step_runs
                  SET status = 'skipped', finished_at = ?, updated_at = ?
                WHERE id = ? AND status = 'blocked'`,
            ).run(now, now, stepRun.id);
            appendWorkflowEvent(this.db, runId, stepRun.id, 'step.skipped', {
              reason: 'route-not-selected',
            }, now);
            changed = true;
            continue;
          }
          const enabled = evaluateBooleanCondition(step.enabledWhen, snapshot.run.variables);
          this.db.prepare(
            `UPDATE workflow_step_runs
                SET status = ?, finished_at = ?, updated_at = ?
              WHERE id = ? AND status = 'blocked'`,
          ).run(enabled ? 'pending' : 'skipped', enabled ? null : now, now, stepRun.id);
          appendWorkflowEvent(
            this.db,
            runId,
            stepRun.id,
            enabled ? 'step.unblocked' : 'step.skipped',
            enabled ? {} : { reason: 'enabledWhen=false' },
            now,
          );
          changed = true;
        }
      }

      snapshot = requireWorkflowRun(this.db, runId);
      const stepRuns = latestStepRuns(snapshot.steps);
      const active = [...stepRuns.values()].filter((step) =>
        ['pending', 'blocked', 'running', 'awaiting-input', 'waiting'].includes(step.status));
      if (active.length === 0) {
        const failed = [...stepRuns.values()].find((step) => step.status === 'failed');
        if (failed) {
          terminateRun(this.db, runId, 'failed', {
            kind: 'system-error',
            code: failed.error?.code ?? 'STEP_FAILED',
            message: failed.error?.message ?? `Step failed: ${failed.stepId}`,
          }, now);
        } else {
          terminateRun(this.db, runId, 'succeeded', {
            kind: 'completed',
            code: 'WORKFLOW_COMPLETED',
            message: 'Workflow completed',
          }, now);
        }
      }
    }).immediate();
    return requireWorkflowRun(this.db, runId);
  }

  private enqueueLoop(
    snapshot: WorkflowRunSnapshot,
    targetStepId: string,
    sourceStepId: string,
    routeId: string,
    maxIterations: number | undefined,
    now: number,
  ): void {
    if (!maxIterations) throw new Error(`Back route requires maxIterations: ${routeId}`);
    const target = requireStepDefinition(snapshot.definition, targetStepId);
    const loopSteps = loopSlice(snapshot.definition, targetStepId, sourceStepId);
    if (loopSteps.length === 0) throw new Error(`Empty loop body for route: ${routeId}`);
    const existing = snapshot.steps.filter((step) => step.stepId === targetStepId);
    const iteration = Math.max(...existing.map((step) => step.iteration), 0) + 1;
    if (iteration > maxIterations) {
      terminateRun(this.db, snapshot.run.id, 'terminated', {
        kind: 'limit-exceeded',
        code: 'MAX_ITERATIONS',
        message: `Route ${routeId} exceeded ${maxIterations} iterations`,
      }, now);
      return;
    }
    if (snapshot.steps.length + loopSteps.length > snapshot.definition.limits.maxStepRuns) {
      terminateRun(this.db, snapshot.run.id, 'terminated', {
        kind: 'limit-exceeded',
        code: 'MAX_STEP_RUNS',
        message: 'Workflow exceeded its step run budget',
      }, now);
      return;
    }
    const insert = this.db.prepare(
      `INSERT INTO workflow_step_runs
       (id, workflow_run_id, step_id, sequence, iteration, attempt, status,
          input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    );
    for (const loopStep of loopSteps) {
      insert.run(
        randomUUID(),
        snapshot.run.id,
        loopStep.id,
        snapshot.definition.steps.indexOf(loopStep) + 1,
        iteration,
        loopStep.id === target.id ? 'pending' : 'blocked',
        JSON.stringify(snapshot.run.input),
        now,
        now,
      );
    }
    appendWorkflowEvent(this.db, snapshot.run.id, null, 'loop.enqueued', {
      routeId,
      iteration,
      steps: loopSteps.map((step) => step.id),
    }, now);
  }

  private enqueueContinuation(
    snapshot: WorkflowRunSnapshot,
    targetStepId: string,
    iteration: number,
    now: number,
  ): void {
    const target = requireStepDefinition(snapshot.definition, targetStepId);
    const continuation = forwardSlice(snapshot.definition, targetStepId);
    const missing = continuation.filter((step) =>
      !snapshot.steps.some((run) => run.stepId === step.id && run.iteration === iteration));
    if (missing.length === 0) return;
    if (snapshot.steps.length + missing.length > snapshot.definition.limits.maxStepRuns) {
      terminateRun(this.db, snapshot.run.id, 'terminated', {
        kind: 'limit-exceeded',
        code: 'MAX_STEP_RUNS',
        message: 'Workflow exceeded its step run budget',
      }, now);
      return;
    }
    const insert = this.db.prepare(
      `INSERT INTO workflow_step_runs
         (id, workflow_run_id, step_id, sequence, iteration, attempt, status,
          input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    );
    for (const step of missing) {
      insert.run(
        randomUUID(),
        snapshot.run.id,
        step.id,
        snapshot.definition.steps.indexOf(step) + 1,
        iteration,
        'blocked',
        JSON.stringify(snapshot.run.input),
        now,
        now,
      );
    }
    appendWorkflowEvent(this.db, snapshot.run.id, null, 'continuation.enqueued', {
      iteration,
      steps: missing.map((step) => step.id),
    }, now);
  }

  private expireIfNeeded(snapshot: WorkflowRunSnapshot, now: number): boolean {
    const runLimit = snapshot.definition.limits.maxDurationMs;
    const runExpired = runLimit !== undefined
      && now - Date.parse(snapshot.run.createdAt) > runLimit;
    const timedOutStep = snapshot.steps.find((stepRun) => {
      if (stepRun.status !== 'running' || !stepRun.startedAt) return false;
      const definition = snapshot.definition.steps.find((step) => step.id === stepRun.stepId);
      return definition?.timeoutMs !== undefined
        && now - Date.parse(stepRun.startedAt) > definition.timeoutMs;
    });
    if (!runExpired && !timedOutStep) return false;
    terminateRun(this.db, snapshot.run.id, 'terminated', {
      kind: 'limit-exceeded',
      code: runExpired ? 'MAX_DURATION' : 'STEP_TIMEOUT',
      message: runExpired
        ? 'Workflow exceeded its duration budget'
        : `Workflow step timed out: ${timedOutStep!.stepId}`,
    }, now);
    return true;
  }
}

function mergeWorkflowStepOutput(
  variables: Record<string, JsonValue>,
  stepId: string,
  output: JsonValue,
): Record<string, JsonValue> {
  const currentContext = isJsonObject(variables.workflowContext)
    ? variables.workflowContext
    : {};
  const currentOutputs = isJsonObject(currentContext.nodeOutputs)
    ? currentContext.nodeOutputs
    : {};
  return {
    ...variables,
    workflowContext: {
      ...currentContext,
      nodeOutputs: {
        ...currentOutputs,
        [stepId]: output,
      },
      latestNodeId: stepId,
      latestOutput: output,
    },
  };
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStep(snapshot: WorkflowRunSnapshot, stepRunId: string): WorkflowStepRun {
  const step = snapshot.steps.find((item) => item.id === stepRunId);
  if (!step) throw new Error(`Workflow step run not found: ${stepRunId}`);
  return step;
}

function requireStepDefinition(definition: WorkflowDefinition, stepId: string) {
  const step = definition.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Workflow step definition not found: ${stepId}`);
  return step;
}

function latestStepRuns(steps: WorkflowStepRun[]): Map<string, WorkflowStepRun> {
  const result = new Map<string, WorkflowStepRun>();
  for (const step of steps) {
    const current = result.get(step.stepId);
    if (
      !current
      || step.iteration > current.iteration
      || (step.iteration === current.iteration && step.attempt > current.attempt)
    ) result.set(step.stepId, step);
  }
  return result;
}

function selectRoute(
  routes: NonNullable<WorkflowDefinition['steps'][number]['routes']>,
  selectedRouteId: string | undefined,
) {
  if (routes.length === 0) {
    if (selectedRouteId) throw new Error(`Step has no routes: ${selectedRouteId}`);
    return undefined;
  }
  if (!selectedRouteId) throw new Error('A selectedRouteId is required for a routed step');
  const route = routes.find((item) => item.id === selectedRouteId);
  if (!route) throw new Error(`Unknown workflow route: ${selectedRouteId}`);
  return route;
}

function routeSelectionState(
  snapshot: WorkflowRunSnapshot,
  stepId: string,
): 'selected' | 'not-selected' | 'undecided' {
  const routedParents = snapshot.definition.steps.filter((step) =>
    step.routes?.some((route) => route.to === stepId));
  if (routedParents.length === 0) return 'selected';
  const targetIteration = Math.max(
    ...snapshot.steps.filter((step) => step.stepId === stepId).map((step) => step.iteration),
    1,
  );
  if (routedParents.some((parent) =>
    snapshot.steps.some((step) =>
      step.stepId === parent.id
      && step.iteration === targetIteration
      && step.status === 'succeeded'
      && parent.routes?.find((route) => route.id === step.selectedRoute?.routeId)?.to === stepId))) {
    return 'selected';
  }
  const target = snapshot.definition.steps.find((step) => step.id === stepId);
  const routedParentIds = new Set(routedParents.map(parent => parent.id));
  const ordinaryParentIds = (target?.dependsOn ?? []).filter(parentId => !routedParentIds.has(parentId));
  if (ordinaryParentIds.some(parentId =>
    snapshot.steps.some(step =>
      step.stepId === parentId
      && step.iteration === targetIteration
      && step.status === 'succeeded'))) {
    // The node was reached through a selected routed path that has already
    // completed an ordinary parent (for example branch -> clarify -> Agent).
    return 'selected';
  }
  const allDecided = routedParents.every((parent) =>
    snapshot.steps.some((step) =>
      step.stepId === parent.id
      && step.iteration === targetIteration
      && ['succeeded', 'failed', 'skipped', 'cancelled'].includes(step.status)));
  return allDecided ? 'not-selected' : 'undecided';
}

function evaluateBooleanCondition(
  condition: string | undefined,
  variables: Record<string, JsonValue>,
): boolean {
  if (!condition) return true;
  const match = condition.trim().match(/^\$\{([A-Za-z][A-Za-z0-9_]*)\}$/);
  if (!match) throw new Error(`Runtime does not support condition: ${condition}`);
  return variables[match[1]!] === true;
}

function isBackEdge(
  definition: WorkflowDefinition,
  fromStepId: string,
  toStepId: string,
): boolean {
  return definition.steps.findIndex((step) => step.id === toStepId)
    <= definition.steps.findIndex((step) => step.id === fromStepId);
}

function loopSlice(
  definition: WorkflowDefinition,
  targetStepId: string,
  sourceStepId: string,
): WorkflowDefinition['steps'] {
  const adjacency = new Map<string, string[]>();
  for (const step of definition.steps) adjacency.set(step.id, []);
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) adjacency.get(dependency)?.push(step.id);
  }
  return definition.steps.filter((step) =>
    hasDependencyPath(adjacency, targetStepId, step.id)
    && hasDependencyPath(adjacency, step.id, sourceStepId));
}

function forwardSlice(
  definition: WorkflowDefinition,
  targetStepId: string,
): WorkflowDefinition['steps'] {
  const adjacency = new Map<string, string[]>();
  for (const step of definition.steps) adjacency.set(step.id, []);
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) adjacency.get(dependency)?.push(step.id);
  }
  return definition.steps.filter((step) =>
    hasDependencyPath(adjacency, targetStepId, step.id));
}

function hasDependencyPath(
  adjacency: Map<string, string[]>,
  from: string,
  to: string,
): boolean {
  const queue = [from];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function terminateRun(
  db: Database,
  runId: string,
  status: 'succeeded' | 'terminated' | 'failed' | 'cancelled',
  termination: NonNullable<WorkflowRunSnapshot['run']['termination']>,
  now: number,
): void {
  const result = db.prepare(
    `UPDATE workflow_runs
        SET status = ?, termination_json = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending','running','awaiting-input','waiting')`,
  ).run(status, JSON.stringify(termination), now, runId);
  if (result.changes > 0) {
    db.prepare(
      `UPDATE workflow_step_runs
          SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE workflow_run_id = ?
          AND status IN ('pending','blocked','running','awaiting-input','waiting')`,
    ).run(now, now, runId);
    appendWorkflowEvent(db, runId, null, `run.${status}`, { code: termination.code }, now);
  }
}

function digestJson(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
