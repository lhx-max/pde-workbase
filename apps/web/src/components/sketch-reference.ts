import type { ExcalidrawSketchScene } from './sketch-model';

export type SketchReferenceScope = 'scene' | 'selection';
export interface SketchReferenceRequest {
  sourceName: string;
  scope: SketchReferenceScope;
  elementIds: string[];
  files: File[];
}

/** Freeze only the requested content. Never leak other shapes/images through
 * the scene's binary-file map or references to unselected containers. */
export function sketchReferenceScene(scene: ExcalidrawSketchScene, selectedIds?: ReadonlySet<string>): ExcalidrawSketchScene {
  const elements = scene.elements.filter((value): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    && !(value as { isDeleted?: boolean }).isDeleted);
  const included = new Set(selectedIds ?? elements.map(element => element.id as string));
  // A frame includes its children; bound labels belong to their selected shape.
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      if (included.has(element.id as string)) continue;
      if ((typeof element.containerId === 'string' && included.has(element.containerId))
        || (typeof element.frameId === 'string' && included.has(element.frameId))) {
        included.add(element.id as string);
        changed = true;
      }
    }
  }
  const selected = elements.filter(element => included.has(element.id as string));
  if (!selected.length) throw new Error('Empty sketch reference');
  const files: Record<string, unknown> = {};
  const snapshot = selected.map(value => {
    const element = structuredClone(value);
    if (typeof element.fileId === 'string' && scene.files[element.fileId]) {
      files[element.fileId] = structuredClone(scene.files[element.fileId]);
    }
    for (const field of ['containerId', 'frameId']) {
      if (typeof element[field] === 'string' && !included.has(element[field] as string)) element[field] = null;
    }
    for (const field of ['startBinding', 'endBinding']) {
      const binding = element[field] as { elementId?: string } | null;
      if (binding?.elementId && !included.has(binding.elementId)) element[field] = null;
    }
    if (Array.isArray(element.boundElements)) {
      element.boundElements = element.boundElements.filter((bound: { id: string }) => included.has(bound.id));
    }
    return element;
  });
  return {
    elements: snapshot,
    files,
    appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor ?? '#ffffff' },
  };
}
