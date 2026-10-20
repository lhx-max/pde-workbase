import { describe, expect, it } from 'vitest';
import type { WorkflowResultArtifact } from '@bezier/contracts';
import Database from './helpers/workflow-database.js';
import { bindWorkflowTaskRun, latestWorkflowTaskRun, migrateWorkflows } from '../src/workflows/persistence.js';
import { WorkflowResultService } from '../src/workflows/results.js';
import { GenericWorkflowGraphService } from '../src/workflows/generic-graph.js';

function harness() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p')");
  migrateWorkflows(db);
  const results = new WorkflowResultService(db);
  const graphs = new GenericWorkflowGraphService(db, results); graphs.register();
  graphs.saveConfig({ id: 'flow', version: 2, title: 'Flow', updatedAt: '2026-09-24', nodes: [
    { id: 'start', kind: 'start', title: 'Start', description: '' }, { id: 'work', kind: 'agent', title: 'Work', description: '' },
  ], edges: [{ id: 'edge', source: 'start', target: 'work' }] });
  return { db, results, graphs };
}

describe('original workflow schema migrations on node:sqlite', () => {
  it('migrates populated one-result-per-node schemas without losing immutable versions or foreign keys', () => {
    const h = harness();
    const table = h.db.prepare("SELECT sql FROM sqlite_master WHERE name='workflow_result_artifacts'").get() as { sql: string };
    h.db.pragma('foreign_keys = OFF');
    h.db.exec(`DROP TABLE workflow_result_artifacts; ${table.sql.replace(/\)\s*$/, ', UNIQUE(workflow_run_id, result_definition_id))')}`);
    h.db.pragma('foreign_keys = ON');
    const started = h.graphs.start({ projectId: 'p', workflowId: 'flow' });
    if (started.next.kind !== 'agent') throw new Error('Expected agent step');
    const artifact: WorkflowResultArtifact = { id: 'old-result', projectId: 'p', workflowRunId: started.snapshot.run.id, sourceStepRunId: started.next.stepRunId,
      resultDefinitionId: 'primary', version: 1, title: 'Historical result', shape: 'single', renderer: 'structured', capabilities: [], actions: [], createdAt: '2026-09-24T00:00:00Z' };
    h.results.publish({ artifact, adapterId: 'workflow.generic' });
    expect(() => h.results.publish({ artifact: { ...artifact, id: 'new-result' }, adapterId: 'workflow.generic' })).toThrow();
    migrateWorkflows(h.db); migrateWorkflows(h.db);
    h.results.publish({ artifact: { ...artifact, id: 'new-result' }, adapterId: 'workflow.generic' });
    expect(h.results.list({ projectId: 'p' })).toHaveLength(2);
    expect(h.db.prepare('SELECT version FROM workflow_result_artifact_versions WHERE result_id = ?').get('old-result')).toMatchObject({ version: 1 });
    expect(h.db.pragma('foreign_key_check')).toEqual([]);
    expect(h.db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('binds independent task identities idempotently and refuses conflicting ownership', () => {
    const h = harness();
    const started = h.graphs.start({ projectId: 'p', workflowId: 'flow' });
    h.db.prepare('UPDATE workflow_runs SET business_key = ? WHERE id = ?').run('business', started.snapshot.run.id);
    const binding = { workflowRunId: started.snapshot.run.id, taskRunId: 'task-1', businessKey: 'business', role: 'agent', now: 1 };
    expect(bindWorkflowTaskRun(h.db, binding).taskRunId).toBe('task-1');
    expect(bindWorkflowTaskRun(h.db, { ...binding, now: 2 }).createdAt).toBe(1);
    expect(latestWorkflowTaskRun(h.db, binding.workflowRunId)?.taskRunId).toBe('task-1');
    expect(() => bindWorkflowTaskRun(h.db, { ...binding, role: 'other' })).toThrow('Task run is already bound');
    expect(() => bindWorkflowTaskRun(h.db, { ...binding, businessKey: 'other' })).toThrow('business key mismatch');
  });
});
