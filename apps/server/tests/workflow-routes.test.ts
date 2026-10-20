import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanvasTaskReceipt, CanvasTaskDelivery, WorkflowResultArtifact, WorkflowRun } from '@bezier/contracts';
import { Database } from '../src/storage/database.js';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { CanvasStateService } from '../src/canvas/state.js';
import { AgentTasks, type AgentAdapter } from '../src/services-tasks.js';
import { registerWorkflowRoutes } from '../src/routes/workflows.js';
import type { WorkflowGraphConfig, Next } from '../src/workflows/generic-graph.js';

type RunBody = { run: WorkflowRun; next: Next; reused?: boolean; error?: { code: string } };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const graph: WorkflowGraphConfig = { id: 'independent-flow', title: 'Original workflow', version: 2, updatedAt: '2026-09-24', nodes: [
  { id: 'start', kind: 'start', title: 'Start', description: '' },
  { id: 'draft', kind: 'agent', title: 'Draft', description: 'Draft candidates', agentConfig: { systemPrompt: 'Preserve facts', confirmation: { mode: 'continue', selection: 'single', selectionRequired: true, materializeOnConfirm: false } } },
  { id: 'final', kind: 'agent', title: 'Finalize', description: 'Use accepted draft', agentConfig: { outputContract: { format: 'markdown' } } },
  { id: 'deliver', kind: 'delivery', title: 'Document', description: '', deliveryConfig: { artifactKind: 'text' } },
], edges: [{ id: 'e1', source: 'start', target: 'draft' }, { id: 'e2', source: 'draft', target: 'final' }, { id: 'e3', source: 'final', target: 'deliver' }] };

async function harness(withAgent = true, existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(path.join(tmpdir(), 'independent-workflow-'));
  if (!existingRoot) cleanups.push(async () => { expect(path.basename(root)).toMatch(/^independent-workflow-/); await rm(root, { recursive: true, force: true }); });
  const registry = createProjectRegistry(root);
  if (!registry.get('project')) registry.create({ id: 'project', name: 'Project' });
  const canvas = new CanvasStateService(async id => registry.resolveProjectRoot(id));
  const db = new Database(path.join(root, 'workspace.sqlite'));
  const pending = new Map<string, { input: Parameters<AgentAdapter['execute']>[0]; resolve: (value: CanvasTaskDelivery) => void }>();
  const agent: AgentAdapter = { execute: input => new Promise((resolve, reject) => {
    pending.set(input.task.id, { input, resolve });
    input.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
  }) };
  const deliveryObservers = new Set<() => void>();
  // Observe completion of the real publication method, not coalescible fs.watch
  // events. No execution or persistence behavior is replaced by this test hook.
  class ObservedAgentTasks extends AgentTasks {
    override async deliver(...args: Parameters<AgentTasks['deliver']>): Promise<CanvasTaskReceipt> {
      const receipt = await super.deliver(...args);
      for (const observer of deliveryObservers) observer();
      return receipt;
    }
  }
  const tasks = new ObservedAgentTasks(registry, canvas, withAgent ? agent : undefined);
  let authorized = true;
  const app = express(); app.use(express.json());
  const workflows = registerWorkflowRoutes(app, { db, registry, canvas, tasks, ...(withAgent ? { agent } : {}),
    authorize: (_req, res) => { if (authorized) return true; res.status(403).json({ error: { code: 'DENIED' } }); return false; },
    authorizeExecution: async () => { if (!authorized) throw new Error('Authority revoked'); },
  });
  const server: Server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    await workflows.stop();
    for (const id of pending.keys()) await tasks.cancel('project', id);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
  cleanups.push(close);
  async function call<T = RunBody>(endpoint: string, body?: unknown, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${base}${endpoint}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? undefined as T : await response.json() as T };
  }
  async function start(execution?: unknown, value: unknown = { task: 'Preserve root facts' }) {
    expect((await call(`/api/workflow-graphs/${graph.id}`, graph, 'PUT')).status).toBe(200);
    const result = await call(`/api/projects/project/workflow-graphs/${graph.id}/runs`, { requestId: 'start-once', value, ...(execution ? { execution } : {}) });
    if (result.body.run) await workflows.execution?.advance(result.body.run.id);
    return result;
  }
  async function finish(runId: string, content: string) {
    const current = workflows.graphs.current(runId);
    if (current.next.kind !== 'agent') throw new Error(`Expected agent, got ${current.next.kind}`);
    const receipt = tasks.findByRequestId('project', `workflow-step-${current.next.stepRunId}`)!;
    const complete = new Promise<CanvasTaskReceipt>((resolve, reject) => {
      const timer = setTimeout(() => { deliveryObservers.delete(check); reject(new Error('Task delivery did not complete')); }, 3000);
      function check() {
        const task = tasks.getById(receipt.id);
        if (task && ['succeeded', 'failed', 'cancelled'].includes(task.status)) {
          deliveryObservers.delete(check); clearTimeout(timer); resolve(task);
        }
      }
      deliveryObservers.add(check); // Subscribe before allowing the adapter to finish.
      pending.get(receipt.id)!.resolve({ content });
      check(); // Also cover a receipt already persisted when the observer was registered.
    });
    expect((await complete).status).toBe('succeeded');
    await workflows.execution!.advance(runId);
  }
  return { root, registry, db, canvas, workflows, tasks, pending, start, finish, call, close, revoke: () => { authorized = false; } };
}

describe('independent original workflow HTTP composition', () => {
  it('reports an absent adapter without creating a pretend running workflow', async () => {
    const h = await harness(false);
    const result = await h.start();
    expect(result.status).toBe(503); expect(result.body.error?.code).toBe('AGENT_ADAPTER_UNAVAILABLE');
    expect(h.workflows.graphs.listProjectRuns('project')).toEqual([]);
    expect((await h.call(`/api/workflow-graphs/${graph.id}/assistant`, { message: 'Edit', workflow: graph })).status).toBe(503);
    const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(JSON.stringify(tables)).not.toMatch(/chat_runs|messages|conversations/);
    expect(JSON.stringify(tables)).toContain('workflow_run_task_runs');
  });

  it('executes real task receipts, confirms results, delivers once and reopens persisted state', async () => {
    const h = await harness();
    const projectRoot = h.registry.resolveProjectRoot('project')!;
    await mkdir(path.join(projectRoot, 'inputs'), { recursive: true });
    await writeFile(path.join(projectRoot, 'inputs/source.txt'), 'PINNED_SOURCE_BYTES');
    const value = { task: 'Preserve root facts', source: { kind: 'project-file', path: 'inputs/source.txt' } };
    const started = await h.start(undefined, value); expect(started.status).toBe(201);
    const runId = started.body.run.id;
    const inputWorkspace = [...h.pending.values()][0]!.input.workspace!;
    expect(await readFile(path.join(inputWorkspace.cwd, 'inputs/source.txt'), 'utf8')).toBe('PINNED_SOURCE_BYTES');
    expect([...h.pending.values()][0]!.input.workspace?.cwd).not.toBe(h.registry.resolveProjectRoot('project'));
    expect([...h.pending.values()][0]!.input.workspace?.cwd.startsWith(h.root)).toBe(true);
    await h.finish(runId, JSON.stringify([{ title: 'Chosen draft', content: 'PINNED_DRAFT_FACT' }]));
    expect(h.workflows.graphs.current(runId).next.kind).toBe('review');
    const listed = await h.call<{ artifacts: WorkflowResultArtifact[] }>('/api/projects/project/workflow-results');
    const artifact = listed.body.artifacts[0]!; expect(artifact.items).toHaveLength(1);
    const interaction = { actionId: 'continue', expectedVersion: artifact.version, selectedIds: [artifact.items![0]!.id], feedback: '', surface: 'canvas', idempotencyKey: 'accept-once' };
    const accepted = await h.call(`/api/workflow-results/${artifact.id}/interactions`, interaction); expect(accepted.status).toBe(200);
    expect(accepted.body).not.toHaveProperty('agentPrompt');
    expect((await h.call(`/api/workflow-results/${artifact.id}/interactions`, interaction)).body).toEqual(accepted.body);
    // The interaction route, not a second browser task, owns the next dispatch.
    expect(h.pending.size).toBe(2);
    expect(h.tasks.list('project')).toHaveLength(2);
    expect([...h.pending.values()].at(-1)!.input.request.prompt).toContain('PINNED_DRAFT_FACT');
    await h.finish(runId, '# Final document\n\nVerified original delivery.');
    expect(h.workflows.graphs.current(runId).next.kind).toBe('completed');
    const snapshot = await h.canvas.read('project');
    const nodes = snapshot.state.workbenchBasicNodes as Array<{ id: string; projectFilePath?: string }>;
    expect(nodes).toHaveLength(1);
    const documentPath = nodes[0]!.projectFilePath!;
    expect(await readFile(path.join(h.registry.resolveProjectRoot('project')!, documentPath), 'utf8')).toContain('Verified original delivery');
    expect((await h.start(undefined, value)).body.run.id).toBe(runId); expect(h.pending.size).toBe(2);
    await h.close();
    const reopened = await harness(true, h.root);
    expect((await reopened.call(`/api/workflow-graph-runs/${runId}`)).body.run.status).toBe('succeeded');
    expect((await reopened.canvas.read('project')).state).toEqual(snapshot.state);
    expect((await reopened.call<{ artifacts: WorkflowResultArtifact[] }>('/api/projects/project/workflow-results')).body.artifacts.length).toBeGreaterThan(0);
  });

  it('preserves external-host prompts for a genuinely unmanaged run even with an executor configured', async () => {
    const h = await harness();
    h.workflows.graphs.saveConfig(graph);
    const started = h.workflows.graphs.start({ projectId: 'project', workflowId: graph.id });
    if (started.next.kind !== 'agent') throw new Error('Expected external agent hand-off');
    await h.workflows.graphs.completeAgentAndDelivery({ runId: started.snapshot.run.id, stepRunId: started.next.stepRunId, output: { title: 'External draft', content: 'EXTERNAL_HOST_FACT' } });
    const artifact = h.workflows.results.list({ projectId: 'project' })[0]!;
    const response = await h.call(`/api/workflow-results/${artifact.id}/interactions`, { actionId: 'continue', expectedVersion: artifact.version, selectedIds: [artifact.items![0]!.id], surface: 'canvas', idempotencyKey: 'external-continue' });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('agentPrompt', expect.stringContaining('EXTERNAL_HOST_FACT'));
    expect(h.workflows.execution!.owns(started.snapshot.run.id)).toBe(false);
    expect(h.pending.size).toBe(0); expect(h.tasks.list('project')).toEqual([]);
  });

  it('passes provider credentials only to ephemeral adapter context, never SQL or receipts', async () => {
    const h = await harness();
    const snapshot = { mode: 'api', model: 'selected/model', byokProvider: { protocol: 'openai', apiKey: 'private-workflow-key', baseUrl: 'https://example.test/v1?token=private-route' } };
    const started = await h.start({ snapshot }); expect(started.status).toBe(201);
    const input = [...h.pending.values()][0]!.input;
    expect(input).toHaveProperty('execution', snapshot);
    const sql = JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_owners').all()) + JSON.stringify(h.db.prepare('SELECT * FROM workflow_execution_steps').all());
    expect(sql).not.toContain('private-workflow-key'); expect(sql).not.toContain('private-route');
    for (const file of await readdir(path.join(h.root, 'agent-tasks'))) if (file.endsWith('.json')) {
      const content = await readFile(path.join(h.root, 'agent-tasks', file), 'utf8');
      expect(content).not.toContain('private-workflow-key'); expect(content).not.toContain('private-route');
    }
  });

  it('enforces project authorization and stops children when execution authority is revoked', async () => {
    const h = await harness(); const started = await h.start(); const runId = started.body.run.id;
    const active = [...h.pending.values()][0]!;
    h.revoke(); expect((await h.call(`/api/workflow-graph-runs/${runId}`)).status).toBe(403);
    await h.workflows.execution!.advance(runId);
    expect(active.input.signal.aborted).toBe(true);
    active.resolve({ content: 'LATE_UNAUTHORIZED_RESULT' });
    expect(h.tasks.getById(active.input.task.id)?.status).toBe('cancelled');
    expect(h.workflows.graphs.current(runId).next.kind).not.toBe('completed');
    expect((await h.canvas.read('project')).state.workbenchBasicNodes ?? []).toEqual([]);
  });
});
