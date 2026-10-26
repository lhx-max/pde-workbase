import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { proxyBrowserAppRequest } from '../src/server/browser-app-proxy';

const servers: ReturnType<typeof createServer>[] = [];
async function upstream(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected isolated TCP listener');
  return `http://127.0.0.1:${address.port}`;
}
const params = (path: string[]) => Promise.resolve({ path });
const call = (url: string, init?: RequestInit, path?: string[]) =>
  proxyBrowserAppRequest(new Request(url, init), params(path ?? ['api', 'projects']));

beforeEach(() => {
  vi.stubEnv('CANVAS_WEB_URL', '');
  vi.stubEnv('BROWSER_APP_API_ORIGIN', '');
  vi.stubEnv('BROWSER_APP_AUTH_TOKEN', '');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

describe('browser app same-origin proxy', () => {
  it('fails closed outside explicit dev without a configured origin', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await call('http://localhost:8011/api/browser-app/api/projects')).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('defaults to the loopback dev service only under a dev runtime', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await call('http://localhost:8011/api/browser-app/api/projects/p/tabs', undefined, ['api', 'projects', 'p', 'tabs']);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17620/api/projects/p/tabs', expect.anything());
  });
  it.each(['file:///tmp/browser', 'http://secret@localhost:7000', 'http://localhost:7000/api', 'http://localhost:7000/?q=1'])('rejects malformed origin %s', async origin => {
    vi.stubEnv('BROWSER_APP_API_ORIGIN', origin);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await call('http://localhost:8011/api/browser-app/api/projects')).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['api', 'admin'],
    ['api', 'apps', 'browser', 'actions', 'browser.create'],
    ['canvas', 'api', 'projects'],
  ])('refuses non-browser paths %o without touching upstream', async (...path) => {
    let contacts = 0;
    vi.stubEnv('BROWSER_APP_API_ORIGIN', await upstream((_req, res) => { contacts += 1; res.end('private'); }));
    expect((await call('http://localhost:8011/api/browser-app/api/admin', undefined, path)).status).toBe(404);
    expect(contacts).toBe(0);
  });
  it.each([[['..']], [['api', '..', 'projects']], [['api', '.', 'projects']]])('refuses traversal segments %o', async path => {
    let contacts = 0;
    vi.stubEnv('BROWSER_APP_API_ORIGIN', await upstream((_req, res) => { contacts += 1; res.end('private'); }));
    expect((await call('http://localhost:8011/api/browser-app/x', undefined, path)).status).toBe(404);
    expect(contacts).toBe(0);
  });
  it.each(['OPTIONS'])('refuses method %s', async method => {
    let contacts = 0;
    vi.stubEnv('BROWSER_APP_API_ORIGIN', await upstream((_req, res) => { contacts += 1; res.end('private'); }));
    expect((await call('http://localhost:8011/api/browser-app/api/projects', { method })).status).toBe(405);
    expect(contacts).toBe(0);
  });
  it('rejects an untrusted browser Origin but allows the page’s own', async () => {
    let contacts = 0;
    vi.stubEnv('BROWSER_APP_API_ORIGIN', await upstream((_req, res) => { contacts += 1; res.end('{}'); }));
    vi.stubEnv('CANVAS_WEB_URL', 'http://localhost:8011');
    const foreign = await call('http://localhost:8011/api/browser-app/api/projects', { headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(contacts).toBe(0);
    expect((await call('http://localhost:8011/api/browser-app/api/projects', { headers: { origin: 'http://localhost:8011' } })).status).toBe(200);
    expect(contacts).toBe(1);
  });
  it('turns an upstream redirect into 502 instead of replaying credentials at Location', async () => {
    vi.stubEnv('BROWSER_APP_API_ORIGIN', await upstream((_req, res) => { res.writeHead(307, { location: 'https://evil.example/steal' }); res.end(); }));
    const response = await call('http://localhost:8011/api/browser-app/api/projects', { headers: { authorization: 'Bearer biz' } });
    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
  });
  it('rejects an untrusted Host before contacting the browser backend', async () => {
    let contacts = 0;
    vi.stubEnv('BROWSER_APP_API_ORIGIN', await upstream((_req, res) => { contacts += 1; res.end('private'); }));
    const response = await call('http://localhost:8011/api/browser-app/api/projects', { headers: { host: 'attacker.example:8011' } });
    expect(response.status).toBe(403);
    expect(contacts).toBe(0);
  });
  it('forwards business auth, tenant, idempotency and conditional headers — never cookies, host or origin', async () => {
    const origin = await upstream((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ url: req.url, headers: req.headers }));
    });
    vi.stubEnv('BROWSER_APP_API_ORIGIN', origin);
    const response = await call('http://localhost:8011/api/browser-app/api/projects/p/files?scope=all', {
      method: 'PUT',
      body: '{"content":"x"}',
      headers: {
        host: 'localhost:8011',
        origin: 'http://localhost:8011',
        referer: 'http://localhost:8011/',
        cookie: 'a_session=secret; maintainer=yes',
        authorization: 'Bearer business-token',
        'content-type': 'application/json',
        'idempotency-key': 'op-1',
        'if-match': '"rev-3"',
        range: 'bytes=0-10',
        'x-team-id': 'team-a',
        'x-user-id': 'user-a',
        'x-mav-sso-authorization': 'sso',
        'x-workspace-id': 'canvas-only-scope',
      },
    }, ['api', 'projects', 'p', 'files']);
    expect(response.status).toBe(200);
    const echoed = await response.json() as { url: string; headers: Record<string, string | undefined> };
    expect(echoed.url).toBe('/api/projects/p/files?scope=all');
    expect(echoed.headers).toMatchObject({
      authorization: 'Bearer business-token',
      'content-type': 'application/json',
      'idempotency-key': 'op-1',
      'if-match': '"rev-3"',
      range: 'bytes=0-10',
      'x-team-id': 'team-a',
      'x-user-id': 'user-a',
      'x-mav-sso-authorization': 'sso',
      'x-forwarded-host': 'localhost:8011',
      'x-forwarded-proto': 'http',
    });
    expect(echoed.headers.cookie).toBeUndefined();
    expect(echoed.headers.origin).toBeUndefined();
    expect(echoed.headers.referer).toBeUndefined();
    expect(echoed.headers.host).toBe(`127.0.0.1:${new URL(origin).port}`);
    expect(echoed.headers['x-workspace-id']).toBeUndefined();
  });
  it('a configured service token overrides the caller authorization header', async () => {
    const origin = await upstream((req, res) => res.end(JSON.stringify(req.headers)));
    vi.stubEnv('BROWSER_APP_API_ORIGIN', origin);
    vi.stubEnv('BROWSER_APP_AUTH_TOKEN', 'deployed-service-token');
    const response = await call('http://localhost:8011/api/browser-app/api/browser-preferences', { headers: { authorization: 'Bearer user-token' } }, ['api', 'browser-preferences']);
    expect((await response.json() as Record<string, string>).authorization).toBe('Bearer deployed-service-token');
  });
  it('streams multipart upload bodies and preserves asset-library paths', async () => {
    const origin = await upstream(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.end(JSON.stringify({ url: req.url, method: req.method, type: req.headers['content-type'], body: Buffer.concat(chunks).toString() }));
    });
    vi.stubEnv('BROWSER_APP_API_ORIGIN', origin);
    const response = await call('http://localhost:8011/api/browser-app/api/asset-library/upload', {
      method: 'POST', body: '--b\r\nfile-bytes',
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
    }, ['api', 'asset-library', 'upload']);
    expect(await response.json()).toMatchObject({ url: '/api/asset-library/upload', method: 'POST', type: 'multipart/form-data; boundary=b', body: '--b\r\nfile-bytes' });
  });
  it('re-encodes decoded separators so a segment cannot become its own path', async () => {
    const origin = await upstream((req, res) => res.end(req.url));
    vi.stubEnv('BROWSER_APP_API_ORIGIN', origin);
    const response = await call('http://localhost:8011/api/browser-app/api/projects', undefined, ['api', 'projects', 'p', 'files', 'dir/evil.png']);
    expect(await response.text()).toBe('/api/projects/p/files/dir%2Fevil.png');
  });
  it('streams SSE without buffering and never falls back to the canvas proxy', async () => {
    let endStream: (() => void) | undefined;
    const origin = await upstream((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write('event: changed\ndata: first\n\n');
      endStream = () => res.end('event: changed\ndata: last\n\n');
    });
    vi.stubEnv('BROWSER_APP_API_ORIGIN', origin);
    const stream = await call('http://localhost:8011/api/browser-app/api/projects/p/events', undefined, ['api', 'projects', 'p', 'events']);
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: first');
    endStream!();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: last');
    expect((await reader.read()).done).toBe(true);
  });
});
