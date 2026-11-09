import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProject } from '@/api';
import { useToolsDev } from '@/vitest/suite';

type Snapshot = { ok: true; state: Record<string, unknown>; revision: number };
type Receipt = { operationId: string; status: 'applied' | 'noop'; baseRevision: number; revision: number; nodeIds: string[] };
type Result = { ok: true; receipt: Receipt; revision: number; state: Record<string, unknown>; replayed: boolean };

/** Observe only public HTTP: the daemon's storage and operation internals are deliberately not imported. */
async function request(base: string, route: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${route}`, init);
}
function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
function nodes(snapshot: Snapshot): Array<Record<string, unknown>> {
  return Array.isArray(snapshot.state.workbenchBasicNodes) ? snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>> : [];
}

/** The public operation is a revision-checked change, not an arbitrary state overwrite. */
describe('public canvas operation HTTP lifecycle', () => {
  const active = useToolsDev();

  it('reads state, applies a node operation, resolves its receipt, and reloads the same revision without replaying', async () => {
    const runtime = active();
    const projectId = await createProject(runtime, 'Canvas operations persistence');
    const prefix = `/api/projects/${encodeURIComponent(projectId)}/canvas`;
    const initialResponse = await request(runtime.serverUrl, `${prefix}/state`);
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json() as Snapshot;
    const operationId = randomUUID();
    const nodeId = `text-${randomUUID()}`;
    const body = { operationId, baseRevision: initial.revision,
      operations: [{ type: 'node.create', node: { id: nodeId, kind: 'text', x: 120, y: 64, title: 'HTTP node', text: 'Saved by operation' } }] };
    const appliedResponse = await request(runtime.serverUrl, `${prefix}/operations`, post(body));
    expect(appliedResponse.status).toBe(200);
    const applied = await appliedResponse.json() as Result;
    expect(applied).toMatchObject({ ok: true, replayed: false,
      receipt: { operationId, status: 'applied', baseRevision: initial.revision, revision: applied.revision } });
    expect(applied.receipt.nodeIds).toContain(nodeId);
    const receiptResponse = await request(runtime.serverUrl, `${prefix}/operations/${operationId}`);
    expect(receiptResponse.status).toBe(200);
    expect(await receiptResponse.json()).toMatchObject({ receipt: applied.receipt });
    const revisionResponse = await request(runtime.serverUrl, `${prefix}/revision`);
    expect(revisionResponse.status).toBe(200);
    expect(await revisionResponse.json()).toMatchObject({ revision: applied.revision });
    const reloadedResponse = await request(runtime.serverUrl, `${prefix}/state`);
    expect(reloadedResponse.status).toBe(200);
    const reloaded = await reloadedResponse.json() as Snapshot;
    expect(reloaded.revision).toBe(applied.revision);
    expect(nodes(reloaded)).toContainEqual(expect.objectContaining({ id: nodeId, text: 'Saved by operation', x: 120, y: 64 }));
    // A lost HTTP response must not create a second card or advance the revision.
    const replayResponse = await request(runtime.serverUrl, `${prefix}/operations`, post(body));
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as Result;
    expect(replay).toMatchObject({ replayed: true, revision: applied.revision, receipt: applied.receipt });
    const final = await (await request(runtime.serverUrl, `${prefix}/state`)).json() as Snapshot;
    expect(final.revision).toBe(applied.revision);
    expect(nodes(final).filter(item => item.id === nodeId)).toHaveLength(1);
  });

  it('rejects stale conflicting edits and prevents cross-project receipt reads and unauthorized origins', async () => {
    const runtime = active();
    const first = await createProject(runtime, 'Canvas operations owner');
    const second = await createProject(runtime, 'Canvas operations unrelated project');
    const prefix = `/api/projects/${encodeURIComponent(first)}/canvas`;
    const before = await (await request(runtime.serverUrl, `${prefix}/state`)).json() as Snapshot;
    const nodeId = `text-${randomUUID()}`;
    const createId = randomUUID();
    const createdResponse = await request(runtime.serverUrl, `${prefix}/operations`, post({
      operationId: createId, baseRevision: before.revision,
      operations: [{ type: 'node.create', node: { id: nodeId, kind: 'text', x: 0, y: 0, text: 'original' } }],
    }));
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as Result;
    const updateResponse = await request(runtime.serverUrl, `${prefix}/operations`, post({
      operationId: randomUUID(), baseRevision: created.revision,
      operations: [{ type: 'node.update', nodeId, set: { text: 'newer' } }],
    }));
    expect(updateResponse.status).toBe(200);
    const newer = await updateResponse.json() as Result;
    const conflict = await request(runtime.serverUrl, `${prefix}/operations`, post({
      operationId: randomUUID(), baseRevision: created.revision,
      operations: [{ type: 'node.update', nodeId, set: { text: 'stale overwrite' } }],
    }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { error: { code: string } }).error.code).toBe('CANVAS_REVISION_CONFLICT');
    const after = await (await request(runtime.serverUrl, `${prefix}/state`)).json() as Snapshot;
    expect(after.revision).toBe(newer.revision);
    expect(nodes(after).find(item => item.id === nodeId)?.text).toBe('newer');

    const other = `/api/projects/${encodeURIComponent(second)}/canvas`;
    const foreignReceipt = await request(runtime.serverUrl, `${other}/operations/${createId}`);
    expect(foreignReceipt.status).toBe(404);
    const forbiddenRead = await request(runtime.serverUrl, `${prefix}/operations/${createId}`, { headers: { Origin: 'https://untrusted.example' } });
    expect(forbiddenRead.status).toBe(403);
    const forbiddenWrite = await request(runtime.serverUrl, `${prefix}/operations`, post({
      operationId: randomUUID(), baseRevision: newer.revision, operations: [{ type: 'node.delete', nodeId }],
    }, { Origin: 'https://untrusted.example' }));
    expect(forbiddenWrite.status).toBe(403);
    expect(nodes(await (await request(runtime.serverUrl, `${prefix}/state`)).json() as Snapshot).some(item => item.id === nodeId)).toBe(true);
  });
});
