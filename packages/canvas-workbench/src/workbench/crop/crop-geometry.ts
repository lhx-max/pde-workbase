export type CropRect = { x: number; y: number; width: number; height: number };
export type CropSize = { width: number; height: number };
export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const emptyCrop = (): CropRect => ({ x: 0, y: 0, width: 0, height: 0 });
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const validBounds = (bounds: CropSize): boolean =>
  Number.isFinite(bounds.width) && bounds.width > 0
  && Number.isFinite(bounds.height) && bounds.height > 0;
const validRatio = (ratio: number | null): ratio is number =>
  ratio !== null && Number.isFinite(ratio) && ratio > 0;

/** A unit with its longer side equal to one avoids squaring/overflowing ratios. */
function ratioUnit(ratio: number): CropSize {
  return ratio >= 1 ? { width: 1, height: 1 / ratio } : { width: ratio, height: 1 };
}

/**
 * Solve both sides through one scalar. Prefer a 1px minimum on each side, but
 * bounds and the aspect ratio win when an image/anchor has less room than that.
 */
function lockedSize(available: CropSize, unit: CropSize, requested: number): CropSize {
  const max = Math.min(available.width / unit.width, available.height / unit.height);
  const min = Math.min(max, Math.max(1 / unit.width, 1 / unit.height));
  const length = clamp(requested, min, max);
  return { width: length * unit.width, height: length * unit.height };
}

function positioned(origin: { x: number; y: number }, size: CropSize, bounds: CropSize): CropRect {
  return {
    x: clamp(finite(origin.x), 0, Math.max(0, bounds.width - size.width)),
    y: clamp(finite(origin.y), 0, Math.max(0, bounds.height - size.height)),
    width: size.width,
    height: size.height,
  };
}

function normalized(rect: CropRect, bounds: CropSize, ratio: number | null): CropRect {
  const width = clamp(finite(rect.width, bounds.width), Math.min(1, bounds.width), bounds.width);
  const height = clamp(finite(rect.height, bounds.height), Math.min(1, bounds.height), bounds.height);
  const size = validRatio(ratio)
    ? lockedSize(bounds, ratioUnit(ratio), width / ratioUnit(ratio).width)
    : { width, height };
  return positioned(rect, size, bounds);
}

/** Largest centered crop in natural image coordinates; invalid ratios unlock. */
export function fitCrop(bounds: CropSize, ratio: number | null): CropRect {
  if (!validBounds(bounds)) return emptyCrop();
  const size = validRatio(ratio)
    ? lockedSize(bounds, ratioUnit(ratio), Infinity)
    : { width: bounds.width, height: bounds.height };
  return { x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, ...size };
}

/**
 * Resize from a drag-start rectangle and natural-coordinate deltas. Corners
 * keep the opposite corner; locked corners follow the larger normalized delta.
 * Edges keep the opposite edge, centering the other axis until bounds require
 * translation. Crossing an anchor stops at the minimum rather than flipping.
 * Moving ignores the lock and never resizes an already valid rectangle.
 */
export function resizeCrop(
  rect: CropRect,
  bounds: CropSize,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
): CropRect {
  if (!validBounds(bounds)) return emptyCrop();
  dx = finite(dx);
  dy = finite(dy);
  if (handle === 'move') {
    // Subpixel sides can be valid under a lock; translation must not inflate them.
    const size = {
      width: Math.min(bounds.width, rect.width > 0 ? finite(rect.width, bounds.width) : 1),
      height: Math.min(bounds.height, rect.height > 0 ? finite(rect.height, bounds.height) : 1),
    };
    const start = positioned(rect, size, bounds);
    return positioned({ x: start.x + dx, y: start.y + dy }, size, bounds);
  }
  const start = normalized(rect, bounds, ratio);

  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const horizontal = west || east;
  const vertical = north || south;
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  if (!validRatio(ratio)) {
    const minWidth = Math.min(1, start.width);
    const minHeight = Math.min(1, start.height);
    const x = west ? clamp(start.x + dx, 0, right - minWidth) : start.x;
    const y = north ? clamp(start.y + dy, 0, bottom - minHeight) : start.y;
    const endX = east ? clamp(right + dx, x + minWidth, bounds.width) : right;
    const endY = south ? clamp(bottom + dy, y + minHeight, bounds.height) : bottom;
    return { x, y, width: endX - x, height: endY - y };
  }

  const unit = ratioUnit(ratio);
  const anchorX = west ? right : start.x;
  const anchorY = north ? bottom : start.y;
  const available = {
    width: horizontal ? (west ? anchorX : bounds.width - anchorX) : bounds.width,
    height: vertical ? (north ? anchorY : bounds.height - anchorY) : bounds.height,
  };
  const deltaX = (west ? -dx : dx) / unit.width;
  const deltaY = (north ? -dy : dy) / unit.height;
  const delta = horizontal && vertical
    ? (Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY)
    : horizontal ? deltaX : deltaY;
  const size = lockedSize(available, unit, start.width / unit.width + delta);
  const x = horizontal ? (west ? anchorX - size.width : anchorX) : start.x + (start.width - size.width) / 2;
  const y = vertical ? (north ? anchorY - size.height : anchorY) : start.y + (start.height - size.height) / 2;
  return positioned({ x, y }, size, bounds);
}

/** Edit one dimension, derive the locked companion, then translate only to fit. */
export function setCropDimension(
  rect: CropRect,
  bounds: CropSize,
  axis: 'width' | 'height',
  value: number,
  ratio: number | null,
): CropRect {
  if (!validBounds(bounds)) return emptyCrop();
  const start = normalized(rect, bounds, ratio);
  const requested = finite(value, start[axis]);
  let size: CropSize;
  if (validRatio(ratio)) {
    const unit = ratioUnit(ratio);
    size = lockedSize(bounds, unit, requested / unit[axis]);
  } else {
    size = {
      width: axis === 'width' ? clamp(requested, Math.min(1, bounds.width), bounds.width) : start.width,
      height: axis === 'height' ? clamp(requested, Math.min(1, bounds.height), bounds.height) : start.height,
    };
  }
  return positioned(rect, size, bounds);
}

/**
 * Round crop edges to the nearest export pixel and clamp to whole image pixels.
 * A nonempty image gets at least one pixel on each axis. Integer quantization
 * may approximate the internal ratio; it never changes the floating crop.
 */
export function toPixelCrop(rect: CropRect, bounds: CropSize): CropRect {
  if (!validBounds(bounds)) return emptyCrop();
  const width = Math.floor(bounds.width);
  const height = Math.floor(bounds.height);
  if (width < 1 || height < 1) return emptyCrop();
  const left = finite(rect.x);
  const top = finite(rect.y);
  const x = clamp(Math.round(left), 0, width - 1);
  const y = clamp(Math.round(top), 0, height - 1);
  const right = clamp(Math.round(left + Math.max(0, finite(rect.width, 1))), x + 1, width);
  const bottom = clamp(Math.round(top + Math.max(0, finite(rect.height, 1))), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}
