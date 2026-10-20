import { CanvasHistory } from '../src/platform/canvas-history';
import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { WorkflowCanvasRun, WorkflowResultArtifact } from '@bezier/contracts';
import { workflowGroupRuns, activeWorkflowGroups, dismissedWorkflowNodeIds, arrangeWorkflowMembers, reconcileWorkflowGroups, workflowGroupMoves, workflowNodeOwners, workflowRunGroupId, workflowRunSteps, workflowRunConnections } from '../src/workbench/workflow-run-group';

function snapshot(id: string): WorkflowCanvasRun {
  return { run: { id, projectId: 'p', workflowId: 'flow', definitionVersion: '1', definitionDigest: 'digest', status: 'running', input: {}, variables: {}, createdAt: '', updatedAt: '' },
    definition: { canvasPresentation: 'run-group', schemaVersion: 1, id: 'flow', aliases: [], version: '1', digest: 'digest', title: '流程', inputs: [], results: [], exits: [], limits: { maxStepRuns: 20 }, steps: [] }, steps: [], execution: { managed: true } };
}
const node = (id: string, runId?: string): Node => ({ id, type: 'basicCanvas', position: { x: 0, y: 0 }, data: { node: { source: runId ? { workflowRunId: runId } : {} } }, width: 640 });

describe('workflow run canvas projection', () => {
  it('uses persisted run provenance, keeps repeated invocations separate, and is stable across polls', () => {
    const snapshots = [snapshot('one'), snapshot('two')];
    const nodes = [node('a', 'one'), node('b', 'one'), node('c', 'two'), node('unrelated')];
    const owners = workflowNodeOwners(nodes, [], snapshots);
    const groups = reconcileWorkflowGroups({}, snapshots, nodes, owners);
    expect(Object.keys(groups.one!.members)).toEqual(['a', 'b']);
    expect(Object.keys(groups.two!.members)).toEqual(['c']);
    expect(owners.has('unrelated')).toBe(false);
    expect(groups.one!.x).not.toBe(groups.two!.x);
    expect(reconcileWorkflowGroups(groups, snapshots, nodes, owners)).toBe(groups);
  });
  it('moves the group and its children once, persists child moves as world coordinates, and preserves detached cards', () => {
    const groups = { run: { x: 100, y: 200, layoutVersion: 3, members: { a: { x: 24, y: 250 }, b: { x: 700, y: 250 } }, detached: ['b'] } };
    const moved = workflowGroupMoves([{ id: workflowRunGroupId('run'), x: 400, y: 500 }], groups);
    expect(moved.positions).toEqual([{ id: 'a', x: 424, y: 750 }]);
    const child = workflowGroupMoves([{ id: 'a', x: 35, y: 260 }], moved.groups);
    expect(child.positions).toEqual([{ id: 'a', x: 435, y: 760 }]);
    expect(child.groups.run!.members.a).toEqual({ x: 35, y: 260 });
    expect(groups.run.x).toBe(100);
    const nodes = [node('a', 'run'), node('b', 'run')];
    expect(reconcileWorkflowGroups(child.groups, [snapshot('run')], nodes, workflowNodeOwners(nodes, [], []))).toBe(child.groups);
  });
  it('expands the frame to the left and top without shifting other cards in world space', () => {
    const before = { r: { x: 100, y: 200, layoutVersion: 3, members: { a: { x: 24, y: 240 }, b: { x: 700, y: 240 } } } };
    const next = workflowGroupMoves([{ id: 'a', x: -50, y: 100 }], before);
    expect(next.groups.r).toMatchObject({ x: 26, y: 60, members: { a: { x: 24, y: 240 }, b: { x: 774, y: 380 } } });
    expect(next.positions).toEqual([{ id: 'a', x: 50, y: 300 }]);
    expect(next.groups.r!.x + next.groups.r!.members.b!.x).toBe(800);
    expect(next.groups.r!.y + next.groups.r!.members.b!.y).toBe(440);
  });
  it('reclaims a removed loading slot without moving existing cards or detached output', () => {
    const run = snapshot('r');
    const old = { r: { x: 0, y: 0, layoutVersion: 3, members: { a: {x:24,y:240}, 'workflow-initial-pending-p': {x:744,y:240} } } };
    const nodes = [node('a','r'),node('output','r')];
    const next = reconcileWorkflowGroups(old,[run],nodes,workflowNodeOwners(nodes,[],[run]));
    expect(next.r!.members).toEqual({a:{x:24,y:240},output:{x:744,y:240}});
    expect(reconcileWorkflowGroups(next,[run],nodes,workflowNodeOwners(nodes,[],[run]))).toBe(next);
  });
  it('uses actual widths and flow order when arranging, and upgrades old oversized layouts once', () => {
    const run = snapshot('r');
    run.definition.steps = ['first','last'].map(id => ({id,title:id,kind:'agent',dependsOn:[],failurePolicy:{kind:'stop'}}));
    run.steps = ['first','last'].map((id,i) => ({id,stepId:id,workflowRunId:'r',sequence:i,iteration:1,attempt:1,status:'succeeded',input:{},artifactRefs:[`canvas-node:${id}`]}));
    const nodes = [{...node('last','r'),width:420},{...node('first','r'),width:420}];
    const members = arrangeWorkflowMembers(nodes,run);
    expect(members).toEqual({first:{x:24,y:240},last:{x:524,y:240}});
    const upgraded = reconcileWorkflowGroups({r:{x:90,y:50,members:{last:{x:3000,y:250}}}},[run],nodes,workflowNodeOwners(nodes,[],[run]));
    expect(upgraded.r).toMatchObject({x:90,y:50,layoutVersion:3,members});
    expect(reconcileWorkflowGroups(upgraded,[run],nodes,workflowNodeOwners(nodes,[],[run]))).toBe(upgraded);
  });
  it('represents pending and skipped steps and selects the newest retry', () => {
    const run = snapshot('one');
    run.definition.steps = ['a', 'b', 'c'].map(id => ({ id, title: id, kind: 'agent', dependsOn: [], failurePolicy: { kind: 'stop' } }));
    const base = { workflowRunId: 'one', stepId: 'a', iteration: 1, attempt: 1, input: {}, artifactRefs: [] };
    run.steps = [{ ...base, id: 'old', sequence: 1, status: 'failed' }, { ...base, id: 'new', sequence: 3, attempt: 2, status: 'running' }, { ...base, stepId: 'b', id: 'skip', sequence: 2, status: 'skipped' }];
    expect(workflowRunSteps(run).map(s => [s.definition.id, s.status, s.step?.id])).toEqual([['a', 'running', 'new'], ['b', 'skipped', 'skip'], ['c', 'pending', undefined]]);
  });
  it('groups delivery refs and pending questions without manufacturing a card for every step', () => {
    const run = snapshot('one');
    run.clarification = { stepRunId: 'ask', content: 'question' };
    run.steps = [{ id: 'save', workflowRunId: 'one', stepId: 'save', sequence: 1, iteration: 1, attempt: 1, status: 'succeeded', input: {}, artifactRefs: ['canvas-node:document'] }];
    const owners = workflowNodeOwners([node('document')], [], [run]);
    expect([...owners]).toEqual([['workflow-question-one', 'one'], ['document', 'one']]);
  });
  it('connects actual input lineage through invisible steps and confirmation output without crossing runs', () => {
    const run = snapshot('r');
    const step = (id: string, upstream: string[], refs: string[] = []): WorkflowCanvasRun['steps'][number] => ({
      id, stepId: id, workflowRunId: 'r', sequence: 1, iteration: 1, attempt: 1, status: 'succeeded', input: {}, artifactRefs: refs.map(id => `canvas-node:${id}`),
      inputSnapshot: { version: 1, definitionDigest: 'd', capturedAt: '', task: {}, content: [], context: [], upstream: upstream.map(id => ({ stepRunId: id, stepId: id, title: id, kind: 'agent', iteration: 1, attempt: 1, outputDigest: 'd' })) },
    });
    run.steps = [step('brief', [], ['doc1']), step('analyze', ['brief']), step('confirm', ['analyze'], ['doc2']), step('execute', ['confirm']), step('deliver', ['execute'], ['doc3']), step('other', [], ['unrelated'])];
    const artifact = { id: 'result', workflowRunId: 'r', resultDefinitionId: 'confirm', sourceStepRunId: 'analyze' } as WorkflowResultArtifact;
    const nodes = ['doc3', 'unrelated', 'doc2', 'workflow-result-result', 'doc1'].map(id => node(id, 'r'));
    const links = workflowRunConnections(nodes, [artifact, { ...artifact, id: 'foreign', workflowRunId: 'other' }], [run]);
    expect(links.map(e => [e.source,e.target])).toEqual([['doc1','workflow-result-result'],['workflow-result-result','doc2'],['doc2','doc3']]);
    // A retry with another input must not inherit the previous confirmation's card.
    run.steps.push({ ...step('confirm-retry', ['other'], ['doc4']), stepId: 'confirm' });
    expect(workflowRunConnections([...nodes,node('doc4','r')],[artifact],[run]).map(e => [e.source,e.target])).toEqual([...links.map(e => [e.source,e.target]), ['unrelated','doc4']]);
  });

});


describe('workflow group canvas deletion', () => {
  it('persists removal across polling and hides late outputs while preserving detached and unrelated cards', () => {
    const groups = { r: { x: 0, y: 0, dismissed: true, layoutVersion: 3, members: { a: { x: 24, y: 240 } }, detached: ['outside'] } };
    const nodes = [node('a', 'r'), node('late', 'r'), node('outside', 'r'), node('unrelated')];
    const owners = workflowNodeOwners(nodes, [], [snapshot('r')]);
    expect([...dismissedWorkflowNodeIds(groups, nodes, owners)]).toEqual(['a', 'late']);
    expect(reconcileWorkflowGroups(groups, [snapshot('r')], nodes, owners)).toBe(groups);
    expect([...dismissedWorkflowNodeIds(JSON.parse(JSON.stringify(groups)), nodes, owners)]).toEqual(['a', 'late']);
  });
  it('undo restores the entire projection and edges without replacing new run data', () => {
    const history = new CanvasHistory();
    const before = { workbenchWorkflowRunGroups: { r: { x: 0, y: 0, members: {} } }, workbenchEdges: [{ id: 'ref', source: 'a', target: 'external' }] };
    const after = { workbenchWorkflowRunGroups: { r: { ...before.workbenchWorkflowRunGroups.r, dismissed: true } }, workbenchEdges: [] };
    history.record(before, after);
    const current = { ...after, unrelatedRunUpdate: 'new output arrived' };
    const undone = history.step(current);
    expect(undone.workbenchWorkflowRunGroups).toEqual(before.workbenchWorkflowRunGroups);
    expect(undone.workbenchEdges).toEqual(before.workbenchEdges);
    expect(undone.unrelatedRunUpdate).toBe('new output arrived');
    expect(history.step(undone, true).workbenchWorkflowRunGroups).toEqual(after.workbenchWorkflowRunGroups);
  });
});


describe('workflow group opt-in boundary', () => {
  it('keeps managed internal flows, their results and saved group flags outside the projection', () => {
    const legacy = snapshot('legacy');
    delete legacy.definition.canvasPresentation;
    const asset = snapshot('asset');
    const runs = [legacy, asset];
    const nodes = [node('gift', 'legacy'), node('document', 'asset'), node('ordinary')];
    const artifacts = [{ id: 'gift', workflowRunId: 'legacy' }] as WorkflowResultArtifact[];
    const saved = { legacy: { x: 90000, y: 500, collapsed: true, dismissed: true, members: { gift: { x: 20, y: 240 } } } };
    expect(workflowGroupRuns(runs)).toEqual([asset]);
    const owners = workflowNodeOwners(nodes, artifacts, runs);
    expect([...owners]).toEqual([['document', 'asset']]);
    expect(dismissedWorkflowNodeIds(saved, nodes, owners).size).toBe(0);
    expect(activeWorkflowGroups(saved, runs)).toEqual({});
    const move = workflowGroupMoves([{ id: 'gift', x: 10, y: 20 }], activeWorkflowGroups(saved, runs));
    expect(move.positions).toEqual([{ id: 'gift', x: 10, y: 20 }]);
    const groups = reconcileWorkflowGroups(saved, runs, nodes, owners);
    expect(groups.legacy).toBe(saved.legacy);
    expect(groups.asset?.x).toBeLessThan(90000);
    expect(Object.keys(groups.asset!.members)).toEqual(['document']);
    expect(workflowRunConnections(nodes, artifacts, [legacy])).toEqual([]);
    // Reload/poll and absent snapshots must never adopt nodes through stale source IDs.
    expect(workflowNodeOwners(nodes, artifacts, []).size).toBe(0);
    expect(activeWorkflowGroups(JSON.parse(JSON.stringify(saved)), runs)).toEqual({});
  });
});
