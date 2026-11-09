import type { Node } from '@xyflow/react';
import type { WorkflowCanvasRun, WorkflowResultArtifact, WorkflowStepRun } from '@bezier/contracts';

export type WorkflowRunGroupLayout = {
  x: number; y: number; collapsed?: boolean; dismissed?: boolean; layoutVersion?: number;
  members: Record<string, { x: number; y: number }>;
  detached?: string[];
};
export const workflowRunGroupId = (id: string) => `workflow-run-group-${id}`;
export const workflowQuestionNodeId = (id: string) => `workflow-question-${id}`;

/** A runtime record alone does not opt a business feature into workflow chrome. */
export function workflowGroupRuns(snapshots: WorkflowCanvasRun[]) {
  return snapshots.filter(snapshot => snapshot.definition.canvasPresentation === 'run-group');
}

/** Ignore historical auto-group layouts, including collapse/delete flags and drag offsets. */
export function activeWorkflowGroups(groups: Record<string, WorkflowRunGroupLayout>, snapshots: WorkflowCanvasRun[]) {
  const ids = new Set(workflowGroupRuns(snapshots).map(snapshot => snapshot.run.id));
  return Object.fromEntries(Object.entries(groups).filter(([id]) => ids.has(id)));
}

export function workflowRunSteps(snapshot: WorkflowCanvasRun) {
  const latest = new Map<string, WorkflowStepRun>();
  for (const step of snapshot.steps) {
    const previous = latest.get(step.stepId);
    if (!previous || step.sequence > previous.sequence) latest.set(step.stepId, step);
  }
  return snapshot.definition.steps.filter(step => step.metadata?.nodeKind !== 'start').map(definition => ({
    definition, step: latest.get(definition.id),
    status: latest.get(definition.id)?.status ?? 'pending',
  }));
}

/** Membership is provenance, never inferred from proximity or definition node count. */
export function workflowNodeOwners(nodes: Node[], artifacts: WorkflowResultArtifact[], snapshots: WorkflowCanvasRun[]) {
  snapshots = workflowGroupRuns(snapshots);
  const runIds = new Set(snapshots.map(snapshot => snapshot.run.id));
  const owners = new Map<string, string>();
  for (const artifact of artifacts) if (runIds.has(artifact.workflowRunId)) owners.set(`workflow-result-${artifact.id}`, artifact.workflowRunId);
  for (const snapshot of snapshots) {
    if (snapshot.clarification) owners.set(workflowQuestionNodeId(snapshot.run.id), snapshot.run.id);
    for (const step of snapshot.steps) {
      for (const ref of step.artifactRefs) if (ref.startsWith('canvas-node:')) owners.set(ref.slice(12), snapshot.run.id);
    }
  }
  for (const node of nodes) {
    const source = (node.data as { node?: { source?: { workflowRunId?: string } } }).node?.source;
    if (source?.workflowRunId && runIds.has(source.workflowRunId)) owners.set(node.id, source.workflowRunId);
  }
  return owners;
}

/** Compact only on first layout, explicit arrange, or replacing temporary placeholders. */
export function arrangeWorkflowMembers(nodes: Node[], snapshot: WorkflowCanvasRun) {
  const rank = new Map<string, number>();
  snapshot.definition.steps.forEach((definition, index) => {
    for (const step of snapshot.steps.filter(s => s.stepId === definition.id)) {
      for (const ref of step.artifactRefs) if (ref.startsWith('canvas-node:')) rank.set(ref.slice(12), index);
      for (const node of nodes) {
        const artifact = (node.data as { artifact?: WorkflowResultArtifact }).artifact;
        if (artifact?.sourceStepRunId === step.id || artifact?.resultDefinitionId === definition.id) rank.set(node.id, index);
      }
    }
  });
  const ordered = [...nodes].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  const members: WorkflowRunGroupLayout['members'] = {};
  let x = 24;
  for (const node of ordered) {
    members[node.id] = { x, y: 240 };
    x += workflowMemberWidth(node) + 80;
  }
  return members;
}
function workflowMemberWidth(node?: Node) {
  return node?.measured?.width ?? node?.width ?? (Number(node?.style?.width) || (node?.type === 'workflowStage' ? 480 : 640));
}
const temporaryMember = (id: string) => id.startsWith('workflow-initial-pending-') || id.startsWith('workflow-regeneration-pending-') || id.startsWith('workflow-question-');

/** Persist a canvas dismissal so polling and late outputs cannot recreate a removed run.
 * Detached cards belong to the canvas independently and survive group deletion. */
export function dismissedWorkflowNodeIds(groups: Record<string, WorkflowRunGroupLayout>, nodes: Node[], owners: ReadonlyMap<string, string>) {
  const hidden = new Set<string>();
  for (const node of nodes) {
    const owner = owners.get(node.id);
    const group = owner ? groups[owner] : undefined;
    if (group?.dismissed && !group.detached?.includes(node.id)) hidden.add(node.id);
  }
  return hidden;
}

/** Polls preserve manual positions; vanished temporary cards never reserve permanent gaps. */
export function reconcileWorkflowGroups(current: Record<string, WorkflowRunGroupLayout>, snapshots: WorkflowCanvasRun[], nodes: Node[], owners: Map<string, string>) {
  const next = { ...current };
  let changed = false;
  for (const snapshot of workflowGroupRuns(snapshots)) {
    const id = snapshot.run.id;
    if (!next[id]) {
      const right = Math.max(0, ...nodes.filter(n => !owners.has(n.id)).map(n => n.position.x + workflowMemberWidth(n)), ...Object.values(activeWorkflowGroups(next, snapshots)).filter(g => !g.dismissed).map(g => g.x + Math.max(1100, ...Object.entries(g.members).map(([key, p]) => p.x + workflowMemberWidth(nodes.find(n => n.id === key)) + 24))));
      next[id] = { x: right + 100, y: 100, members: {}, layoutVersion: 3 }; changed = true;
    }
    const layout = next[id]!;
    if (layout.dismissed) continue;
    const eligible = nodes.filter(n => owners.get(n.id) === id && !n.parentId && !layout.detached?.includes(n.id));
    // Upgrade the original oversized run layout once; future polls never rearrange user edits.
    if (layout.layoutVersion !== 3) {
      next[id] = { ...layout, layoutVersion: 3, members: arrangeWorkflowMembers(eligible, snapshot) }; changed = true;
      continue;
    }
    const members = { ...layout.members };
    const vacant: Array<{x: number; y: number}> = [];
    for (const [key, point] of Object.entries(members)) if (temporaryMember(key) && !nodes.some(n => n.id === key)) {
      vacant.push(point); delete members[key];
    }
    let updated = vacant.length > 0;
    const additions = eligible.filter(n => !members[n.id]);
    if (!Object.keys(members).length && additions.length) {
      Object.assign(members, arrangeWorkflowMembers(additions, snapshot)); updated = true;
    } else for (const node of additions) {
      const right = Math.max(24, ...Object.entries(members).filter(([key]) => !layout.detached?.includes(key)).map(([key, p]) => p.x + workflowMemberWidth(nodes.find(n => n.id === key)) + 80));
      members[node.id] = vacant.shift() ?? { x: right, y: 240 }; updated = true;
    }
    if (updated) { next[id] = { ...layout, members }; changed = true; }
  }
  return changed ? next : current;
}

/** Persist business positions in world coordinates while the view uses relative children. */
export function workflowGroupMoves(positions: Array<{ id: string; x: number; y: number }>, groups: Record<string, WorkflowRunGroupLayout>) {
  const next = { ...groups };
  const output = new Map(positions.map(p => [p.id, p]));
  for (const [runId, layout] of Object.entries(groups)) {
    const groupMove = output.get(workflowRunGroupId(runId));
    if (groupMove) output.delete(groupMove.id);
    let changed = !!groupMove;
    const updated = { ...layout, ...(groupMove ? { x: groupMove.x, y: groupMove.y } : {}), members: { ...layout.members } };
    for (const [id, point] of Object.entries(layout.members)) {
      if (layout.detached?.includes(id)) continue;
      const moved = output.get(id);
      if (moved) { updated.members[id] = { x: moved.x, y: moved.y }; changed = true; }
      if (groupMove || moved) output.set(id, { id, x: updated.x + (moved?.x ?? point.x), y: updated.y + (moved?.y ?? point.y) });
    }
    if (changed) {
      // Grow toward the left/top as well, preserving every card's world position.
      const attached = Object.entries(updated.members).filter(([id]) => !updated.detached?.includes(id));
      const dx = Math.min(0, ...attached.map(([, p]) => p.x - 24));
      const dy = Math.min(0, ...attached.map(([, p]) => p.y - 240));
      if (dx || dy) {
        updated.x += dx; updated.y += dy;
        for (const [id, p] of attached) updated.members[id] = { x: p.x - dx, y: p.y - dy };
      }
      next[runId] = updated;
    }
  }
  return { groups: next, positions: [...output.values()] };
}

/** Project immutable input lineage through steps with no canvas card. Never join by visual order. */
export function workflowRunConnections(nodes: Node[], artifacts: WorkflowResultArtifact[], snapshots: WorkflowCanvasRun[]) {
  snapshots = workflowGroupRuns(snapshots);
  const present = new Set(nodes.map(n => n.id));
  const edges: Array<{id: string; source: string; target: string}> = [];
  for (const snapshot of snapshots) {
    const outputs = new Map<string, string[]>();
    const steps = new Map(snapshot.steps.map(step => [step.id, step]));
    for (const step of snapshot.steps) {
      const cards = artifacts.filter(a => a.workflowRunId === snapshot.run.id && (a.resultDefinitionId === step.stepId && (a.sourceStepRunId === step.id || step.inputSnapshot?.upstream.some(input => input.stepRunId === a.sourceStepRunId)))).map(a => `workflow-result-${a.id}`);
      const documents = step.artifactRefs.filter(ref => ref.startsWith('canvas-node:')).map(ref => ref.slice(12));
      outputs.set(step.id, [...new Set([...cards, ...documents])].filter(id => present.has(id)));
    }
    const nearest = (stepId: string, seen = new Set<string>()): string[] => {
      if (seen.has(stepId)) return [];
      const own = outputs.get(stepId) ?? [];
      if (own.length) return [own[own.length - 1]!];
      const branch = new Set(seen).add(stepId);
      return (steps.get(stepId)?.inputSnapshot?.upstream ?? []).flatMap(input => nearest(input.stepRunId, branch));
    };
    const add = (source: string, target: string) => {
      if (source === target || edges.some(e => e.source === source && e.target === target)) return;
      edges.push({ id: `chain-run-${snapshot.run.id}-${source}-${target}`, source, target });
    };
    for (const step of snapshot.steps) {
      const targets = outputs.get(step.id) ?? [];
      if (!targets.length) continue;
      for (const input of step.inputSnapshot?.upstream ?? []) for (const source of nearest(input.stepRunId)) add(source, targets[0]!);
      for (let index = 1; index < targets.length; index++) add(targets[index - 1]!, targets[index]!);
    }
  }
  return edges;
}
