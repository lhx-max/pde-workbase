import { open } from 'node:fs/promises';
import path from 'node:path';
import { CanvasStateError, type CanvasVideoStore } from '@bezier/canvas-core';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';

/** Uploaded/generated MP4 files are project-owned immutable media outputs. */
export class ProjectVideoStore implements CanvasVideoStore {
  constructor(private readonly root: string) {}
  async assertVideo(relative: string): Promise<void> {
    if (!/\.mp4$/i.test(relative) || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..'))
      throw new CanvasStateError(400, 'CANVAS_INVALID_VIDEO', 'Expected a project-relative MP4 file');
    try { assertProjectPathHasNoSymlinks(this.root, relative); }
    catch { throw new CanvasStateError(400, 'CANVAS_INVALID_VIDEO', 'Video path must not contain symlinks'); }
    const file = await open(path.join(this.root, relative), 'r').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new CanvasStateError(404, 'CANVAS_VIDEO_NOT_FOUND', 'Video file not found');
      throw error;
    });
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 12) throw new CanvasStateError(400, 'CANVAS_INVALID_VIDEO', 'Expected a nonempty MP4 file');
      const header = Buffer.alloc(12);
      await file.read(header, 0, 12, 0);
      if (header.toString('ascii', 4, 8) !== 'ftyp') throw new CanvasStateError(400, 'CANVAS_INVALID_VIDEO', 'Invalid MP4 header');
    } finally { await file.close(); }
  }
}
