// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCompatProvider, useCanvasState } from '../src/platform/canvas-compat';

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const json = (body: unknown) => new Response(JSON.stringify(body));
function Probe() { const [nodes] = useCanvasState<string[]>('nodes', ['default']); return React.createElement('span', null, nodes.join(',')); }

it('keeps consumers unmounted on load failure and retries the saved state without writing defaults', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let fail = true;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET');
    if (fail) throw new Error('offline');
    return json({ ok: true, state: { nodes: ['saved'] }, revision: 1 });
  });
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, {requestContext: {projectId: 'initial', transport: {fetch}}}, React.createElement(Probe))));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain('default');
  fail = false;
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('saved');
});

it('times out a stalled initial read and offers recovery without mounting empty state', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {once: true});
  }));
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(React.createElement(CanvasCompatProvider, {requestContext: {projectId: 'timeout', transport: {fetch}}}, React.createElement(Probe))));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain('default');
});
