import { CANVAS_IMAGE_CONTENT_KEYS, withCanvasResultHistory } from '@bezier/contracts';
import type { CanvasAssetStore, CanvasImageProcessor, CanvasItem, ImageOperation } from './assets.js';
import { CanvasStateError } from './errors.js';

const invalid = (message: string): never => { throw new CanvasStateError(400, 'CANVAS_INVALID_IMAGE', message); };

/** Image selection/version semantics; codec and immutable storage are host ports. */
export async function prepareCanvasImage(
  assets: CanvasAssetStore, processor: CanvasImageProcessor, operationId: string,
  op: ImageOperation, current?: CanvasItem,
): Promise<CanvasItem> {
  if ('expectedPath' in op && op.expectedPath !== undefined && op.expectedPath !== current?.path)
    throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Selected image version has changed');
  let bytes: Uint8Array, name: string, sourceAsset: unknown;
  if (op.type === 'image.attach' || op.type === 'image.replace') {
    if ('assetId' in op.source) {
      ({ bytes, name, sourceAsset } = await assets.readAssetImage(op.source.assetId, op.source.versionId));
    } else {
      bytes = await assets.readImage(op.source.path);
      name = op.source.path.split('/').at(-1)!;
    }
  } else {
    if (!current?.path) return invalid('Image has no saved content');
    const history = Array.isArray(current.resultHistory) ? current.resultHistory : [];
    if (op.type === 'image.select' && ![current.path, ...history.map(v => v.path)].includes(op.path))
      invalid('Result is not a version of this image');
    bytes = await assets.readImage(String(op.type === 'image.select' ? op.path : current.path));
    name = String(current.name || 'image.png');
    const selected = op.type === 'image.select' && op.path !== current.path ? history.find(v => v.path === op.path) : current;
    sourceAsset = selected?.sourceAsset;
    if (selected?.name) name = String(selected.name);
  }
  if (bytes.length > 40 * 1024 * 1024) invalid('Image exceeds 40 MB');
  const output = await processor.process(bytes, op);
  const stored = await assets.putImage(output.bytes);
  const patch = {
    ...stored, name: op.type === 'image.attach' && op.name ? op.name : name,
    naturalWidth: output.width, naturalHeight: output.height, status: 'ready',
    error: undefined, sourceAsset, replacementRequestId: operationId,
  };
  const node = op.type === 'image.attach' ? { id: op.nodeId, x: op.x, y: op.y, assetKind: 'uploaded' } : current!;
  return withCanvasResultHistory(node, patch, CANVAS_IMAGE_CONTENT_KEYS);
}
