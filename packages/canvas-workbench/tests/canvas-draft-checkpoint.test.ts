// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCompatProvider, useCanvasState } from '../src/platform/canvas-compat';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const node = (text: string) => ({ id: 'text-1', kind: 'sketch', x: 1, y: 2, text });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('checkpoints unacknowledged edits before a pending request finishes and keeps the latest draft through an older acknowledgement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  let revision = 1;
  let persisted = node('original');
  const saves: { body: { changes: { workbenchBasicNodes: ReturnType<typeof node>[] } }; response: ReturnType<typeof deferred<Response>> }[] = [];
  const context = { projectId: 'draft-project', transport: { fetch: vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'PATCH') return json({ ok: true, state: { workbenchBasicNodes: [persisted] }, revision });
    const response = deferred<Response>();
    saves.push({ body: JSON.parse(String(init.body)), response });
    return response.promise;
  }) } };
  let setNodes!: React.Dispatch<React.SetStateAction<ReturnType<typeof node>[]>>;
  function Probe() { [, setNodes] = useCanvasState('workbenchBasicNodes', [node('default')]); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  await act(async () => setNodes([node('first')]));
  expect(saves).toHaveLength(1);
  expect(localStorage.getItem('canvas-unsaved:draft-project')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(JSON.parse(localStorage.getItem('canvas-unsaved:draft-project')!).state.workbenchBasicNodes).toEqual([node('first')]);
  await act(async () => setNodes([node('second')]));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const first = saves[0]!;
  await act(async () => {
    persisted = node('first');
    first.response.resolve(json({ ok: true, revision: ++revision, state: { workbenchBasicNodes: [persisted] } }));
  });
  expect(JSON.parse(localStorage.getItem('canvas-unsaved:draft-project')!).state.workbenchBasicNodes).toEqual([node('second')]);
  expect(saves).toHaveLength(2);
  const second = saves[1]!;
  expect(first.body.changes.workbenchBasicNodes).toEqual([node('first')]);
  expect(second.body.changes.workbenchBasicNodes).toEqual([node('second')]);
  await act(async () => {
    persisted = node('second');
    second.response.resolve(json({ ok: true, revision: ++revision, state: { workbenchBasicNodes: [persisted] } }));
  });
  expect(localStorage.getItem('canvas-unsaved:draft-project')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(localStorage.getItem('canvas-unsaved:draft-project')).toBeNull();
});

it('keeps the draft scoped to its owner and rate-limits repeated edits without waiting for a failed request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const pending = deferred<Response>();
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? pending.promise : json({ ok: true, state: { background: 'white' }, revision: 1 }));
  const context = { projectId: 'one', transport: { fetch } };
  localStorage.setItem('canvas-unsaved:two', JSON.stringify({ state: { background: 'another project' } }));
  let setBackground!: React.Dispatch<React.SetStateAction<string>>;
  function Probe() { [, setBackground] = useCanvasState('background', 'white'); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  await act(async () => { setBackground('red'); setBackground('blue'); setBackground('green'); });
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
  expect(setItem).not.toHaveBeenCalledWith('canvas-unsaved:one', expect.anything());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(setItem.mock.calls.filter(([key]) => key === 'canvas-unsaved:one')).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('canvas-unsaved:one')!).state.background).toBe('green');
  expect(JSON.parse(localStorage.getItem('canvas-unsaved:two')!).state.background).toBe('another project');
  setItem.mockRestore();
  pending.resolve(json({ ok: true, state: { background: 'green' }, revision: 2 }));
});

it('keeps the same public operation id on retry while checkpointing its unacknowledged state', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const attempts: { url: string; body: { operationId: string }; response: ReturnType<typeof deferred<Response>> }[] = [];
  const context = { projectId: 'operation-project', transport: { fetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return json({ ok: true, state: { workbenchBasicNodes: [{ ...node('original'), kind: 'text' }] }, revision: 1 });
    const response = deferred<Response>();
    attempts.push({ url, body: JSON.parse(String(init.body)), response });
    return response.promise;
  }) } };
  let setNodes!: React.Dispatch<React.SetStateAction<ReturnType<typeof node>[]>>;
  function Probe() { [, setNodes] = useCanvasState('workbenchBasicNodes', [{ ...node('default'), kind: 'text' }]); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  await act(async () => setNodes([{ ...node('edited'), kind: 'text' }]));
  expect(attempts).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(JSON.parse(localStorage.getItem('canvas-unsaved:operation-project')!).state.workbenchBasicNodes[0].text).toBe('edited');
  await act(async () => attempts[0]!.response.resolve(new Response(JSON.stringify({ ok: false, error: 'try again' }), { status: 503 })));
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(attempts).toHaveLength(2);
  expect(attempts[1]!.body.operationId).toBe(attempts[0]!.body.operationId);
  expect(attempts[1]!.url).toMatch(/\/api\/projects\/operation-project\/canvas\/operations$/);
  await act(async () => attempts[1]!.response.resolve(json({ ok: true, state: { workbenchBasicNodes: [{ ...node('edited'), kind: 'text' }] }, revision: 2,
    receipt: { operationId: attempts[0]!.body.operationId, baseRevision: 1, revision: 2, status: 'applied', nodeIds: ['text-1'], createdAt: 'now' } })));
  expect(localStorage.getItem('canvas-unsaved:operation-project')).toBeNull();
});


it('recovers only changed PATCH fields without replacing current server cards with checkpoint cards', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const viewport = { x: 23, y: 45, zoom: 0.8 };
  const snapshot = { workbenchBasicNodes: [node('stale checkpoint')], workbenchViewport: viewport };
  localStorage.setItem('canvas-unsaved:recovered-project', JSON.stringify({ state: snapshot,
    request: { expectedRevision: 1, changes: { workbenchViewport: viewport }, base: { workbenchViewport: {} } } }));
  const context = { projectId: 'recovered-project', transport: { fetch: vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })
      : json({ ok: true, state: { workbenchBasicNodes: [node('current cloud')], workbenchViewport: {} }, revision: 2 })) } };
  let observed: unknown;
  function Probe() { const [nodes] = useCanvasState('workbenchBasicNodes', []); const [view] = useCanvasState('workbenchViewport', {}); observed = { nodes, view }; return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, { requestContext: context }, React.createElement(Probe))));
  expect(observed).toEqual({ nodes: [node('current cloud')], view: viewport });
  expect(localStorage.getItem('canvas-unsaved:recovered-project')).not.toBeNull();
});
