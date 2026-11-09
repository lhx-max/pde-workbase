import type { CanvasSketchStore, SketchStoredFile } from '@bezier/canvas-core';
import { CanvasStateError } from '../canvas/errors.js';
import {currentRequestTenant,forwardedAuthorityHeaders} from '../tenant.js';

export function isSketchDocumentPath(value: string): boolean {
  const path = value.replace(/\\/g, '/');
  return /\.(?:sketch\.json|excalidraw)$/i.test(path)
    && !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
}

function segment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return cleaned || 'card';
}

interface SketchMeta {
  id: string;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  nodeId?:string;
  mirrorCanvasId?:string;
}

/** HTTP client for the sketch App file API. The sketch store is the authority. */
export class SketchAppFiles {
  constructor(private readonly endpoint: string) {}

  private origin(): string {
    return this.endpoint.replace(/\/+$/, '').replace(/\/api\/apps\/sketch$/, '');
  }

  private fileUrl(path: string): string {
    return `${this.origin()}/api/files?path=${encodeURIComponent(path)}`;
  }

  private headers(): Record<string, string> {
    const actor=currentRequestTenant();
    return { 'x-team-id': actor?.teamId??'local', 'x-user-id': actor?.userId??'local', ...forwardedAuthorityHeaders(this.endpoint) };
  }

  private async bodyOf<T>(response: Response): Promise<T> {
    const body = await response.json() as { data?: T };
    return body.data ?? (body as T);
  }

  async read(path: string): Promise<string | null> {
    const response = await fetch(this.fileUrl(path), { redirect:'error', headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app read failed (${response.status})`);
    return response.text();
  }

  async meta(path: string): Promise<SketchMeta | null> {
    const response = await fetch(`${this.origin()}/api/files/meta?path=${encodeURIComponent(path)}`, { redirect:'error', headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app lookup failed (${response.status})`);
    return this.bodyOf<SketchMeta>(response);
  }

  async bind(id: string, path: string, canvasId: string, nodeId: string): Promise<void> {
    const response=await fetch(`${this.origin()}/api/apps/sketch/instances/${encodeURIComponent(id)}/actions/sketch.bind`, {
      method:'POST', redirect:'error', headers:{'content-type':'application/json',...this.headers()},
      body:JSON.stringify({input:{nodeId,mirrorCanvasId:canvasId,mirrorPath:path}}),
    });
    if(!response.ok)throw new CanvasStateError(502,'SKETCH_APP_UNAVAILABLE',`Sketch app binding failed (${response.status})`);
  }

  async createBound(path: string, content: string, canvasId: string, nodeId: string, operationId: string): Promise<SketchMeta> {
    const response = await fetch(`${this.origin()}/api/apps/sketch/actions/sketch.create`, {
      method: 'POST', redirect:'error',
      headers: { 'content-type': 'application/json', 'idempotency-key': `canvas-${canvasId}-${operationId}-${nodeId}`, ...this.headers() },
      body: JSON.stringify({ input: { name: nodeId, content, nodeId, mirrorCanvasId: canvasId, mirrorPath: path } }),
    });
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app create failed (${response.status})`);
    const result = await this.bodyOf<{result: {meta: SketchMeta}}>(response);
    return result.result.meta;
  }

  async write(path: string, content: string): Promise<SketchMeta> {
    const current = await fetch(this.fileUrl(path), { redirect:'error', headers: this.headers() });
    const version: { expectedRevision?: string; baseContent?: string } = {};
    if (current.status !== 404) {
      if (!current.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app read failed (${current.status})`);
      version.baseContent = await current.text();
      version.expectedRevision = current.headers.get('x-content-revision') ?? '';
      if (!version.expectedRevision) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', 'Sketch app did not return a content revision');
    }
    const response = await fetch(this.fileUrl(path), {
      method: 'PUT', redirect:'error',
      headers: { 'content-type': 'application/json', ...this.headers() },
      body: JSON.stringify({ content, ...version }),
    });
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app write failed (${response.status})`);
    return this.bodyOf<SketchMeta>(response);
  }
}

/** Canvas sketch operations addressed at one canvas instance, stored by the sketch App. */
export class SketchAppSketchStore implements CanvasSketchStore {
  constructor(private readonly files: SketchAppFiles, private readonly instanceId: string) {}

  async readSketch(path: string): Promise<string> {
    const content = await this.files.read(path);
    if (content === null) throw new CanvasStateError(404, 'CANVAS_SKETCH_NOT_FOUND', 'Sketch file not found');
    return content;
  }

  async putSketch(content: string, operationId: string, nodeId: string): Promise<SketchStoredFile> {
    const path = `canvases/${segment(this.instanceId)}/cards/${segment(nodeId)}.sketch.json`;
    const existing = await this.files.meta(path);
    if(existing && (existing.nodeId!==nodeId || existing.mirrorCanvasId!==this.instanceId)) {
      if(existing.nodeId || existing.mirrorCanvasId)throw new CanvasStateError(409,'SKETCH_BINDING_CONFLICT','Sketch path belongs to another card');
      await this.files.bind(existing.id,path,this.instanceId,nodeId);
    }
    const saved = existing ? await this.files.write(path, content) : await this.files.createBound(path, content, this.instanceId, nodeId, operationId);
    return { path, sketchId: saved.id };
  }
}
