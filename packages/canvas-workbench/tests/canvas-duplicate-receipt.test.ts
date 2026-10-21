// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCompatProvider, useCanvasState } from '../src/platform/canvas-compat';
import { canvasTextPatchWithCopyOnWrite } from '../src/workbench/model/canvas-text-files';
import type { CanvasBasicNode } from '../src/workbench/BasicCanvasNode';

const json = (body: unknown) => Response.json(body);
const source = { id: 'original', kind: 'text', text: 'shared initial body', title: 'Text', x: 1, y: 2, projectFilePath: 'sources/text/original.md' };
const optimistic = { ...source, id: 'copy', x: 37, y: 38 };
const copied = { ...optimistic, projectFilePath: 'sources/text/copy-op.md' };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; vi.useRealTimers(); localStorage.clear(); vi.unstubAllGlobals();
});

it('does not persist the source alias when a delayed optimistic copy snapshot follows its operation receipt', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  let resolveDuplicate!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { resolveDuplicate = resolve; });
  const saves: { route: string; body: Record<string, any> }[] = [];
  let current = [source], revision = 1;
  const context = { projectId: 'copy-path-receipt', transport: { fetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== 'POST' && init?.method !== 'PATCH') return json({ ok: true, state: { workbenchBasicNodes: current }, revision });
    const body = JSON.parse(String(init.body)); saves.push({ route: url, body });
    if (saves.length === 1) return pending;
    current = init.method === 'PATCH' ? body.changes.workbenchBasicNodes : [source, { ...copied, text: 'copy edited after acknowledgement', x: 99 }];
    return json({ ok: true, state: { workbenchBasicNodes: current }, revision: ++revision,
      ...(init.method === 'POST' ? { receipt: { operationId: body.operationId, status: 'applied', baseRevision: revision - 1, revision, nodeIds: ['copy'], createdAt: 'now' } } : {}) });
  }) } };
  let setNodes!: React.Dispatch<React.SetStateAction<typeof source[]>>;
  let visible: typeof source[] = [];
  function Probe() { [visible, setNodes] = useCanvasState('workbenchBasicNodes', [] as typeof source[]); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  await act(async () => setNodes([source, optimistic]));
  expect(saves[0]!.body.operations).toEqual([{ type: 'node.duplicate', nodeId: 'original', newNodeId: 'copy', x: 37, y: 38 }]);
  await act(async () => {
    current = [source, copied]; revision = 2;
    resolveDuplicate(json({ ok: true, state: { workbenchBasicNodes: current }, revision,
      receipt: { operationId: saves[0]!.body.operationId, status: 'applied', baseRevision: 1, revision, nodeIds: ['original', 'copy'], createdAt: 'now' } }));
  });
  expect(visible[1]!.projectFilePath).toBe(copied.projectFilePath);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    setNodes([source, optimistic]); // stale UI effect after receiving canonical copy identity
  });
  expect(visible[1]!.projectFilePath).toBe(copied.projectFilePath);
  expect(saves).toHaveLength(1);
  // A delayed snapshot may carry a real later edit: retain its body/position,
  // but never treat its old copied path as a document rebind.
  await act(async () => setNodes([source, { ...optimistic, text: 'copy edited after acknowledgement', x: 99 }]));
  expect(visible[1]).toMatchObject({ projectFilePath: copied.projectFilePath, text: 'copy edited after acknowledgement', x: 99 });
  expect(saves[1]!.body.expectedState.workbenchBasicNodes[1].projectFilePath).toBe(copied.projectFilePath);
  expect(saves[1]!.body.operations).toEqual([{ type: 'node.update', nodeId: 'copy', set: { text: 'copy edited after acknowledgement', x: 99 } }]);
  expect(visible[0]).toEqual(source);
});

it.each(['acknowledged-rebase', 'http-409'])('retains the latest queued draft and blocks blind replay after %s conflict', async mode => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  let settle!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { settle = resolve; });
  const writes: Record<string, any>[] = [];
  const projectId = `queued-conflict-${mode}`;
  const remote = { ...source, text: 'remote conflicting body' };
  const context = { projectId, transport: { fetch: vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST' && init?.method !== 'PATCH') return json({ ok: true, state: { workbenchBasicNodes: writes.length ? [remote] : [source] }, revision: writes.length ? 2 : 1 });
    writes.push(JSON.parse(String(init.body))); return response;
  }) } };
  let setNodes!: React.Dispatch<React.SetStateAction<typeof source[]>>;
  let visible: typeof source[] = [];
  function Probe() { [visible, setNodes] = useCanvasState('workbenchBasicNodes', [] as typeof source[]); return null; }
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  await act(async () => setNodes([{ ...source, text: 'first submitted draft' }]));
  await act(async () => setNodes([{ ...source, text: 'LATEST unsaved draft' }]));
  await act(async () => settle(mode === 'http-409'
    ? new Response(JSON.stringify({ ok: false, error: 'concurrent edit conflict' }), { status: 409 })
    : json({ ok: true, state: { workbenchBasicNodes: [remote] }, revision: 2,
      receipt: { operationId: writes[0]!.operationId, status: 'applied', baseRevision: 1, revision: 2, nodeIds: ['original'], createdAt: 'now' } })));
  expect(visible[0]!.text).toBe('LATEST unsaved draft');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  const checkpoint = JSON.parse(localStorage.getItem(`canvas-unsaved:${projectId}`)!);
  expect(checkpoint.state.workbenchBasicNodes[0].text).toBe('LATEST unsaved draft');
  expect(checkpoint.request).toBeUndefined(); // Never replay an acknowledged/stale request on reload.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(writes).toHaveLength(1);
  await act(async () => setNodes([{ ...source, text: 'LATEST additional recovery edit' }]));
  expect(JSON.parse(localStorage.getItem(`canvas-unsaved:${projectId}`)!).state.workbenchBasicNodes[0].text).toBe('LATEST additional recovery edit');
  expect(writes).toHaveLength(1);
});

it.each(['immutable', 'mutable', 'copy-on-write'])('publishes canonical copy identity when SSE and a queued draft precede the receipt (%s)', async mode => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  let resolveDuplicate!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { resolveDuplicate = resolve; });
  const sent = [source, { ...optimistic }];
  const saves: { method: string; body: Record<string, any> }[] = [];
  let persisted = [source], revision = 1;
  const context = { projectId: 'sse-before-copy-receipt', transport: { fetch: vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST' && init?.method !== 'PATCH') return json({ ok: true, state: { workbenchBasicNodes: persisted }, revision });
    const body = JSON.parse(String(init.body)); saves.push({ method: init.method, body });
    if (saves.length === 1) return pending;
    persisted = [source, { ...copied, text: 'COPY ONLY' }];
    return json({ ok: true, state: { workbenchBasicNodes: persisted }, revision: ++revision,
      ...(init.method === 'POST' ? { receipt: { operationId: body.operationId, status: 'applied', baseRevision: revision - 1, revision, nodeIds: ['copy'], createdAt: 'now' } } : {}) });
  }) } };
  let setNodes!: React.Dispatch<React.SetStateAction<typeof source[]>>;
  let visible: typeof source[] = [];
  function Probe() { [visible, setNodes] = useCanvasState('workbenchBasicNodes', [] as typeof source[]); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  await act(async () => setNodes(sent));
  expect(saves[0]!.body.operations[0].type).toBe('node.duplicate');
  await act(async () => {
    persisted = [source, copied]; revision = 2;
    window.dispatchEvent(new CustomEvent('bezier:canvas-text-delivery-changed', { detail: { projectId: context.projectId } }));
  });
  // An external view reconciles its existing node object before the receipt;
  // batch.value is a reference, while requestBody is the durable sent intent.
  await act(async () => {
    if (mode === 'mutable') sent[1]!.projectFilePath = copied.projectFilePath;
    if (mode !== 'copy-on-write') setNodes([source, copied]);
    const patch = mode === 'copy-on-write'
      ? canvasTextPatchWithCopyOnWrite(sent as CanvasBasicNode[], 'copy', { text: 'COPY ONLY' })
      : { text: 'COPY ONLY' };
    if (mode === 'copy-on-write') expect(patch.projectFilePath).toBe('sources/text/copy.md');
    setNodes([source, { ...optimistic, text: 'COPY ONLY', projectFilePath: patch.projectFilePath ?? optimistic.projectFilePath }]);
  });
  await act(async () => resolveDuplicate(json({ ok: true, state: { workbenchBasicNodes: [source, copied] }, revision: 2,
    receipt: { operationId: saves[0]!.body.operationId, status: 'applied', baseRevision: 1, revision: 2, nodeIds: ['original', 'copy'], createdAt: 'now' } })));
  expect(saves).toHaveLength(2);
  expect(saves[1]!.method).toBe('POST');
  expect(saves[1]!.body.operations).toEqual([{ type: 'node.update', nodeId: 'copy', set: { text: 'COPY ONLY' } }]);
  expect(saves[1]!.body.expectedState.workbenchBasicNodes[1].projectFilePath).toBe(copied.projectFilePath);
  expect(visible[1]).toMatchObject({ text: 'COPY ONLY', projectFilePath: copied.projectFilePath });
  expect(visible[0]).toEqual(source);
});
