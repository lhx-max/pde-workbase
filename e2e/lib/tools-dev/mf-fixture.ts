import { createServer } from 'node:https';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('../../fixtures/mf/', import.meta.url));
export const MF_FIXTURE_AIE = 'canvas-e2e-agent';
export const MF_FIXTURE_UI_HOST = 'mf.localhost';
export type MfFixtureAuthFailure = 'http-401' | 'code-40101';
export const MF_FIXTURE_FILE = { path: 'fixture-preview.txt', name: 'fixture-preview.txt', directory: false };
export const MF_FIXTURE_FILE_CONTENT = 'MF_WORKSPACE_PREVIEW_FIXTURE\nImported bytes must match the native workspace preview.\n';
const COOKIE = 'canvas_e2e_fixture=NOT_A_REAL_CREDENTIAL';
export interface MfFixtureRequest { method: string; path: string; query: Record<string, string>; body: unknown; bytes: number; authenticated: boolean }
export interface MfProtocolFixture {
  url: string;
  environment: NodeJS.ProcessEnv;
  requests: MfFixtureRequest[];
  unexpected: string[];
  websocketMessages: unknown[];
  setAuthFailure(mode?: MfFixtureAuthFailure): void;
  /** SSE remains open until the test explicitly finishes; no timing-dependent fake model. */
  finishStreams(text?: string): void;
  emit(event: Record<string, unknown>): void;
  dispose(): Promise<void>;
}

/** Owned HTTPS transport fixture only: the browser loads the real pinned SDK bundle. */
export async function startMfProtocolFixture(root: string): Promise<MfProtocolFixture> {
  const certPath = path.join(fixtures, 'localhost-cert.pem');
  const [key, cert] = await Promise.all([readFile(path.join(fixtures, 'localhost-key.pem')), readFile(certPath)]);
  const cookieFile = path.join(root, 'mf-fixture-cookie.txt');
  await writeFile(cookieFile, COOKIE, { mode: 0o600, flag: 'wx' });
  const requests: MfFixtureRequest[] = [], unexpected: string[] = [], websocketMessages: unknown[] = [];
  const streams = new Set<ServerResponse>(), sockets = new Set<Duplex>();
  const sessions = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  let authFailure: MfFixtureAuthFailure | undefined;
  const sendEvent = (res: ServerResponse, event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const server = createServer({ key, cert }, async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'https://localhost');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks), text = buffer.toString('utf8');
      let body: any = undefined;
      try { body = text ? JSON.parse(text) : undefined; } catch { body = { multipart: true }; }
      requests.push({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, bytes: buffer.length, authenticated: req.headers.cookie === COOKIE });
      const reply = (result: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ code: 0, result })); };
      const p = url.pathname.replace(/^\/api\/kpandora/, '');
      if (req.headers.cookie !== COOKIE) { res.writeHead(401); res.end(); return; }
      // The auth-code case uses a native non-projected endpoint so its login URL
      // reaches the actual SDK interceptor; user-info intentionally strips it.
      if (authFailure && p === (authFailure === 'http-401' ? '/v1/login/user' : '/v1/model/chat/list')) {
        res.writeHead(authFailure === 'http-401' ? 401 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(authFailure === 'http-401'
          ? { code: 401, message: 'Owned fixture authentication required' }
          : { code: 40101, data: { location: 'https://mf-login.invalid/login' }, message: 'Owned fixture authentication required' }));
        return;
      }
      if (p === '/v1/login/user') return reply({ username: 'canvas-e2e-user', name: 'Local fixture user' });
      if (p === '/v1/model/chat/list') return reply({ fixedModels: [], customModels: [] });
      if (p === '/v1/model/auto') return reply({ autoTiers: [] });
      if (p === `/v1/aie/manage/detail/${MF_FIXTURE_AIE}`) return reply({ summary: { status: 'PUBLISHED', myRole: 'OWNER', ownerUsername: 'canvas-e2e-user' }, kimOpenApi: { fixtureSecret: 'MUST_NOT_REACH_BROWSER' } });
      if (p === `/v1/aie/manage/detail/${MF_FIXTURE_AIE}/model`) return reply({ routeMode: 'AUTO', tokenBillingMode: 'OWNER', autoTier: 'ECO', privateAuto: false, fixtureSecret: 'MUST_NOT_REACH_BROWSER' });
      if (p === '/v1/aie/web/personal/list') return reply({ groups: [], sharedAieList: [{ aieUsername: MF_FIXTURE_AIE, displayName: 'Local protocol fixture', id: 'fixture-aie', status: 'PUBLISHED' }] });
      if (p === `/api/v1/myknowledge/aie/${MF_FIXTURE_AIE}/relations`) return reply([]);
      if (p === '/v1/session/new') {
        const sessionKey = `fixture-session-${++sequence}`;
        sessions.set(sessionKey, { key: sessionKey, title: 'Fixture conversation', aieUsername: MF_FIXTURE_AIE, enableArtifact: true, type: 'NORMAL' });
        return reply({ key: sessionKey });
      }
      if (req.method === 'POST' && p === '/v1/activity/session/list') return reply({ sessions: [], hasMore: false });
      if (req.method === 'POST' && (p === '/v1/asset/cdn/page' || p === '/v1/asset/doc/page')) return reply({ data: [], total: 0 });
      if (p === '/v1/session/info') return reply({ session: sessions.get(body?.sessionKey), activeChat: null });
      if (p === '/v1/session/list' || p === '/v1/session/pinned/list') return reply({ sessions: [...sessions.values()], hasMore: false });
      if (p === '/v1/session/chat/history' || p === '/v1/session/chat/history/page') return reply({ messages: [], hasMore: false, startOffset: 0, endOffset: 0, fileSig: 'fixture' });
      if (p === '/v1/chat/active') return reply(null);
      if (p === '/v1/session/draft/get') return reply(null);
      if (p === '/v1/session/draft/save' || p === '/v1/session/draft/delete' || p === '/v1/session/mark-read' || p === '/v1/artifact/report') return reply(true);
      if (p === '/v1/user-model/credit-alert') return reply({ show: false });
      if (req.method === 'POST' && p === '/v1/chat/queue/list') return reply({ activeItem: null, interruptItem: null, queuedItems: [] });
      if (req.method === 'POST' && p === '/v1/chat/queue/claim-next') return reply({ claimed: false, item: null });
      if (req.method === 'POST' && p === '/v1/chat/queue/finish') return reply(null);
      if (p === '/v1/session/ws/ticket') return reply({ ticket: 'fixture-ticket' });
      if (p === '/v1/chat/webmcp/tools/register') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, contextVersion: body.contextVersion, toolCount: body.tools.length })); return;
      }
      if (p === '/v1/chat/webmcp/call/update') return reply({});
      if (p === '/v1/sandbox/instance/workspace/files') return reply([{ ...MF_FIXTURE_FILE, size: Buffer.byteLength(MF_FIXTURE_FILE_CONTENT) }]);
      if (p === '/v1/sandbox/instance/workspace/file/raw' && url.searchParams.get('path') === MF_FIXTURE_FILE.path) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(MF_FIXTURE_FILE_CONTENT); return;
      }
      if (p === '/v1/sandbox/instance/workspace/files/exist') return reply({ files: [], exists: true });
      if (p === '/v1/sandbox/instance/workspace/upload-policy') return reply({ maxFileSize: 10485760, maxFileCount: 10 });
      if (p === '/v1/sandbox/instance/workspace/file/upload') return reply({ path: '/workspace/fixture-note.txt', name: 'fixture-note.txt', size: buffer.length });
      if (p === '/v1/chat/web') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders(); streams.add(res); res.once('close', () => streams.delete(res));
        sendEvent(res, { type: 'response.init', chatId: `fixture-chat-${++sequence}` });
        sendEvent(res, { type: 'response.begin' });
        sendEvent(res, { type: 'response.content', delta: 'Local protocol fixture response. No model was contacted.' });
        return;
      }
      if (p === '/v1/chat/abort') { for (const stream of streams) stream.end(); streams.clear(); return reply(true); }
      unexpected.push(`${req.method} ${url.pathname}`);
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 404, message: 'Unsupported fixture endpoint' }));
    } catch (error) { unexpected.push(String(error)); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  // Minimal RFC6455 server: native upgrade, masked text frames, JSON subscribe/ping and close.
  // No undeclared ws dependency and no public server/test-only production switches.
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/kpandora/v1/session/ws?ticket=fixture-ticket' || req.headers.cookie !== COOKIE || typeof req.headers['sec-websocket-key'] !== 'string') { socket.destroy(); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (value: unknown) => { const data = Buffer.from(JSON.stringify(value)); socket.write(Buffer.concat([Buffer.from([0x81, data.length]), data])); };
    let pending = Buffer.alloc(0);
    const consume = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = pending[0]! & 15, masked = !!(pending[1]! & 128);
        let size = pending[1]! & 127, offset = 2;
        if (size === 127) { socket.destroy(); return; }
        if (size === 126) { if (pending.length < 4) return; size = pending.readUInt16BE(2); offset = 4; }
        if (!masked || size > 65535) { socket.destroy(); return; }
        if (pending.length < offset + 4 + size) return;
        const mask = pending.subarray(offset, offset + 4), data = Buffer.from(pending.subarray(offset + 4, offset + 4 + size));
        pending = pending.subarray(offset + 4 + size);
        for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ mask[i % 4]!;
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (opcode !== 1) continue;
        try { const message = JSON.parse(data.toString()); websocketMessages.push(message); if (message.type === 'ping') send({ type: 'pong' }); } catch { socket.destroy(); }
      }
    };
    socket.on('data', consume); if (head.length) consume(head);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture listen failed');
  return {
    url: `https://127.0.0.1:${address.port}`, requests, unexpected, websocketMessages,
    environment: { CANVAS_MF_UPSTREAM_URL: `https://127.0.0.1:${address.port}`, CANVAS_MF_COOKIE_FILE: cookieFile, CANVAS_MF_AIE_USERNAME: MF_FIXTURE_AIE, NODE_EXTRA_CA_CERTS: certPath },
    setAuthFailure(mode) { authFailure = mode; },
    emit(event) { for (const res of streams) sendEvent(res, event); },
    finishStreams(text) { for (const res of streams) { if (text) sendEvent(res, { type: 'response.content', delta: text }); sendEvent(res, { type: 'response.end' }); res.end(); } streams.clear(); },
    async dispose() { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
