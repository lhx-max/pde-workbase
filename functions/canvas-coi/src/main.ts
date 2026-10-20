import { createHash, randomUUID } from 'node:crypto';
import { Jimp } from 'jimp';
import {
  applyCanvasOperations, assertCanvasMerge, assertCanvasReferences, records,
  canonical, equal, mergeCanvasValue, CanvasStateError,
  prepareCanvasDocument, prepareCanvasImage, prepareCanvasSketch, prepareCanvasVideo,
  type CanvasImageProcessor, type StoredCanvasOperation,
} from '@bezier/canvas-core';
import { canvasOperationSchema, canvasOperationsRequestSchema, canvasTextPath, CANVAS_CARD_KINDS, type CanvasOperationReceipt } from '@bezier/contracts';
import { AppwriteClient } from './vendor/appwrite-client.js';
import { AppwriteCanvasFileContent, AppwriteCanvasPersistence } from './vendor/canvas-appwrite-persistence.js';
import { AppwriteCanvasAssetStore } from './vendor/canvas-appwrite-assets.js';
import { AppwriteSketchStore, AppwriteVideoStore } from './vendor/canvas-appwrite-effects.js';

/** The canvas COI door as an Appwrite Function: the whole app backend lives in
 * the database + bucket; this function is only the HTTP entry that runs
 * operations. No resident process, no cross-request lock — commit conflicts
 * are handled by optimistic retry against the embedded journal. */

interface FnRequest { method: string; path: string; bodyText: string; headers: Record<string, string> }
interface FnResponse { json: (body: unknown, status?: number) => unknown }
interface FnContext { req: FnRequest; res: FnResponse; log: (m: string) => void; error: (m: string) => void }

const env = (name: string): string => process.env[name] ?? '';
const client = new AppwriteClient({
  // Functions run inside IDC; the public edge refuses that segment, so the
  // platform injects an internal endpoint for function-to-API traffic.
  endpoint: env('APPWRITE_FUNCTION_API_ENDPOINT') || env('APPWRITE_ENDPOINT'),
  projectId: env('APPWRITE_PROJECT_ID'),
  apiKey: env('APPWRITE_FUNCTION_API_KEY') || undefined,
  sessionCookie: env('APPWRITE_SESSION_COOKIE') || undefined,
});
const databaseId = env('APPWRITE_DATABASE_ID');
const bucketId = env('APPWRITE_BUCKET_ID');
const persistence = new AppwriteCanvasPersistence(client, databaseId);
const content = new AppwriteCanvasFileContent(client, databaseId, bucketId);

/** Pure-JS image pipeline for the function runtime (no native sharp). */
const jimpProcessor: CanvasImageProcessor = {
  async process(bytes, operation) {
    const image = await Jimp.read(Buffer.from(bytes));
    if (operation.crop) image.crop({ x: Math.round(operation.crop.x), y: Math.round(operation.crop.y), w: Math.round(operation.crop.width), h: Math.round(operation.crop.height) });
    if (operation.rotate) image.rotate(operation.rotate);
    const out = await image.getBuffer('image/png');
    return { bytes: new Uint8Array(out), width: image.bitmap.width, height: image.bitmap.height };
  },
};

const effects = (canvasId: string, operationId: string) => {
  const assets = new AppwriteCanvasAssetStore(client, databaseId, bucketId, canvasId);
  const sketches = new AppwriteSketchStore(client, databaseId, bucketId, canvasId);
  const videos = new AppwriteVideoStore(client, databaseId, bucketId, canvasId);
  return {
    image: (op: Parameters<typeof prepareCanvasImage>[3], node?: Record<string, unknown>) => prepareCanvasImage(assets, jimpProcessor, operationId, op as never, node as never),
    document: (op: unknown, node?: unknown) => prepareCanvasDocument(assets, operationId, op as never, node as never),
    sketch: (op: unknown, node?: unknown) => prepareCanvasSketch(sketches, operationId, op as never, node as never),
    video: (op: unknown, node?: unknown) => prepareCanvasVideo(videos, operationId, op as never, node as never),
  };
};

const canvasTextDocumentPath = (node: Record<string, unknown>): string =>
  typeof node.projectFilePath === 'string' ? node.projectFilePath : canvasTextPath(String(node.id));

const reconcileSketchFileReferences = (state: Record<string, unknown>): Record<string, unknown> => {
  const aliases = (state.__sketchFileRenames ?? {}) as Record<string, Record<string, string>>;
  if (!Object.keys(aliases).length) return state;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const item = value as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(item).map(([k, child]) => [k, visit(child)]));
    const sourceId = item.kind === 'sketch' ? item.id : item.sourceNodeId;
    const paths = typeof sourceId === 'string' ? aliases[sourceId] : undefined;
    for (const key of ['projectFilePath', 'path']) {
      const source = item[key] || (key === 'projectFilePath' && item.kind === 'sketch' ? `canvas-${item.id}.sketch.json` : undefined);
      const target = typeof source === 'string' ? paths?.[source] : undefined;
      if (typeof target === 'string') { next[key] = target; if (item.kind === 'sketch') next.sketchPending = false; }
    }
    return next;
  };
  return { ...state,
    ...(state.workbenchBasicNodes ? { workbenchBasicNodes: visit(state.workbenchBasicNodes) } : {}),
    ...(state.workbenchTaskDrafts ? { workbenchTaskDrafts: visit(state.workbenchTaskDrafts) } : {}),
  };
};

const reconcileTextOperationReferences = (state: Record<string, unknown>, previous: Record<string, unknown>): Record<string, unknown> => {
  const items = (v: unknown): Array<Record<string, unknown> & { id: string }> => Array.isArray(v) ? v as never : [];
  const nodes = items(state.workbenchBasicNodes), edges = items(state.workbenchEdges), images = items(state.workbenchImages);
  const textIds = new Set([...nodes, ...items(previous.workbenchBasicNodes)].filter(n => n.kind === 'text' || n.kind === 'page').map(n => n.id));
  [...images, ...items(previous.workbenchImages)].forEach(n => textIds.add(n.id));
  const out = nodes.map(node => {
    if (node.kind !== 'text') return node;
    const derived: Record<string, unknown>[] = [];
    for (const edge of edges.filter(e => e.target === node.id)) {
      if ((edge.data as Record<string, unknown> | undefined)?.skipSourceContext) continue;
      const source = nodes.find(n => n.id === edge.source && n.kind === 'text');
      if (source?.projectFilePath) derived.push({ kind: 'canvas-text', nodeId: source.id, path: source.projectFilePath, title: source.title });
      const image = images.find(n => n.id === edge.source);
      if (image?.path) derived.push({ kind: 'canvas-image', nodeId: image.id, path: image.path, title: image.title });
    }
    const kept = items(node.linkedAttachments).filter(a => a.kind !== 'canvas-text' && a.kind !== 'canvas-image');
    const next = { ...node, linkedAttachments: [...kept, ...derived] };
    return equal(next, node) ? node : next;
  });
  return { ...state, workbenchBasicNodes: out };
};

/** One apply pass: load → dedup/replay → apply ops → merge → commit. */
async function applyOnce(canvasId: string, input: unknown) {
  const parsed = canvasOperationsRequestSchema.safeParse(input);
  if (!parsed.success) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'Invalid canvas operation', { issues: parsed.error.issues });
  const request = parsed.data;
  const fingerprint = createHash('sha256').update(canonical(request)).digest('hex');
  const fx = effects(canvasId, request.operationId);
  const current = await persistence.load(canvasId);
  const journal = current.operations ?? {};
  const previous = journal[request.operationId];
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new CanvasStateError(409, 'CANVAS_OPERATION_ID_CONFLICT', 'Operation ID was used with different input');
    return { ok: true, state: current.state, revision: current.revision, receipt: previous.receipt, replayed: true };
  }
  if (request.baseRevision !== current.revision && !request.expectedState)
    throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Canvas revision changed', { actualRevision: current.revision });
  const draft = { ...current.state, ...request.expectedState };
  const applied = await applyCanvasOperations(draft, request.operations, journal, fx.image, fx.document, fx.sketch, fx.video);
  for (const key of applied.keys) {
    if (!request.expectedState || !Object.hasOwn(request.expectedState, key)) {
      if (request.baseRevision !== current.revision)
        throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Missing base state for changed collection', { field: key, actualRevision: current.revision });
      continue;
    }
    const base = request.expectedState[key as keyof typeof request.expectedState];
    assertCanvasMerge(base, applied.state[key], current.state[key] ?? [], key);
    applied.state[key] = mergeOperationValue(base, applied.state[key], current.state[key] ?? []);
  }
  assertCanvasReferences(current.state, applied.state);
  const nodeIds = new Set([...records(applied.state.workbenchBasicNodes), ...records(applied.state.workbenchImages)].map(node => node.id));
  const oldEdges = records(current.state.workbenchEdges);
  for (const edge of records(applied.state.workbenchEdges)) {
    if (!oldEdges.some(old => equal(old, edge)) && (!nodeIds.has(String(edge.source)) || !nodeIds.has(String(edge.target))))
      throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Connection target was removed', { edgeId: edge.id });
  }
  const oldNodes = records(current.state.workbenchBasicNodes);
  if (applied.keys.includes('workbenchBasicNodes')) {
    applied.state.workbenchBasicNodes = records(applied.state.workbenchBasicNodes).map(node => {
      const old = oldNodes.find(item => item.id === node.id);
      return node.kind !== 'text' || (old && old.text === node.text)
        ? node : { ...node, projectFilePath: canvasTextPath(`${node.id}-op-${fingerprint.slice(0, 16)}`) };
    });
  }
  applied.state = reconcileTextOperationReferences(reconcileSketchFileReferences(applied.state), current.state);
  const before = Object.fromEntries(applied.keys.map(key => [key, current.state[key] ?? []]));
  const after = Object.fromEntries(applied.keys.map(key => [key, applied.state[key] ?? []]));
  const revision = Math.max(current.revision + 1, Date.now());
  const receipt: CanvasOperationReceipt = { operationId: request.operationId, status: equal(before, after) ? 'noop' : 'applied', baseRevision: current.revision, revision, nodeIds: applied.nodeIds, createdAt: new Date().toISOString() };
  if (applied.keys.includes('workbenchBasicNodes')) {
    for (const node of records(applied.state.workbenchBasicNodes).filter(n => !equal(n, oldNodes.find(o => o.id === n.id)))) {
      if (node.kind !== 'text' || typeof node.text !== 'string') continue;
      const p = canvasTextDocumentPath(node);
      if (await content.read(canvasId, p) !== node.text) await content.write(canvasId, p, node.text);
    }
  }
  await persistence.commit(canvasId, { ...current, updatedAt: receipt.createdAt, state: applied.state, revision,
    operations: { ...journal, [request.operationId]: { fingerprint, receipt, before, after } } }, request.operationId);
  return { ok: true, state: applied.state, revision, receipt, replayed: false };
}

/** Functions cannot serialize writers — commit, then verify the journal won;
 * a lost race reruns against the freshest state (bounded). */
async function apply(canvasId: string, input: unknown) {
  const request = input as { operationId?: string };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await applyOnce(canvasId, input);
    if (result.replayed) return result;
    const verify = await persistence.load(canvasId);
    if (request.operationId && verify.operations?.[request.operationId]) return result;
    if (attempt === 2) throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Concurrent write won; retry the operation');
  }
  throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'unreachable');
}

const json = (res: FnResponse, status: number, data: unknown) =>
  res.json({ requestId: `req_${randomUUID()}`, data }, status);
const fail = (res: FnResponse, error: unknown) => {
  const err = error instanceof CanvasStateError ? error : new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', String(error));
  return res.json({ error: { code: err.code, message: err.message, retryable: err.status >= 500 }, requestId: `req_${randomUUID()}` }, err.status);
};

export default async function ({ req, res }: FnContext) {
  try {
    const body = req.bodyText ? JSON.parse(req.bodyText) as Record<string, unknown> : {};
    const p = req.path;
    if (p === '/debug/env') {
      const probe = await fetch(`${env('APPWRITE_ENDPOINT')}/databases/${env('APPWRITE_DATABASE_ID')}/collections/canvases/documents`, {
        headers: {
          'x-appwrite-project': env('APPWRITE_PROJECT_ID'),
          ...(env('APPWRITE_FUNCTION_API_KEY') ? { 'x-appwrite-key': env('APPWRITE_FUNCTION_API_KEY') } : {}),
          ...(env('APPWRITE_SESSION_COOKIE') ? { cookie: env('APPWRITE_SESSION_COOKIE') } : {}),
        },
      });
      const internal = env('APPWRITE_FUNCTION_API_ENDPOINT');
      const probe2 = internal ? await fetch(`${internal}/databases/${env('APPWRITE_DATABASE_ID')}/collections/canvases/documents`, {
        headers: {
          'x-appwrite-project': env('APPWRITE_FUNCTION_PROJECT_ID') || env('APPWRITE_PROJECT_ID'),
          ...(env('APPWRITE_FUNCTION_API_KEY') ? { 'x-appwrite-key': env('APPWRITE_FUNCTION_API_KEY') } : {}),
          ...(env('APPWRITE_SESSION_COOKIE') ? { cookie: env('APPWRITE_SESSION_COOKIE') } : {}),
        },
      }) : null;
      return json(res, 200, {
        hasApiKey: Boolean(env('APPWRITE_FUNCTION_API_KEY')),
        hasCookie: Boolean(env('APPWRITE_SESSION_COOKIE')),
        endpoint: env('APPWRITE_ENDPOINT'),
        internalEndpoint: internal,
        probeStatus: probe.status,
        probeBody: (await probe.text()).slice(0, 200),
        internalProbeStatus: probe2?.status,
        internalProbeBody: probe2 ? (await probe2.text()).slice(0, 200) : null,
      });
    }
    if (req.method === 'GET' && (p === '/' || p === '/api/apps/canvas')) {
      const actions = (canvasOperationSchema.options.map(option => (option as { shape: { type: { value: string } } }).shape.type.value) as string[])
        .map(actionId => ({ actionId, target: 'instance' }));
      return json(res, 200, { appId: 'canvas', protocolVersion: 1, nodeKinds: CANVAS_CARD_KINDS, actions: [{ actionId: 'canvas.create', target: 'app' }, ...actions] });
    }
    if (req.method === 'POST' && /^\/api\/apps\/canvas\/actions\/canvas\.create$/.test(p)) {
      const id = typeof body.input === 'object' && body.input && typeof (body.input as Record<string, unknown>).instanceId === 'string'
        ? (body.input as Record<string, unknown>).instanceId : `canvas-${randomUUID().slice(0, 12)}`;
      const existing = await persistence.load(id);
      if (existing.revision > 0) throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'Instance already exists');
      await persistence.commit(id, { state: {}, revision: 1, operations: {}, snapshots: {} });
      return json(res, 201, { status: 'succeeded', result: { instanceId: id } });
    }
    const stateMatch = /^\/api\/apps\/canvas\/instances\/([^/]+)\/state$/.exec(p);
    if (req.method === 'GET' && stateMatch) {
      const current = await persistence.load(stateMatch[1]);
      return json(res, 200, { instanceId: stateMatch[1], revision: current.revision, state: current.state, eventCursor: String(current.revision) });
    }
    const actionMatch = /^\/api\/apps\/canvas\/instances\/([^/]+)\/actions\/([^/]+)$/.exec(p);
    if (req.method === 'POST' && actionMatch) {
      const input = body.input && typeof body.input === 'object' ? body.input : {};
      const operationId = req.headers['idempotency-key'] ?? `op-${randomUUID()}`;
      const baseRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : (await persistence.load(actionMatch[1])).revision;
      const response = await apply(actionMatch[1], { operationId, baseRevision, operations: [{ type: actionMatch[2], ...input }] });
      return json(res, 200, { receiptId: response.receipt.operationId, status: 'succeeded',
        result: { revision: response.revision, state: response.state }, revision: response.revision,
        replayed: response.replayed, eventCursor: String(response.revision) });
    }
    const receiptMatch = /^\/api\/apps\/canvas\/instances\/([^/]+)\/action-receipts\/([^/]+)$/.exec(p);
    if (req.method === 'GET' && receiptMatch) {
      const stored = (await persistence.load(receiptMatch[1])).operations ?? {};
      const entry = stored[receiptMatch[2]];
      if (!entry) throw new CanvasStateError(404, 'CANVAS_OPERATION_NOT_FOUND', 'Operation not found');
      return json(res, 200, { receiptId: entry.receipt.operationId, status: entry.receipt.status === 'applied' ? 'succeeded' : 'noop', result: entry.receipt });
    }
    return fail(res, new CanvasStateError(404, 'CANVAS_NOT_FOUND', `No route for ${req.method} ${p}`));
  } catch (error) {
    return fail(res, error);
  }
}
