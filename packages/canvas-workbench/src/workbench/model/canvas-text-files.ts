import { canvasTextPath } from '@bezier/contracts';
import type { TextDocumentChange } from '../../platform/artifact-bridge';
import type { CanvasBasicNode } from '../BasicCanvasNode';

export function normalizeCanvasProjectFilePath(value: string | undefined): string {
  return String(value || '').replace(/^\.\//u, '').replace(/^\/+/, '').replace(/\\/gu, '/');
}

export function canvasTextFallbackPath(nodeId: string): string {
  return canvasTextPath(nodeId);
}

/** The backing Markdown path is the text asset identity. */
export function canvasTextDocumentPath(node: Pick<CanvasBasicNode, 'id' | 'projectFilePath'>): string {
  return normalizeCanvasProjectFilePath(node.projectFilePath) || canvasTextFallbackPath(node.id);
}

/** A copied text card initially remains another reference to the same asset. */
export function shareCanvasTextForDuplicate(
  source: CanvasBasicNode,
  duplicate: CanvasBasicNode,
): { source: CanvasBasicNode; duplicate: CanvasBasicNode } {
  if (source.kind !== 'text' || duplicate.kind !== 'text') return { source, duplicate };
  const projectFilePath = canvasTextDocumentPath(source);
  return {
    source: normalizeCanvasProjectFilePath(source.projectFilePath) === projectFilePath
      ? source
      : { ...source, projectFilePath },
    duplicate: { ...duplicate, projectFilePath },
  };
}

/**
 * Inline editing is copy-on-write: shared cards stop sharing only when their
 * content diverges. Explicit path changes are already an ownership decision.
 */
export function canvasTextPatchWithCopyOnWrite(
  nodes: readonly CanvasBasicNode[],
  nodeId: string,
  patch: Partial<CanvasBasicNode>,
  forkToken = Date.now().toString(36),
): Partial<CanvasBasicNode> {
  const node = nodes.find(item => item.id === nodeId);
  if (
    node?.kind !== 'text'
    || !Object.prototype.hasOwnProperty.call(patch, 'text')
    || patch.text === node.text
    || Object.prototype.hasOwnProperty.call(patch, 'projectFilePath')
  ) return patch;

  const sharedPath = canvasTextDocumentPath(node);
  const otherPaths = new Set(nodes
    .filter(item => item.kind === 'text' && item.id !== nodeId)
    .map(canvasTextDocumentPath));
  if (!otherPaths.has(sharedPath)) return patch;

  const ownPath = canvasTextFallbackPath(nodeId);
  const projectFilePath = ownPath !== sharedPath && !otherPaths.has(ownPath)
    ? ownPath
    : canvasTextPath(`${nodeId}-edit-${forkToken}`);
  return { ...patch, projectFilePath };
}

/** Editing the shared project document itself updates every live reference. */
export function applyCanvasTextDocumentChange(
  nodes: CanvasBasicNode[],
  change: Pick<TextDocumentChange, 'path' | 'content'>,
): CanvasBasicNode[] {
  const changedPath = normalizeCanvasProjectFilePath(change.path);
  let changed = false;
  const next = nodes.map(node => {
    if (node.kind !== 'text' || canvasTextDocumentPath(node) !== changedPath || (node.text || '') === change.content) return node;
    changed = true;
    return { ...node, text: change.content };
  });
  return changed ? next : nodes;
}
