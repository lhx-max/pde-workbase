import { describe, expect, it } from 'vitest';
import {
  createWorkflowPackageJson,
  renderWorkflowCompatibilityMarkdown,
  renderWorkflowEditorMarkdown,
  updateWorkflowPackageFromMarkdown,
  updateWorkflowPackageGraph,
  workflowGraphConfigFromPackage,
} from '../src/workflows/workflow-package-json.js';


describe('workflow package JSON', () => {

  it('creates a complete JSON package for a new canvas workflow', () => {
    const workflow = createWorkflowPackageJson({
      id: 'new-flow', version: 2, title: '新流程', updatedAt: '2026-08-27T12:00:00.000Z',
      nodes: [
        {
          id: 'start', kind: 'start', title: '开始', description: '',
          startConfig: {
            workflowName: '内容分析', description: '分析一份内容', triggerScenarios: ['用户要分析内容'],
            includeProjectContext: true,
          },
        },
        {
          id: 'ask', kind: 'clarify', title: '询问', description: '',
          clarificationConfig: { questions: [{ id: 'goal', titleMode: 'manual', title: '目标是什么？', type: 'text' }] },
        },
      ],
      edges: [{ id: 'start-ask', source: 'start', target: 'ask' }],
    });

    expect(workflow).toMatchObject({
      id: 'new-flow',
      name: '内容分析',
      description: '分析一份内容',
      discovery: { scenarios: ['用户要分析内容'] },
      graph: { startNodeId: 'start', nodes: [{ type: 'start' }, { type: 'clarify' }] },
    });
  });
});

