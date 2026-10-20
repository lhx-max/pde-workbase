import { nativeMessage, nativeFailure } from './locales/native-messages.js';
import { captureMessages } from '../locales/browser-capture-messages.js';
import { BROWSER_EXTENSION_ID, BROWSER_BRIDGE_DISCOVERY_PORTS } from './browser-extension-identity.js';
import { du } from "./locales/desktop-ui.js";
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  attachImageBytes,
  BROWSER_CAPTURE_IMAGE_CONTENT_TYPE,
  BROWSER_CAPTURE_LIMITS,
  BrowserCaptureValidationError,
  decodeBrowserCaptureImageBody,
  parseBrowserCaptureEnvelope,
  type BrowserCaptureEnvelopeV1,
} from '@bezier/contracts';

export type BrowserCaptureAcceptResult =
  | { status: 'saved'; message: string; assetData?: unknown; sessionId?: string }
  | { status: 'rejected'; message: string }
  | { status: 'pending'; message: string };

const JSON_BODY_MAX = 1 * 1024 * 1024;
const IMAGE_BODY_MAX = 4 + BROWSER_CAPTURE_LIMITS.imageMetadataBytes + BROWSER_CAPTURE_LIMITS.imagePayloadBytes;

/**
 * Loopback-only, single-use HTTP receiver.
 *
 * Selection stays JSON. Image is a length-prefixed metadata JSON followed by
 * the original picture bytes — the body after the prefix is the file that
 * lands in the personal-asset library, not a base64 field inside JSON.
 */
export async function startBrowserCaptureBridge(options: {
  inspectAsset?: (request: unknown) => Promise<BrowserCaptureAcceptResult>;
  accept: (envelope: BrowserCaptureEnvelopeV1) => Promise<BrowserCaptureAcceptResult>;
  context: {
    connected: true;
    projectName: string | null;
    canWrite: boolean;
    spaces?: Array<{ id: string; name: string }>;
    defaultSpaceId?: string;
  };
  ttlMs?: number;
}) {
  const token = randomBytes(32).toString('hex');
  let used = false;
  let closed = false;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const reply = (status: number, body: Record<string, unknown>) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    const address = server.address();
    const expectedHost = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    const origin = request.headers.origin;
    const supplied = Buffer.from((request.headers.authorization || '').replace(/^Bearer /, ''));
    const validToken = supplied.length === token.length && timingSafeEqual(supplied, Buffer.from(token));
    if (
      closed || used
      || request.headers.host !== expectedHost
      || request.method !== 'POST'
      || request.url !== '/v1/captures'
      || !validToken
      || (origin && origin !== `chrome-extension://${BROWSER_EXTENSION_ID}`)
    ) { reply(403, { code: 'CLAIM_EXPIRED', message: du().claimExpiredOrUsed }); return; }
    const contentType = request.headers['content-type'] ?? '';
    const isImage = contentType.startsWith(BROWSER_CAPTURE_IMAGE_CONTENT_TYPE);
    const isJson = contentType.startsWith('application/json');
    if (!isImage && !isJson) { reply(415, { code: 'INVALID_ENVELOPE', message: du().badRequestFormat }); return; }
    used = true;
    try {
      const cap = isImage ? IMAGE_BODY_MAX : JSON_BODY_MAX;
      let size = 0;
      let oversized = false;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > cap) { oversized = true; continue; }
        chunks.push(Buffer.from(chunk));
      }
      if (oversized) { reply(413, { code: 'PAYLOAD_TOO_LARGE', message: captureMessages().tooLarge }); return; }
      if (closed) { reply(410, { code: 'CLAIM_EXPIRED', message: captureMessages().claimExpired }); return; }
      if (isJson) {
        const operation = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (operation?.schema === 'design-ai.browser-asset-inspector.v1') {
          if (!options.inspectAsset) { reply(409, {message: captureMessages().updateApp}); return; }
          const result = await options.inspectAsset(operation);
          reply(result.status === 'saved' ? 200 : 409, {ok: result.status === 'saved', ...result});
          return;
        }
      }
      let parsed: BrowserCaptureEnvelopeV1;
      try {
        parsed = isImage ? parseImageBody(Buffer.concat(chunks)) : parseJsonBody(Buffer.concat(chunks));
      } catch (error) {
        const code = error instanceof BrowserCaptureValidationError ? error.code : 'INVALID_ENVELOPE';
        reply(400, { code, message: nativeFailure(error, du().badContentFormat) });
        return;
      }
      const result = await options.accept(parsed);
      const statusCode = result.status === 'saved' ? 200 : result.status === 'pending' ? 202 : 409;
      reply(statusCode, { ok: result.status === 'saved', ...result });
    } catch { reply(400, { code: 'WRITE_FAILED', message: captureMessages().receiveFailed }); }
    finally { close(); }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  const timer = setTimeout(() => close(), options.ttlMs ?? 300000);
  timer.unref();
  function close() { closed = true; clearTimeout(timer); server.close(); server.closeIdleConnections(); }
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error(nativeMessage('Local browser capture bridge unavailable'));
  return {
    close,
    claim: {
      protocolVersion: 1 as const,
      uploadUrl: `http://127.0.0.1:${address.port}/v1/captures`,
      token,
      expiresAt: Date.now() + (options.ttlMs ?? 300000),
      context: options.context,
    },
  };
}

function parseJsonBody(body: Buffer): BrowserCaptureEnvelopeV1 {
  const parsed = parseBrowserCaptureEnvelope(JSON.parse(body.toString('utf8')));
  if (parsed.kind === 'image') {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', du().imageNotInJson);
  }
  return parsed;
}

function parseImageBody(body: Buffer): BrowserCaptureEnvelopeV1 {
  const { metadata, imageBytes } = decodeBrowserCaptureImageBody(body);
  const parsed = parseBrowserCaptureEnvelope(metadata);
  if (parsed.kind !== 'image') {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', du().imageChannelOnly);
  }
  return attachImageBytes(parsed, imageBytes);
}


/** Ports the extension scans on 127.0.0.1. First free port wins. */
export { BROWSER_BRIDGE_DISCOVERY_PORTS };

function isChromeExtensionOrigin(origin: string | undefined): boolean {
  return !origin || origin === `chrome-extension://${BROWSER_EXTENSION_ID}`;
}

/**
 * Persistent loopback discovery. Any Chromium browser with the extension can
 * find DA without Native Messaging being registered in that browser's profile.
 */
export async function startBrowserDiscovery(options: {
  readStatus: () => Record<string, unknown>;
  mintClaim: () => Promise<string | null>;
  onExtensionSeen?: () => void;
}): Promise<{ close: () => void; port: number }> {
  const server = createServer((request, response) => {
    void handleDiscovery(request, response, options).catch(() => { if (!response.headersSent) response.writeHead(503); response.end(); });
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    server.close();
    server.closeIdleConnections();
  };
  let lastError: unknown;
  for (const port of BROWSER_BRIDGE_DISCOVERY_PORTS) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListen); reject(error); };
        const onListen = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.listen(port, '127.0.0.1', onListen);
      });
      return { close, port };
    } catch (error) {
      lastError = error;
    }
  }
  close();
  throw lastError instanceof Error ? lastError : new Error(du().discoveryPortBusy);
}

async function handleDiscovery(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    readStatus: () => Record<string, unknown>;
    mintClaim: () => Promise<string | null>;
    onExtensionSeen?: () => void;
  },
): Promise<void> {
  const origin = request.headers.origin;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  if (origin && origin === `chrome-extension://${BROWSER_EXTENSION_ID}`) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-canvas-extension-id');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Vary', 'Origin');
  }
  const reply = (status: number, body: Record<string, unknown>) => {
    response.writeHead(status);
    response.end(JSON.stringify(body));
  };
  if (!isChromeExtensionOrigin(origin) || request.headers.host !== `127.0.0.1:${request.socket.localPort}`) {
    reply(403, { code: 'FORBIDDEN', message: du().localExtensionOnly });
    return;
  }
  if (request.method === 'OPTIONS' && origin === `chrome-extension://${BROWSER_EXTENSION_ID}`) { response.writeHead(204); response.end(); return; }
  if (request.headers['x-canvas-extension-id'] !== BROWSER_EXTENSION_ID) { reply(403, { code: 'FORBIDDEN', message: du().localExtensionOnly }); return; }
  const url = request.url?.split('?')[0] ?? '';
  if (request.method === 'GET' && url === '/v1/status') {
    // Chromium can omit Origin for extension fetches with host permissions.
    // Every accepted probe must update the desktop's connection heartbeat.
    options.onExtensionSeen?.();
    reply(200, { status: options.readStatus() });
    return;
  }
  if (request.method === 'POST' && url === '/v1/claim') {
    options.onExtensionSeen?.();
    const code = await options.mintClaim();
    if (!code) { reply(503, { error: du().connectionUnavailable }); return; }
    reply(200, { code });
    return;
  }
  reply(404, { error: du().unknownRequest });
}
