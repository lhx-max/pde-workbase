import { createHash } from 'node:crypto';
import type { JsonValue, WorkflowInputSource, WorkflowStepInputSnapshot, WorkflowStepRun } from '@bezier/contracts';
import type { WorkflowRunSnapshot } from './persistence.js';

export function outputDigest(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function latestInputSteps(snapshot: WorkflowRunSnapshot): Map<string, WorkflowStepRun> {
  const latest = new Map<string, WorkflowStepRun>();
  for (const step of snapshot.steps) {
    const previous = latest.get(step.stepId);
    if (!previous || step.iteration > previous.iteration || (step.iteration === previous.iteration && step.attempt > previous.attempt)) latest.set(step.stepId, step);
  }
  return latest;
}

/** A routed parent supplies data only on the edge chosen in this attempt. */
export function activeInputParent(snapshot: WorkflowRunSnapshot, parent: WorkflowStepRun, targetId: string): boolean {
  const definition = snapshot.definition.steps.find(step => step.id === parent.stepId);
  return !definition?.routes?.length || definition.routes.some(route => route.id === parent.selectedRoute?.routeId && route.to === targetId);
}

function unique(sources: WorkflowInputSource[]): WorkflowInputSource[] {
  return [...new Map(sources.map(source => [source.stepRunId, source])).values()];
}

function sourceOf(snapshot: WorkflowRunSnapshot, step: WorkflowStepRun): WorkflowInputSource {
  if (step.output === undefined) throw new Error(`工作流输入缺失：${step.stepId}`);
  const definition = snapshot.definition.steps.find(item => item.id === step.stepId)!;
  return { stepRunId: step.id, stepId: step.stepId, title: definition.title,
    kind: String(definition.metadata?.nodeKind ?? definition.kind),
    iteration: step.iteration, attempt: step.attempt, outputDigest: outputDigest(step.output) };
}

/** Only new canvas-compiled definitions opt in. Historical runs keep their semantics. */
export function captureStepInput(
  snapshot: WorkflowRunSnapshot,
  step: WorkflowStepRun,
  now: number,
  historicalParent?: WorkflowStepRun,
): WorkflowStepInputSnapshot | undefined {
  const definition = snapshot.definition.steps.find(item => item.id === step.stepId)!;
  if (definition.metadata?.dataflowVersion !== 1) return undefined;
  if (step.inputSnapshot && !historicalParent) return step.inputSnapshot;
  const latest = latestInputSteps(snapshot);
  const parents = definition.dependsOn.flatMap(id => {
    const parent = historicalParent?.stepId === id ? historicalParent : latest.get(id);
    if (!parent) throw new Error(`工作流输入来源不存在：${id}`);
    if (parent.status === 'skipped' || !activeInputParent(snapshot, parent, step.stepId)) return [];
    if (parent.status !== 'succeeded' && !(parent === historicalParent && parent.status === 'cancelled' && parent.output !== undefined)) {
      throw new Error(`工作流上游尚未完成：${id}`);
    }
    return [parent];
  });
  if (definition.dependsOn.length && !parents.length) throw new Error(`工作流没有激活的输入路线：${step.stepId}`);
  const content: WorkflowInputSource[] = [];
  const context: WorkflowInputSource[] = [];
  for (const parent of parents) {
    const source = sourceOf(snapshot, parent);
    context.push(...(parent.inputSnapshot?.context ?? []));
    if (source.kind === 'clarify' || source.kind === 'branch') {
      content.push(...(parent.inputSnapshot?.content ?? []));
      context.push(source);
    } else {
      content.push(source);
      if (source.kind === 'review') context.push(source);
    }
  }
  const referenceSources: WorkflowInputSource[] = [];
  const references = definition.metadata?.inputReferences;
  if (Array.isArray(references)) for (const id of references) {
    if (typeof id !== 'string') continue;
    const referenced = latest.get(id);
    if (!referenced || referenced.status !== 'succeeded') throw new Error(`引用的输入来源未完成或已跳过：${id}`);
    const source = sourceOf(snapshot, referenced);
    referenceSources.push(source);
  }
  return { version: 1, definitionDigest: snapshot.definition.digest, capturedAt: new Date(now).toISOString(),
    task: snapshot.run.inputVersion ?? snapshot.run.input, upstream: parents.map(parent => sourceOf(snapshot, parent)),
    content: unique(content), references: unique(referenceSources), context: unique(context) };
}

export function readInputSource(snapshot: WorkflowRunSnapshot, source: WorkflowInputSource): JsonValue {
  const step = snapshot.steps.find(item => item.id === source.stepRunId);
  if (!step || step.output === undefined || outputDigest(step.output) !== source.outputDigest) {
    throw new Error(`工作流输入版本不可用：${source.title}，请从该步骤重新执行`);
  }
  return step.output;
}

/** Read only pinned output versions. Confirmation publishes its accepted result. */
export function snapshotContent(snapshot: WorkflowRunSnapshot, input: WorkflowStepInputSnapshot): Record<string, JsonValue> {
  return Object.fromEntries(input.content.map(source => {
    const value = readInputSource(snapshot, source);
    const accepted = source.kind === 'review' && isRecord(value) && 'result' in value ? value.result! : value;
    return [input.content.filter(item => item.stepId === source.stepId).length > 1 ? `${source.stepId}@${source.stepRunId}` : source.stepId, accepted];
  }));
}

export function snapshotVariables(snapshot: WorkflowRunSnapshot, input: WorkflowStepInputSnapshot): Record<string, JsonValue> {
  const root: Record<string, JsonValue> = isRecord(input.task) ? { ...input.task } : { task: input.task };
  // A previous run's context must not become a new run's implicit input.
  delete root.workflowContext;
  const outputs: Record<string, JsonValue> = {};
  for (const source of input.context) {
    const value = readInputSource(snapshot, source);
    outputs[input.context.filter(item => item.stepId === source.stepId).length > 1 ? `${source.stepId}@${source.stepRunId}` : source.stepId] = source.kind === 'review' && isRecord(value)
      ? { selectedIds: value.selectedIds ?? [], feedback: value.feedback ?? '' }
      : value;
  }
  for (const source of input.references ?? []) {
    const value = readInputSource(snapshot, source);
    outputs[source.stepId] = source.kind === 'review' && isRecord(value) && 'result' in value ? value.result! : value;
  }
  return { ...root, workflowContext: { nodeOutputs: outputs } };
}

export function snapshotPromptContext(snapshot: WorkflowRunSnapshot, stepRunId: string): Record<string, JsonValue> {
  const input = snapshot.steps.find(step => step.id === stepRunId)?.inputSnapshot;
  if (!input) return snapshot.run.variables;
  return { ...snapshotVariables(snapshot, input), upstreamContent: snapshotContent(snapshot, input) };
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
