import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_LAYOUT, workflowProjectPath } from '@bezier/contracts';

/** Existing files/instances keep their locations. No migration and no copies. */
export function existingOrNewProjectPath(root: string, next: string, legacy: string): string {
  return !existsSync(path.join(root, next)) && existsSync(path.join(root, legacy)) ? legacy : next;
}
export function canvasStateRelativePath(root: string): string {
  return existingOrNewProjectPath(root, PROJECT_LAYOUT.canvasState, '整理/canvas-state.json');
}
export function workflowRelativePath(root: string, id: string, relative = ''): string {
  const legacy = id === 'legacy' ? '整理' : `整理/workflows/${id}`;
  if (existsSync(path.join(root, legacy, 'case.json'))) return `${legacy}/${relative || 'case.json'}`;
  return workflowProjectPath(id, relative);
}

/** Check existing ancestors before mkdir, including the new internal parent. */
export function assertProjectPathHasNoSymlinks(root: string, relative: string): void {
  let current = path.resolve(root);
  for (const segment of relative.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '..' || segment === '.') throw new Error('invalid project path');
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('symbolic links are not allowed in project storage');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}
