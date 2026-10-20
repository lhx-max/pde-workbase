import type { CanvasSketchStore, SketchStoredFile } from '@bezier/canvas-core';
import { CanvasStateError } from '../canvas/errors.js';

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
}

/** HTTP client for the sketch App's own file API. Bytes stay there. */
export class SketchAppFiles {
  constructor(private readonly endpoint: string) {}

  private fileUrl(path: string): string {
    return `${this.endpoint.replace(/\/+$/, '')}/api/files?path=${encodeURIComponent(path)}`;
  }

  async read(path: string): Promise<string | null> {
    const response = await fetch(this.fileUrl(path));
    if (response.status === 404) return null;
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app read failed (${response.status})`);
    return response.text();
  }

  async meta(path: string): Promise<SketchMeta | null> {
    const response = await fetch(`${this.endpoint.replace(/\/+$/, '')}/api/files/meta?path=${encodeURIComponent(path)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app lookup failed (${response.status})`);
    return response.json() as Promise<SketchMeta>;
  }

  async write(path: string, content: string): Promise<SketchMeta> {
    const response = await fetch(this.fileUrl(path), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: content,
    });
    if (!response.ok) throw new CanvasStateError(502, 'SKETCH_APP_UNAVAILABLE', `Sketch app write failed (${response.status})`);
    return response.json() as Promise<SketchMeta>;
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

  async putSketch(content: string, _operationId: string, nodeId: string): Promise<SketchStoredFile> {
    const path = `canvases/${segment(this.instanceId)}/cards/${segment(nodeId)}.sketch.json`;
    const saved = await this.files.write(path, content);
    return { path: saved.path || path, sketchId: saved.id };
  }
}
