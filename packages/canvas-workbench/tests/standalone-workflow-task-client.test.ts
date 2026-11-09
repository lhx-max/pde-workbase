import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasTaskSubmitter } from '../src/platform/task-client';
import type { AgentTaskDisplay } from '../src/platform/agent-bridge';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const run = { id: 'run-a', projectId: 'project-a', workflowId: 'workflow-a' };
const display: AgentTaskDisplay = { kind: 'instruction-card', title: 'Continue', genericWorkflow: {
  runId: 'run-a', workflowId: 'workflow-a', stepRunId: 'step-a', nodeTitle: 'Next step', expectsCandidates: false,
} };
const clients: ReturnType<typeof createCanvasTaskSubmitter>[] = [];
function setup(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const client = createCanvasTaskSubmitter({ context: { projectId: 'project-a', transport: {
    baseUrl: 'https://canvas.example/prefix', fetch, headers: () => ({ 'x-canvas-authority-id': 'scope-a' }),
  } } });
  clients.push(client); return client;
}
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); });

describe('workflow and contextual task ownership', () => {
  it('continues the existing validated graph executor without creating a detached agent task', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'POST' ? { run } : { run, steps: [{ id: 'step-a' }] }));
    await setup(fetch).submit('Continue selected result', display);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://canvas.example/prefix/api/workflow-graph-runs/run-a',
      'https://canvas.example/prefix/api/workflow-graph-runs/run-a/execution',
    ]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ action: 'recover', stepRunId: 'step-a' });
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('x-canvas-authority-id')).toBe('scope-a');
  });
  it.each([
    { run: { ...run, projectId: 'other-project' }, steps: [{ id: 'step-a' }] },
    { run: { ...run, id: 'other-run' }, steps: [{ id: 'step-a' }] },
    { run: { ...run, workflowId: 'other-workflow' }, steps: [{ id: 'step-a' }] },
    { run, steps: [{ id: 'other-step' }] },
  ])('rejects mismatched project/run/workflow/step before mutation', async snapshot => {
    const fetch = vi.fn(async () => json(snapshot));
    await expect(setup(fetch).submit('Continue', display)).rejects.toThrow('does not belong');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('reports unavailable execution without falling back to detached paid work', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? json({ error: { message: 'Agent adapter unavailable' } }, 503) : json({ run, steps: [{ id: 'step-a' }] }));
    await expect(setup(fetch).submit('Continue', display)).rejects.toThrow('Agent adapter unavailable');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not silently discard unbound workflow attachments or business archive semantics', async () => {
    const fetch = vi.fn(async () => json({}));
    const client = setup(fetch);
    await expect(client.submit('Continue', display, [new File(['private'], 'source.txt')])).rejects.toThrow('verified input');
    await expect(client.submit('Continue', { ...display, genericWorkflow: undefined, runArchive: { instanceId: 'archive', stage: 'creative', trigger: 'continue' } })).rejects.toThrow('host task adapter');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains selected design system and target context in the independent task request', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return json({ ok: true, task: { id: 'task-a', projectId: 'project-a', requestId: request.requestId, status: 'succeeded', createdAt: 1, updatedAt: 1 } });
    });
    const taskContext = { targetLabel: 'Page', baseVersionKind: 'target-snapshot' as const, baseVersionSource: 'approved snapshot' };
    await setup(fetch).submit('Render', { kind: 'instruction-card', title: 'Page', designSystemId: 'external-brand', taskContext });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ designSystemId: 'external-brand', taskContext });
  });
});
