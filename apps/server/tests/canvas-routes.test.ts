import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerCanvasStateRoutes } from '../src/routes/canvas.js';
import type { ProjectLedger } from '../src/project-ledger/service.js';
type ToolTokenGrant = {projectId: string};

type CanvasResponse = { revision: number; state: Record<string, unknown> };

describe('shared canvas persistence routes', () => {
  let root: string;
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base: string;
  let denyWrite = false;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bezier-canvas-routes-'));
    denyWrite = false;
    const app = express(); app.use(express.json());
    const resolve = (id: string) => id === 'project' ? root : null;
    registerCanvasStateRoutes(app, {
      canvasState: new CanvasStateService(resolve), resolveProjectRoot: resolve,
      ledger: {
        listEntityHistory: (_projectId: string, _entityType: string, nodeId: string) => nodeId === 'page-1'
          ? [{ id: 'event-1', type: 'canvas.node.created', summary: 'Canvas card created' }]
          : [],
      } as unknown as ProjectLedger,
      authorizeToolRequest: () => ({ projectId: 'project' } as ToolTokenGrant),
      authorizeProjectRequest: async (_req, res, _id, options) => {
        if (denyWrite && options.mode === 'write') { res.status(403).json({ error: 'denied' }); return false; }
        return true;
      },
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    base = `http://127.0.0.1:${address.port}/api/projects/project`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });

  it('shares one persisted canvas document across reads', async () => {
    const initial = await (await fetch(`${base}/canvas/state`)).json() as CanvasResponse;
    const response = await fetch(`${base}/canvas/state`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: initial.revision, changes: { workbenchViewport: { x: 17, y: 28, scale: 1.2 } } }) });
    expect(response.status).toBe(200);
    const reread = await (await fetch(`${base}/canvas/state`)).json() as CanvasResponse;
    expect(reread.state.workbenchViewport).toEqual({ x: 17, y: 28, scale: 1.2 });
    const reopened = new CanvasStateService(() => root);
    expect((await reopened.read('project')).state.workbenchViewport).toEqual(reread.state.workbenchViewport);
    const revision = await (await fetch(`${base}/canvas/revision`)).json() as CanvasResponse;
    expect(revision.revision).toBe(reread.revision);
  });

  it('preserves authorization and rejects malformed writes on the shared surface', async () => {
    const options = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    expect((await fetch(`${base}/canvas/state`, options)).status).toBe(400);
    denyWrite = true;
    expect((await fetch(`${base}/canvas/state`, { ...options, body: JSON.stringify({ changes: { test: true } }) })).status).toBe(403);
    const saved = await (await fetch(`${base}/canvas/state`)).json() as CanvasResponse;
    expect(saved.state.test).toBeUndefined();
  });

  it('rejects blind state patches and preserves an explicit merge base',async()=>{
    const patch=(body:unknown)=>fetch(`${base}/canvas/state`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    expect((await patch({changes:{title:'blind'}})).status).toBe(428);
    expect((await patch({expectedRevision:-1,changes:{title:'invalid'}})).status).toBe(400);
    expect((await patch({base:{},changes:{workbenchViewport:{x:1,y:2,scale:1}}})).status).toBe(200);
    expect((await patch({expectedRevision:0,changes:{workbenchViewport:{x:3,y:4,scale:1}}})).status).toBe(409);
  });

  it('exposes compact context and per-node history through the same authorized surface', async () => {
    await fetch(`${base}/canvas/state`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision:0, changes: { workbenchBasicNodes: [{ id: 'page-1', kind: 'page', title: 'Deck', projectFilePath: 'deck.html' }] } }),
    });
    const context = await (await fetch(`${base}/canvas/context`)).json() as { summary: { nodeCount: number; nodes: Array<{ id: string }> } };
    expect(context.summary).toMatchObject({ nodeCount: 1, nodes: [{ id: 'page-1' }] });
    const history = await (await fetch(`${base}/canvas/nodes/page-1/history`)).json() as { nodeId: string; events: Array<{ id: string }> };
    expect(history).toMatchObject({ nodeId: 'page-1', events: [{ id: 'event-1' }] });
    expect((await fetch(`${base}/canvas/nodes/missing/history`)).status).toBe(404);
    expect((await fetch(`${base}/canvas/nodes/workflow-result-foreign/history`)).status).toBe(404);
    const toolHistory = await (await fetch(`http://127.0.0.1:${new URL(base).port}/api/tools/canvas/history/page-1`)).json() as { projectId: string; nodeId: string };
    expect(toolHistory).toMatchObject({ projectId: 'project', nodeId: 'page-1' });
  });
});
