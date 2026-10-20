import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_LAYOUT } from '@bezier/contracts';
import { CanvasStateError, type CanvasSketchStore } from '@bezier/canvas-core';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';

/** Immutable operation snapshots; file editor reads use the existing project file API. */
export class ProjectSketchStore implements CanvasSketchStore {
  constructor(private readonly root: string) {}
  private file(relative: string): string {
    if (!relative.endsWith('.sketch.json') || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..'))
      throw new CanvasStateError(400, 'CANVAS_INVALID_SKETCH', 'Expected a project-relative sketch file');
    try { assertProjectPathHasNoSymlinks(this.root, relative); }
    catch { throw new CanvasStateError(400, 'CANVAS_INVALID_SKETCH', 'Sketch path must not contain symlinks'); }
    return path.join(this.root, relative);
  }
  async readSketch(relative: string): Promise<string> {
    const file = this.file(relative);
    const info = await stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info?.isFile()) throw new CanvasStateError(404, 'CANVAS_SKETCH_NOT_FOUND', 'Sketch file not found');
    if (info.size > 5_000_000) throw new CanvasStateError(400, 'CANVAS_INVALID_SKETCH', 'Sketch exceeds 5 MB');
    return readFile(file, 'utf8');
  }
  async putSketch(content: string, operationId: string, nodeId: string): Promise<string> {
    const hash = createHash('sha256').update(JSON.stringify([operationId, nodeId, content])).digest('hex').slice(0, 24);
    const relative = `${PROJECT_LAYOUT.sketches}/canvas-${hash}.sketch.json`;
    const file = this.file(relative);
    await mkdir(path.dirname(file), { recursive: true });
    try { await writeFile(file, content, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await this.readSketch(relative) !== content) throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Sketch snapshot changed');
    }
    return relative;
  }
}
