// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasUiHost } from '@bezier/canvas-workbench';

// 只 mock 重量级的真实画布 surface——断言对象是包装层自身的
// 预检/隔离/不可用/凭据流，不是画布内部行为。
const state = vi.hoisted(() => ({
  renders: [] as Array<Record<string, unknown>>,
  mounts: 0,
  unmounts: 0,
}));
vi.mock('../../../packages/canvas-workbench/src/CanvasWorkbenchSurface', async () => {
  const React = await import('react');
  const Mock = (props: Record<string, unknown>) => {
    state.renders.push(props);
    React.useEffect(() => {
      state.mounts += 1;
      return () => {
        state.unmounts += 1;
      };
    }, []);
    return React.createElement('div', { 'data-testid': 'canvas-surface', 'data-project': String(props.projectId) });
  };
  return { CanvasWorkbenchSurface: Mock, default: Mock };
});

import { createCanvasApp } from '../../../packages/canvas-workbench/src/platform/ma-app';
import {
  CanvasAppError,
  canvasAppScopeKey,
  preflightFailureCode,
  sanitizePreflightError,
  validateCanvasAppContext,
} from '../../../packages/canvas-workbench/src/platform/ma-context';

const uiHost = {
  renderPopover: () => null,
  renderHoverCard: () => null,
  renderDialog: () => null,
  renderMenu: () => null,
  renderTabs: () => null,
} as unknown as CanvasUiHost;

const makeContext = (over: Record<string, unknown> = {}) => ({
  applicationId: 'app_canvas',
  applicationVersion: '0.1.0',
  applicationInstanceId: 'ai_1',
  providerInstanceId: 'ma-aaa111',
  bizId: 'biz_1',
  sessionId: 's_1',
  actor: { tenantId: 't_1', userId: 'u_1' },
  locale: 'zh-CN',
  ...over,
});

const actionPath = (pid: string) =>
  `http://127.0.0.1:17463/open-platform/v1/instances/${pid}/actions/canvas.read`;

const okRead = (pid: string, canvasInstanceId = `ma-canvas-${pid}`) =>
  new Response(
    JSON.stringify({
      protocolVersion: '1.0',
      actionId: 'canvas.read',
      providerInstanceId: pid,
      revision: 12,
      summary: '画布已读取',
      data: { canvasInstanceId },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const readEnvelope = (init: RequestInit | undefined) =>
  JSON.parse(String(init?.body)) as Record<string, unknown>;

const reset = () => {
  state.renders.length = 0;
  state.mounts = 0;
  state.unmounts = 0;
};

afterEach(() => {
  cleanup();
  reset();
});

const makeApp = (over: Record<string, unknown> = {}) => {
  const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const match = String(url).match(/\/instances\/([^/]+)\/actions\//);
    return okRead(match ? decodeURIComponent(match[1]!) : 'unknown');
  });
  const getCredential = vi.fn(async () => 'Bearer tok_valid');
  const resourceUrl = vi.fn((url: string) => `https://res.example.test/proxy?u=${encodeURIComponent(url)}`);
  const App = createCanvasApp({
    baseUrl: 'http://127.0.0.1:17463',
    getCredential,
    uiHost,
    fetcher,
    resourceUrl,
    ...over,
  });
  return { App, fetcher, getCredential, resourceUrl };
};

const lastRender = () => state.renders[state.renders.length - 1];

it('opens an existing instance via a single authenticated canvas.read — no create/register/MA calls', async () => {
  const { App, fetcher, getCredential } = makeApp();
  render(<App context={makeContext()} />);
  const surface = await screen.findByTestId('canvas-surface');
  expect(surface.getAttribute('data-project')).toBe('ma-canvas-ma-aaa111');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(actionPath('ma-aaa111'));
  expect(init.method).toBe('POST');
  const headers = new Headers(init.headers);
  expect(headers.get('x-mav-tenant')).toBe('t_1');
  expect(headers.get('x-mav-application-instance-id')).toBe('ai_1');
  expect(headers.get('x-mav-sso-authorization')).toBe('Bearer tok_valid');
  const envelope = readEnvelope(init);
  expect(envelope).toMatchObject({
    protocolVersion: '1.0',
    applicationId: 'app_canvas',
    applicationVersion: '0.1.0',
    applicationInstanceId: 'ai_1',
    providerInstanceId: 'ma-aaa111',
    actionId: 'canvas.read',
    bizId: 'biz_1',
    sessionId: 's_1',
    actor: { tenantId: 't_1', userId: 'u_1' },
  });
  expect(typeof envelope.requestId).toBe('string');
  expect(envelope.idempotencyKey).toBe(envelope.requestId);
  expect(getCredential).toHaveBeenCalledWith(expect.objectContaining({ providerInstanceId: 'ma-aaa111' }));
  for (const call of fetcher.mock.calls) {
    const body = readEnvelope(call[1] as RequestInit);
    expect(body.actionId).toBe('canvas.read');
    expect(String(call[0])).not.toContain('/api/projects');
  }
  const props = lastRender();
  expect(props.projectId).toBe('ma-canvas-ma-aaa111');
  expect(props.transport).toBeTruthy();
  expect(props.locale).toBe('zh-CN');
  expect(props.uiHost).toBe(uiHost);
});

it('identical-semantic context rerenders keep the same transport and canvas state', async () => {
  const { App, fetcher } = makeApp();
  const { rerender } = render(<App context={makeContext()} />);
  await screen.findByTestId('canvas-surface');
  const transport = lastRender().transport;
  const rendersBefore = state.renders.length;
  rerender(<App context={makeContext()} />);
  rerender(<App context={makeContext({ sessionId: 's_9' })} />);
  await act(async () => { await Promise.resolve(); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(state.mounts).toBe(1);
  expect(state.renders.length).toBeGreaterThan(rendersBefore);
  expect(lastRender().transport).toBe(transport);
});

it('a genuine scope change remounts the surface against the new instance', async () => {
  const { App, fetcher } = makeApp();
  const { rerender } = render(<App context={makeContext()} />);
  await screen.findByTestId('canvas-surface');
  rerender(<App context={makeContext({ providerInstanceId: 'ma-bbb222', bizId: 'biz_2' })} />);
  const surface = await screen.findByTestId('canvas-surface');
  expect(surface.getAttribute('data-project')).toBe('ma-canvas-ma-bbb222');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[1]![0])).toBe(actionPath('ma-bbb222'));
  expect(state.mounts).toBe(2);
  expect(state.unmounts).toBe(1);
});

it('cancels a stale in-flight preflight when the scope switches A→B', async () => {
  let resolveA: ((res: Response) => void) | null = null;
  const fetcher = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
    const href = String(url);
    if (href.includes('ma-stale-a')) {
      return new Promise<Response>((resolve) => { resolveA = resolve; });
    }
    return Promise.resolve(okRead('ma-stale-b'));
  });
  const App = createCanvasApp({
    baseUrl: 'http://127.0.0.1:17463',
    getCredential: async () => 'Bearer tok_valid',
    uiHost,
    fetcher,
    resourceUrl: (url) => url,
  });
  const { rerender } = render(<App context={makeContext({ providerInstanceId: 'ma-stale-a' })} />);
  await act(async () => { await Promise.resolve(); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const signalA = (fetcher.mock.calls[0]![1] as RequestInit).signal as AbortSignal;
  rerender(<App context={makeContext({ providerInstanceId: 'ma-stale-b' })} />);
  const surface = await screen.findByTestId('canvas-surface');
  expect(surface.getAttribute('data-project')).toBe('ma-canvas-ma-stale-b');
  expect(signalA.aborted).toBe(true);
  await act(async () => {
    resolveA!(okRead('ma-stale-a'));
    await Promise.resolve();
  });
  expect(screen.getByTestId('canvas-surface').getAttribute('data-project')).toBe('ma-canvas-ma-stale-b');
  expect(state.renders.every((props) => props.projectId === 'ma-canvas-ma-stale-b')).toBe(true);
});

it('404 on preflight renders an unavailable alert and never creates the instance', async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: { code: 'PROVIDER_INSTANCE_NOT_FOUND' } }), { status: 404 }));
  const { App } = makeApp({ fetcher });
  render(<App context={makeContext()} />);
  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('data-canvas-app-unavailable')).toBe('INSTANCE_NOT_FOUND');
  expect(screen.queryByTestId('canvas-surface')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const init = fetcher.mock.calls[0]![1] as RequestInit;
  expect(readEnvelope(init).actionId).toBe('canvas.read');
});

it.each([
  ['mismatched providerInstanceId echo', { providerInstanceId: 'ma-other' }],
  ['non-positive revision', { revision: 0 }],
  ['non-safe canvasInstanceId', { data: { canvasInstanceId: '../x' } }],
  ['missing canvasInstanceId', { data: {} }],
  ['wrong protocolVersion', { protocolVersion: '9.9' }],
])('untrusted canvas.read mapping (%s) renders SERVICE_UNAVAILABLE and never mounts', async (_name, patch) => {
  const good = JSON.parse(await okRead('ma-aaa111').text()) as Record<string, unknown>;
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ ...good, ...(patch as Record<string, unknown>) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  const { App } = makeApp({ fetcher });
  render(<App context={makeContext()} />);
  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('data-canvas-app-unavailable')).toBe('SERVICE_UNAVAILABLE');
  expect(screen.queryByTestId('canvas-surface')).toBeNull();
});

it('401/403 on preflight renders ACCESS_DENIED without leaking causes', async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: { code: 'PROVIDER_FORBIDDEN', message: 'secret-cause' } }), { status: 403 }));
  const { App } = makeApp({ fetcher });
  const { container } = render(<App context={makeContext()} />);
  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('data-canvas-app-unavailable')).toBe('ACCESS_DENIED');
  expect(container.textContent).not.toContain('secret-cause');
});

it('missing context renders CONTEXT_INVALID and issues no request', () => {
  const { App, fetcher } = makeApp();
  render(<App />);
  expect(screen.getByRole('alert').getAttribute('data-canvas-app-unavailable')).toBe('CONTEXT_INVALID');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ['traversal pid', makeContext({ providerInstanceId: '../escape' })],
  ['encoded traversal pid', makeContext({ providerInstanceId: '%2e%2e' })],
  ['slash pid', makeContext({ providerInstanceId: 'a/b' })],
  ['missing actor', { ...makeContext(), actor: undefined }],
  ['blank tenant', makeContext({ actor: { tenantId: '  ', userId: 'u_1' } })],
  ['missing applicationInstanceId', { ...makeContext(), applicationInstanceId: undefined }],
])('malformed context (%s) renders CONTEXT_INVALID with no request', (_name, context) => {
  const { App, fetcher } = makeApp();
  render(<App context={context} />);
  expect(screen.getByRole('alert').getAttribute('data-canvas-app-unavailable')).toBe('CONTEXT_INVALID');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ['credential in URL', 'https://user:secret@canvas.example.test'],
  ['http non-loopback', 'http://canvas.example.test'],
  ['relative path', '/api'],
])('unsafe baseUrl (%s) renders CONFIGURATION_INVALID with no request', async (_name, baseUrl) => {
  const { App, fetcher } = makeApp({ baseUrl });
  render(<App context={makeContext()} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').getAttribute('data-canvas-app-unavailable')).toBe('CONFIGURATION_INVALID');
  expect(fetcher).not.toHaveBeenCalled();
});

it('missing resourceUrl bridge renders RESOURCE_URL_UNAVAILABLE instead of smuggling credentials', () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => okRead('ma-aaa111'));
  const App = createCanvasApp({
    baseUrl: 'http://127.0.0.1:17463',
    getCredential: async () => 'Bearer tok_valid',
    uiHost,
    fetcher,
  });
  const { container } = render(<App context={makeContext()} />);
  expect(screen.getByRole('alert').getAttribute('data-canvas-app-unavailable')).toBe('RESOURCE_URL_UNAVAILABLE');
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('tok_valid');
});

it('credential getter failures surface CREDENTIAL_UNAVAILABLE without raw cause leakage', async () => {
  const getCredential = vi.fn(async () => {
    throw new Error('raw SECRET-XYZ cause');
  });
  const { App } = makeApp({ getCredential });
  const { container } = render(<App context={makeContext()} />);
  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('data-canvas-app-unavailable')).toBe('CREDENTIAL_UNAVAILABLE');
  expect(container.textContent).not.toContain('SECRET-XYZ');
  expect(container.textContent).not.toContain('raw');
});

it('non-Bearer credential values surface CREDENTIAL_UNAVAILABLE', async () => {
  const { App } = makeApp({ getCredential: vi.fn(async () => 'tok_not_bearer') });
  render(<App context={makeContext()} />);
  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('data-canvas-app-unavailable')).toBe('CREDENTIAL_UNAVAILABLE');
});

it('network failures during preflight surface a sanitized SERVICE_UNAVAILABLE', async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    throw new Error('socket SECRET detail');
  });
  const { App } = makeApp({ fetcher });
  const { container } = render(<App context={makeContext()} />);
  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('data-canvas-app-unavailable')).toBe('SERVICE_UNAVAILABLE');
  expect(container.textContent).not.toContain('SECRET');
});

it('the resourceUrl bridge receives the url and the live context', async () => {
  const { App, resourceUrl } = makeApp();
  render(<App context={makeContext()} />);
  await screen.findByTestId('canvas-surface');
  const transport = lastRender().transport as { resourceUrl: (url: string) => string };
  const bridged = transport.resourceUrl('http://127.0.0.1:17463/api/projects/ma-aaa111/files/pic.png');
  expect(resourceUrl).toHaveBeenCalledWith(
    'http://127.0.0.1:17463/api/projects/ma-aaa111/files/pic.png',
    expect.objectContaining({ providerInstanceId: 'ma-aaa111' }),
  );
  expect(bridged).not.toContain('tok_valid');
});

it('validateCanvasAppContext accepts the published 1.0 shape and normalizes it', () => {
  const result = validateCanvasAppContext(makeContext());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.context.providerInstanceId).toBe('ma-aaa111');
  expect(result.context.actor).toEqual({ tenantId: 't_1', userId: 'u_1' });
});

it.each([
  ['not an object', 42],
  ['empty object', {}],
  ['oversized field', makeContext({ applicationId: 'x'.repeat(2000) })],
  ['control char', makeContext({ bizId: 'biz\u0007' })],
  ['surrounding whitespace actor', makeContext({ actor: { tenantId: ' t_1', userId: 'u_1' } })],
  ['unsupported protocolVersion', { ...makeContext(), protocolVersion: '2.0' }],
])('validateCanvasAppContext rejects malformed input (%s)', (_name, input) => {
  expect(validateCanvasAppContext(input).ok).toBe(false);
});

it('canvasAppScopeKey is stable for equal contexts and changes with real scope fields', () => {
  const base = validateCanvasAppContext(makeContext());
  if (!base.ok) throw new Error('fixture invalid');
  const same = validateCanvasAppContext({ ...makeContext(), sessionId: 's_other', locale: 'en' });
  if (!same.ok) throw new Error('fixture invalid');
  expect(canvasAppScopeKey(same.context, 'http://127.0.0.1:17463')).toBe(
    canvasAppScopeKey(base.context, 'http://127.0.0.1:17463'),
  );
  for (const over of [
    { providerInstanceId: 'ma-bbb222' },
    { bizId: 'biz_2' },
    { applicationInstanceId: 'ai_2' },
    { actor: { tenantId: 't_2', userId: 'u_1' } },
    { actor: { tenantId: 't_1', userId: 'u_2' } },
  ]) {
    const other = validateCanvasAppContext(makeContext(over));
    if (!other.ok) throw new Error('fixture invalid');
    expect(canvasAppScopeKey(other.context, 'http://127.0.0.1:17463')).not.toBe(
      canvasAppScopeKey(base.context, 'http://127.0.0.1:17463'),
    );
  }
  expect(canvasAppScopeKey(base.context, 'https://other.example.test')).not.toBe(
    canvasAppScopeKey(base.context, 'http://127.0.0.1:17463'),
  );
});

it('status and error sanitization map to bounded codes only', () => {
  expect(preflightFailureCode(404)).toBe('INSTANCE_NOT_FOUND');
  expect(preflightFailureCode(401)).toBe('ACCESS_DENIED');
  expect(preflightFailureCode(403)).toBe('ACCESS_DENIED');
  expect(preflightFailureCode(500)).toBe('SERVICE_UNAVAILABLE');
  expect(sanitizePreflightError(new CanvasAppError('CREDENTIAL_UNAVAILABLE', 'x'))).toBe('CREDENTIAL_UNAVAILABLE');
  expect(sanitizePreflightError(new Error('raw internal detail'))).toBe('SERVICE_UNAVAILABLE');
});

it('refuses old-scope credentials and resources after switching to another instance',async()=>{
 const {App,getCredential,fetcher}=makeApp();const view=render(<App context={makeContext()}/>);await act(async()=>{});
 const old=lastRender()!.transport as {fetch:(url:string,init?:RequestInit)=>Promise<Response>;resourceUrl:(url:string)=>string};
 view.rerender(<App context={makeContext({providerInstanceId:'other-instance',applicationInstanceId:'other-ma-instance'})}/>);await act(async()=>{});
 const calls=getCredential.mock.calls.length,requests=fetcher.mock.calls.length;
 await expect(old.fetch('http://127.0.0.1:17463/api/projects/old/state')).rejects.toThrow('MA scope');
 expect(()=>old.resourceUrl('http://127.0.0.1:17463/api/projects/old/raw/file.png')).toThrow('MA resource scope');
 expect(getCredential).toHaveBeenCalledTimes(calls);expect(fetcher).toHaveBeenCalledTimes(requests);
});


it('revalidates a reused mutable context on application version change and revokes the previous transport',async()=>{
 const context=makeContext();const {App,fetcher,getCredential}=makeApp();const view=render(<App context={context}/>);
 await screen.findByTestId('canvas-surface');const old=lastRender().transport as {fetch:(url:string,init?:RequestInit)=>Promise<Response>;resourceUrl:(url:string)=>string};
 context.applicationVersion='0.2.0';view.rerender(<App context={context}/>);await screen.findByTestId('canvas-surface');
 expect(fetcher).toHaveBeenCalledTimes(2);expect(readEnvelope(fetcher.mock.calls[1]![1] as RequestInit).applicationVersion).toBe('0.2.0');expect(lastRender().transport).not.toBe(old);
 const before=getCredential.mock.calls.length;await expect(old.fetch(actionPath(context.providerInstanceId))).rejects.toBeTruthy();expect(getCredential).toHaveBeenCalledTimes(before);expect(()=>old.resourceUrl('http://127.0.0.1:17463/api/projects/ma-aaa111/files/pic.png')).toThrow();
});

it('revalidates a reused mutable context after invalidation without dispatching an old identity',async()=>{
 const context=makeContext();const {App,fetcher}=makeApp();const view=render(<App context={context}/>);await screen.findByTestId('canvas-surface');
 context.actor.userId='';view.rerender(<App context={context}/>);expect(screen.queryByTestId('canvas-surface')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(1);
});
