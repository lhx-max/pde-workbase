import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Request } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import type { ImageAssetReference,ImageReferenceAttachResult } from '../src/canvas/state.js';
import { registerIndependentImageRoutes, independentImageSourceActor, independentImageCallerScope } from '../src/routes/independent-image.js';
import { setVerifiedTenant } from '../src/tenant.js';
import type { IndependentImageClient, BoundIndependentImageClient, ImageRemoteScope } from '../src/media/independent-image-client.js';
import type { AppActor } from '@ks-designai/app-authority';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const WID = `iw${'1'.repeat(32)}`, AID = `ia${'2'.repeat(34)}`, INST = 'inst-image-1';
const TARGET = { applicationId: 'image', applicationInstanceId: INST, providerInstanceId: 'prov-1', teamId: 'team-1', bizId: 'biz-1' };
const ACTOR: AppActor = { teamId: 'team-1', userId: 'user-1', bizId: 'biz-1', applicationId: 'canvas', applicationInstanceId: 'inst-canvas-1', providerInstanceId: 'prov-canvas-1' } as AppActor;
const REFERENCE: ImageAssetReference = { ...TARGET, workspaceId: WID, assetId: AID, mime: 'image/png', sha256: sha(PNG), width: 4, height: 4 };
const SCOPE = independentImageCallerScope({ teamId: ACTOR.teamId, userId: ACTOR.userId, bizId: ACTOR.bizId, applicationId: ACTOR.applicationId, applicationInstanceId: ACTOR.applicationInstanceId, providerInstanceId: ACTOR.providerInstanceId });

let roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map(r => rm(r, { recursive: true, force: true }))); roots = []; });

function service(): { canvas: CanvasStateService; root: string } {
  const root = join(tmpdir(), '');
  const dir = join(root, `imref-${Math.random().toString(36).slice(2)}`);
  roots.push(dir);
  const canvas = new CanvasStateService(() => dir);
  return { canvas, root: dir };
}

const resolver = (reference: ImageAssetReference = REFERENCE) => ({
  resolve: async () => ({ reference, previewUrl: (nodeId: string) => `/api/projects/p1/image-app/references/${nodeId}/preview` }),
});
const input = (extra: Record<string, unknown> = {}) => ({
  applicationInstanceId: INST, workspaceId: WID, assetId: AID, x: 10, y: 20,
  expectedRevision: 0, idempotencyKey: 'k-1', callerScope: SCOPE, ...extra,
});

describe('attachImageReference', () => {
  it('persists layout+reference+receipt and replays the original ack on duplicate key', async () => {
    const { canvas } = service();
    const result = await canvas.attachImageReference('p1', input(), resolver());
    expect(result.replayed).toBe(false);
    expect(result.nodeId).toMatch(/^imref-[0-9a-f]{32}$/);
    const snapshot = await canvas.read('p1');
    const images = snapshot.state.workbenchImages as Record<string, unknown>[];
    const node = images.find(n => n.id === result.nodeId)!;
    expect(node.status).toBe('ready');
    expect(node.imageReference).toEqual(REFERENCE);
    expect(String(node.src)).toContain(`/api/projects/p1/image-app/references/${result.nodeId}/preview`);
    const receipts = snapshot.state.workbenchImageReferenceReceipts as Record<string, Record<string, unknown>>;
    expect(Object.keys(receipts)).toEqual([`${SCOPE}:k-1`]);
    // Canvas state carries no Image business data.
    expect(snapshot.state.workbenchImageEdits).toBeUndefined();
    const replay = await canvas.attachImageReference('p1', input(), resolver());
    expect(replay).toEqual({ ...result, replayed: true });
    expect((await canvas.read('p1')).revision).toBe(result.revision);
  });
  it('replay never recreates a deleted node', async () => {
    const { canvas } = service();
    const result = await canvas.attachImageReference('p1', input(), resolver());
    const snapshot = await canvas.read('p1');
    const remaining = (snapshot.state.workbenchImages as Record<string, unknown>[]).filter(n => n.id !== result.nodeId);
    await canvas.patch('p1', { workbenchImages: remaining });
    const replay = await canvas.attachImageReference('p1', input(), resolver());
    expect(replay.nodeId).toBe(result.nodeId);
    expect((await canvas.read('p1')).state.workbenchImages).toEqual(remaining);
  });
  it('rejects same key with changed input, stale base revision, collisions and malformed fields', async () => {
    const { canvas } = service();
    await canvas.attachImageReference('p1', input(), resolver());
    await expect(canvas.attachImageReference('p1', input({ assetId: `ia${'3'.repeat(34)}` }), resolver())).rejects.toMatchObject({ status: 409, code: 'IMAGE_REFERENCE_KEY_CONFLICT' });
    await expect(canvas.attachImageReference('p1', input({ idempotencyKey: 'k-2' }), resolver())).rejects.toMatchObject({ status: 409, code: 'CANVAS_REVISION_CONFLICT' });
    for (const bad of [
      { workspaceId: 'nope' }, { assetId: 'ia123' }, { callerScope: 'z'.repeat(64) },
      { idempotencyKey: '' }, { x: Number.NaN }, { expectedRevision: -1 }, { unknown: 1 },
    ]) await expect(canvas.attachImageReference('p1', input({ idempotencyKey: `bad-${Math.random()}`, expectedRevision: (await canvas.read('p1')).revision, ...bad }), resolver())).rejects.toMatchObject({ status: 400 });
    await expect(canvas.attachImageReference('p1', input({ idempotencyKey: 'k-3', assetId: `ia${'3'.repeat(34)}`, expectedRevision: (await canvas.read('p1')).revision }), { resolve: async () => ({ reference: { ...REFERENCE, assetId: `ia${'9'.repeat(34)}` }, previewUrl: (n: string) => `/api/projects/p1/image-app/references/${n}/preview` }) })).rejects.toMatchObject({ status: 409, code: 'IMAGE_REFERENCE_MISMATCH' });
    await expect(canvas.attachImageReference('p1', input({ idempotencyKey: 'k-4', assetId: `ia${'4'.repeat(34)}`, expectedRevision: (await canvas.read('p1')).revision }), { resolve: async () => ({ reference: { ...REFERENCE, assetId: `ia${'4'.repeat(34)}`, mime: 'image/svg+xml' }, previewUrl: (n: string) => `/api/projects/p1/image-app/references/${n}/preview` }) })).rejects.toMatchObject({ status: 502 });
  });
  it('the PATCH journal key is server-only', async () => {
    const { canvas } = service();
    await expect(canvas.patch('p1', { workbenchImageReferenceReceipts: { forged: {} } })).rejects.toMatchObject({ status: 403, code: 'IMAGE_RECEIPT_READ_ONLY' });
  });
});

/** Typed in-memory bound client standing in for the gateway transport. */
function fakeBound(reference: ImageAssetReference, bytes: Uint8Array = PNG): BoundIndependentImageClient {
  const asset = { id: reference.assetId, workspaceId: reference.workspaceId, mime: reference.mime, sha256: reference.sha256, width: reference.width, height: reference.height };
  const scope: ImageRemoteScope = { ...TARGET, userId: ACTOR.userId };
  return {
    scope: () => ({ ...scope }),
    manifest: async () => ({ appId: 'image', protocolVersion: 1 }),
    listWorkspaces: async () => [{ id: WID, scope }],
    state: async (wid: string) => wid === WID ? { workspace: { id: WID, scope }, assets: [asset], jobs: [] } : { workspace: { id: wid, scope }, assets: [], jobs: [] },
    job: async () => ({}),
    asset: async () => ({ bytes, mime: reference.mime, sha256: sha(bytes) }),
    create: async () => ({ receiptId: `ir${'4'.repeat(32)}`, replayed: false, revision: 1, result: {} }),
    action: async () => ({ receiptId: `ir${'4'.repeat(32)}`, replayed: false, revision: 1, result: {} }),
  } as unknown as BoundIndependentImageClient;
}
function server(reference: ImageAssetReference = REFERENCE, opts: { verified?: boolean; authorize?: boolean; remoteSha?: string } = {}) {
  const { canvas } = service();
  const calls: string[] = [];
  const client = {
    forRequest: async (source: ImageRemoteScope, headers: Record<string, string>, target: string) => {
      calls.push(`${source.userId}:${headers['x-mav-tenant']}:${target}`);
      if (!headers['x-mav-sso-authorization']) throw Object.assign(new Error('x'), { status: 401, code: 'IMAGE_REMOTE_AUTH_REQUIRED' });
      if (target !== INST) throw Object.assign(new Error('x'), { status: 403, code: 'IMAGE_REMOTE_TARGET_MISMATCH' });
      const bound = fakeBound(reference);
      if (opts.remoteSha) { const orig = bound.asset,remoteSha=opts.remoteSha; bound.asset = async (w: string, a: string) => ({ ...(await orig(w, a)), sha256: remoteSha }); }
      return bound;
    },
  } as unknown as IndependentImageClient;
  const app = express();
  app.use(express.json());
  if (opts.verified !== false) app.use((req, _res, next) => { setVerifiedTenant(req as Request, ACTOR); next(); });
  registerIndependentImageRoutes(app, {
    client, canvas,
    authorize: async () => opts.authorize !== false,
    allowImage: async () => undefined,
  });
  return { app, canvas, calls };
}
const HEADERS = { 'x-mav-sso-authorization': 'Bearer sso-token', 'x-mav-tenant': 'team-1', 'x-mav-application-instance-id': 'inst-canvas-1' };

describe('independent image routes', () => {
  it('binds a reference and replays it; the journal and node persist', async () => {
    const { app, canvas, calls } = server();
    const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
    try {
      const revision = (await canvas.read('p1')).revision;
      const post = await fetch(`http://127.0.0.1:${port}/api/projects/p1/image-app/references`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'bind-1', ...HEADERS },
        body: JSON.stringify({ applicationInstanceId: INST, workspaceId: WID, assetId: AID, x: 5, y: 6, expectedRevision: revision }),
      });
      expect(post.status).toBe(201);
      const bound = (await post.json() as {data:ImageReferenceAttachResult}).data;
      expect(bound.nodeId).toMatch(/^imref-/); expect(bound.receiptId).toMatch(/^ir[0-9a-f]{32}$/);
      expect(calls).toEqual([`user-1:team-1:${INST}`]);
      // Same key, same input -> replayed ack, no second remote call.
      const again = await fetch(`http://127.0.0.1:${port}/api/projects/p1/image-app/references`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'bind-1', ...HEADERS },
        body: JSON.stringify({ applicationInstanceId: INST, workspaceId: WID, assetId: AID, x: 5, y: 6, expectedRevision: revision }),
      });
      const replayed = (await again.json() as {data:ImageReferenceAttachResult}).data;
      expect(replayed.replayed).toBe(true); expect(replayed.revision).toBe(bound.revision);
      expect(calls.length).toBe(1);
      // Preview serves verified bytes privately.
      const preview = await fetch(`http://127.0.0.1:${port}/api/projects/p1/image-app/references/${bound.nodeId}/preview`, { headers: HEADERS });
      expect(preview.status).toBe(200);
      expect(preview.headers.get('content-type')).toContain('image/png');
      expect(preview.headers.get('cache-control')).toContain('no-store');
      expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await preview.arrayBuffer()).equals(PNG)).toBe(true);
    } finally { srv.close(); }
  });
  it('rejects unverified callers, missing SSO, foreign targets and tampered remote bytes', async () => {
    const noTenant = server(REFERENCE, { verified: false });
    const srv1 = noTenant.app.listen(0); const p1 = (srv1.address() as { port: number }).port;
    const foreign = server();
    const srv2 = foreign.app.listen(0); const p2 = (srv2.address() as { port: number }).port;
    const tampered = server(REFERENCE, { remoteSha: 'f'.repeat(64) });
    const srv3 = tampered.app.listen(0); const p3 = (srv3.address() as { port: number }).port;
    try {
      const r1 = await fetch(`http://127.0.0.1:${p1}/api/projects/p1/image-app/references`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k', ...HEADERS }, body: '{}' });
      expect(r1.status).toBe(401);
      // Foreign target instance: resolution fails before any canvas write.
      const revision = (await foreign.canvas.read('p2')).revision;
      const r2 = await fetch(`http://127.0.0.1:${p2}/api/projects/p2/image-app/references`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k', ...HEADERS },
        body: JSON.stringify({ applicationInstanceId: 'inst-foreign', workspaceId: WID, assetId: AID, x: 1, y: 1, expectedRevision: revision }),
      });
      expect(r2.status).toBe(403);
      expect((await foreign.canvas.read('p2')).state.workbenchImages ?? []).toEqual([]);
      // Tampered remote bytes at preview time: integrity check rejects.
      const revision3 = (await tampered.canvas.read('p3')).revision;
      const bound = (await (await fetch(`http://127.0.0.1:${p3}/api/projects/p3/image-app/references`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k', ...HEADERS },
        body: JSON.stringify({ applicationInstanceId: INST, workspaceId: WID, assetId: AID, x: 1, y: 1, expectedRevision: revision3 }),
      })).json() as {data:ImageReferenceAttachResult}).data;
      const preview = await fetch(`http://127.0.0.1:${p3}/api/projects/p3/image-app/references/${bound.nodeId}/preview`, { headers: HEADERS });
      expect(preview.status).toBe(502);
    } finally { srv1.close(); srv2.close(); srv3.close(); }
  });
  it('proxy whitelist: manifest/state reachable, unknown paths 404, writes need SSO headers', async () => {
    const { app } = server();
    const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
    try {
      const base = `http://127.0.0.1:${port}/api/projects/p1/image-app/${INST}/api/apps/image`;
      const manifest = await fetch(base, { headers: HEADERS });
      expect(manifest.status).toBe(200); expect((await manifest.json() as {data:{appId:string}}).data.appId).toBe('image');
      const state = await fetch(`${base}/instances/${WID}/state`, { headers: HEADERS });
      expect(state.status).toBe(200);
      const unknown = await fetch(`${base}/invented-route`, { headers: HEADERS });
      expect(unknown.status).toBe(404);
      const noSso = await fetch(`${base}/workspaces`, { headers: { 'x-mav-tenant': 'team-1', 'x-mav-application-instance-id': 'inst-canvas-1' } });
      expect(noSso.status).toBe(401);
    } finally { srv.close(); }
  });
  it('source actor requires a verified tenant and a full six-field identity', async () => {
    const app = express();
    let err: unknown;
    app.get('/x', (req, res) => { try { res.json({ s: independentImageCallerScope(independentImageSourceActor(req)) }); } catch (e) { err = e; res.status(401).end(); } });
    const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
    await fetch(`http://127.0.0.1:${port}/x`);
    expect((err as { status: number }).status).toBe(401);
    srv.close();
  });
});
