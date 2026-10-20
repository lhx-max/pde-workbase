import { createHash } from 'node:crypto';
import Database from './helpers/workflow-database.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { WORKFLOW_EXECUTION_CONFIRMATION, type WorkflowResultArtifact } from '@bezier/contracts';
import { GenericWorkflowGraphService, type WorkflowGraphConfig } from '../src/workflows/generic-graph.js';
import { migrateWorkflows } from '../src/workflows/persistence.js';
import { WorkflowResultService } from '../src/workflows/results.js';


function freshHarness(): {
  service: GenericWorkflowGraphService;
  results: WorkflowResultService;
  materialized: Array<{ projectId: string; sourceAgentStepRunId?: string; sourceResultId?: string; sourceItemIds?: string[]; kind: string; title: string; content: string }>;
} {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO projects VALUES ('project-1', 'Project', 0, 0);
  `);
  migrateWorkflows(db);
  const results = new WorkflowResultService(db);
  const materialized: Array<{ projectId: string; sourceAgentStepRunId?: string; sourceResultId?: string; sourceItemIds?: string[]; kind: string; title: string; content: string }> = [];
  const service = new GenericWorkflowGraphService(db, results, {
    materialize: async ({ projectId, ...input }) => {
      materialized.push({
        projectId,
        ...(input.sourceAgentStepRunId ? { sourceAgentStepRunId: input.sourceAgentStepRunId } : {}),
        ...(input.sourceResultId ? { sourceResultId: input.sourceResultId } : {}),
        ...(input.sourceItemIds?.length ? { sourceItemIds: input.sourceItemIds } : {}),
        kind: input.kind,
        title: input.title,
        content: input.content,
      });
      return {
        canvasNodeId: `canvas-${input.stepRunId}`,
        kind: input.kind,
        revision: materialized.length,
      };
    },
  });
  service.register();
  return { service, results, materialized };
}

function freshService(): GenericWorkflowGraphService {
  return freshHarness().service;
}

function config(
  nodes: NonNullable<WorkflowGraphConfig['nodes']>,
  edges: NonNullable<WorkflowGraphConfig['edges']>,
): WorkflowGraphConfig {
  return {
    id: 'stable-flow',
    version: 2,
    title: 'Stable flow',
    updatedAt: '2026-08-26T00:00:00.000Z',
    nodes,
    edges,
  };
}

describe('generic workflow graph', () => {

  it('persists report edits, preserves the original version and confirms edited content', async () => {
    const { service, results } = freshHarness();
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'generate', kind: 'agent', title: '方案', description: '' },
      { id: 'review', kind: 'review', title: '选择方案', description: '', reviewConfig: { selection: 'single', materializeOnConfirm: false } },
    ], [{ id: 'a', source: 'start', target: 'generate' }, { id: 'b', source: 'generate', target: 'review' }]));
    const run = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const report = { version: 1, label: '目标报告', facts: [{ label: '生产数量', value: '3' }], sections: [], references: [], checks: [] };
    service.completeAgent({ runId: run.snapshot.run.id, stepRunId: run.next.kind === 'agent' ? run.next.stepRunId : '', output: [{ title: '方案一', report }] });
    const original = results.list({ projectId: 'project-1' })[0]!;
    expect(original.actions.some(action => action.id === 'edit-report')).toBe(true);
    const edited = { ...report, facts: [], document: '## 自定义方案\n\n生产数量改为 6，可以自由修改整篇正文。' };
    const request = { resultId: original.id, actionId: 'edit-report', expectedVersion: 1, itemId: '1', selectedIds: ['1'], feedback: '保留反馈', surface: 'canvas' as const, patch: { report: JSON.stringify(edited) }, idempotencyKey: 'edit-one' };
    await results.interact(request);
    await results.interact(request);
    expect(results.get(original.id)?.artifact).toMatchObject({ version: 2, feedbackValue: '保留反馈', items: [{ data: { report: edited } }] });
    expect(original.items?.[0]?.data).toEqual({ title: '方案一', report });
    await expect(results.interact({ ...request, idempotencyKey: 'stale', patch: { report: JSON.stringify(report) } })).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_VERSION_CONFLICT' });
    await expect(results.interact({ ...request, expectedVersion: 2, idempotencyKey: 'invalid', patch: { report: '{}' } })).rejects.toMatchObject({ code: 'WORKFLOW_REPORT_INVALID' });
    await results.interact({ resultId: original.id, actionId: 'continue', expectedVersion: 2, selectedIds: ['1'], idempotencyKey: 'confirm' });
    const review = service.getRun(run.snapshot.run.id)!.steps.find(step => step.stepId === 'review');
    expect(review?.output).toMatchObject({ result: { report: edited } });
    await expect(results.interact({ ...request, expectedVersion: 2, idempotencyKey: 'after-confirm', patch: { report: JSON.stringify(report) } })).rejects.toMatchObject({ code: 'WORKFLOW_REPORT_ALREADY_CONFIRMED' });
  });

  let service: GenericWorkflowGraphService;

  beforeEach(() => {
    service = freshService();
  });

  it.each(['write_script', '写脚本', 'write-', 'Start'])('rejects unsupported node ID %s with an actionable rule', (id) => {
    const graph = config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id, kind: 'agent', title: '写脚本', description: '' },
    ], [{ id: 'start-execute', source: 'start', target: id }]);
    expect(() => service.saveConfig(graph)).toThrow(`节点 ID 无效或重复：${id}`);
    expect(() => service.saveConfig(graph)).toThrow('小写字母开头的短横线命名');
  });

  it('namespaces compiled definition digests away from legacy canvas-only hashes', () => {
    const graph = config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '' },
    ], [{ id: 'start-execute', source: 'start', target: 'execute' }]);
    const legacyDigest = createHash('sha256').update(JSON.stringify(graph)).digest('hex');

    service.saveConfig(graph);
    const started = service.start({ projectId: 'project-1', workflowId: graph.id });

    expect(started.snapshot.definition.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(started.snapshot.definition.digest).not.toBe(legacyDigest);
  });

  it('discovers canvas workflows from WORKFLOW.md without a second scenario source', () => {
    service.saveConfig(config([
      {
        id: 'start',
        kind: 'start',
        title: '开始',
        description: '',
        startConfig: {
          workflowMarkdown: [
            '---',
            'id: stable-flow',
            'name: 稳定流程',
            'description: 当用户需要稳定性验证时使用',
            'scenarios:',
            '  - 这条旧表达不应进入发现目录',
            '---',
            '',
            '仅在需要验证工作流闭环时启动。',
          ].join('\n'),
        },
      },
      { id: 'execute', kind: 'agent', title: '执行', description: '验证流程' },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
    ]));

    const catalog = service.renderDiscoveryCatalog();
    expect(catalog).toContain('匹配说明：当用户需要稳定性验证时使用');
    expect(catalog).toContain('仅在需要验证工作流闭环时启动。');
    expect(catalog).not.toContain('这条旧表达不应进入发现目录');

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.snapshot.run.variables.workflow).toEqual({
      title: '稳定流程',
      description: '当用户需要稳定性验证时使用',
      projectId: 'project-1',
    });
  });

  it('runs inquiry -> current Agent -> automatic deliverable component and carries inquiry output forward', async () => {
    const harness = freshHarness();
    service = harness.service;
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'ask',
        kind: 'clarify',
        title: '询问',
        description: '补齐目标用户',
        clarificationConfig: {
          title: '补充任务信息',
          description: '默认用户来自企业；不要重复询问所属平台。',
          submitLabel: '开始策划',
          questions: [{
            id: 'audience',
            titleMode: 'manual',
            title: '目标用户是谁？',
            type: 'text',
            required: true,
            allowOther: false,
          }],
        },
      },
      {
        id: 'execute',
        kind: 'agent',
        title: '执行',
        description: '生成方案',
        agentConfig: { systemPrompt: '根据已经收集的信息生成方案。' },
      },
      {
        id: 'result',
        kind: 'delivery',
        title: '结果',
        description: '展示方案',
        deliveryConfig: { artifactKind: 'document' },
      },
    ], [
      { id: 'start-ask', source: 'start', target: 'ask' },
      { id: 'ask-execute', source: 'ask', target: 'execute' },
      { id: 'execute-result', source: 'execute', target: 'result' },
    ]));
    const persisted = service.getConfig('stable-flow')!;
    expect(persisted.nodes?.find(node => node.id === 'result')).toMatchObject({
      kind: 'delivery',
      deliveryConfig: { artifactKind: 'document' },
    });
    expect(persisted.nodes?.find(node => node.id === 'execute')?.agentConfig?.confirmation)
      .toBeUndefined();

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next).toMatchObject({ kind: 'clarify', node: { id: 'ask' } });
    expect(started.snapshot.run.status).toBe('awaiting-input');
    expect(started.next.kind === 'clarify' ? started.next.prompt : '').toContain('workflow="stable-flow"');
    expect(started.next.kind === 'clarify' ? started.next.prompt : '').toContain('目标用户是谁？');
    expect(started.next.kind === 'clarify' ? started.next.prompt : '')
      .toContain('本节点的询问边界（优先级高于通用澄清习惯）：默认用户来自企业；不要重复询问所属平台。');
    expect(started.next.kind === 'clarify' ? started.next.prompt : '').toContain('"submitLabel":"开始策划"');

    const afterInquiry = service.submitClarification({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
      values: { audience: '设计师' },
    });
    expect(afterInquiry.next).toMatchObject({ kind: 'agent', node: { id: 'execute' } });
    expect(afterInquiry.next.kind === 'agent' ? afterInquiry.next.prompt : '')
      .toContain('"audience":"设计师"');
    expect(afterInquiry.next.kind === 'agent' ? afterInquiry.next.prompt : '')
      .not.toContain('根据已经收集的信息生成方案。');
    expect(afterInquiry.snapshot.run.variables).toMatchObject({
      workflowContext: {
        nodeOutputs: { ask: { audience: '设计师' } },
      },
    });

    const afterAgent = service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: afterInquiry.next.kind === 'agent' ? afterInquiry.next.stepRunId : '',
      output: { title: '方案', content: '正文' },
    });
    expect(afterAgent.next).toMatchObject({ kind: 'delivery', node: { id: 'result' } });
    expect(afterAgent.snapshot.run.status).toBe('awaiting-input');

    // Delivery nodes are not review/result cards. They materialize the final
    // content into the canvas artifact component when the delivery step runs.
    expect(harness.results.list({ projectId: 'project-1' })).toEqual([]);
    const delivery = await service.completeDelivery({
      runId: started.snapshot.run.id,
      stepRunId: afterAgent.next.kind === 'delivery' ? afterAgent.next.stepRunId : '',
    });
    expect(delivery.next).toEqual({ kind: 'completed' });
    expect(delivery.artifact).toEqual({
      canvasNodeId: expect.stringMatching(/^canvas-/),
      kind: 'text',
      revision: 1,
    });
    expect(harness.materialized).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        kind: 'text',
        title: '结果',
        content: '正文',
      }),
    ]);
    const completed = service.getRun(started.snapshot.run.id)!;
    expect(completed.run.status).toBe('succeeded');
    expect(completed.run.variables).toMatchObject({
      workflowContext: {
        nodeOutputs: {
          ask: { audience: '设计师' },
          execute: { title: '方案', content: '正文' },
          result: {
            delivered: true,
            artifactKind: 'text',
            canvasNodeId: delivery.artifact.canvasNodeId,
            canvasRevision: 1,
          },
        },
        latestNodeId: 'result',
      },
    });

  });

  it('keeps confirmation before delivering the accepted artifact', async () => {
    const harness = freshHarness();
    service = harness.service;
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '执行', description: '',
        agentConfig: {
          outputContract: { format: 'markdown', requiredText: ['# 正文'] },
          confirmation: {
            enabled: true, selection: 'single', selectionRequired: true,
            feedbackEnabled: true, feedbackRequired: false, allowRegenerate: true,
            continueLabel: '确认并继续', artifactKind: 'text',
          },
        },
      },
      { id: 'delivery', kind: 'delivery', title: '正文', description: '', deliveryConfig: { artifactKind: 'text' } },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
      { id: 'execute-delivery', source: 'execute', target: 'delivery' },
    ]));

    expect(service.getConfig('stable-flow')?.nodes?.find(node => node.id === 'execute')?.agentConfig?.confirmation).toBeDefined();
    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const afterAgent = await service.completeAgentAndDelivery({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: '# 正文\n\n已生成的正文',
    });
    expect(afterAgent.next.kind).toBe('review');
    expect(afterAgent.snapshot.steps.some(step => step.stepId === 'execute-confirmation')).toBe(true);
    expect(harness.materialized).toHaveLength(0);
    const result = harness.results.list({ projectId: 'project-1' })[0]!;
    await harness.results.interact({ resultId: result.id, actionId: 'continue', expectedVersion: result.version, selectedIds: ['result'], idempotencyKey: 'confirm-before-delivery' });
    expect(harness.materialized).toHaveLength(1);
    expect(harness.materialized[0]).toMatchObject({ title: '正文', content: '# 正文\n\n已生成的正文' });
  });

  it('pauses a simple execution checkpoint without selecting candidates or creating canvas output', async () => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '分析', description: '', agentConfig: { confirmation: { ...WORKFLOW_EXECUTION_CONFIRMATION }, outputContract: { format: 'markdown' } } },
    ], [{ id: 'a', source: 'start', target: 'execute' }]));
    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const completed = await harness.service.completeAgentAndDelivery({ runId: started.snapshot.run.id, stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '', output: '# 分析\n\n确认这一方向。' });
    expect(completed.next.kind).toBe('review');
    const result = harness.results.list({ projectId: 'project-1' })[0]!;
    await harness.results.interact({ resultId: result.id, actionId: 'continue', expectedVersion: result.version, selectedIds: [], idempotencyKey: 'simple-continue' });
    expect(harness.service.getRun(started.snapshot.run.id)?.run.status).toBe('succeeded');
    expect(harness.materialized).toEqual([]);
  });

  it.each(['single', 'multiple'] as const)('preserves %s checkpoint settings through save, execution and confirmation', async selection => {
    const harness = freshHarness();
    const confirmation = { ...WORKFLOW_EXECUTION_CONFIRMATION, title: '选择执行方案', selection, selectionRequired: true, feedbackRequired: true, allowRegenerate: false, continueLabel: '采用方案' };
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '', agentConfig: { confirmation } },
    ], [{ id: 'a', source: 'start', target: 'execute' }]));
    const saved = harness.service.getConfig('stable-flow')!;
    harness.service.saveConfig(saved);
    expect(harness.service.getConfig('stable-flow')?.nodes?.[1]?.agentConfig?.confirmation).toMatchObject({ ...confirmation, chat: { selection, selectionRequired: true, feedbackRequired: true, allowRegenerate: false }, canvas: { enabled: true, selection, selectionRequired: true, feedbackRequired: true, allowRegenerate: false } });
    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain(selection === 'single' ? '单选' : '多选');
    await harness.service.completeAgentAndDelivery({ runId: started.snapshot.run.id, stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '', output: { items: [{ title: '方向一', content: '方案一' }, { title: '方向二', content: '方案二' }, { title: '方向三', content: '方案三' }] } });
    const result = harness.results.list({ projectId: 'project-1' })[0]!;
    expect(result).toMatchObject({ title: '选择执行方案', surfaces: ['chat', 'canvas'], selection: { mode: selection, min: 1 }, chatSelection: { mode: selection, min: 1 }, feedback: { required: true }, chatFeedback: { required: true } });
    expect(result.chatActions?.map(action => action.label)).toEqual(['采用方案']);
    expect(result.actions.map(action => action.label)).toEqual(['采用方案']);
    const surface = selection === 'single' ? 'chat' : 'canvas';
    await expect(harness.results.interact({ resultId: result.id, actionId: 'continue', surface, expectedVersion: result.version, selectedIds: [], idempotencyKey: 'invalid-empty' })).rejects.toThrow();
    await harness.results.interact({ resultId: result.id, actionId: 'continue', surface, expectedVersion: result.version, selectedIds: [result.items![0]!.id], feedback: '采用这个方向', idempotencyKey: 'configured-continue' });
    expect(harness.service.getRun(started.snapshot.run.id)?.run.status).toBe('succeeded');
    expect(harness.materialized).toEqual([]);
  });

  it.each([
    { artifactKind: 'presentation' as const, artifactName: '客户方案', requirements: '面向决策者', presentation: { pages: 8 } },
    { artifactKind: 'video' as const, artifactName: '', requirements: '简洁产品演示', video: { ratio: '16:9', duration: 10 } },
  ])('persists and passes $artifactKind delivery requirements to execution', async deliveryConfig => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '' },
      { id: 'delivery', kind: 'delivery', title: '产物', description: '', deliveryConfig },
    ], [{ id: 'a', source: 'start', target: 'execute' }, { id: 'b', source: 'execute', target: 'delivery' }]));
    expect(harness.service.getConfig('stable-flow')?.nodes?.find(node => node.id === 'delivery')?.deliveryConfig).toEqual(deliveryConfig);
    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const prompt = started.next.kind === 'agent' ? started.next.prompt : '';
    expect(prompt).toContain(deliveryConfig.requirements);
    expect(prompt).toContain(deliveryConfig.artifactKind === 'presentation' ? '"pages":8' : '"duration":10');
    const output = `<workflow-artifacts>${JSON.stringify({ artifacts: [{ nodeId: 'delivery', kind: deliveryConfig.artifactKind, path: 'artifact.html', title: '自动产物名称' }] })}</workflow-artifacts>`;
    const completed = await harness.service.completeAgentAndDelivery({ runId: started.snapshot.run.id, stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '', output });
    expect(completed.next.kind).toBe('completed');
    expect(harness.materialized[0]?.title).toBe(deliveryConfig.artifactName || '自动产物名称');
  });

  it.each(['text', 'page', 'presentation', 'image', 'video'] as const)('materializes native %s delivery after its Agent succeeds', async kind => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '', agentConfig: { outputContract: { format: 'markdown' } } },
      { id: 'delivery', kind: 'delivery', title: '正文', description: '', deliveryConfig: { artifactKind: kind } },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
      { id: 'execute-delivery', source: 'execute', target: 'delivery' },
    ]));
    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('【下游产物交付要求】');
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain(`（${kind}）`);
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('<workflow-artifacts>');
    const completed = await harness.service.completeAgentAndDelivery({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: '# 正文\n\n自动交付。',
    });
    expect(completed.next).toEqual({ kind: 'completed' });
    expect(completed.artifact).toMatchObject({ kind, canvasNodeId: expect.stringMatching(/^canvas-/) });
    expect(harness.materialized).toEqual([expect.objectContaining({ content: '# 正文\n\n自动交付。' })]);
  });

  it('recovers a persisted pending delivery after the browser or daemon hand-off is interrupted', async () => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '' },
      { id: 'delivery', kind: 'delivery', title: '正文', description: '', deliveryConfig: { artifactKind: 'text' } },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
      { id: 'execute-delivery', source: 'execute', target: 'delivery' },
    ]));
    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const pending = harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: { title: '正文', content: '恢复后交付。' },
    });
    expect(pending.next.kind).toBe('delivery');
    harness.service.saveConfig({
      ...harness.service.getConfig('stable-flow')!,
      updatedAt: '2026-08-31T12:00:00.000Z',
      title: '已经编辑过的工作流',
    });
    expect(harness.service.resumeAwaitingInput(started.snapshot.run.id)?.next.kind).toBe('delivery');
    expect(harness.service.getActiveProjectRun('project-1')?.next.kind).toBe('delivery');
    const recovered = await harness.service.recoverPendingDeliveries();
    expect(recovered).toEqual({ attempted: 1, completed: 1, failed: 0 });
    expect(harness.service.getRun(started.snapshot.run.id)?.run.status).toBe('succeeded');
    expect(harness.materialized).toEqual([expect.objectContaining({ content: '恢复后交付。' })]);
  });

  it('lets an automatic inquiry node decide the runtime question form within a saved budget', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'ask', kind: 'clarify', title: '询问', description: '只问缺失信息',
        clarificationConfig: {
          mode: 'auto',
          autoConfig: {
            instruction: '默认平台是企业，不要重复询问平台。',
            maxQuestions: 2,
            allowedTypes: ['text', 'multiple'],
          },
          questions: [],
        },
      },
    ], [
      { id: 'start-ask', source: 'start', target: 'ask' },
    ]));

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next).toMatchObject({ kind: 'clarify', node: { id: 'ask' } });
    const prompt = started.next.kind === 'clarify' ? started.next.prompt : '';
    expect(prompt).toContain('你可以生成 1～2 道问题');
    expect(prompt).toContain('默认平台是企业，不要重复询问平台。');
    expect(prompt).toContain('允许的回答类型：text、multiple');

    const resumed = service.submitClarification({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
      values: { 'auto-1': '春节节点', 'auto-2': ['positive'] },
    });
    expect(resumed.snapshot.run.variables).toMatchObject({
      workflowContext: { nodeOutputs: { ask: { 'auto-1': '春节节点', 'auto-2': ['positive'] } } },
    });
  });

  it('validates the configured Agent output contract before advancing', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '执行', description: '生成两个结果',
        agentConfig: {
          outputContract: {
            format: 'json', minItems: 2, maxItems: 2, requiredFields: ['title', 'content'],
            instructions: 'content 必须是一句完整说明。',
          },
          confirmation: { enabled: true, selection: 'multiple', selectionRequired: true },
        },
      },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
    ]));

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('items 必须恰好 2 项');
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('title / content');
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('输出格式：JSON');
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('content 必须是一句完整说明');
    expect(() => service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: [{ title: '只有一个', content: '不应通过' }],
    })).toThrow('至少需要 2 项');
    expect(() => service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: [{ title: '一', content: '内容' }, { title: '二' }],
    })).toThrow('缺少字段：content');

    const completed = service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: { items: [{ title: '一', content: '内容一' }, { title: '二', content: '内容二' }] },
    });
    expect(completed.next).toMatchObject({ kind: 'review', node: { id: 'execute-confirmation' } });
  });

  it('composes and validates a Markdown output contract independently from the System Prompt', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '执行', description: '撰写交付正文',
        agentConfig: {
          systemPrompt: '你是严谨的方案撰写者。',
          outputContract: {
            format: 'markdown',
            requiredText: ['## 执行建议'],
            forbiddenText: ['生成过程'],
            instructions: '必须包含一级标题和「执行建议」章节。',
          },
        },
      },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
    ]));

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const prompt = started.next.kind === 'agent' ? started.next.prompt : '';
    expect(prompt).toContain('输出格式：Markdown');
    expect(prompt).toContain('不要包裹 JSON');
    expect(prompt).toContain('必须包含一级标题和「执行建议」章节');
    expect(prompt).toContain('正文必须原样包含：## 执行建议');
    expect(prompt).toContain('正文不得包含：生成过程');
    expect(prompt).not.toContain('你是严谨的方案撰写者');
    expect(() => service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: { title: '空正文' },
    })).toThrow('必须是非空 Markdown 内容');
    expect(() => service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: '# 方案\n\n缺少结构。',
    })).toThrow('缺少必需内容：## 执行建议');
    expect(() => service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: '# 方案\n\n## 执行建议\n\n这里解释生成过程。',
    })).toThrow('包含禁用内容：生成过程');

    const completed = service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: { title: '方案', content: '# 方案\n\n## 执行建议\n直接执行。' },
    });
    expect(completed.snapshot.run.status).toBe('succeeded');
  });

  it('rejects an impossible Agent output quantity contract when saving', () => {
    expect(() => service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '执行', description: '',
        agentConfig: { outputContract: { format: 'json', minItems: 5, maxItems: 1 } },
      },
    ], [{ id: 'start-execute', source: 'start', target: 'execute' }]))).toThrow('最少数量不能大于最多数量');
  });

  it('materializes a terminal Markdown result from a legacy run even when its old flag is false', async () => {
    const harness = freshHarness();
    service = harness.service;
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'write', kind: 'agent', title: '方案正文', description: '',
        agentConfig: { outputContract: { format: 'markdown' } },
      },
      {
        id: 'review-final', kind: 'review', title: '正文确认', description: '',
        reviewConfig: {
          artifactKind: 'text',
          enabled: true,
          selection: 'none',
          selectionRequired: false,
          feedbackEnabled: true,
          feedbackRequired: false,
          allowRegenerate: true,
          continueLabel: '确认',
          materializeOnConfirm: false,
        },
      },
    ], [
      { id: 'start-write', source: 'start', target: 'write' },
      { id: 'write-review', source: 'write', target: 'review-final' },
    ]));
    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const completed = service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: '# 完整正文',
    });
    expect(completed.next).toMatchObject({ kind: 'review', node: { id: 'review-final' } });
    const result = harness.results.list({ projectId: 'project-1' })[0]!;

    await harness.results.interact({
      resultId: result.id,
      actionId: 'continue',
      expectedVersion: result.version,
      selectedIds: [],
      idempotencyKey: 'legacy-terminal-markdown',
    });

    expect(harness.materialized).toEqual([
      expect.objectContaining({ sourceResultId: result.id, content: '# 完整正文' }),
    ]);
  });

  it('keeps an adjacent result card as an independently persisted runtime node', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '生成方向', description: '生成三个方向',
        agentConfig: {
          systemPrompt: '生成结构化方向。', skillIds: ['direction'], knowledgeIds: ['external-knowledge:7:方向.md'],
        },
      },
      {
        id: 'legacy-review', kind: 'review', title: '方向确认', description: '旧结果卡',
        resultSurfaces: ['chat', 'canvas'],
        reviewConfig: {
          artifactKind: 'page', selection: 'multiple', feedbackEnabled: true,
          chat: { enabled: true, selection: 'single', selectionRequired: true, feedbackEnabled: true, feedbackRequired: false, allowRegenerate: true, continueLabel: '继续' },
          canvas: { enabled: true, selection: 'multiple', selectionRequired: false, feedbackEnabled: false, feedbackRequired: false, allowRegenerate: false, continueLabel: '采用' },
        },
      },
      { id: 'next', kind: 'agent', title: '继续执行', description: '' },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
      { id: 'execute-review', source: 'execute', target: 'legacy-review' },
      { id: 'review-next', source: 'legacy-review', target: 'next' },
    ]));

    const saved = service.getConfig('stable-flow')!;
    expect(saved.nodes?.find(node => node.id === 'legacy-review')).toMatchObject({
      kind: 'review',
      title: '方向确认',
      resultSurfaces: ['chat', 'canvas'],
      reviewConfig: {
        artifactKind: 'page',
        selection: 'multiple',
        chat: { selection: 'single', continueLabel: '继续' },
        canvas: { selection: 'multiple', continueLabel: '采用' },
      },
    });
    expect(saved.nodes?.find(node => node.id === 'execute')).toMatchObject({
      agentConfig: {
        systemPrompt: '生成结构化方向。',
        skillIds: ['direction'],
        knowledgeIds: ['external-knowledge:7:方向.md'],
      },
    });
    expect(saved.edges).toEqual([
      { id: 'start-execute', source: 'start', target: 'execute' },
      { id: 'execute-review', source: 'execute', target: 'legacy-review' },
      { id: 'review-next', source: 'legacy-review', target: 'next' },
    ]);

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const afterAgent = service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: { content: '方向结果' },
    });
    expect(afterAgent.next).toMatchObject({ kind: 'review', node: { id: 'legacy-review', title: '方向确认' } });
  });

  it('rejects cycles, unreachable cards, and unavailable video artifacts before a run starts', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '' },
      { id: 'orphan', kind: 'agent', title: '孤立节点', description: '' },
    ], [{ id: 'start-execute', source: 'start', target: 'execute' }]));
    expect(() => service.start({ projectId: 'project-1', workflowId: 'stable-flow' }))
      .toThrow('以下节点没有从“开始”接入流程：孤立节点');

    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'a', kind: 'agent', title: 'A', description: '' },
      { id: 'b', kind: 'agent', title: 'B', description: '' },
    ], [
      { id: 'start-a', source: 'start', target: 'a' },
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-a', source: 'b', target: 'a' },
    ]));
    expect(() => service.start({ projectId: 'project-1', workflowId: 'stable-flow' }))
      .toThrow('当前不支持普通节点回环，请删除循环连线');

    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'result', kind: 'delivery', title: '正文', description: '', deliveryConfig: { artifactKind: 'text' } },
    ], [{ id: 'start-result', source: 'start', target: 'result' }]));
    expect(() => service.start({ projectId: 'project-1', workflowId: 'stable-flow' }))
      .toThrow('产物卡“正文”必须连接一个会产生内容的上游节点');

    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'video', kind: 'delivery', title: '视频', description: '',
        deliveryConfig: { artifactKind: 'video' },
      },
    ], [{ id: 'start-video', source: 'start', target: 'video' }]));
    expect(() => service.start({ projectId: 'project-1', workflowId: 'stable-flow' }))
      .toThrow('必须连接一个会产生内容的上游节点');
  });

  it('validates configured inquiry answers, resumes the same wait, and rejects duplicate submission', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'ask',
        kind: 'clarify',
        title: '询问',
        description: '收集主题方向',
        clarificationConfig: {
          questions: [{
            id: 'themes',
            titleMode: 'ai',
            titleDirection: '询问方案要覆盖的主题',
            type: 'multiple',
            optionDirection: '根据任务生成主题方向',
            required: true,
            allowOther: true,
          }],
        },
      },
      { id: 'execute', kind: 'agent', title: '执行', description: '生成方案' },
    ], [
      { id: 'start-ask', source: 'start', target: 'ask' },
      { id: 'ask-execute', source: 'ask', target: 'execute' },
    ]));

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next.kind).toBe('clarify');
    expect(started.next.kind === 'clarify' ? started.next.prompt : '').toContain('"answerType":"multiple"');

    const resumed = service.resumeAwaitingInput(started.snapshot.run.id);
    expect(resumed?.next).toMatchObject({
      kind: 'clarify',
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
    });
    expect(() => service.submitClarification({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
      values: {},
    })).toThrow('请完成必填问题');
    expect(() => service.submitClarification({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
      values: { themes: '文化' },
    })).toThrow('答案类型不正确');

    const submitted = service.submitClarification({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
      values: { themes: ['文化', '社会温度'] },
    });
    expect(submitted.next.kind).toBe('agent');
    expect(() => service.submitClarification({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'clarify' ? started.next.stepRunId : '',
      values: { themes: ['文化'] },
    })).toThrow('这个问题已经回答，不能重复提交不同答案');
  });

  it('reuses the active project workflow run instead of starting a duplicate', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '' },
    ], [{ id: 'start-execute', source: 'start', target: 'execute' }]));

    const first = service.startOrResumeActive({
      projectId: 'project-1',
      workflowId: 'stable-flow',
      value: { userPrompt: '第一次启动' },
    });
    const second = service.startOrResumeActive({
      projectId: 'project-1',
      workflowId: 'stable-flow',
      value: { userPrompt: '第一次启动' },
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.snapshot.run.id).toBe(first.snapshot.run.id);
    expect(second.snapshot.run.input).toMatchObject({ userPrompt: '第一次启动' });
  });

  it('preserves the active definition until explicitly cancelled before starting an edited graph', () => {
    const original = config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '旧流程' },
    ], [{ id: 'start-execute', source: 'start', target: 'execute' }]);
    service.saveConfig(original);
    const first = service.startOrResumeActive({
      projectId: 'project-1', workflowId: 'stable-flow', value: { userPrompt: '旧任务' },
    });

    service.saveConfig({
      ...original,
      updatedAt: '2026-08-31T00:00:00.000Z',
      nodes: original.nodes!.map(node => node.id === 'execute'
        ? { ...node, description: '新流程' }
        : node),
    });
    expect(service.getActiveProjectRun('project-1')?.snapshot.run.id).toBe(first.snapshot.run.id);
    const resumed = service.startOrResumeActive({
      projectId: 'project-1', workflowId: 'stable-flow', value: { userPrompt: '旧任务' },
    });
    expect(resumed.next.kind === 'agent' ? resumed.next.prompt : '').toContain('旧流程');
    expect(() => service.startOrResumeActive({
      projectId: 'project-1', workflowId: 'stable-flow', value: { userPrompt: '新任务' },
    })).toThrow('这个工作流还有未完成的任务');
    service.cancel(first.snapshot.run.id);
    const second = service.startOrResumeActive({
      projectId: 'project-1', workflowId: 'stable-flow', value: { userPrompt: '新任务' },
    });

    expect(second.reused).toBe(false);
    expect(second.snapshot.run.id).not.toBe(first.snapshot.run.id);
    expect(second.snapshot.run.input).toMatchObject({ userPrompt: '新任务' });
    expect(service.getRun(first.snapshot.run.id)?.run.status).toBe('cancelled');
    expect(second.next.kind === 'agent' ? second.next.prompt : '').toContain('新流程');
  });

  it('asks the current Agent to choose a configured natural-language branch and follows only that route', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      // Deliberately persist downstream cards before the branch. Canvas save
      // order must not turn these forward routes into runtime loops.
      { id: 'execute', kind: 'agent', title: '执行', description: '生成方案' },
      { id: 'ask', kind: 'clarify', title: '询问', description: '补充缺失信息' },
      {
        id: 'judge',
        kind: 'branch',
        title: '信息判断',
        description: '判断是否可以开始执行',
        branchConfig: {
          instruction: '判断用户提供的信息是否足以直接生成方案。',
          defaultRouteId: 'route-missing',
          routes: [
            { id: 'route-ready', label: '信息足够', condition: '目标、受众和限制条件已经明确。' },
            { id: 'route-missing', label: '信息不足', condition: '仍缺少目标、受众或关键限制。' },
          ],
        },
      },
    ], [
      { id: 'start-judge', source: 'start', target: 'judge' },
      { id: 'judge-ready', source: 'judge', sourceHandle: 'route-ready', target: 'execute' },
      { id: 'judge-missing', source: 'judge', sourceHandle: 'route-missing', target: 'ask' },
      { id: 'ask-execute', source: 'ask', target: 'execute' },
    ]));

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow', value: { audience: '设计师' } });
    expect(started.next).toMatchObject({ kind: 'branch', node: { id: 'judge' } });
    expect(started.next.kind === 'branch' ? started.next.prompt : '').toContain('route-ready: 目标、受众和限制条件已经明确。');
    expect(started.next.kind === 'branch' ? started.next.prompt : '').toContain('"audience":"设计师"');

    const selected = service.resolveBranchDecision({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'branch' ? started.next.stepRunId : '',
      decision: '{"routeId":"route-ready","reason":"信息完整","confidence":0.92}',
    });
    expect(selected.decision).toEqual({ routeId: 'route-ready', reason: '信息完整', confidence: 0.92, fallback: false });
    expect(selected.next).toMatchObject({ kind: 'agent', node: { id: 'execute' } });
    expect(selected.snapshot.steps.find(step => step.stepId === 'ask')?.status).toBe('skipped');

    const fallbackRun = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const fallback = service.resolveBranchDecision({
      runId: fallbackRun.snapshot.run.id,
      stepRunId: fallbackRun.next.kind === 'branch' ? fallbackRun.next.stepRunId : '',
      decision: '模型没有返回 JSON',
    });
    expect(fallback.decision).toMatchObject({ routeId: 'route-missing', fallback: true });
    expect(fallback.next).toMatchObject({ kind: 'clarify', node: { id: 'ask' } });
    const afterInquiry = service.submitClarification({
      runId: fallback.snapshot.run.id,
      stepRunId: fallback.next.kind === 'clarify' ? fallback.next.stepRunId : '',
      values: {},
    });
    expect(afterInquiry.next).toMatchObject({ kind: 'agent', node: { id: 'execute' } });
  });

  it('turns a failed Agent turn into a terminal workflow failure', () => {
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'execute', kind: 'agent', title: '执行', description: '生成方案' },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
    ]));

    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next.kind).toBe('agent');
    const failed = service.failAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      error: { code: 'AGENT_RUN_FAILED', message: '模型执行失败', retryable: false },
    });

    expect(failed.run.status).toBe('failed');
    expect(failed.run.termination).toMatchObject({
      code: 'AGENT_RUN_FAILED',
      message: '模型执行失败',
    });
    expect(failed.steps.find(step => step.stepId === 'execute')).toMatchObject({
      status: 'failed',
      error: { code: 'AGENT_RUN_FAILED' },
    });

    expect(service.failAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      error: { code: 'AGENT_RUN_FAILED', message: '重复回执', retryable: false },
    }).run.status).toBe('failed');
  });

  it('appends regenerated outputs and lets a completed historical card start another branch', async () => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute',
        kind: 'agent',
        title: '执行',
        description: '生成方案',
      },
      {
        id: 'result-review',
        kind: 'review',
        title: '结果确认',
        description: '',
        reviewConfig: {
          selection: 'single',
          feedbackEnabled: true,
          allowRegenerate: true,
        },
      },
      { id: 'result', kind: 'delivery', title: '结果', description: '' },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
      { id: 'execute-result-review', source: 'execute', target: 'result-review' },
      { id: 'result-review-result', source: 'result-review', target: 'result' },
    ]));

    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect(started.next.kind === 'agent' ? started.next.prompt : '').toContain('文本组件（text）');
    const first = harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: [{ title: '初稿', content: '这是初稿正文。' }],
    });
    expect(first.next.kind).toBe('review');
    const initialArtifact = harness.results.list({ projectId: 'project-1' })[0]!;
    expect(initialArtifact.actions.map(action => action.id)).toEqual(['regenerate', 'continue']);
    const initialArtifactBeforeRegeneration = structuredClone(initialArtifact);

    const regenerate = await harness.results.interact({
      resultId: initialArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      feedback: '更简洁一些',
      selectedIds: ['1'],
      idempotencyKey: 'regenerate-1',
    });
    expect(regenerate).toMatchObject({
      state: 'accepted',
      visiblePrompt: '基于所选结果重新生成：更简洁一些',
      runMetadata: { genericWorkflow: { next: { kind: 'agent' } } },
    });
    expect(regenerate.agentPrompt).toContain('用户的调整意见：更简洁一些');
    expect(regenerate.agentPrompt).toContain('本次只重生成用户所选的 1 条历史结果');
    expect(harness.results.get(initialArtifact.id)?.artifact).toEqual(initialArtifactBeforeRegeneration);

    const next = regenerate.runMetadata?.genericWorkflow as unknown as { next?: { stepRunId?: string } };
    const duplicate = await harness.results.interact({
      resultId: initialArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      feedback: '重复点击不应再启动一轮',
      selectedIds: [],
      idempotencyKey: 'regenerate-while-running',
    });
    expect(duplicate).toMatchObject({
      state: 'accepted',
      message: '新结果正在生成，完成后会新增一张卡片；当前卡片不会改变。',
    });
    expect(duplicate.agentPrompt).toBeUndefined();
    expect(harness.service.getRun(started.snapshot.run.id)?.steps.filter(
      step => step.stepId === 'execute',
    )).toHaveLength(2);

    const interruptedAttempt = harness.service.failAgent({
      runId: started.snapshot.run.id,
      stepRunId: next.next?.stepRunId ?? '',
      error: {
        code: 'DAEMON_RESTART',
        message: 'The daemon restarted while this step was running',
        retryable: false,
      },
    });
    expect(interruptedAttempt.run.status).toBe('failed');

    const recoveredAfterInterruptedGeneration = await harness.results.interact({
      resultId: initialArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      feedback: '服务恢复后继续生成',
      selectedIds: ['1'],
      idempotencyKey: 'regenerate-after-failed-attempt-with-open-review',
    });
    expect(recoveredAfterInterruptedGeneration).toMatchObject({
      state: 'accepted',
      runMetadata: { genericWorkflow: { next: { kind: 'agent' } } },
    });
    const recoveredNext = recoveredAfterInterruptedGeneration.runMetadata?.genericWorkflow as unknown as {
      next?: { stepRunId?: string };
    };
    const refreshed = harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: recoveredNext.next?.stepRunId ?? '',
      output: [{ title: '新结果', content: '这是重新生成后的正文。' }],
    });
    expect(refreshed.next.kind).toBe('review');
    expect(refreshed.snapshot.run.status).toBe('awaiting-input');
    const generated = harness.results.list({ projectId: 'project-1' });
    expect(generated).toHaveLength(2);
    expect(generated[0]).toMatchObject({
      id: initialArtifact.id,
      version: 1,
      state: 'active',
      items: [{ title: '初稿', summary: '这是初稿正文。' }],
    });
    const currentArtifact = generated[1]!;
    expect(currentArtifact).toMatchObject({
      version: 1,
      state: 'active',
      items: [{ title: '新结果', summary: '这是重新生成后的正文。' }],
      parentResultId: initialArtifact.id,
      parentItemIds: ['1'],
    });
    expect(currentArtifact.id).not.toBe(initialArtifact.id);
    expect(currentArtifact.sourceStepRunId).not.toBe(initialArtifact.sourceStepRunId);

    const confirmed = await harness.results.interact({
      resultId: currentArtifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['1'],
      idempotencyKey: 'continue-1',
    });
    expect(confirmed.state).toBe('completed');
    expect(confirmed.runMetadata).toBeUndefined();
    expect(harness.materialized).toEqual([
      expect.objectContaining({ title: '结果确认', content: '这是重新生成后的正文。' }),
      expect.objectContaining({ title: '结果', content: '这是重新生成后的正文。' }),
    ]);
    expect(harness.results.get(currentArtifact.id)?.artifact).toMatchObject({
      state: 'active',
      selectedIds: ['1'],
    });

    const replay = await harness.results.interact({
      resultId: currentArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      feedback: '换一个方向',
      selectedIds: [],
      idempotencyKey: 'regenerate-after-complete',
    });
    expect(replay).toMatchObject({
      state: 'accepted',
      runMetadata: { genericWorkflow: { next: { kind: 'agent' } } },
    });
    expect(harness.results.get(currentArtifact.id)?.artifact.selectedIds).toEqual(['1']);
    expect(harness.service.getRun(started.snapshot.run.id)?.run.status).toBe('running');

    const interrupted = replay.runMetadata?.genericWorkflow as unknown as { next?: { stepRunId?: string } };
    const failed = harness.service.failAgent({
      runId: started.snapshot.run.id,
      stepRunId: interrupted.next?.stepRunId ?? '',
      error: {
        code: 'DAEMON_RESTART',
        message: 'The daemon restarted while this step was running',
        retryable: false,
      },
    });
    expect(failed.run.status).toBe('failed');

    const recovered = await harness.results.interact({
      resultId: currentArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      feedback: '服务恢复后再试一次',
      selectedIds: [],
      idempotencyKey: 'regenerate-after-daemon-restart',
    });
    expect(recovered).toMatchObject({
      state: 'accepted',
      runMetadata: { genericWorkflow: { next: { kind: 'agent' } } },
    });
    expect(harness.results.get(currentArtifact.id)?.artifact).toMatchObject({
      selectedIds: ['1'],
      items: [{ title: '新结果', summary: '这是重新生成后的正文。' }],
    });
    expect(harness.service.getRun(started.snapshot.run.id)?.run.status).toBe('running');
  });

  it('preserves a late Agent output as a historical card after the user switches branches', async () => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'upstream', kind: 'agent', title: '上游', description: '生成上游结果',
        agentConfig: {
          confirmation: {
            selection: 'single',
            allowRegenerate: true,
            title: '上游确认',
          },
        },
      },
      {
        id: 'downstream', kind: 'agent', title: '下游', description: '生成下游结果',
      },
      {
        id: 'downstream-review', kind: 'review', title: '下游确认', description: '',
        reviewConfig: {
          selection: 'none',
          allowRegenerate: true,
        },
      },
      { id: 'result', kind: 'delivery', title: '结果', description: '' },
    ], [
      { id: 'start-upstream', source: 'start', target: 'upstream' },
      { id: 'upstream-downstream', source: 'upstream', target: 'downstream' },
      { id: 'downstream-review', source: 'downstream', target: 'downstream-review' },
      { id: 'downstream-review-result', source: 'downstream-review', target: 'result' },
    ]));

    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    const upstream = harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: [{ title: '上游初稿', content: '上游内容' }],
    });
    expect(upstream.next.kind).toBe('review');
    const upstreamArtifact = harness.results.list({ projectId: 'project-1' })[0]!;
    const confirmed = await harness.results.interact({
      resultId: upstreamArtifact.id,
      actionId: 'continue',
      expectedVersion: 1,
      selectedIds: ['1'],
      idempotencyKey: 'start-downstream',
    });
    const downstreamMetadata = confirmed.runMetadata?.genericWorkflow as unknown as {
      next?: { stepRunId?: string };
    };
    const downstreamStepRunId = downstreamMetadata.next?.stepRunId ?? '';
    expect(harness.service.getRun(started.snapshot.run.id)?.steps.find(
      step => step.id === downstreamStepRunId,
    )?.status).toBe('running');

    const switched = await harness.results.interact({
      resultId: upstreamArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      selectedIds: ['1'],
      idempotencyKey: 'switch-upstream-branch',
    });
    expect(switched.runMetadata).toMatchObject({ genericWorkflow: { next: { kind: 'agent' } } });
    expect(harness.service.getRun(started.snapshot.run.id)?.steps.find(
      step => step.id === downstreamStepRunId,
    )?.status).toBe('cancelled');

    const late = harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: downstreamStepRunId,
      output: { title: '迟到正文', content: '这份内容已经生成，仍应保留为卡片。' },
    });
    expect(late.snapshot.steps.find(step => step.id === downstreamStepRunId)?.status).toBe('cancelled');
    const artifacts = harness.results.list({ projectId: 'project-1' });
    expect(artifacts).toHaveLength(2);
    expect(artifacts[1]).toMatchObject({
      title: '下游确认',
      sourceStepRunId: downstreamStepRunId,
      items: [{ title: '迟到正文', summary: '这份内容已经生成，仍应保留为卡片。' }],
    });

    const replay = await harness.results.interact({
      resultId: artifacts[1]!.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      selectedIds: [],
      idempotencyKey: 'regenerate-late-result',
    });
    expect(replay).toMatchObject({
      state: 'accepted',
      runMetadata: { genericWorkflow: { next: { kind: 'agent' } } },
    });
  });

  it('validates a selected-item regeneration against the selected count instead of the full output contract', async () => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '执行', description: '生成五个结果',
        agentConfig: {
          outputContract: {
            format: 'json', minItems: 5, maxItems: 5, requiredFields: ['title', 'content'],
          },
          confirmation: { selection: 'multiple', allowRegenerate: true },
        },
      },
    ], [
      { id: 'start-execute', source: 'start', target: 'execute' },
    ]));

    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: Array.from({ length: 5 }, (_, index) => ({
        title: `候选 ${index + 1}`,
        content: `候选 ${index + 1} 的正文。`,
      })),
    });
    const initialArtifact = harness.results.list({ projectId: 'project-1' })[0]!;
    const regenerate = await harness.results.interact({
      resultId: initialArtifact.id,
      actionId: 'regenerate',
      expectedVersion: 1,
      selectedIds: ['2'],
      idempotencyKey: 'regenerate-one-of-five',
    });
    expect(regenerate.agentPrompt).toContain('items 必须恰好 1 项');
    expect(regenerate.agentPrompt).not.toContain('items 必须恰好 5 项');

    const metadata = regenerate.runMetadata?.genericWorkflow as unknown as { next?: { stepRunId?: string } };
    const completed = harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: metadata.next?.stepRunId ?? '',
      output: [{ title: '新候选', content: '这是单项重新生成的正文。' }],
    });
    expect(completed.next.kind).toBe('review');
    expect(harness.results.list({ projectId: 'project-1' })).toHaveLength(2);
    expect(harness.results.list({ projectId: 'project-1' })[1]).toMatchObject({
      parentResultId: initialArtifact.id,
      parentItemIds: ['2'],
      items: [{ title: '新候选', summary: '这是单项重新生成的正文。' }],
    });
  });

  it('publishes independent chat and canvas confirmation settings', () => {
    const harness = freshHarness();
    harness.service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      {
        id: 'execute', kind: 'agent', title: '执行', description: '生成方案',
        agentConfig: { confirmation: {
          selection: 'single', feedbackEnabled: true, allowRegenerate: true,
          chat: {
            enabled: true, selection: 'single', selectionRequired: false,
            feedbackEnabled: false, feedbackRequired: false, allowRegenerate: false,
            continueLabel: '使用这个结果',
          },
          canvas: {
            enabled: false, selection: 'multiple', selectionRequired: true,
            feedbackEnabled: true, feedbackRequired: true, allowRegenerate: true,
            continueLabel: '确认并继续',
          },
        } },
      },
    ], [{ id: 'start-execute', source: 'start', target: 'execute' }]));

    const started = harness.service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    harness.service.completeAgent({
      runId: started.snapshot.run.id,
      stepRunId: started.next.kind === 'agent' ? started.next.stepRunId : '',
      output: [{ title: 'A' }, { title: 'B' }],
    });
    const result = harness.results.list({ projectId: 'project-1' })[0]!;
    expect(result.selection).toMatchObject({ mode: 'multiple' });
    expect(result.capabilities).toEqual(['select', 'comment', 'regenerate', 'continue']);
    expect(result.surfaces).toEqual(['chat']);
    expect(result.selection).toMatchObject({ mode: 'multiple', min: 1 });
    expect(result.feedback).toMatchObject({ required: true });
    expect(result.chatSelection).toEqual({ mode: 'single' });
    expect(result.chatCapabilities).toEqual(['select', 'continue']);
    expect(result.chatActions).toEqual([expect.objectContaining({ id: 'continue', label: '使用这个结果' })]);
    expect(result.chatFeedback).toBeUndefined();
  });
});

describe('workflow input snapshots', () => {
  it('carries content through questions, excludes siblings and persists exact sources', () => {
    const { service } = freshHarness();
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'unrelated', kind: 'agent', title: '另一条路线', description: '' },
      { id: 'draft', kind: 'agent', title: '整理资料', description: '' },
      { id: 'ask', kind: 'clarify', title: '补充受众', description: '', clarificationConfig: { questions: [{ id: 'audience', titleMode: 'manual', title: '受众', type: 'text' }] } },
      { id: 'write', kind: 'agent', title: '写报告', description: '' },
    ], [
      { id: 'a', source: 'start', target: 'unrelated' }, { id: 'b', source: 'start', target: 'draft' },
      { id: 'c', source: 'draft', target: 'ask' }, { id: 'd', source: 'ask', target: 'write' },
    ]));
    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow', value: { task: '完成报告' } });
    const runId = started.snapshot.run.id;
    const draft = service.completeAgent({ runId, stepRunId: 'stepRunId' in started.next ? started.next.stepRunId : '', output: 'SIBLING_MUST_NOT_LEAK' });
    const asked = service.completeAgent({ runId, stepRunId: 'stepRunId' in draft.next ? draft.next.stepRunId : '', output: 'ORIGINAL_SOURCE_CONTENT' });
    expect(asked.next.kind).toBe('clarify');
    expect('prompt' in asked.next && asked.next.prompt).not.toContain('SIBLING_MUST_NOT_LEAK');
    const written = service.submitClarification({ runId, stepRunId: 'stepRunId' in asked.next ? asked.next.stepRunId : '', values: { audience: '设计师' } });
    const prompt = 'prompt' in written.next ? written.next.prompt : '';
    expect(prompt).toContain('ORIGINAL_SOURCE_CONTENT');
    expect(prompt).toContain('设计师');
    expect(prompt).not.toContain('SIBLING_MUST_NOT_LEAK');
    const step = service.getRun(runId)!.steps.find(item => item.stepId === 'write')!;
    expect(step.inputSnapshot).toMatchObject({ version: 1, content: [{ stepId: 'draft' }], context: [{ stepId: 'ask' }] });
    expect(service.current(runId).next).toMatchObject({ prompt });
  });

  it('forwards content through a selected branch into delivery', async () => {
    const { service, materialized, results } = freshHarness();
    service.saveConfig(config([
      { id: 'start', kind: 'start', title: '开始', description: '' },
      { id: 'draft', kind: 'agent', title: '正文', description: '', agentConfig: { confirmation: { selection: 'none', selectionRequired: false, materializeOnConfirm: true } } },
      { id: 'judge', kind: 'branch', title: '判断', description: '', branchConfig: { routes: [{ id: 'ready', label: '通过', condition: '内容完整' }, { id: 'stop', label: '不通过', condition: '内容不完整' }] } },
      { id: 'delivery', kind: 'delivery', title: '产物', description: '', deliveryConfig: { artifactKind: 'text' } },
      { id: 'revise', kind: 'agent', title: '修改', description: '' },
    ], [
      { id: 'a', source: 'start', target: 'draft' }, { id: 'b', source: 'draft', target: 'judge' },
      { id: 'c', source: 'judge', target: 'delivery', sourceHandle: 'ready' }, { id: 'd', source: 'judge', target: 'revise', sourceHandle: 'stop' },
    ]));
    const started = service.start({ projectId: 'project-1', workflowId: 'stable-flow' });
    expect('prompt' in started.next && started.next.prompt).toContain('下游产物交付要求');
    const runId = started.snapshot.run.id;
    const confirmed = service.completeAgent({ runId, stepRunId: 'stepRunId' in started.next ? started.next.stepRunId : '', output: 'THE_REAL_DOCUMENT' });
    expect(confirmed.next.kind).toBe('review');
    const result = results.list({ projectId: 'project-1' })[0]!;
    await results.interact({ resultId: result.id, actionId: 'continue', expectedVersion: result.version, selectedIds: [], idempotencyKey: 'confirm-before-branch' });
    expect(materialized).toHaveLength(0);
    const judged = service.current(runId);
    const ready = service.chooseBranch({ runId, stepRunId: 'stepRunId' in judged.next ? judged.next.stepRunId : '', routeId: 'ready' });
    expect(ready.next.kind).toBe('delivery');
    await service.completeDelivery({ runId, stepRunId: 'stepRunId' in ready.next ? ready.next.stepRunId : '' });
    expect(materialized[0]?.content).toBe('THE_REAL_DOCUMENT');
  });
});