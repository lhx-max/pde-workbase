import { toPixelCrop, type CropRect, type CropSize } from './crop-geometry';

export class CropExportError extends Error {
  constructor(public readonly stage: 'load' | 'export') { super(`Crop ${stage} failed`); }
}

/** Load the original, never the displayed thumbnail. Cancellation prevents a stale editor from saving. */
export async function exportCrop(src: string, name: string, rect: CropRect, bounds: CropSize, signal: AbortSignal) {
  signal.throwIfAborted();
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    const clean = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); image.src = ''; reject(signal.reason); };
    image.onload = () => { clean(); resolve(); };
    image.onerror = () => { clean(); reject(new CropExportError('load')); };
    signal.addEventListener('abort', abort, { once: true });
    image.src = src;
  });
  signal.throwIfAborted();
  if (!image.naturalWidth || !image.naturalHeight || bounds.width <= 0 || bounds.height <= 0) throw new CropExportError('load');
  // The UI waits for original-image decoding. Never stretch a crop from stale metadata:
  // if the source changed between preview and export, fail rather than silently change its aspect.
  if (image.naturalWidth !== bounds.width || image.naturalHeight !== bounds.height) throw new CropExportError('load');
  const crop = toPixelCrop(rect, bounds);
  const canvas = document.createElement('canvas');
  canvas.width = crop.width; canvas.height = crop.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new CropExportError('export');
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    signal.throwIfAborted();
    if (!blob) throw new CropExportError('export');
    const base = name.replace(/\.[^.]+$/, '') || 'image';
    return { file: new File([blob], `${base}-cropped.png`, { type: 'image/png' }), meta: { width: crop.width, height: crop.height } };
  } finally {
    // Release potentially large backing stores after PNG encoding (also on failure).
    canvas.width = 0; canvas.height = 0;
  }
}
