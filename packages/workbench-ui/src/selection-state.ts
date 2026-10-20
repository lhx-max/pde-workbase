export type SelectableKnowledge = {
  id: string;
  defaultEnabled?: boolean;
  allowDisable?: boolean;
};

export type StepActor = 'AI' | 'Action' | 'Eval';

export type SelectableStep = {
  id: string;
  title: string;
  actor: StepActor;
  knowledgeIds?: string[];
};

type SelectionMap = Record<string, string[]>;

function safeNamespace(namespace: string): string {
  const normalized = namespace.trim().toLowerCase();
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalized) ? normalized : 'default';
}

function storageKey(namespace: string, kind: 'knowledge' | 'step'): string {
  return `bezier:${safeNamespace(namespace)}:workflow-${kind}-selection`;
}

function eventName(namespace: string, kind: 'knowledge' | 'step'): string {
  return `bezier:${safeNamespace(namespace)}:workflow-${kind}-selection-changed`;
}

function readMap(namespace: string, kind: 'knowledge' | 'step'): SelectionMap {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(namespace, kind)) || '{}') as SelectionMap;
  } catch {
    return {};
  }
}

function writeMap(
  namespace: string,
  kind: 'knowledge' | 'step',
  next: SelectionMap,
  detail: Record<string, unknown>,
): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(storageKey(namespace, kind), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(eventName(namespace, kind), { detail }));
}

export function enabledKnowledgeIds(
  namespace: string,
  flowId: string,
  items: SelectableKnowledge[],
): string[] {
  const allIds = items.map(item => item.id);
  const saved = readMap(namespace, 'knowledge')[flowId];
  const defaults = items.filter(item => item.defaultEnabled !== false).map(item => item.id);
  const enabled = new Set(Array.isArray(saved) ? saved : defaults);
  for (const item of items) {
    if (item.allowDisable === false) enabled.add(item.id);
  }
  return allIds.filter(id => enabled.has(id));
}

export function setKnowledgeEnabled(
  namespace: string,
  flowId: string,
  knowledgeId: string,
  enabled: boolean,
  items: SelectableKnowledge[],
): void {
  const allIds = items.map(item => item.id);
  const target = items.find(item => item.id === knowledgeId);
  if (!enabled && target?.allowDisable === false) return;
  const current = new Set(enabledKnowledgeIds(namespace, flowId, items));
  if (enabled) current.add(knowledgeId);
  else current.delete(knowledgeId);
  const next = {
    ...readMap(namespace, 'knowledge'),
    [flowId]: allIds.filter(id => current.has(id)),
  };
  writeMap(namespace, 'knowledge', next, { flowId, enabledIds: next[flowId] });
}

export function toStepActor(actor: string): StepActor {
  return actor === 'AI' || actor === 'Eval' ? actor : 'Action';
}

function isSkippableActor(actor: SelectableStep['actor']): boolean {
  return actor === 'AI';
}

function canSkipStep(steps: SelectableStep[], stepId: string, skipped: string[]): boolean {
  const target = steps.find(step => step.id === stepId);
  if (!target || !isSkippableActor(target.actor)) return false;
  const skippedSet = new Set(skipped);
  if (skippedSet.has(stepId)) return true;
  return steps.some(step => step.actor === 'AI' && step.id !== stepId && !skippedSet.has(step.id));
}

export function skippedStepIds(
  namespace: string,
  flowId: string,
  steps: SelectableStep[],
): string[] {
  const saved = readMap(namespace, 'step')[flowId];
  if (!Array.isArray(saved)) return [];
  return steps
    .filter(step => saved.includes(step.id) && isSkippableActor(step.actor))
    .map(step => step.id);
}

export function setStepSkipped(
  namespace: string,
  flowId: string,
  stepId: string,
  skipped: boolean,
  steps: SelectableStep[],
): void {
  const current = new Set(skippedStepIds(namespace, flowId, steps));
  if (skipped) {
    if (!canSkipStep(steps, stepId, [...current])) return;
    current.add(stepId);
  } else {
    current.delete(stepId);
  }
  const next = {
    ...readMap(namespace, 'step'),
    [flowId]: steps.filter(step => current.has(step.id)).map(step => step.id),
  };
  writeMap(namespace, 'step', next, { flowId, skippedIds: next[flowId] });
}

export function workflowSelectionStorageKeys(namespace: string): Readonly<{
  knowledge: string;
  steps: string;
}> {
  return Object.freeze({
    knowledge: storageKey(namespace, 'knowledge'),
    steps: storageKey(namespace, 'step'),
  });
}
