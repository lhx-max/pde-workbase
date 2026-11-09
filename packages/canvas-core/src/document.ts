import { withCanvasResultHistory } from '@bezier/contracts';
import type { CanvasAssetStore, CanvasItem, DocumentOperation } from './assets.js';
import { CanvasStateError } from './errors.js';

/** HTML/PPT card semantics. The host preserves sibling paths and relative resources. */
export async function prepareCanvasDocument(
  assets: CanvasAssetStore, operationId: string, op: DocumentOperation, current?: CanvasItem,
): Promise<CanvasItem> {
  if (op.type === 'document.begin') {
    if (!current || current.kind !== 'page') throw new CanvasStateError(400, 'CANVAS_OPERATION_UNSUPPORTED', 'Target is not a document');
    if (op.expectedPath !== undefined && (current.projectFilePath || '') !== op.expectedPath)
      throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Document target changed');
    await assets.assertNewDocumentPath(op.outputPath);
    return { ...current, generation: { requestId: op.requestId, status: 'running', previewPath: op.outputPath } };
  }
  if (op.type === 'document.select') {
    if (!current || current.kind !== 'page') throw new CanvasStateError(400, 'CANVAS_OPERATION_UNSUPPORTED', 'Target is not a webpage or presentation');
    if (op.expectedPath !== undefined && current.projectFilePath !== op.expectedPath)
      throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Document target changed');
    if (![current.projectFilePath, ...(Array.isArray(current.resultHistory) ? current.resultHistory.map(v => v.projectFilePath) : [])].includes(op.path))
      throw new CanvasStateError(400, 'CANVAS_INVALID_DOCUMENT', 'Path is not in this card history');
    await assets.readDocument(op.path);
    return withCanvasResultHistory(current, { projectFilePath: op.path, generation: undefined }, ['projectFilePath']);
  }
  let relative: string | undefined;
  if (op.source) {
    const html = 'path' in op.source ? await assets.readDocument(op.source.path) : op.source.html;
    if (new TextEncoder().encode(html).length > 5_000_000)
      throw new CanvasStateError(400, 'CANVAS_INVALID_DOCUMENT', 'HTML exceeds 5 MB');
    if (!html.trim() || !/<(?:html|body|section|div|main|article|!doctype)\b/i.test(html))
      throw new CanvasStateError(400, 'CANVAS_INVALID_DOCUMENT', 'Expected HTML content');
    relative = await assets.putDocument({ html, operationId, nodeId: op.nodeId, format: op.format,
      ...('path' in op.source ? { sourcePath: op.source.path } : {}) });
  }
  return { id: op.nodeId, kind: 'page', artifactFormat: op.format, x: op.x, y: op.y,
    width: op.width || 420, height: op.height || 300, title: op.title || (op.format === 'presentation' ? 'PPT' : '网页'), text: op.prompt || '',
    ...(relative ? { projectFilePath: relative, sourceMime: 'text/html' } : {}) };
}
