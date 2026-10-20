import { createServer, type Server } from 'node:http';
import { BrowserResourceError, parseBrowserResourceCommand, type BrowserResourceExecutor } from '@bezier/contracts';
import { authenticates, requireHostToken } from './policy.js';

/** Narrow authenticated server-to-native transport. No generic fetch/eval/filesystem API. */
export async function startCommandTransport(options: { port: number; token: string; execute: BrowserResourceExecutor }): Promise<Server> {
  const token = requireHostToken(options.token);
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('CANVAS_BROWSER_HOST_PORT must be 1..65535');
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const failure = (status: number, code: string, message: string) => { res.writeHead(status); res.end(JSON.stringify({ ok: false, error: { code, message } })); };
    if (req.headers.origin || req.headers['sec-fetch-site'] || !authenticates(req.headers.authorization, token)) {
      failure(401, 'unauthorized', 'Native host authorization required'); req.resume(); return;
    }
    if (req.method !== 'POST' || req.url !== '/command') { failure(404, 'invalid-request', 'Unknown native command'); req.resume(); return; }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') { failure(400, 'invalid-request', 'JSON command required'); req.resume(); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) { failure(413, 'too-large', 'Native command exceeds limit'); req.resume(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const command = parseBrowserResourceCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const result = await options.execute(command);
      if (!res.destroyed) { res.writeHead(200); res.end(JSON.stringify({ ok: true, result })); }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (error instanceof BrowserResourceError) {
        failure(error.code === 'unauthorized' ? 401 : error.code === 'stale-document' ? 409 : error.code === 'too-large' ? 413 : error.code === 'invalid-request' ? 400 : 503, error.code, error.message);
      } else failure(400, 'invalid-request', 'Native resource command failed');
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  return server;
}
