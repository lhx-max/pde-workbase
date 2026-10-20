import { swatchesFromRgba, type ImageSwatch } from './image-swatches.js';

export type ImageFilePreview = {
  width?: number;
  height?: number;
  size: number;
  colors: ImageSwatch[];
};

/** Decode original bytes the way the save dialog needs file-info, without CORS. */
export async function previewFromImageBytes(bytes: Uint8Array, mime: string): Promise<ImageFilePreview> {
  const size = bytes.byteLength;
  const empty: ImageFilePreview = { size, colors: [] };
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return empty;
    const copy = Uint8Array.from(bytes);
    const blob = new Blob([copy], { type: mime || 'application/octet-stream' });
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    const scale = Math.min(1, 64 / Math.max(width, height, 1));
    const drawWidth = Math.max(1, Math.round(width * scale));
    const drawHeight = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(drawWidth, drawHeight);
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return { width, height, size, colors: [] };
    }
    context.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
    bitmap.close();
    const { data } = context.getImageData(0, 0, drawWidth, drawHeight);
    return { width, height, size, colors: swatchesFromRgba(data) };
  } catch {
    return empty;
  }
}
