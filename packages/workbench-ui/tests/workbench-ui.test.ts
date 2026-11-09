import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enabledKnowledgeIds,
  setKnowledgeEnabled,
  setStepSkipped,
  skippedStepIds,
  toStepActor,
  workflowSelectionStorageKeys,
} from '../src/selection-state';

const editorSource = readFileSync(
  new URL('../src/WorkflowEditor.tsx', import.meta.url),
  'utf8',
);
const editorStyles = readFileSync(
  new URL('../src/workbench-ui.css', import.meta.url),
  'utf8',
);
const resultSource = readFileSync(new URL('../src/WorkflowStageCard.tsx', import.meta.url), 'utf8');
const resultStyles = readFileSync(new URL('../src/workflow-result.css', import.meta.url), 'utf8');
const packageSource = `${editorSource}\n${editorStyles}\n${resultSource}\n${resultStyles}`;

describe('@bezier/workbench-ui boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps product implementation details outside the neutral UI', () => {
    expect(packageSource).not.toMatch(/canvas-workbench|business-adapter|LEGACY_PLAN|\/api\/actions\/business\./i);
    expect(resultStyles).not.toMatch(/workflow-pending|canvas-result-/);
    for (const legacyClass of [
      'process-result-analysis',
      'process-result-feedback',
      'process-result-field',
      'process-result-fold',
      'process-result-item-lineage',
      'process-result-item-quiet',
      'process-result-item-status',
      'process-result-round-action',
      'process-result-round-head',
      'process-result-source',
    ]) {
      expect(resultStyles).not.toContain(`.${legacyClass}`);
    }
    expect(editorSource).toContain('selectionStorageNamespace');
    expect(editorSource).toContain('knowledgePayload.wikis');
    expect(editorStyles).toContain('.bezier-workbench.workflow-editor-shell');
  });

  it('isolates browser selection keys by OEM product namespace', () => {
    expect(workflowSelectionStorageKeys('bezierdesign')).toEqual({
      knowledge: 'bezier:bezierdesign:workflow-knowledge-selection',
      steps: 'bezier:bezierdesign:workflow-step-selection',
    });
    expect(workflowSelectionStorageKeys('oem-demo')).toEqual({
      knowledge: 'bezier:oem-demo:workflow-knowledge-selection',
      steps: 'bezier:oem-demo:workflow-step-selection',
    });
  });

  it('does not leak saved knowledge or step choices between products', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('CustomEvent', class {
      constructor(public type: string, public init: unknown) {}
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: vi.fn(),
    });

    const knowledge = [
      { id: 'shared-default', defaultEnabled: true },
      { id: 'optional', defaultEnabled: true },
    ];
    setKnowledgeEnabled('bezierdesign', 'flow', 'optional', false, knowledge);
    expect(enabledKnowledgeIds('bezierdesign', 'flow', knowledge)).toEqual(['shared-default']);
    expect(enabledKnowledgeIds('oem-demo', 'flow', knowledge)).toEqual(['shared-default', 'optional']);

    const steps = [
      { id: 'draft', title: 'Draft', actor: 'AI' as const },
      { id: 'polish', title: 'Polish', actor: 'AI' as const },
      { id: 'save', title: 'Save', actor: 'Action' as const },
    ];
    setStepSkipped('oem-demo', 'flow', 'draft', true, steps);
    expect(skippedStepIds('oem-demo', 'flow', steps)).toEqual(['draft']);
    expect(skippedStepIds('bezierdesign', 'flow', steps)).toEqual([]);
  });

  it('keeps unknown execution actors on the non-skippable Action path', () => {
    expect(toStepActor('AI')).toBe('AI');
    expect(toStepActor('Eval')).toBe('Eval');
    expect(toStepActor('unknown')).toBe('Action');
  });
});
