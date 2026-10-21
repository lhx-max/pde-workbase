/** Canvas capability manifest — registered like every other App so discovery
 * (GET /api/apps) tells agents the whole vocabulary in one shot.
 * Actions = semantic lifecycle ops. Operations = the batch write channel —
 * the actual "card API" (create/move/update/delete cards, connect edges,
 * kind-specific ops). Content-level edits route through the bound App's
 * actions instead (spec: data owner owns the action). */
import { listAgentSurface } from './canvas/agent-surface.js';

export function canvasManifest() {
  return {
    appId: 'canvas',
    name: '画布',
    version: '0.1.0',
    protocolVersion: 1,
    // Native card kinds — text/sketch/page/presentation appear here only via
    // their App's editorKinds when that App is registered.
    cardKinds: ['image', 'video', 'storyboard'],
    actions: [
      { actionId: 'canvas.create', mode: 'app', async: false },
      { actionId: 'canvas.rename', mode: 'instance', async: false },
      { actionId: 'canvas.delete', mode: 'instance', async: false },
      { actionId: 'canvas.duplicate', mode: 'instance', async: false, available: false },
    ],
    // Card API: POST /api/apps/canvas/instances/{id}/operations accepts these.
    operations: [
      'node.create', 'node.delete', 'node.duplicate', 'node.move', 'node.resize', 'node.rename', 'node.update',
      'edge.connect', 'edge.disconnect',
      'image.attach', 'image.select', 'image.replace', 'image.transform',
      'video.attach', 'video.select', 'video.configure',
      'sketch.create', 'sketch.update',
      'document.create', 'document.select', 'document.begin',
      'storyboard.shot.add', 'storyboard.shot.update', 'storyboard.shot.delete',
      'storyboard.shot.move', 'storyboard.shot.duplicate', 'storyboard.shot.references',
      'operation.undo',
    ],
    endpoints: {
      instances: 'GET /api/apps/canvas/instances',
      state: 'GET /api/apps/canvas/instances/{id}/state',
      node: 'GET /api/apps/canvas/instances/{id}/nodes/{nodeId}',
      nodeHistory: 'GET /api/apps/canvas/instances/{id}/nodes/{nodeId}/history',
      operations: 'POST /api/apps/canvas/instances/{id}/operations',
      operationReceipt: 'GET /api/apps/canvas/instances/{id}/operations/{operationId}',
      files: 'GET|PUT /api/apps/canvas/instances/{id}/files?path=',
      bindings: 'GET|PUT /api/apps/canvas/instances/{id}/bindings',
      events: 'GET /api/apps/canvas/instances/{id}/events (SSE)',
      snapshot: 'GET /api/apps/canvas/instances/{id}/snapshot',
    },
    events: { available: true, types: ['card.created', 'card.updated', 'card.deleted', 'edge.created', 'edge.updated', 'edge.deleted'] },
    snapshots: { available: true },
    agentSurface: listAgentSurface(),
    tenancy: 'required',
    execution: 'receipt',
  };
}
