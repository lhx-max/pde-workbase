// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCompatProvider, useCanvasState } from '../src/platform/canvas-compat';
import { setCanvasHostContext } from '../src/platform/api-base';
import { setAgentTaskSubmitter, submitAgentTask } from '../src/platform/agent-bridge';

type Node = { id: string; text: string; generation?: { requestId: string; status: string } };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  setAgentTaskSubmitter(null);
  setCanvasHostContext(null);
  vi.unstubAllGlobals();
});

it.each(['text', 'artifact'] as const)('does not submit %s generation while an older save and its newer binding save are pending', async kind => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const saves: { body: { changes: { workbenchBasicNodes: Node[] } }; response: ReturnType<typeof deferred<Response>> }[] = [];
  let persisted: Node[] = [{ id: 'node', text: 'original' }];
  let revision = 1;
  const context = { projectId: 'project', transport: { fetch: vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'PATCH') return json({ ok: true, state: { workbenchBasicNodes: persisted }, revision });
    const response = deferred<Response>();
    saves.push({ body: JSON.parse(String(init.body)), response });
    return response.promise;
  }) } };
  setCanvasHostContext(context);
  let setNodes!: React.Dispatch<React.SetStateAction<Node[]>>;
  function Probe() { [, setNodes] = useCanvasState<Node[]>('workbenchBasicNodes', []); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  await act(async () => setNodes(nodes => nodes.map(node => ({ ...node, text: 'edited before generation' }))));
  expect(saves).toHaveLength(1);
  const backend = vi.fn(async () => {
    expect(persisted[0]?.generation).toEqual({ requestId: 'request', status: 'running' });
  });
  setAgentTaskSubmitter(backend);
  let submitted!: Promise<void>;
  await act(async () => {
    setNodes(nodes => nodes.map(node => ({ ...node, generation: { requestId: 'request', status: 'running' } })));
    submitted = submitAgentTask('generate', { kind: 'instruction-card', title: 'Generate', ...(kind === 'text'
      ? { canvasTextGeneration: { nodeId: 'node', requestId: 'request' } }
      : { canvasArtifactGeneration: { nodeId: 'node', requestId: 'request', format: 'html' as const } }) });
    void submitted.catch(() => {});
  });
  expect(backend).not.toHaveBeenCalled();
  async function accept(index: number) {
    await act(async () => {
      persisted = saves[index]!.body.changes.workbenchBasicNodes;
      saves[index]!.response.resolve(json({ ok: true, state: { workbenchBasicNodes: persisted }, revision: ++revision }));
    });
  }
  await accept(0);
  expect(saves).toHaveLength(2);
  expect(backend).not.toHaveBeenCalled();
  await accept(1);
  await submitted;
  expect(backend).toHaveBeenCalledOnce();
});
