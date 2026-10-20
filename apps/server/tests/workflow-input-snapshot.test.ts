import Database from './helpers/workflow-database.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { workflowFileVersions } from '../src/workflows/artifact-versions.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '@bezier/contracts';
import { GenericWorkflowGraphService, type WorkflowGraphConfig } from '../src/workflows/generic-graph.js';
import { WorkflowRuntime } from '../src/workflows/runtime.js';
import { migrateWorkflows } from '../src/workflows/persistence.js';
import { WorkflowResultService } from '../src/workflows/results.js';

const dbs: Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
function harness(nodes: NonNullable<WorkflowGraphConfig['nodes']>, edges: NonNullable<WorkflowGraphConfig['edges']>, writer?: ConstructorParameters<typeof GenericWorkflowGraphService>[2], input: JsonValue = { task: 'ROOT_TASK' }) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES (\'p\')');
  migrateWorkflows(db);
  const results = new WorkflowResultService(db);
  const service = new GenericWorkflowGraphService(db, results, writer); service.register();
  service.saveConfig({ id: 'flow', version: 2, title: '流程', updatedAt: '2026-09-23', nodes: [{ id: 'start', kind: 'start', title: '开始', description: '' }, ...nodes], edges });
  const started = service.start({ projectId: 'p', workflowId: 'flow', value: input });
  const runId = started.snapshot.run.id;
  const runtime = new WorkflowRuntime(db);
  const current = () => service.current(runId).next;
  const finish = (value: JsonValue) => {
    const next = current();
    if (next.kind !== 'agent') throw new Error(`expected agent: ${next.kind}`);
    return service.completeAgent({ runId, stepRunId: next.stepRunId, output: value });
  };
  return { db, service, runtime, results, runId, current, finish };
}
const agent = (id: string) => ({ id, kind: 'agent' as const, title: id, description: '' });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

describe('versioned workflow inputs', () => {
  it('waits for both ordinary parents and preserves each source', () => {
    const h = harness([agent('one'), agent('two'), agent('merge')], [edge('start', 'one'), edge('start', 'two'), edge('one', 'merge'), edge('two', 'merge')]);
    h.finish('FIRST_CONTENT');
    expect(h.runtime.get(h.runId).steps.find(step => step.stepId === 'merge')?.status).toBe('blocked');
    const next = h.current(); expect(next.kind === 'agent' && next.prompt).not.toContain('FIRST_CONTENT');
    h.finish('SECOND_CONTENT');
    const merge = h.current();
    expect(merge.kind === 'agent' && merge.prompt).toContain('FIRST_CONTENT');
    expect(merge.kind === 'agent' && merge.prompt).toContain('SECOND_CONTENT');
    expect(h.runtime.get(h.runId).steps.find(step => step.stepId === 'merge')?.inputSnapshot?.content.map(source => source.stepId)).toEqual(['one', 'two']);
  });

  it('does not let newer upstream attempts rewrite a running or recovered input', () => {
    const h = harness([agent('one'), agent('two')], [edge('start', 'one'), edge('one', 'two')]);
    h.finish('PINNED_OLD_VERSION');
    const original = h.current();
    const retry = h.runtime.requeueStep(h.runId, 'one');
    h.runtime.claim(h.runId, retry.id); h.runtime.complete(h.runId, retry.id, { output: 'NEW_UNRELATED_VERSION' });
    const restored = new GenericWorkflowGraphService(h.db, h.results).current(h.runId).next;
    expect(restored).toEqual(original);
    expect(restored.kind === 'agent' && restored.prompt).not.toContain('NEW_UNRELATED_VERSION');
  });

  it('skips a whole unselected path and never reuses its earlier successful output on replay', () => {
    const h = harness([
      { id: 'judge', kind: 'branch', title: '判断', description: '', branchConfig: { routes: [{ id: 'left', condition: '选左侧' }, { id: 'right', condition: '选右侧' }] } },
      agent('left'), agent('left-child'), agent('right'), agent('merge'),
    ], [edge('start', 'judge'), edge('judge', 'left', 'left'), edge('judge', 'right', 'right'), edge('left', 'left-child'), edge('left-child', 'merge'), edge('right', 'merge')]);
    let next = h.current(); if (next.kind !== 'branch') throw new Error('expected branch');
    h.service.chooseBranch({ runId: h.runId, stepRunId: next.stepRunId, routeId: 'left' });
    h.finish('LEFT_OLD'); h.finish('LEFT_CHILD_OLD'); h.finish('MERGED_OLD');
    h.runtime.requeueFromStep(h.runId, 'judge');
    next = h.current(); if (next.kind !== 'branch') throw new Error('expected branch');
    h.service.chooseBranch({ runId: h.runId, stepRunId: next.stepRunId, routeId: 'right' });
    const right = h.current(); expect(right.kind === 'agent' && right.node.id).toBe('right');
    h.finish('RIGHT_NEW');
    const merge = h.current();
    expect(merge.kind === 'agent' && merge.node.id).toBe('merge');
    expect(merge.kind === 'agent' && merge.prompt).toContain('RIGHT_NEW');
    expect(merge.kind === 'agent' && merge.prompt).not.toContain('LEFT_CHILD_OLD');
    expect(h.runtime.get(h.runId).steps.filter(step => step.stepId === 'left-child').at(-1)?.status).toBe('skipped');
  });

  it('rejects unavailable pinned versions instead of using another successful output', () => {
    const h = harness([agent('one'), agent('two')], [edge('start', 'one'), edge('one', 'two')]);
    h.finish('ORIGINAL');
    h.db.prepare("UPDATE workflow_step_runs SET output_json = ? WHERE step_id = 'one'").run(JSON.stringify('CORRUPTED'));
    expect(() => h.current()).toThrow('输入版本不可用');
  });

  it('does not advance downstream when an upstream fails', () => {
    const h = harness([agent('one'), agent('two')], [edge('start', 'one'), edge('one', 'two')]);
    const next = h.current(); if (next.kind !== 'agent') throw new Error('expected agent');
    h.service.failAgent({ runId: h.runId, stepRunId: next.stepRunId, error: { code: 'FAIL', message: '失败', retryable: false } });
    expect(h.current().kind).toBe('failed');
    expect(h.runtime.get(h.runId).steps.find(step => step.stepId === 'two')?.inputSnapshot).toBeUndefined();
  });
});


it('persists initial file versions without changing run identity and rejects later replacements', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workflow-source-'));
  try {
    await writeFile(path.join(root, 'brief.txt'), 'ORIGINAL_BRIEF');
    const writer = {
      fileVersions: (_project: string, value: JsonValue, verifyOnly?: boolean) => workflowFileVersions(root, value, verifyOnly),
      materialize: async () => { throw new Error('unexpected delivery'); },
    };
    const input = { task: 'write', source: { kind: 'project-file', path: 'brief.txt' } };
    const h = harness([agent('one'), agent('two')], [edge('start', 'one'), edge('one', 'two')], writer, input);
    const first = h.current(); if (first.kind !== 'agent') throw new Error('expected agent');
    const originalInput = h.service.getRun(h.runId)!.run.input;
    await h.service.prepareStepInput(h.runId, first.stepRunId);
    const pinned = h.service.getRun(h.runId)!;
    expect(pinned.run.input).toEqual(originalInput);
    expect(pinned.run.inputVersion).toMatchObject({ source: { sha256: expect.any(String) } });
    expect(h.current()).toMatchObject({ prompt: expect.stringContaining('sha256') });
    h.finish('DRAFT');
    const second = h.current(); if (second.kind !== 'agent') throw new Error('expected agent');
    const restarted = new GenericWorkflowGraphService(h.db, h.results, writer);
    await restarted.prepareStepInput(h.runId, second.stepRunId);
    expect(restarted.getRun(h.runId)!.steps.find(step => step.id === second.stepRunId)?.inputSnapshot?.task).toEqual(pinned.run.inputVersion);
    await writeFile(path.join(root, 'brief.txt'), 'REPLACED_BRIEF');
    await expect(restarted.prepareStepInput(h.runId, second.stepRunId)).rejects.toThrow('版本不可用');
    expect(restarted.getRun(h.runId)!.run.inputVersion).toEqual(pinned.run.inputVersion);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('blocks ambiguous delivery instead of silently choosing one producer', async () => {
  let writes = 0;
  const h = harness([agent('one'), agent('two'), { id: 'save', kind: 'delivery', title: '产物', description: '', deliveryConfig: { artifactKind: 'text' } }],
    [edge('start', 'one'), edge('start', 'two'), edge('one', 'save'), edge('two', 'save')],
    { materialize: async () => { writes++; return { canvasNodeId: 'unexpected', kind: 'text' }; } });
  h.finish('FIRST'); h.finish('SECOND');
  const next = h.current(); if (next.kind !== 'delivery') throw new Error('expected delivery');
  await expect(h.service.completeDelivery({ runId: h.runId, stepRunId: next.stepRunId })).rejects.toThrow('多个内容来源');
  expect(writes).toBe(0);
});

it('publishes only accepted candidates and feedback to downstream inputs', async () => {
  const h = harness([{ ...agent('one'), agentConfig: { confirmation: { selection: 'single', selectionRequired: true, feedbackEnabled: true, materializeOnConfirm: false } } }, agent('two')],
    [edge('start', 'one'), edge('one', 'two')]);
  h.finish([{ id: 'a', title: '保留', content: 'ACCEPTED_BODY' }, { id: 'b', title: '丢弃', content: 'UNSELECTED_BODY' }]);
  const result = h.results.list({ projectId: 'p' })[0]!;
  await h.results.interact({ resultId: result.id, actionId: 'continue', expectedVersion: result.version, selectedIds: [result.items![0]!.id], feedback: 'USER_FEEDBACK', idempotencyKey: 'accept-first' });
  const next = h.current(); if (next.kind !== 'agent') throw new Error('expected agent');
  expect(next.prompt).toContain('ACCEPTED_BODY');
  expect(next.prompt).toContain('USER_FEEDBACK');
  expect(next.prompt).not.toContain('UNSELECTED_BODY');
  expect(h.service.getRun(h.runId)!.steps.find(step => step.id === next.stepRunId)?.inputSnapshot?.content).toEqual([expect.objectContaining({ kind: 'review' })]);
});

it('adds explicitly referenced earlier output to the next prompt and pins its version', () => {
  const h = harness([agent('one'), agent('two'), { ...agent('three'), inputReferences: ['one'] }], [edge('start', 'one'), edge('one', 'two'), edge('two', 'three')]);
  h.finish('EARLIER_ANALYSIS'); h.finish('LATEST_ANALYSIS');
  const next = h.current();
  expect(next.kind).toBe('agent');
  if (next.kind !== 'agent') throw new Error('expected agent');
  expect(next.prompt).toContain('EARLIER_ANALYSIS');
  expect(next.prompt).toContain('LATEST_ANALYSIS');
  const input = h.service.getRun(h.runId)!.steps.find(step => step.stepId === 'three')!.inputSnapshot!;
  expect(input.content.map(source => source.stepId)).toEqual(['two']);
  expect(input.references?.map(source => source.stepId)).toEqual(['one']);
});

it('does not carry earlier analysis after its explicit reference is removed', () => {
  const h = harness([agent('one'), agent('two'), { ...agent('three'), inputReferences: [] }], [edge('start', 'one'), edge('one', 'two'), edge('two', 'three')]);
  h.finish('EARLIER_ANALYSIS'); h.finish('LATEST_ANALYSIS');
  const next = h.current();
  if (next.kind !== 'agent') throw new Error('expected agent');
  expect(next.prompt).not.toContain('EARLIER_ANALYSIS');
});

it('rejects references to downstream cards', () => {
  expect(() => harness([{ ...agent('one'), inputReferences: ['two'] }, agent('two')], [edge('start', 'one'), edge('one', 'two')])).toThrow('额外输入只能引用');
});
