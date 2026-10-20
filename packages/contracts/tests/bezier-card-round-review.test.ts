import { describe, expect, it } from 'vitest';
import { splitOnBezierCards, tryParseBezierCard } from '../src/artifacts/bezier-card.js';

describe('round review bezier-card', () => {
  const payload = {
    kind: 'round-review',
    projectId: 'project-1',
    instanceId: 'plan-1',
    flowId: 'plan_analysis',
    stage: 'creative',
    round: 2,
    caseRevision: 4,
    candidates: [
      { id: 'creative-1', title: '方向一', summary: '内容摘要' },
    ],
  };

  it('parses a complete persisted review card', () => {
    expect(tryParseBezierCard(JSON.stringify(payload), { type: 'round-review' }))
      .toEqual(payload);
    expect(splitOnBezierCards(
      `请选择\n<bezier-card type="round-review">${JSON.stringify(payload)}</bezier-card>`,
    )).toHaveLength(2);
  });

  it('rejects malformed or empty cards', () => {
    expect(tryParseBezierCard(JSON.stringify({ ...payload, caseRevision: 0 }), {
      type: 'round-review',
    })).toBeNull();
    expect(tryParseBezierCard(JSON.stringify({ ...payload, candidates: [] }), {
      type: 'round-review',
    })).toBeNull();
  });
});

describe('workflow result bezier-card', () => {
  const payload = {
    kind: 'workflow-result',
    projectId: 'project-1',
    resultId: 'result-1',
    version: 2,
    title: '候选结果',
    shape: 'collection',
    renderer: 'structured',
    rendererConfig: {
      fields: [{ key: 'scene', label: '场景' }],
    },
    capabilities: ['select', 'comment', 'regenerate', 'continue'],
    chatCapabilities: ['select', 'comment', 'continue'],
    selection: { mode: 'multiple', min: 0, max: 3 },
    feedback: { label: '调整意见', placeholder: '可选' },
    actions: [{
      id: 'continue',
      capability: 'continue',
      label: '继续',
      completion: 'lock-card',
      when: { minSelection: 1, feedback: 'empty' },
    }],
    items: [
      { id: 'a', title: 'A', summary: '第一项', data: { score: 1 } },
      { id: 'b', title: 'B', summary: '第二项' },
    ],
  };

  it('parses a definition-driven result without workflow-specific fields', () => {
    expect(tryParseBezierCard(JSON.stringify(payload), { type: 'workflow-result' }))
      .toEqual(payload);
  });

  it('rejects results without actions or collection items', () => {
    expect(tryParseBezierCard(JSON.stringify({ ...payload, actions: [] }), {
      type: 'workflow-result',
    })).toBeNull();
    expect(tryParseBezierCard(JSON.stringify({ ...payload, items: [] }), {
      type: 'workflow-result',
    })).toBeNull();
  });
});
