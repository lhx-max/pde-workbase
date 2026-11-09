import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { proxyCanvasRequest } from '../src/server/proxy';

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
beforeEach(() => { vi.stubEnv('CANVAS_WEB_URL', ''); vi.stubEnv('CANVAS_AUTH_TOKEN', ''); });
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

describe('runtime-only standalone backend routing', () => {
  it.each(['attacker.example:8011', '127.0.0.1.attacker.example:8011'])('rejects untrusted Host %s before injecting backend credentials', async host => {
    let contacts = 0;
    vi.stubEnv('CANVAS_SERVER_ORIGIN', await upstream((_req, res) => { contacts += 1; res.end('private data'); }));
    vi.stubEnv('CANVAS_AUTH_TOKEN', 'private-transport-token');
    const response = await proxyCanvasRequest(new Request('http://localhost:8011/api/projects', { headers: { host } }));
    expect(response.status).toBe(403);
    expect(contacts).toBe(0);
  });
  it('restricts explicit public host configuration while permitting a declared reverse proxy', async () => {
    vi.stubEnv('CANVAS_SERVER_ORIGIN', await upstream((req, res) => res.end(JSON.stringify(req.headers))));
    vi.stubEnv('CANVAS_WEB_URL', 'https://workspace.example');
    const denied = await proxyCanvasRequest(new Request('http://localhost:8011/api/projects', { headers: { host: 'other.example' } }));
    expect(denied.status).toBe(403);
    const allowed = await proxyCanvasRequest(new Request('http://localhost:8011/api/projects', { headers: { host: 'workspace.example', 'x-forwarded-host': 'attacker.example' } }));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ 'x-forwarded-host': 'workspace.example', 'x-forwarded-proto': 'https' });
  });
  it('fails closed on malformed explicit web URL rather than accepting arbitrary hostnames', async () => {
    vi.stubEnv('CANVAS_SERVER_ORIGIN', await upstream((_req, res) => res.end('unexpected contact')));
    vi.stubEnv('CANVAS_WEB_URL', 'file:///private');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await proxyCanvasRequest(new Request('http://localhost:8000/api/projects'))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed without an explicit target instead of contacting an ambient daemon', async () => {
    vi.stubEnv('CANVAS_SERVER_ORIGIN', '');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await proxyCanvasRequest(new Request('http://localhost:8000/api/projects'))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['file:///tmp/backend', 'http://secret@localhost:7000', 'http://localhost:7000/api', 'http://localhost:7000/?other=1'])('rejects malformed origin %s without credential forwarding', async origin => {
    vi.stubEnv('CANVAS_SERVER_ORIGIN', origin);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await proxyCanvasRequest(new Request('http://localhost:8000/api/projects'))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses startup/runtime configuration rather than a target captured when imported or built', async () => {
    const a = await upstream((_req, res) => res.end('A'));
    const b = await upstream((_req, res) => res.end('B'));
    vi.stubEnv('CANVAS_SERVER_ORIGIN', a);
    expect(await (await proxyCanvasRequest(new Request('http://localhost:8000/api/projects'))).text()).toBe('A');
    vi.stubEnv('CANVAS_SERVER_ORIGIN', b);
    expect(await (await proxyCanvasRequest(new Request('http://localhost:8001/api/projects'))).text()).toBe('B');
  });
  it('streams multipart bytes and preserves user scope, browser origin and runtime authentication', async () => {
    const origin = await upstream(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }));
    });
    vi.stubEnv('CANVAS_SERVER_ORIGIN', origin);
    vi.stubEnv('CANVAS_AUTH_TOKEN', 'test-transport-secret');
    const response = await proxyCanvasRequest(new Request('http://localhost:8011/api/projects/p/upload?folder=a%2Fb', {
      method: 'POST', body: '--test-boundary\r\noriginal bytes',
      headers: { 'content-type': 'multipart/form-data; boundary=test-boundary', 'x-workspace-id': 'scope-A', origin: 'null', authorization: 'untrusted-token' },
    }));
    const echoed = await response.json();
    expect(echoed).toMatchObject({ url: '/api/projects/p/upload?folder=a%2Fb', method: 'POST', body: '--test-boundary\r\noriginal bytes' });
    expect(echoed.headers).toMatchObject({ 'x-workspace-id': 'scope-A', origin: 'null', authorization: 'Bearer test-transport-secret', 'x-forwarded-host': 'localhost:8011' });
    expect(response.headers.get('authorization')).toBeNull();
  });
  it('preserves range status and content disposition without buffering streamed SSE', async () => {
    let endStream: (() => void) | undefined;
    const origin = await upstream((req, res) => {
      if (req.url === '/api/events') {
        res.setHeader('content-type', 'text/event-stream');
        res.write('event: changed\ndata: first\n\n');
        endStream = () => res.end('event: changed\ndata: last\n\n');
      } else {
        res.writeHead(206, { 'content-range': 'bytes 0-2/6', 'content-disposition': 'attachment; filename=sample.bin' });
        res.end('abc');
      }
    });
    vi.stubEnv('CANVAS_SERVER_ORIGIN', origin);
    const file = await proxyCanvasRequest(new Request('http://localhost:8000/artifacts/sample.bin', { headers: { range: 'bytes=0-2' } }));
    expect(file.status).toBe(206);
    expect(file.headers.get('content-range')).toBe('bytes 0-2/6');
    expect(file.headers.get('content-disposition')).toContain('sample.bin');
    expect(await file.text()).toBe('abc');
    const stream = await proxyCanvasRequest(new Request('http://localhost:8000/api/events'));
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: first');
    expect(endStream).toBeTypeOf('function');
    endStream!();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: last');
    expect((await reader.read()).done).toBe(true);
  });
  it('does not follow redirects with backend credentials and removes decoded transport metadata', async () => {
    const origin = await upstream((req, res) => {
      if (req.url === '/frames/redirect') { res.writeHead(302, { location: 'https://not-the-backend.example/' }); res.end(); }
      else { const zipped = gzipSync('decoded file'); res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': zipped.length }); res.end(zipped); }
    });
    vi.stubEnv('CANVAS_SERVER_ORIGIN', origin);
    const redirect = await proxyCanvasRequest(new Request('http://localhost:8000/frames/redirect'));
    expect(redirect.status).toBe(302);
    const decoded = await proxyCanvasRequest(new Request('http://localhost:8000/frames/file'));
    expect(decoded.headers.get('content-encoding')).toBeNull();
    expect(decoded.headers.get('content-length')).toBeNull();
    expect(await decoded.text()).toBe('decoded file');
  });
});
