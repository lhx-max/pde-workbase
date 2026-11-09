/** Invocation-scoped loopback bridge (Root contract §3): the function request
 * is replayed verbatim into the app's own Express surface over a random
 * loopback port that exists only for this execution. No resident listener,
 * no spawned process, no external upstream — the listener closes on every
 * exit path. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DecodedRequest, UpstreamResponse } from './transport.js';
import { forwardHeaders, TransportError } from './transport.js';

type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export interface BridgeOptions {
  /** Hard bound for a single bridged call; must stay below the function timeout. */
  timeoutMs: number;
  /** Response byte cap; oversized responses fail rather than truncate. */
  maxResponseBytes: number;
}

const DEFAULTS: BridgeOptions = { timeoutMs: 25_000, maxResponseBytes: 48 * 1024 * 1024 };

export async function bridgeRequest(app: RequestHandler, request: DecodedRequest, options: Partial<BridgeOptions> = {}): Promise<UpstreamResponse> {
  const opts = { ...DEFAULTS, ...options };
  const server = http.createServer((req, res) => app(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await new Promise<UpstreamResponse>((resolve, reject) => {
      const path = request.queryString ? `${request.path}?${request.queryString}` : request.path;
      const headers = forwardHeaders(request.headers, `127.0.0.1:${port}`);
      if (request.body && request.body.byteLength > 0) headers['content-length'] = String(request.body.byteLength);
      if (request.contentType) headers['content-type'] = request.contentType;
      let settled = false;
      const finish = (error: Error | null, value?: UpstreamResponse) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(value!);
      };
      const call = http.request({ host: '127.0.0.1', port, path, method: request.method, headers }, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > opts.maxResponseBytes) {
            call.destroy(new TransportError(502, 'FUNCTION_RESPONSE_TOO_LARGE', 'Upstream response exceeds the transport limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
          }
          finish(null, { status: res.statusCode ?? 502, headers: responseHeaders, body: new Uint8Array(Buffer.concat(chunks)) });
        });
        res.on('error', finish);
      });
      call.setTimeout(opts.timeoutMs, () => {
        call.destroy(new TransportError(503, 'FUNCTION_BRIDGE_TIMEOUT', 'Business handler did not complete inside the function bound', true));
      });
      call.on('error', finish);
      if (request.body && request.body.byteLength > 0) call.write(Buffer.from(request.body));
      call.end();
    });
  } finally {
    // Every exit path tears the ephemeral listener down.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      setTimeout(resolve, 2_000).unref();
    });
  }
}
