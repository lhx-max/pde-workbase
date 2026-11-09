import sharp from 'sharp';
import { CanvasStateError, type CanvasImageProcessor } from '@bezier/canvas-core';

const invalid = (message: string): never => { throw new CanvasStateError(400, 'CANVAS_INVALID_IMAGE', message); };

/** Shared sharp pipeline: decode/normalize → optional crop → optional rotate → PNG. */
export const sharpCanvasImageProcessor: CanvasImageProcessor = {
  async process(bytes, operation) {
    if (bytes.length > 40 * 1024 * 1024) invalid('Image exceeds 40 MB');
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
      if (!['png', 'jpeg', 'webp', 'avif', 'heif', 'tiff', 'gif'].includes(metadata.format || '') || (metadata.pages || 1) > 1)
        invalid('Only still raster images are supported');
      const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
      let pipeline = sharp(normalized.data, { limitInputPixels: 40_000_000 });
      if (operation.type === 'image.transform') {
        if (!operation.crop && !operation.rotate) invalid('Provide crop or rotate');
        if (operation.crop) {
          if (operation.crop.x + operation.crop.width > normalized.info.width || operation.crop.y + operation.crop.height > normalized.info.height)
            invalid('Crop exceeds image bounds');
          pipeline = pipeline.extract({ left: operation.crop.x, top: operation.crop.y, width: operation.crop.width, height: operation.crop.height });
        }
        if (operation.rotate) pipeline = pipeline.rotate(operation.rotate);
      }
      const result = await pipeline.png().toBuffer({ resolveWithObject: true });
      return { bytes: new Uint8Array(result.data), width: result.info.width, height: result.info.height };
    } catch (error) {
      if (error instanceof CanvasStateError) throw error;
      return invalid('Image could not be decoded or processed');
    }
  },
};
