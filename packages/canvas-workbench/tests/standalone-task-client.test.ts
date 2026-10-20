import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasTaskReceipt } from '@bezier/contracts';
import { createCanvasTaskSubmitter } from '../src/platform/task-client';
import { setCanvasHostContext, type CanvasHostContext } from '../src/platform/api-base';
import type { AgentTaskDisplay } from '../src/platform/agent-bridge';

const display: AgentTaskDisplay = {
  kind: 'instruction-card', title: 'Generate card',
  canvasTextGeneration: { requestId: 'request-1', nodeId: 'text-node', outputKind: 'text' },
  canvasArtifactGeneration: { requestId: 'request-1', nodeId: 'artifact-node', format: 'html' },
};
function receipt(status: CanvasTaskReceipt['status'] = 'queued', extra: Partial<CanvasTaskReceipt> = {}): CanvasTaskReceipt {
  return { id: 'task-1', projectId: 'project-a', requestId: 'request-1', status, createdAt: 1, updatedAt: 2, ...extra };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const taskResponse = (task: CanvasTaskReceipt) => json({ ok: true, task });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const clients: ReturnType<typeof createCanvasTaskSubmitter>[] = [];
function harness(fetch: (url: string, init?: RequestInit) => Promise<Response>, context?: CanvasHostContext) {
  const callbacks = { onTask: vi.fn(), onTextResult: vi.fn(), onArtifactResult: vi.fn(), onError: vi.fn() };
  const client = createCanvasTaskSubmitter({ context: context ?? { projectId: 'project-a', transport: { baseUrl: 'https://canvas.example/proxy', fetch, headers: () => ({ authorization: 'token-a' }) } }, pollIntervalMs: 100, ...callbacks });
  clients.push(client);
  return { client, ...callbacks };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); setCanvasHostContext(null); });

describe('standalone task submission', () => {
  it('forwards browser execution metadata and explicit snapshot inputs together with attachments', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/upload') ? json({ files: [{ path: 'inputs/attachments/photo.png' }] }) : taskResponse(receipt('succeeded')));
    const { client } = harness(fetch);
    const executionContext = { skillIds: ['page-recreation'], sessionMode: 'design', visiblePrompt: 'Extract page', context: { skillIds: ['page-recreation'], workspaceItems: [{ id: 'tab', kind: 'browser', label: 'Example', title: 'Example', url: 'https://example.com/', tabId: 'tab' }] } };
    await client.submit('Extract', { ...display, executionContext, inputPaths: ['snap/page.html', 'snap/page.css', 'snap/manifest.json'] } as AgentTaskDisplay, [new File(['image'], 'photo.png')]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject({ executionContext, inputPaths: ['snap/page.html', 'snap/page.css', 'snap/manifest.json', 'inputs/attachments/photo.png'] });
  });
  it('rejects workflow continuation context or new snapshot paths instead of silently dropping them', async () => {
    const fetch = vi.fn(async () => taskResponse(receipt())); const { client } = harness(fetch);
    await expect(client.submit('Continue', { kind: 'instruction-card', title: 'Continue', genericWorkflow: { runId: 'run', workflowId: 'workflow', stepRunId: 'step', nodeTitle: 'Node', expectsCandidates: false }, inputPaths: ['snap/page.html'] } as AgentTaskDisplay)).rejects.toThrow(/verified input snapshot/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('confirms all uploads before task creation and preserves input order, multipart dir order and binding request identity', async () => {
    const first = deferred<Response>(); const second = deferred<Response>();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/upload')) return (init?.body as FormData).get('files') instanceof File && ((init?.body as FormData).get('files') as File).name === 'first.txt' ? first.promise : second.promise;
      return taskResponse(receipt('succeeded'));
    });
    const { client } = harness(fetch);
    const submitted = client.submit('Generate original prompt', display, [new File(['one'], 'first.txt'), new File(['two'], 'second.txt')]);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) expect(Array.from((call[1]?.body as FormData).keys())).toEqual(['dir', 'files']);
    second.resolve(json({ files: [{ path: 'inputs/attachments/second.txt' }] }));
    await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(2);
    first.resolve(json({ files: [{ path: 'inputs/attachments/first.txt' }] }));
    await submitted;
    const [url, init] = fetch.mock.calls[2]!;
    expect(url).toBe('https://canvas.example/proxy/api/projects/project-a/agent/tasks');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ requestId: 'request-1', prompt: 'Generate original prompt', canvasTextGeneration: display.canvasTextGeneration, canvasArtifactGeneration: display.canvasArtifactGeneration, inputPaths: ['inputs/attachments/first.txt', 'inputs/attachments/second.txt'] });
    expect(String(init?.body)).not.toMatch(/messages|conversationId|assistantMessageId/);
  });
  it('does not create a task after an upload fails or returns no confirmed project path', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json({ files: [] }));
    const { client } = harness(fetch);
    await expect(client.submit('Generate', display, [new File(['x'], 'input.txt')])).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]?.[0]).toMatch(/\/upload$/);
  });
  it('does not resubmit paid work after task submission loses its response', async () => {
    const fetch = vi.fn(async () => { throw new Error('Response lost after acceptance'); });
    const { client, onTask } = harness(fetch);
    await expect(client.submit('Generate', display)).rejects.toThrow('Response lost');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledOnce(); expect(onTask).not.toHaveBeenCalled();
  });
  it('rejects blank/disposed submission without uploads or HTTP', async () => {
    const fetch = vi.fn(async () => taskResponse(receipt())); const { client } = harness(fetch);
    await expect(client.submit('  ', display)).rejects.toThrow(/empty/);
    client.dispose(); await expect(client.submit('Generate', display)).rejects.toThrow(/disposed/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not submit paid work when disposed while attachments are still uploading', async () => {
    const uploaded = deferred<Response>();
    const fetch = vi.fn(async (url: string) => url.endsWith('/upload') ? uploaded.promise : taskResponse(receipt()));
    const { client } = harness(fetch);
    const submitted = client.submit('Generate', display, [new File(['x'], 'input.txt')]);
    const rejected = expect(submitted).rejects.toThrow(/disposed/);
    client.dispose(); uploaded.resolve(json({ files: [{ path: 'inputs/attachments/input.txt' }] }));
    await rejected;
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('standalone task progress and durable delivery', () => {
  it('resolves acceptance immediately, publishes progress and stops polling on terminal delivery', async () => {
    const fetch = vi.fn< (url: string, init?: RequestInit) => Promise<Response> >()
      .mockResolvedValueOnce(taskResponse(receipt()))
      .mockResolvedValueOnce(taskResponse(receipt('running')))
      .mockResolvedValueOnce(taskResponse(receipt('succeeded', { deliveryState: 'applied', result: { content: 'Delivered text', file: 'outputs/index.html' } })));
    const { client, onTask, onTextResult, onArtifactResult } = harness(fetch);
    await client.submit('Generate', display);
    expect(fetch).toHaveBeenCalledOnce(); expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }), display);
    expect(onTextResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(onTextResult).toHaveBeenCalledWith({ binding: display.canvasTextGeneration, runId: 'task-1', assistantMessageId: 'task-1', status: 'succeeded', content: 'Delivered text' });
    expect(onArtifactResult).toHaveBeenLastCalledWith({ binding: display.canvasArtifactGeneration, assistantMessageId: 'task-1', status: 'succeeded', outputPath: 'outputs/index.html' });
    await vi.advanceTimersByTimeAsync(5000); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('keeps polling an accepted task after transient network errors without POST resubmission', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt()))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(taskResponse(receipt('succeeded')));
    const { client, onError, onTask } = harness(fetch);
    await client.submit('Generate', display); await vi.advanceTimersByTimeAsync(200);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }), 'task-1');
    expect(fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'succeeded' }), display);
  });
  it.each([
    ['failed', undefined, 'failed'], ['cancelled', undefined, 'canceled'], ['interrupted', undefined, 'failed'], ['succeeded', 'delivery_failed', 'failed'],
  ] as const)('maps terminal %s/%s to existing canvas result status %s without a chat runtime', async (status, deliveryState, expected) => {
    const { client, onTextResult, onArtifactResult } = harness(async () => taskResponse(receipt(status, { deliveryState, error: 'failure detail' })));
    await client.submit('Generate', display);
    expect(onTextResult).toHaveBeenCalledWith(expect.objectContaining({ status: expected, binding: display.canvasTextGeneration, error: 'failure detail' }));
    expect(onArtifactResult).toHaveBeenCalledWith(expect.objectContaining({ status: expected, binding: display.canvasArtifactGeneration }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves candidate delivery receipt and does not claim it was applied', async () => {
    const candidate = receipt('succeeded', { deliveryState: 'candidate_saved', result: { content: 'Candidate text', candidatePath: 'outputs/candidate.md' } });
    const { client, onTask, onArtifactResult } = harness(async () => taskResponse(candidate));
    await client.submit('Generate', display);
    expect(onTask).toHaveBeenCalledWith(candidate, display);
    expect(onArtifactResult).toHaveBeenCalledWith({ binding: display.canvasArtifactGeneration, status: 'succeeded', assistantMessageId: 'task-1' });
    expect(onArtifactResult.mock.calls[0]?.[0]).not.toHaveProperty('outputPath');
  });
  it('recovers an existing task by GET without submitting or uploading anything', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt('running'))).mockResolvedValueOnce(taskResponse(receipt('succeeded')));
    const { client, onTextResult } = harness(fetch);
    await client.recover('task-1', display); await vi.advanceTimersByTimeAsync(100);
    expect(fetch.mock.calls.every(call => call[0].endsWith('/agent/tasks/task-1') && !call[1]?.method)).toBe(true);
    expect(onTextResult).toHaveBeenCalledOnce();
  });
  it('rejects foreign-project receipts before publishing a result', async () => {
    const { client, onTask, onArtifactResult } = harness(async () => taskResponse(receipt('succeeded', { projectId: 'foreign' })));
    await expect(client.submit('Generate', display)).rejects.toThrow(/different project/);
    expect(onTask).not.toHaveBeenCalled(); expect(onArtifactResult).not.toHaveBeenCalled();
  });
  it('rejects a submission receipt for a different idempotent request', async () => {
    const { client, onTask } = harness(async () => taskResponse(receipt('succeeded', { requestId: 'other-request' })));
    await expect(client.submit('Generate', display)).rejects.toThrow(/request|identity/i);
    expect(onTask).not.toHaveBeenCalled();
  });
  it('rejects recovery when the server returns a different task identity', async () => {
    const { client, onTask } = harness(async () => taskResponse(receipt('succeeded', { id: 'other-task' })));
    await expect(client.recover('task-1', display)).rejects.toThrow(/task|identity/i);
    expect(onTask).not.toHaveBeenCalled();
  });
  it('ignores mismatched polling identities without applying another task to the node', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt()))
      .mockResolvedValueOnce(taskResponse(receipt('succeeded', { id: 'other-task', result: { content: 'Wrong task' } })))
      .mockResolvedValueOnce(taskResponse(receipt('succeeded', { result: { content: 'Correct task' } })));
    const { client, onTextResult, onError } = harness(fetch);
    await client.submit('Generate', display); await vi.advanceTimersByTimeAsync(100);
    expect(onTextResult).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(onTextResult).toHaveBeenLastCalledWith(expect.objectContaining({ assistantMessageId: 'task-1', content: 'Correct task' }));
  });
  it('pins task polling to the original explicit context when another workspace becomes active', async () => {
    const fetchA = vi.fn(async (_url: string, _init?: RequestInit) => taskResponse(receipt('running')));
    const fetchB = vi.fn(async () => taskResponse(receipt('running', { projectId: 'project-b' })));
    const { client } = harness(fetchA);
    await client.submit('Generate', display);
    setCanvasHostContext({ projectId: 'project-b', transport: { baseUrl: 'https://other.example', fetch: fetchB } });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchB).not.toHaveBeenCalled();
    expect(fetchA.mock.calls.every(call => call[0].includes('/projects/project-a/'))).toBe(true);
  });
  it('isolates two task clients even when task ids match and one client is disposed', async () => {
    const fetchA = vi.fn(async () => taskResponse(receipt('running')));
    const fetchB = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt('running', { projectId: 'project-b' })))
      .mockResolvedValueOnce(taskResponse(receipt('succeeded', { projectId: 'project-b', result: { content: 'Only B' } })));
    const a = harness(fetchA);
    const b = harness(fetchB, { projectId: 'project-b', transport: { baseUrl: 'https://b.example', fetch: fetchB } });
    await a.client.submit('Generate A', display); await b.client.submit('Generate B', display);
    a.client.dispose(); await vi.advanceTimersByTimeAsync(100);
    expect(fetchA).toHaveBeenCalledOnce(); expect(a.onTextResult).not.toHaveBeenCalled();
    expect(b.onTextResult).toHaveBeenCalledWith(expect.objectContaining({ content: 'Only B' }));
    expect(fetchB.mock.calls.every(call => call[0].startsWith('https://b.example/api/projects/project-b/'))).toBe(true);
  });
  it('does not start recover/cancel requests after client disposal', async () => {
    const fetch = vi.fn(async () => taskResponse(receipt()));
    const { client } = harness(fetch); client.dispose();
    await expect(client.recover('task-1', display)).rejects.toThrow(/disposed/);
    await expect(client.cancel('task-1')).rejects.toThrow(/disposed/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('disposes observers without cancelling server work or publishing a late response', async () => {
    const poll = deferred<Response>();
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt())).mockReturnValueOnce(poll.promise);
    const { client, onTask, onTextResult } = harness(fetch);
    await client.submit('Generate', display); await vi.advanceTimersByTimeAsync(100);
    client.dispose();
    expect((fetch.mock.calls[1]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    poll.resolve(taskResponse(receipt('succeeded'))); await vi.advanceTimersByTimeAsync(1000);
    expect(onTask).toHaveBeenCalledOnce(); expect(onTextResult).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores a stale in-flight poll after recovery replaces its monitor, even when fetch ignores abort', async () => {
    const stalePoll = deferred<Response>();
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt()))
      .mockReturnValueOnce(stalePoll.promise)
      .mockResolvedValueOnce(taskResponse(receipt('succeeded', { result: { content: 'Recovered' } })));
    const { client, onTask, onTextResult } = harness(fetch);
    await client.submit('Generate', display); await vi.advanceTimersByTimeAsync(100);
    await client.recover('task-1', display);
    expect(onTask).toHaveBeenCalledTimes(2);
    stalePoll.resolve(taskResponse(receipt('running'))); await vi.advanceTimersByTimeAsync(0);
    expect(onTask).toHaveBeenCalledTimes(2);
    expect(onTextResult).toHaveBeenCalledOnce();
    expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'succeeded' }), display);
  });
  it('retains display bindings and monitoring if cancellation is accepted but execution is still running', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt()))
      .mockResolvedValueOnce(taskResponse(receipt('running')))
      .mockResolvedValueOnce(taskResponse(receipt('cancelled')));
    const { client, onTask, onTextResult } = harness(fetch);
    await client.submit('Generate', display); await client.cancel('task-1');
    expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' }), display);
    await vi.advanceTimersByTimeAsync(100);
    expect(onTextResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled', binding: display.canvasTextGeneration }));
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });
  it('publishes terminal cancellation to the originating node and stops monitoring', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(taskResponse(receipt())).mockResolvedValueOnce(taskResponse(receipt('cancelled')));
    const { client, onTextResult } = harness(fetch);
    await client.submit('Generate', display); await client.cancel('task-1');
    expect(onTextResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled', binding: display.canvasTextGeneration }));
    await vi.advanceTimersByTimeAsync(1000); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
