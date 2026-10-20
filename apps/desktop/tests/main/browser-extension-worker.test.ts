import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { BROWSER_EXTENSION_ID } from '../../src/main/browser-extension-identity.js';
type Reply = { ok: boolean; message: string; inspectorId?: string; sessionId?: string; assetData?: { asset: { id: string; name: string } } };
type Sender = { id?: string; url?: string; tab?: { id: number } };
let worker: string;
beforeAll(async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../../browser-extension/background.ts', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120' });
  worker = result.outputFiles[0]!.text;
});
const secret = 'b'.repeat(64), assetData = { asset: { id: 'captured-asset', name: 'Saved selection' } };
const saved = { ok: true, status: 'saved', message: 'Saved', assetData, sessionId: secret };
const capture = { type: 'save-capture', kind: 'selection', asset: { name: 'Selection', aiFill: false }, capture: { pageUrl: 'https://example.test/', text: 'Explicit selection' } };
function fixture(responses: Response[]) {
  const stored: Record<string, unknown> = {};
  let listener!: (message: Record<string, unknown>, sender: Sender, reply: (value: Reply) => void) => boolean;
  const postBodies: Record<string, unknown>[] = [];
  const context = { connected: true, canWrite: true, projectName: 'Local project' };
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === '/v1/status') return Response.json({ status: context });
    if (path === '/v1/claim') return Response.json({ code: JSON.stringify({ protocolVersion: 1, uploadUrl: 'http://127.0.0.1:23456/v1/captures', token: 'a'.repeat(64), expiresAt: Date.now() + 300000, context }) });
    if (path !== '/v1/captures') throw new Error('Unexpected network target');
    postBodies.push(JSON.parse(String(init?.body)));
    const response = responses.shift(); if (!response) throw new Error('Missing synthetic reply'); return response;
  });
  const badge = vi.fn(async () => {});
  const chrome = { runtime: { id: BROWSER_EXTENSION_ID, getURL: (path: string) => `chrome-extension://${BROWSER_EXTENSION_ID}/${path}`,
    onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, onInstalled: { addListener: vi.fn() }, connectNative: () => { throw new Error('No native fallback expected'); } },
    storage: { session: { get: async (key: string) => ({ [key]: structuredClone(stored[key]) }), set: async (value: Record<string, unknown>) => { Object.assign(stored, structuredClone(value)); } },
      local: { get: async () => ({}), set: async () => {} } },
    action: { setBadgeText: badge }, tabs: { query: async () => [], sendMessage: async () => {} },
    contextMenus: { removeAll: (done?: () => void) => done?.(), create: vi.fn(), onClicked: { addListener: vi.fn() } } };
  new Function('chrome', 'fetch', worker)(chrome, fetchMock);
  const send = (message: Record<string, unknown>, tabId = 7, extensionId = BROWSER_EXTENSION_ID) => new Promise<Reply | undefined>(resolve => {
    if (!listener(message, { id: extensionId, tab: { id: tabId }, url: 'https://example.test/' }, resolve)) resolve(undefined);
  });
  return { send, stored, postBodies, badge, fetchMock };
}
describe('bundled extension worker capture and inspector protocol', () => {
  it('retains saved metadata and exchanges the private session for a tab-bound opaque handle', async () => {
    const f = fixture([Response.json(saved), Response.json({ ...saved, assetData: { asset: { ...assetData.asset, name: 'Read asset' } } }), Response.json({ ...saved, assetData: { asset: { ...assetData.asset, name: 'Updated asset' } } })]);
    const result = (await f.send(capture))!;
    expect(result).toMatchObject({ ok: true, assetData }); expect(result.inspectorId).toBeTypeOf('string'); expect(result).not.toHaveProperty('sessionId');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(f.stored.assetInspectors).toMatchObject({ [result.inspectorId!]: { sessionId: secret, tabId: 7 } });
    const read = await f.send({ type: 'inspect-asset', inspectorId: result.inspectorId, action: 'read', assetId: 'foreign-asset' });
    expect(read).toMatchObject({ ok: true, assetData: { asset: { name: 'Read asset' } } }); expect(read).not.toHaveProperty('sessionId');
    expect(f.postBodies[1]).toEqual({ schema: 'design-ai.browser-asset-inspector.v1', sessionId: secret, action: 'read' });
    const patch = { revision: 1, name: 'Updated asset' };
    const update = await f.send({ type: 'inspect-asset', inspectorId: result.inspectorId, action: 'update', patch });
    expect(update).toMatchObject({ ok: true, assetData: { asset: { name: 'Updated asset' } } }); expect(update).not.toHaveProperty('sessionId');
    expect(f.postBodies[2]).toEqual({ schema: 'design-ai.browser-asset-inspector.v1', sessionId: secret, action: 'update', patch });
  });
  it('denies foreign tabs, foreign senders, invalid operations and expired handles before requesting a claim', async () => {
    const f = fixture([Response.json(saved)]); const result = (await f.send(capture))!;
    expect(result.inspectorId).toBeTypeOf('string'); const calls = f.fetchMock.mock.calls.length;
    const inspect = { type: 'inspect-asset', inspectorId: result.inspectorId, action: 'read' };
    expect((await f.send(inspect, 8))?.ok).toBe(false);
    expect(await f.send(inspect, 7, 'foreign-extension')).toBeUndefined();
    expect((await f.send({ ...inspect, action: 'delete' }))?.ok).toBe(false);
    (f.stored.assetInspectors as Record<string, { expires: number }>)[result.inspectorId!]!.expires = 1;
    expect((await f.send(inspect))?.ok).toBe(false); expect(f.fetchMock).toHaveBeenCalledTimes(calls);
  });
  it.each([null, [], { ok: false, status: 'saved' }, { ok: true, status: 'pending' }, { ...saved, sessionId: 17 }, { ...saved, assetData: { asset: null } }])('rejects malformed or unconfirmed HTTP 200 reply %# without minting a handle', async payload => {
    const f = fixture([Response.json(payload)]); const result = await f.send(capture);
    expect(result?.ok).toBe(false); expect(result).not.toHaveProperty('sessionId'); expect(result).not.toHaveProperty('inspectorId'); expect(f.stored.assetInspectors).toBeUndefined();
  });
  it('never treats 202 or invalid JSON/error responses as a saved capture', async () => {
    for (const response of [Response.json(saved, { status: 202 }), new Response('invalid-json', { status: 200 }), Response.json({ message: 'Unavailable' }, { status: 503 })]) {
      const f = fixture([response]); const result = await f.send(capture);
      expect(result?.ok).toBe(false); expect(result).not.toHaveProperty('inspectorId'); expect(f.stored.assetInspectors).toBeUndefined(); expect(f.badge).not.toHaveBeenCalledWith({ text: '✓' });
    }
  });
});
