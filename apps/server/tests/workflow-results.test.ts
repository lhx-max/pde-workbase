import Database from './helpers/workflow-database.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowResultArtifact } from '@bezier/contracts';
import { migrateWorkflows } from '../src/workflows/persistence.js';
import { WorkflowResultService } from '../src/workflows/results.js';

describe('workflow result service', () => {
  let db: Database;
  let service: WorkflowResultService;
  let artifact: WorkflowResultArtifact;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO projects VALUES ('project-1', 'Project', 0, 0);
    `);
    migrateWorkflows(db);
    db.exec(`
      INSERT INTO workflow_definitions VALUES ('digest', 'generic', '1', '{}', 0);
      INSERT INTO workflow_runs
        (id, workflow_id, definition_version, definition_digest, project_id, status, input_json, variables_json, created_at, updated_at)
        VALUES ('run-1', 'generic', '1', 'digest', 'project-1', 'running', '{}', '{}', 0, 0);
      INSERT INTO workflow_step_runs
        (id, workflow_run_id, step_id, sequence, iteration, attempt, status, input_json, artifact_refs_json, created_at, updated_at)
        VALUES ('step-1', 'run-1', 'publish', 1, 1, 1, 'succeeded', '{}', '[]', 0, 0);
    `);
    service = new WorkflowResultService(db);
    artifact = {
      id: 'result-1',
      workflowRunId: 'run-1',
      resultDefinitionId: 'primary',
      sourceStepRunId: 'step-1',
      version: 1,
      projectId: 'project-1',
      title: 'Candidates',
      shape: 'collection',
      renderer: 'structured',
      rendererConfig: { density: 'compact' },
      capabilities: ['select', 'continue'],
      selection: { mode: 'multiple', min: 1 },
      actions: [{
        id: 'continue',
        capability: 'continue',
        label: 'Continue',
        when: { minSelection: 1, feedback: 'empty' },
      }],
      items: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      createdAt: new Date(0).toISOString(),
    };
  });

  it('exposes editing on legacy canvas reports without changing the stored revision', () => {
    service.registerAdapter('workflow.generic', vi.fn());
    artifact.surfaces = ['canvas'];
    artifact.items![0]!.data = { report: JSON.stringify({ version: 1, facts: [], sections: [] }) };
    service.publish({ artifact, adapterId: 'workflow.generic' });
    expect(service.get(artifact.id)?.artifact.actions.some(a => a.id === 'edit-report')).toBe(true);
    expect(service.list({ projectId: 'project-1' })[0]?.capabilities).toContain('edit');
    expect(service.get(artifact.id)?.artifact.version).toBe(1);
    expect(artifact.actions.some(a => a.id === 'edit-report')).toBe(false);
  });

  it('publishes through a registered adapter and replays an idempotent interaction', async () => {
    const adapter = vi.fn().mockResolvedValue({ ok: true, state: 'accepted', visiblePrompt: 'Continue' });
    service.registerAdapter('test.adapter', adapter);
    service.publish({ artifact, adapterId: 'test.adapter', now: 1 });
    const request = {
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['a', 'b'],
      feedback: '',
      idempotencyKey: 'key-1',
    };

    const first = await service.interact(request);
    const replay = await service.interact(request);

    expect(first).toEqual(replay);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('rejects nested provider secrets before interaction persistence or adapter invocation', async () => {
    const adapter = vi.fn();
    service.registerAdapter('test.adapter', adapter);
    service.publish({ artifact, adapterId: 'test.adapter' });
    await expect(service.interact({ resultId: artifact.id, actionId: 'continue', expectedVersion: 1, selectedIds: ['a'], idempotencyKey: 'malformed',
      execution: { mode: 'api', model: 'm', byokProvider: { protocol: 'openai', apiKey: 'key', baseUrl: { apiKey: 'nested-test-secret' } } } as never })).rejects.toThrow();
    expect(db.prepare('SELECT * FROM workflow_result_interactions').all()).toEqual([]);
    expect(adapter).not.toHaveBeenCalled();
    db.close();
  });
  it('passes execution credentials to adapter but persists only identity and permits key refresh replay', async () => {
    const adapter = vi.fn().mockResolvedValue({ ok: true, state: 'accepted' });
    service.registerAdapter('test.adapter', adapter);
    service.publish({ artifact, adapterId: 'test.adapter' });
    const execution = { mode: 'api' as const, model: 'm', byokProvider: { protocol: 'openai' as const, apiKey: 'secret-one', baseUrl: 'https://private-gateway.example/private-path?api_key=query-secret' } };
    const request = { resultId: artifact.id, actionId: 'continue', expectedVersion: 1, selectedIds: ['a'], idempotencyKey: 'api-key', execution };
    await service.interact(request);
    expect(adapter.mock.calls[0]?.[0].request.execution).toEqual(execution);
    expect(JSON.stringify(db.prepare('SELECT * FROM workflow_result_interactions').all())).not.toMatch(/secret-one|private-gateway|private-path|query-secret/);
    await service.interact({ ...request, execution: { ...execution, byokProvider: { ...execution.byokProvider, apiKey: 'new-key' } } });
    expect(adapter).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('rejects stale versions, unknown items, and unmet action conditions', async () => {
    service.registerAdapter('test.adapter', vi.fn());
    service.publish({ artifact, adapterId: 'test.adapter' });
    await expect(service.interact({
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 2,
      selectedIds: ['a'],
      idempotencyKey: 'stale',
    })).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_VERSION_CONFLICT' });
    await expect(service.interact({
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['missing'],
      idempotencyKey: 'unknown',
    })).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_SELECTION_INVALID' });
    await expect(service.interact({
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: [],
      idempotencyKey: 'empty',
    })).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_ACTION_CONDITION' });
  });

  it('validates chat and canvas interactions against their own contracts', async () => {
    service.registerAdapter('test.adapter', vi.fn().mockResolvedValue({ ok: true, state: 'accepted' }));
    service.publish({
      artifact: {
        ...artifact,
        chatCapabilities: ['continue'],
        chatSelection: { mode: 'single' },
        chatActions: [{ id: 'continue', capability: 'continue', label: 'Continue', completion: 'keep-active' }],
      },
      adapterId: 'test.adapter',
    });

    await expect(service.interact({
      resultId: artifact.id, actionId: 'continue', expectedVersion: 1,
      surface: 'chat', selectedIds: ['a', 'b'], idempotencyKey: 'chat-two',
    })).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_SELECTION_INVALID' });
    await expect(service.interact({
      resultId: artifact.id, actionId: 'continue', expectedVersion: 1,
      surface: 'canvas', selectedIds: ['a', 'b'], idempotencyKey: 'canvas-two',
    })).resolves.toMatchObject({ ok: true });
  });

  it('keeps one result identity while preserving immutable version history', () => {
    service.registerAdapter('test.adapter', vi.fn());
    service.publish({ artifact, adapterId: 'test.adapter', now: 1 });
    const next = { ...artifact, version: 2, title: 'Updated candidates' };

    service.publish({ artifact: next, adapterId: 'test.adapter', now: 2 });

    expect(service.get(artifact.id)?.artifact).toEqual(next);
    expect(db.prepare(
      `SELECT version FROM workflow_result_artifact_versions
        WHERE result_id = ? ORDER BY version`,
    ).all(artifact.id)).toEqual([{ version: 1 }, { version: 2 }]);
    expect(() => service.publish({
      artifact: next,
      adapterId: 'test.adapter',
    })).toThrow(/version must increase/);
  });

  it('lists generic artifacts by project and workflow run', () => {
    service.registerAdapter('test.adapter', vi.fn());
    service.publish({ artifact, adapterId: 'test.adapter', now: 1 });

    expect(service.list({ projectId: 'project-1' })).toEqual([artifact]);
    expect(service.list({ projectId: 'project-1', workflowRunId: 'run-1' })).toEqual([artifact]);
    expect(service.list({ projectId: 'project-1', workflowRunId: 'missing' })).toEqual([]);
    expect(service.list({ projectId: 'missing' })).toEqual([]);
  });

  it('persists generic selection and completion state after interaction', async () => {
    service.registerAdapter('test.adapter', vi.fn().mockResolvedValue({
      ok: true,
      state: 'completed',
    }));
    service.publish({
      artifact: {
        ...artifact,
        actions: [{
          ...artifact.actions[0]!,
          completion: 'lock-card',
        }],
      },
      adapterId: 'test.adapter',
    });

    await service.interact({
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['b'],
      idempotencyKey: 'persist-state',
    });

    expect(service.get(artifact.id)?.artifact).toMatchObject({
      rendererConfig: { density: 'compact' },
      selectedIds: ['b'],
      feedbackValue: '',
      state: 'locked',
    });
  });

  it('keeps the source artifact immutable when regeneration starts a new result branch', async () => {
    const regenerateArtifact: WorkflowResultArtifact = {
      ...artifact,
      capabilities: ['regenerate'],
      selection: { mode: 'none' },
      actions: [{
        id: 'regenerate',
        capability: 'regenerate',
        label: '重新生成',
        completion: 'keep-active',
      }],
      selectedIds: ['a'],
      feedbackValue: '保留这条历史意见',
      state: 'active',
    };
    service.registerAdapter('test.adapter', vi.fn().mockResolvedValue({
      ok: true,
      state: 'accepted',
      message: '新结果生成中',
    }));
    service.publish({ artifact: regenerateArtifact, adapterId: 'test.adapter' });
    const before = structuredClone(service.get(regenerateArtifact.id)!.artifact);

    await service.interact({
      resultId: regenerateArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      selectedIds: [],
      feedback: '这次换个方向',
      idempotencyKey: 'regenerate-new-branch',
    });

    expect(service.get(regenerateArtifact.id)?.artifact).toEqual(before);
  });

  it('rejects an idempotency key reused with different input', async () => {
    const adapter = vi.fn().mockResolvedValue({ ok: true, state: 'completed' });
    service.registerAdapter('test.adapter', adapter);
    service.publish({ artifact, adapterId: 'test.adapter' });
    await service.interact({
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['a'],
      idempotencyKey: 'same-key',
    });

    await expect(service.interact({
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['b'],
      idempotencyKey: 'same-key',
    })).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_IDEMPOTENCY_CONFLICT' });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('persists adapter failures and replays them without invoking the adapter again', async () => {
    const adapter = vi.fn().mockRejectedValue(
      new Error('adapter unavailable'),
    );
    service.registerAdapter('test.adapter', adapter);
    service.publish({ artifact, adapterId: 'test.adapter' });
    const request = {
      resultId: artifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['a'],
      idempotencyKey: 'failed-key',
    };

    await expect(service.interact(request)).rejects.toThrow('adapter unavailable');
    await expect(service.interact(request)).rejects.toMatchObject({
      code: 'WORKFLOW_RESULT_ADAPTER_ERROR',
    });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
