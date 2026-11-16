import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type RequestListener } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

type Board = { notes: string[]; revision: number; writes: Map<string, { text: string; revision: number; notes: string[] }> };

export function createNotesHandler(): RequestListener {
  const boards = new Map<string, Board>();
  return async (request, response) => {
    const send = (status: number, body: object) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    const route = /^\/open-platform\/v1\/instances\/([A-Za-z0-9_-]{1,200})\/actions\/(notes\.(read|add))$/u.exec(request.url ?? '');
    if (request.method !== 'POST' || !route) return send(404, { error: 'NOT_FOUND' });
    if (request.headers.origin || request.headers['content-type'] !== 'application/json') return send(403, { error: 'LOCAL_SERVER_ONLY' });
    const [, instanceId, actionId, action] = route;
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 8192) return send(413, { error: 'BODY_TOO_LARGE' });
        chunks.push(bytes);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body?.protocolVersion !== '1.0' || body.providerInstanceId !== instanceId || body.actionId !== actionId
        || !body.input || typeof body.input !== 'object' || Array.isArray(body.input)) return send(400, { error: 'INVALID_ACTION' });
      const board: Board = boards.get(instanceId!) ?? { notes: [], revision: 1, writes: new Map() };
      const reply = (summary: string, state: Pick<Board, 'revision' | 'notes'> = board) => send(200, {
        protocolVersion: '1.0', actionId, providerInstanceId: instanceId, revision: state.revision, summary,
        data: { notes: state.notes },
      });
      if (action === 'read') return reply(board.notes.length ? `便签：${board.notes.join('、')}`.slice(0, 2000) : '暂无便签');
      const text = typeof body.input.text === 'string' ? body.input.text.trim() : '';
      const key = request.headers['idempotency-key'];
      if (!text || text.length > 500 || typeof key !== 'string' || key !== body.idempotencyKey) {
        return send(400, { error: 'INVALID_NOTE' });
      }
      const previous = board.writes.get(key);
      if (previous) return previous.text === text ? reply(`已添加：${text}`, previous) : send(409, { error: 'IDEMPOTENCY_CONFLICT' });
      if (body.expectedRevision !== board.revision) return send(409, { error: 'REVISION_CONFLICT' });
      board.notes = [...board.notes, text];
      board.revision += 1;
      board.writes.set(key, { text, revision: board.revision, notes: board.notes });
      boards.set(instanceId!, board);
      return reply(`已添加：${text}`);
    } catch { return send(400, { error: 'INVALID_REQUEST' }); }
  };
}

if (import.meta.main) {
  const certFile = process.env.NOTES_TLS_CERT_FILE;
  const keyFile = process.env.NOTES_TLS_KEY_FILE;
  if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('请同时配置便签服务的证书和私钥');
  const port = Number(process.env.NOTES_PORT ?? '4310');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('便签端口无效');
  const handler = createNotesHandler();
  const server = certFile && keyFile
    ? createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, handler) : createHttpServer(handler);
  server.listen(port, '127.0.0.1', () => console.log(`便签 Provider 已启动于 ${certFile ? 'https' : 'http'}://127.0.0.1:${port}`));
}
