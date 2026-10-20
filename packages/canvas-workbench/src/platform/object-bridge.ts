import type { CanvasBasicNode } from '../workbench/BasicCanvasNode';
import { cr } from '../locales/canvas-remainder';
import { getCanvasHostContext } from './api-base';

export type CanvasObjectReference = {
  projectId: string;
  nodeId: string;
  kind: 'text' | 'page';
  label: string;
  text: string;
  path?: string;
  format?: 'html' | 'presentation';
  intent: 'reference' | 'modify';
  requestId?: string;
};
type Handler = (reference: CanvasObjectReference) => void;
/** Read-only, live object preview; never grants modification authority. */
export type CanvasObjectPreview = {
  label: string; text: string; path?: string; format?: 'html' | 'presentation';
  revision?: string; shots?: string[];
};
const previewListeners = new Map<string, Set<() => void>>();
export function subscribeCanvasObjectPreviews(projectId: string, listener: () => void) {
  const listeners = previewListeners.get(projectId) ?? new Set<() => void>();
  listeners.add(listener);
  previewListeners.set(projectId, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) previewListeners.delete(projectId); };
}
export function readCanvasObjectPreview(projectId: string, nodeId: string) {
  return canvases.get(projectId)?.preview?.(nodeId) ?? null;
}
let stager: Handler | null = null;
const navigators = new Map<string, (nodeId: string) => void>();
export function registerCanvasNavigator(projectId: string, navigate: (nodeId: string) => void) {
  navigators.set(projectId, navigate);
  return () => { if (navigators.get(projectId) === navigate) navigators.delete(projectId); };
}
export function revealCanvasObject(projectId: string, nodeId: string) {
  const navigate = navigators.get(projectId);
  if (!navigate) throw new Error(cr().targetCanvasClosed);
  navigate(nodeId);
}
const canvases = new Map<string, {
  preview?: (nodeId: string) => CanvasObjectPreview | null;
  selectedNodeIds?: () => readonly string[];
  read: (nodeId: string) => CanvasObjectReference | null;
  focus: (nodeId: string) => boolean;
  prepare: (reference: CanvasObjectReference, requestId: string) => Promise<void>;
  fail: (nodeId: string, requestId: string, error: string) => void;
}>();
export function setCanvasObjectStager(next: Handler | null) { stager = next; }
export function stageCanvasObject(reference: CanvasObjectReference) {
  if (!stager) throw new Error(cr().canvasNoChat);
  stager(reference);
}
export function registerCanvasObjects(projectId: string, handlers: NonNullable<ReturnType<typeof canvases.get>>) {
  canvases.set(projectId, handlers);
  previewListeners.get(projectId)?.forEach(listener => listener());
  return () => {
    if (canvases.get(projectId) !== handlers) return;
    canvases.delete(projectId);
    previewListeners.get(projectId)?.forEach(listener => listener());
  };
}
export function focusCanvasObject(projectId: string, nodeId: string): boolean {
  return canvases.get(projectId)?.focus(nodeId) ?? false;
}
export function readCanvasObject(projectId: string, nodeId: string) {
  return canvases.get(projectId)?.read(nodeId) ?? null;
}
/** Current supported text/page selections only; image attachments use the existing staging path.
 * Read-only references do not grant write permission or carry a canonical document revision.
 */
export function readCanvasSelection(projectId: string): CanvasObjectReference[] {
  try { if (getCanvasHostContext().projectId !== projectId) return []; } catch { return []; }
  const canvas = canvases.get(projectId);
  if (!canvas) return [];
  return [...new Set(canvas.selectedNodeIds?.() ?? [])].flatMap(nodeId => {
    const reference = canvas.read(nodeId);
    return reference?.projectId === projectId ? [{ ...reference, intent: 'reference' as const }] : [];
  });
}
export function continueCanvasObject(projectId: string, nodeId: string) {
  const reference = readCanvasObject(projectId, nodeId);
  if (!reference) throw new Error(cr().openTargetCanvas);
  stageCanvasObject({ ...reference, intent: 'modify' });
}
export function prepareCanvasObject(reference: CanvasObjectReference, requestId: string) {
  const handlers = canvases.get(reference.projectId);
  if (!handlers) throw new Error(cr().openTargetCanvas2);
  return handlers.prepare(reference, requestId);
}
export function failCanvasObject(reference: CanvasObjectReference, requestId: string, error: string) {
  canvases.get(reference.projectId)?.fail(reference.nodeId, requestId, error);
}
export function canvasObjectReference(projectId: string, node: CanvasBasicNode, intent: CanvasObjectReference['intent']): CanvasObjectReference {
  if (node.kind !== 'text' && node.kind !== 'page') throw new Error(cr().objectNoChatEdit);
  return { projectId, nodeId: node.id, kind: node.kind as 'text' | 'page', label: node.title || cr().canvasObject, text: node.text || '',
    path: node.projectFilePath, format: node.artifactFormat, intent, requestId: node.generation?.requestId };
}
