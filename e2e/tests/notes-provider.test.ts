import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createNotesHandler } from '../../examples/notes-app/provider';

/** 便签 Provider 独立 HTTP 集成检查（协议源自 design-ai-client-integration
 * 的 examples/notes-app；保持参考行为：拒 Origin、幂等去重、revision 冲突）。 */

describe('notes provider local HTTP protocol', () => {
  const instanceId = 'ai_000000000000000000000001';
  let server: Server;
  let base: string;

  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

  async function start() {
    server = createServer(createNotesHandler());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('listener');
    base = `http://127.0.0.1:${address.port}`;
  }

  async function call(actionId: string, body: unknown, init?: { origin?: string; idempotencyKey?: string; expectedRevision?: number }) {
    return fetch(`${base}/open-platform/v1/instances/${instanceId}/actions/${actionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init?.origin ? { origin: init.origin } : {}), ...(init?.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}) },
      body: JSON.stringify(body),
    });
  }

  it('读取空便签板，添加后回读，重复提交幂等去重', async () => {
    await start();
    const read = await call('notes.read', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.read', input: {} });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { summary: string }).summary).toBe('暂无便签');

    const key = 'idem-1';
    const add = await call('notes.add', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.add', input: { text: '下午三点开联调会' }, idempotencyKey: key, expectedRevision: 1 }, { idempotencyKey: key });
    expect(add.status).toBe(200);
    const added = await add.json() as { revision: number; data: { notes: string[] } };
    expect(added.revision).toBe(2);
    expect(added.data.notes).toEqual(['下午三点开联调会']);

    const replay = await call('notes.add', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.add', input: { text: '下午三点开联调会' }, idempotencyKey: key, expectedRevision: 1 }, { idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { revision: number }).revision).toBe(2);

    const again = await call('notes.read', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.read', input: {} });
    expect(((await again.json()) as { data: { notes: string[] } }).data.notes).toEqual(['下午三点开联调会']);
  });

  it('拒绝浏览器 Origin、revision 冲突与非法请求', async () => {
    await start();
    const fromBrowser = await call('notes.read', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.read', input: {} }, { origin: 'http://127.0.0.1:17573' });
    expect(fromBrowser.status).toBe(403);

    const key = 'idem-2';
    const stale = await call('notes.add', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.add', input: { text: '第二条' }, idempotencyKey: key, expectedRevision: 99 }, { idempotencyKey: key });
    expect(stale.status).toBe(409);

    const invalid = await call('notes.add', { protocolVersion: '1.0', providerInstanceId: instanceId, actionId: 'notes.add', input: { text: '' }, idempotencyKey: key }, { idempotencyKey: key });
    expect(invalid.status).toBe(400);

    const unknown = await fetch(`${base}/open-platform/v1/instances/${instanceId}/actions/notes.delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(unknown.status).toBe(404);
  });
});
