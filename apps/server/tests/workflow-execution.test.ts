import Database from './helpers/workflow-database.js';
import { describe, expect, it } from 'vitest';
import { GenericWorkflowGraphService, type WorkflowGraphNode } from '../src/workflows/generic-graph.js';
import { migrateWorkflows, reconcileWorkflowRuns } from '../src/workflows/persistence.js';
import { WorkflowResultService } from '../src/workflows/results.js';
import { WorkflowExecutionService, type WorkflowChildRun } from '../src/workflows/execution.js';

function harness(nodes?: WorkflowGraphNode[]) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p')");
  migrateWorkflows(db);
  const results = new WorkflowResultService(db);
  const writes: string[] = [];
  let storageFailure = false;
  const graph = new GenericWorkflowGraphService(db, results, { async materialize(input) {
    if (storageFailure) throw new Error('disk unavailable');
    writes.push(input.content);
    return { canvasNodeId: `node-${input.stepRunId}`, kind: input.kind, revision: writes.length };
  } });
  graph.register();
  const graphNodes: WorkflowGraphNode[] = nodes ?? [
    { id: 'a', kind: 'agent', title: '写文案', description: '正文', agentConfig: { outputContract: { format: 'markdown' } } },
    { id: 'b', kind: 'agent', title: '润色', description: '修改', agentConfig: { outputContract: { format: 'markdown' } } },
    { id: 'save', kind: 'delivery', title: '文本', description: '', deliveryConfig: { artifactKind: 'text' } },
  ];
  graph.saveConfig({ id: 'flow', title: 'Flow', version: 2, updatedAt: '2026-09-11',
    nodes: [{ id: 'start', kind: 'start', title: '开始', description: '' }, ...graphNodes],
    edges: graphNodes.map((node, index) => ({ id: `e${index}`, source: graphNodes[index - 1]?.id ?? 'start', target: node.id })),
  });
  const runId = graph.start({ projectId: 'p', workflowId: 'flow' }).snapshot.run.id;
  const children = new Map<string, WorkflowChildRun>();
  let submissions = 0;
  const requests: Record<string, unknown>[] = [];
  let responseLost = false;
  let revoked = false;
  const ports = {
    async authorize() { if (revoked) throw new Error('authority revoked'); }, async knowledge() { return ''; },
    child: (id: string) => children.get(id) ?? null,
    findChild: (_: string, key: string) => [...children.values()].find(child => child.clientRequestId === key) ?? null,
    async cancel(id: string) { const child = children.get(id); if (child) child.status = 'canceled'; },
    async dispatch(body: Record<string, unknown>) {
      requests.push(body);
      submissions += 1;
      const id = `child-${submissions}`;
      children.set(id, { id, status: 'running', clientRequestId: String(body.clientRequestId) });
      if (responseLost) { responseLost = false; throw new Error('response lost'); }
      return { runId: id };
    },
  };
  let execution = new WorkflowExecutionService(db, graph, ports);
  return {
    db, graph, results, children, writes, runId, requests,
    get execution() { return execution; },
    get submissions() { return submissions; },
    storageFailure(value: boolean) { storageFailure = value; },
    loseResponse() { responseLost = true; },
    revoke() { revoked = true; },
    restart() { execution.stop(); reconcileWorkflowRuns(db); execution = new WorkflowExecutionService(db, graph, ports); },
    async accept() { await execution.accept(runId, {}, {}, false); await execution.advance(runId); },
    async finish(status = 'succeeded', text = '真实正文') {
      const child = [...children.values()].at(-1)!;
      child.status = status; child.assistantText = text;
      await execution.advance(runId);
    },
  };
}

describe('durable canvas workflow execution', () => {
  it('pins API execution without storing credentials or falling back after restart', async () => {
    const h = harness();
    const snapshot = { mode: 'api' as const, model: 'selected/model', byokProvider: { protocol: 'openai' as const, apiKey: 'secret-snapshot', baseUrl: 'https://example.test/v1' } };
    await h.execution.accept(h.runId, { snapshot }, {}, false);
    await h.execution.advance(h.runId);
    expect(h.requests[0]).toMatchObject({ agentId: 'byok-opencode', model: 'selected/model', byokProvider: snapshot.byokProvider });
    expect(JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_owners').all())).not.toContain('secret-snapshot');
    expect(JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_steps').all())).not.toContain('secret-snapshot');
    h.restart();
    await h.finish();
    expect(h.submissions).toBe(1);
    expect(h.execution.status(h.runId).error).toMatch(/snapshot|配置|凭据/i);
    await h.execution.accept(h.runId, { snapshot }, {}, false);
    await h.execution.control(h.runId, 'recover');
    expect(h.requests[1]).toMatchObject({ agentId: 'byok-opencode', byokProvider: snapshot.byokProvider });
    h.db.close();
  });
  it('adopts matching legacy CLI owner without duplicating its existing child', async () => {
    const h = harness();
    await h.execution.accept(h.runId, { agentId: 'codex', model: 'm' }, {}, false);
    await h.execution.advance(h.runId);
    await h.execution.accept(h.runId, { snapshot: { mode: 'cli', agentId: 'codex', model: 'm' } }, {}, false);
    await h.execution.advance(h.runId);
    expect(h.submissions).toBe(1);
    h.db.close();
  });
  it('rejects conflicting node CLI overrides instead of falling back from API', async () => {
    const h = harness([{ id: 'a', kind: 'agent', title: '写', description: '', agentConfig: { agentId: 'codex' } }]);
    await h.execution.accept(h.runId, { snapshot: { mode: 'api', model: 'm', byokProvider: { protocol: 'openai', apiKey: 'key' } } }, {}, false);
    await h.execution.advance(h.runId);
    expect(h.submissions).toBe(0);
    expect(h.execution.status(h.runId).error).toContain('冲突');
    h.db.close();
  });
  it('rejects provider/model changes on recovery instead of changing run identity', async () => {
    const h = harness();
    const snapshot = { mode: 'api' as const, model: 'm', byokProvider: { protocol: 'openai' as const, apiKey: 'key' } };
    await h.execution.accept(h.runId, { snapshot }, {}, false);
    await expect(h.execution.accept(h.runId, { snapshot: { ...snapshot, model: 'other' } }, {}, false)).rejects.toThrow('配置');
    expect(h.submissions).toBe(0);
    h.db.close();
  });
  it('does not persist malformed provider option objects in workflow owners', async () => {
    const h = harness();
    await expect(h.execution.accept(h.runId, { snapshot: { mode: 'api', model: 'm', byokProvider: { protocol: 'openai', apiKey: 'key', baseUrl: { apiKey: 'nested-test-secret' } } } as never }, {}, false)).rejects.toThrow();
    expect(h.db.prepare('SELECT * FROM workflow_execution_owners').all()).toEqual([]);
    expect(h.db.prepare('SELECT * FROM workflow_execution_steps').all()).toEqual([]);
    h.db.close();
  });
  it.each(['https://user:url-secret@gateway.example/v1', 'https://gateway.example/v1#url-secret'])('rejects URL-carried credentials before registering an owner: %s', async baseUrl => {
    const h = harness();
    try {
      await expect(h.execution.accept(h.runId, { snapshot: { mode: 'api', model: 'm', byokProvider: { protocol: 'openai', apiKey: 'key', baseUrl } } }, {}, false)).rejects.toThrow(/apiKey.*apiVersion/);
      expect(h.db.prepare('SELECT * FROM workflow_execution_owners').all()).toEqual([]);
      expect(h.db.prepare('SELECT * FROM workflow_execution_steps').all()).toEqual([]);
      expect(h.submissions).toBe(0);
    } finally { h.db.close(); }
  });
  it('runs query gateways without persisting URLs and restores only matching endpoint identity', async () => {
    const h = harness();
    const snapshot = { mode: 'api' as const, model: 'm', byokProvider: { protocol: 'openai' as const, apiKey: 'key', baseUrl: 'https://private-gateway.example/private-path?api_key=query-secret&tenant=a' } };
    try {
      await h.execution.accept(h.runId, { snapshot }, {}, false);
      await h.execution.advance(h.runId);
      expect(h.requests[0]?.byokProvider).toEqual(snapshot.byokProvider);
      expect(JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_owners').all())).not.toMatch(/private-gateway|private-path|query-secret|api_key/);
      expect(JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_steps').all())).not.toMatch(/private-gateway|query-secret/);
      h.restart();
      await h.finish();
      expect(h.submissions).toBe(1);
      expect(h.execution.status(h.runId).error).toMatch(/snapshot/);
      await expect(h.execution.accept(h.runId, { snapshot: { ...snapshot, byokProvider: { ...snapshot.byokProvider, baseUrl: snapshot.byokProvider.baseUrl + 'b' } } }, {}, false)).rejects.toThrow(/配置/);
      const refreshed = { ...snapshot, byokProvider: { ...snapshot.byokProvider, apiKey: 'rotated-key' } };
      await h.execution.accept(h.runId, { snapshot: refreshed }, {}, false);
      await h.execution.control(h.runId, 'recover');
      expect(h.requests[1]?.byokProvider).toEqual(refreshed.byokProvider);
    } finally { h.db.close(); }
  });
  it('upgrades matching legacy safe API identity to a fingerprint on explicit recovery', async () => {
    const h = harness();
    const snapshot = { mode: 'api' as const, model: 'm', byokProvider: { protocol: 'openai' as const, apiKey: 'key', baseUrl: 'https://gateway.example/v1' } };
    try {
      await h.execution.accept(h.runId, { snapshot }, {}, false);
      h.db.prepare('UPDATE workflow_execution_owners SET config_json = ? WHERE run_id = ?').run(JSON.stringify({ agentId: 'byok-opencode', model: 'm', snapshot: { ...snapshot, byokProvider: { ...snapshot.byokProvider, apiKey: '' } } }), h.runId);
      h.restart();
      await h.execution.accept(h.runId, { snapshot }, {}, false);
      const stored = JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_owners').all());
      expect(stored).toContain('endpointFingerprint');
      expect(stored).not.toContain('gateway.example');
    } finally { h.db.close(); }
  });
  it('rejects incomplete API snapshot before registering an owner', async () => {
    const h = harness();
    await expect(h.execution.accept(h.runId, { snapshot: { mode: 'api', model: 'x' } as never }, {}, false)).rejects.toThrow(/provider|snapshot|配置/i);
    expect(h.execution.owns(h.runId)).toBe(false);
    expect(h.submissions).toBe(0);
    h.db.close();
  });
  it('does not inherit a different provider model when a node overrides the agent', async () => {
    const h = harness([{ id: 'a', kind: 'agent', title: '写', description: '', agentConfig: { agentId: 'sample-agent' } }]);
    await h.execution.accept(h.runId, { agentId: 'codex', model: 'codex-model' }, {}, false);
    await h.execution.advance(h.runId);
    expect(h.requests[0]?.agentId).toBe('sample-agent');
    expect(h.requests[0]?.model).toBeUndefined();
    h.db.close();
  });
  it.each([
    [{ agentId: 'codex' }, 'codex-model'],
    [{}, 'codex-model'],
    [{ agentId: 'sample-agent', modelId: 'flicker-model' }, 'flicker-model'],
  ])('preserves matching-provider and explicit node model choices: %j', async (agentConfig, expected) => {
    const h = harness([{ id: 'a', kind: 'agent', title: '写', description: '', agentConfig }]);
    await h.execution.accept(h.runId, { agentId: 'codex', model: 'codex-model' }, {}, false);
    await h.execution.advance(h.runId);
    expect(h.requests[0]?.model).toBe(expected);
    h.db.close();
  });
  it('resumes progressed input and sends upstream content only once without losing root facts', async () => {
    const h = harness(); h.graph.cancel(h.runId);
    const input = { projectId: 'p', workflowId: 'flow', value: { userPrompt: 'root-fact', audience: 'designers' } };
    const run = h.graph.startOrResumeActive(input);
    await h.execution.accept(run.snapshot.run.id, {}, {}, false);
    await h.execution.advance(run.snapshot.run.id);
    const child = [...h.children.values()][0]!;
    child.status = 'succeeded'; child.assistantText = 'unique-upstream-payload';
    await h.execution.advance(run.snapshot.run.id);
    expect(h.graph.startOrResumeActive(input).snapshot.run.id).toBe(run.snapshot.run.id);
    expect(h.graph.startOrResumeActive({ ...input, value: { audience: 'designers', userPrompt: 'root-fact' } }).snapshot.run.id).toBe(run.snapshot.run.id);
    const message = String(h.requests[1]?.message);
    expect(message).toContain('root-fact');
    expect(message.split('unique-upstream-payload')).toHaveLength(2);
    expect(h.graph.getRun(run.snapshot.run.id)?.run.variables.workflowContext).toBeDefined();
    h.db.close();
  });
  it('stops an active child when authority is revoked and does not save its late result', async () => {
    const h = harness(); await h.accept(); h.revoke(); await h.execution.advance(h.runId);
    expect([...h.children.values()][0]?.status).toBe('canceled');
    expect(h.execution.status(h.runId).error).toContain('authority');
    await h.finish(); expect(h.writes).toHaveLength(0); expect(h.submissions).toBe(1); h.db.close();
  });
  it('restores a waiting selection and deduplicates repeated clicks with different UI request ids', async () => {
    const h = harness([
      { id: 'a', kind: 'agent', title: '写', description: '', agentConfig: { outputContract: { format: 'markdown' } } },
      { id: 'review', kind: 'review', title: '确认', description: '', reviewConfig: { selection: 'none', selectionRequired: false, feedbackEnabled: true, feedbackRequired: false, allowRegenerate: true } },
      { id: 'b', kind: 'agent', title: '润色', description: '', agentConfig: { outputContract: { format: 'markdown' } } },
      { id: 'save', kind: 'delivery', title: '正文', description: '', deliveryConfig: { artifactKind: 'text' } },
    ]);
    await h.accept(); await h.finish(); h.restart(); await h.execution.advance(h.runId);
    expect(h.submissions).toBe(1); expect(h.graph.current(h.runId).next.kind).toBe('review');
    const result = h.results.list({ projectId: 'p' })[0]!;
    const request = { resultId: result.id, actionId: 'continue', expectedVersion: result.version, selectedIds: [], idempotencyKey: 'click-1' };
    const first = await h.results.interact(request);
    const confirmedWrites = h.writes.length;
    const second = await h.results.interact({ ...request, idempotencyKey: 'click-2' });
    expect(second.interactionId).toBe(first.interactionId);
    expect(h.writes).toHaveLength(confirmedWrites);
    expect(h.db.prepare('SELECT count(*) AS n FROM workflow_result_interactions').get()).toEqual({ n: 1 });
    await h.execution.advance(h.runId); expect(h.submissions).toBe(2);
    await h.finish(); expect(h.writes).toHaveLength(confirmedWrites + 1); h.db.close();
  });
  it('keeps an execution recovery error when merely reconnecting', async () => {
    const h = harness(); h.loseResponse(); await h.accept();
    await h.execution.accept(h.runId, {}, {}, false);
    expect(h.execution.status(h.runId).error).toContain('response lost');
    expect(h.submissions).toBe(1); h.db.close();
  });
  it('deduplicates the start receipt after completion and rejects different input', async () => {
    const h = harness(); h.graph.cancel(h.runId);
    const input = { projectId: 'p', workflowId: 'flow', requestId: 'stable', value: { userPrompt: '正文' } };
    const first = h.graph.startOrResumeActive(input);
    h.graph.cancel(first.snapshot.run.id);
    expect(h.graph.startOrResumeActive(input).snapshot.run.id).toBe(first.snapshot.run.id);
    expect(() => h.graph.startOrResumeActive({ ...input, value: { userPrompt: '其他' } })).toThrow();
    h.db.close();
  });
  it('serializes concurrent delivery and never rewrites the saved artifact', async () => {
    const h = harness(); await h.accept(); await h.finish(); h.storageFailure(true); await h.finish();
    h.storageFailure(false);
    const next = h.graph.current(h.runId).next;
    if (next.kind !== 'delivery') throw new Error('missing delivery');
    const input = { runId: h.runId, stepRunId: next.stepRunId };
    await Promise.all([h.graph.completeDelivery(input), h.graph.completeDelivery(input)]);
    await h.graph.completeDelivery(input);
    expect(h.writes).toHaveLength(1); h.db.close();
  });
  it('runs consecutive steps and delivers once without a browser terminal handler', async () => {
    const h = harness();
    await h.accept(); await h.accept();
    expect(h.submissions).toBe(1);
    await h.finish(); expect(h.submissions).toBe(2);
    await h.finish(); await h.execution.advance(h.runId);
    expect(h.graph.getRun(h.runId)?.run.status).toBe('succeeded');
    expect(h.writes).toHaveLength(1);
    expect(h.graph.getRun(h.runId)?.steps.filter(step => step.childRunId)).toHaveLength(2);
    h.db.close();
  });
  it('reconciles a lost acceptance response by the persisted step request key', async () => {
    const h = harness(); h.loseResponse(); await h.accept();
    expect(h.execution.status(h.runId).error).toContain('response lost');
    await h.execution.control(h.runId, 'recover');
    expect(h.submissions).toBe(1);
    expect(h.execution.status(h.runId).error).toBeUndefined();
    h.db.close();
  });
  it('restores a managed running step and ignores later edits to the definition', async () => {
    const h = harness(); await h.accept();
    h.graph.deleteConfig('flow'); h.restart();
    expect(h.graph.getRun(h.runId)?.run.status).toBe('running');
    await h.execution.advance(h.runId); expect(h.submissions).toBe(1);
    await h.finish(); await h.finish();
    expect(h.writes).toHaveLength(1);
    h.db.close();
  });
  it('retries only the failed step and keeps successful predecessors', async () => {
    const h = harness(); await h.accept(); await h.finish(); await h.finish('failed');
    const step = h.graph.getRun(h.runId)!.steps.find(item => item.status === 'failed')!;
    await h.execution.control(h.runId, 'retry', step.id);
    await h.execution.control(h.runId, 'retry', step.id);
    expect(h.submissions).toBe(3);
    expect(h.graph.getRun(h.runId)!.steps.filter(item => item.stepId === 'a')).toHaveLength(1);
    await h.finish(); expect(h.writes).toHaveLength(1);
    h.db.close();
  });
  it('restores saving without regenerating any output', async () => {
    const h = harness(); await h.accept(); await h.finish(); h.storageFailure(true); await h.finish();
    expect(h.execution.status(h.runId).error).toContain('disk');
    h.restart(); h.storageFailure(false);
    await h.execution.control(h.runId, 'recover');
    expect(h.submissions).toBe(2); expect(h.writes).toHaveLength(1);
    h.db.close();
  });
  it('does not advance a cancelled run when a late model result arrives', async () => {
    const h = harness(); await h.accept(); await h.execution.control(h.runId, 'cancel'); await h.finish();
    expect(h.submissions).toBe(1); expect(h.writes).toHaveLength(0);
    expect(h.graph.current(h.runId).next.kind).toBe('cancelled'); h.db.close();
  });
  it('restores a clarification and accepts an identical answer only once', async () => {
    const h = harness([
      { id: 'ask', kind: 'clarify', title: '问题', description: '', clarificationConfig: { questions: [{ id: 'brief', titleMode: 'manual', type: 'text', title: '要求' }] } },
      { id: 'a', kind: 'agent', title: '写', description: '' },
    ]);
    await h.accept(); const next = h.graph.current(h.runId).next;
    if (next.kind !== 'clarify') throw new Error('missing question');
    await h.finish('succeeded', `<question-form title="需求" id="workflow-${h.runId}-${next.stepRunId}">{"questions":[{"id":"brief","label":"要求","type":"text"}]}</question-form>`);
    h.restart(); await h.execution.advance(h.runId); expect(h.submissions).toBe(1);
    expect(h.execution.clarification(h.runId)).toMatchObject({ stepRunId: next.stepRunId, content: expect.stringContaining('<question-form') });
    const answer = { runId: h.runId, stepRunId: next.stepRunId, values: { brief: '简短' } };
    h.graph.submitClarification(answer); h.graph.submitClarification(answer);
    expect(h.execution.clarification(h.runId)).toBeUndefined();
    await h.execution.advance(h.runId); expect(h.submissions).toBe(2);
    expect(() => h.graph.submitClarification({ ...answer, values: { brief: '不同答案' } })).toThrow();
    h.db.close();
  });
});

