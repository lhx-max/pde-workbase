import { describe, expect, it } from 'vitest';
import {
  diagnoseWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowResultArtifact,
} from '../src/api/workflows.js';
import {
  workflowResultArtifactToBezierCard,
  workflowResultSupportsSurface,
} from '../src/workflow-result-projection.js';

function definition(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'test-workflow',
    aliases: [],
    version: '1.0.0',
    digest: 'digest',
    title: 'Test',
    inputs: [],
    steps: [
      {
        id: 'generate',
        title: 'Generate',
        kind: 'agent',
        dependsOn: [],
        failurePolicy: { kind: 'stop' },
        outputSchemaRef: 'Generated',
      },
      {
        id: 'publish',
        title: 'Publish',
        kind: 'publish',
        dependsOn: ['generate'],
        failurePolicy: { kind: 'stop' },
      },
    ],
    results: [{
      id: 'result',
      title: 'Result',
      sourceStepId: 'publish',
      shape: 'single',
      renderer: 'structured',
      capabilities: ['edit'],
    }],
    exits: [{
      id: 'done',
      kind: 'terminal',
      when: 'steps.publish.status == succeeded',
      action: 'notify_user',
    }],
    limits: { maxStepRuns: 20 },
    ...overrides,
  };
}

describe('workflow doctor', () => {
  it('keeps workflow artifacts self-describing for any canvas renderer', () => {
    const artifact: WorkflowResultArtifact = {
      id: 'result-1',
      workflowRunId: 'run-1',
      resultDefinitionId: 'review',
      sourceStepRunId: 'step-1',
      version: 1,
      projectId: 'project-1',
      title: 'Review',
      shape: 'collection',
      renderer: 'structured',
      rendererConfig: { density: 'compact' },
      capabilities: ['select', 'continue'],
      selection: { mode: 'single' },
      actions: [],
      parentResultId: 'result-0',
      parentNodeId: 'entry-1',
      state: 'locked',
      selectedIds: ['candidate-1'],
      items: [{ id: 'candidate-1', title: 'Candidate' }],
      createdAt: new Date(0).toISOString(),
    };

    expect(artifact).toMatchObject({
      renderer: 'structured',
      parentResultId: 'result-0',
      state: 'locked',
      selectedIds: ['candidate-1'],
    });
    expect(workflowResultSupportsSurface(artifact, 'chat')).toBe(true);
    expect(workflowResultArtifactToBezierCard(artifact)).toMatchObject({
      kind: 'workflow-result',
      resultId: 'result-1',
      state: 'locked',
      selectedIds: ['candidate-1'],
    });
  });

  it('projects the chat interaction contract independently from canvas', () => {
    const artifact: WorkflowResultArtifact = {
      id: 'result-surfaces', workflowRunId: 'run-1', resultDefinitionId: 'review',
      sourceStepRunId: 'step-1', version: 1, projectId: 'project-1', title: 'Review',
      shape: 'collection', renderer: 'structured', capabilities: ['select', 'comment', 'continue'],
      selection: { mode: 'multiple', min: 1 },
      actions: [{ id: 'continue', capability: 'continue', label: 'Canvas continue' }],
      feedback: { label: 'Canvas feedback' },
      chatCapabilities: ['continue'],
      chatSelection: { mode: 'none' },
      chatActions: [{ id: 'continue', capability: 'continue', label: 'Chat continue' }],
      items: [], createdAt: new Date(0).toISOString(),
    };

    expect(workflowResultArtifactToBezierCard(artifact)).toMatchObject({
      capabilities: ['select', 'comment', 'continue'],
      chatCapabilities: ['continue'],
      selection: { mode: 'none' },
      actions: [{ label: 'Chat continue' }],
    });
    expect(workflowResultArtifactToBezierCard(artifact).feedback).toBeUndefined();
  });

  it('accepts a valid deterministic workflow', () => {
    expect(diagnoseWorkflowDefinition(definition())).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it('rejects missing dependencies and result sources', () => {
    const value = definition({
      steps: [{
        id: 'publish',
        title: 'Publish',
        kind: 'publish',
        dependsOn: ['missing'],
        failurePolicy: { kind: 'stop' },
      }],
      results: [{
        id: 'result',
        title: 'Result',
        sourceStepId: 'other',
        shape: 'single',
        renderer: 'structured',
        capabilities: [],
      }],
    });
    const result = diagnoseWorkflowDefinition(value);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'MISSING_DEPENDENCY',
      'MISSING_RESULT_SOURCE',
    ]));
  });

  it('requires bounded back edges', () => {
    const value = definition({
      steps: [
        {
          id: 'generate',
          title: 'Generate',
          kind: 'agent',
          dependsOn: [],
          failurePolicy: { kind: 'stop' },
          outputSchemaRef: 'Generated',
        },
        {
          id: 'review',
          title: 'Review',
          kind: 'eval',
          dependsOn: ['generate'],
          failurePolicy: { kind: 'stop' },
          outputSchemaRef: 'Review',
          routes: [{ id: 'retry', to: 'generate', when: 'output.score < 8' }],
        },
      ],
      results: [],
    });

    expect(diagnoseWorkflowDefinition(value).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CYCLE_WITHOUT_LIMIT', severity: 'error' }),
    ]));

    value.steps[1]!.routes![0]!.maxIterations = 3;
    expect(diagnoseWorkflowDefinition(value).diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CYCLE_WITHOUT_LIMIT' }),
    ]));
  });

  it('finds bounded back edges independently of step order', () => {
    const value = definition({
      steps: [
        {
          id: 'review',
          title: 'Review',
          kind: 'eval',
          dependsOn: ['generate'],
          failurePolicy: { kind: 'stop' },
          outputSchemaRef: 'Review',
          routes: [{ id: 'retry', to: 'generate', when: 'output.score < 8', maxIterations: 3 }],
        },
        {
          id: 'generate',
          title: 'Generate',
          kind: 'agent',
          dependsOn: [],
          failurePolicy: { kind: 'stop' },
          outputSchemaRef: 'Generated',
        },
      ],
      results: [],
    });

    expect(diagnoseWorkflowDefinition(value).diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CYCLE_WITHOUT_LIMIT' }),
    ]));
  });

  it('rejects action steps without registered action ids and invalid budgets', () => {
    const value = definition({
      limits: { maxStepRuns: 0 },
      steps: [{
        id: 'commit',
        title: 'Commit',
        kind: 'action',
        dependsOn: [],
        failurePolicy: { kind: 'stop' },
        outputSchemaRef: 'Committed',
      }],
      results: [],
    });

    expect(diagnoseWorkflowDefinition(value).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_ACTION_ID', severity: 'error' }),
      expect.objectContaining({ code: 'INVALID_LIMIT', severity: 'error' }),
    ]));
  });

  it('rejects duplicate entity ids and unsafe conditions', () => {
    const value = definition({
      inputs: [
        { key: 'brief', label: 'Brief', type: 'text', required: true },
        { key: 'brief', label: 'Brief 2', type: 'text', required: false },
      ],
      exits: [
        { id: 'done', kind: 'terminal', when: 'constructor.constructor()', action: 'notify' },
        { id: 'done', kind: 'terminal', when: 'ok == true', action: 'notify' },
      ],
    });

    expect(diagnoseWorkflowDefinition(value).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_INPUT_KEY', severity: 'error' }),
      expect.objectContaining({ code: 'DUPLICATE_EXIT_ID', severity: 'error' }),
      expect.objectContaining({ code: 'INVALID_CONDITION', severity: 'error' }),
    ]));
  });

  it('enforces one final default route', () => {
    const value = definition();
    value.steps[0]!.routes = [
      { id: 'default', to: 'publish' },
      { id: 'conditional', to: 'publish', when: 'output.ok == true' },
    ];

    expect(diagnoseWorkflowDefinition(value).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DEFAULT_ROUTE_NOT_LAST', severity: 'error' }),
    ]));
  });

  it('warns when executable steps omit output schemas', () => {
    const value = definition();
    delete value.steps[0]!.outputSchemaRef;

    expect(diagnoseWorkflowDefinition(value)).toMatchObject({
      valid: true,
      diagnostics: [
        expect.objectContaining({ code: 'MISSING_OUTPUT_SCHEMA', severity: 'warning' }),
      ],
    });
  });
});
