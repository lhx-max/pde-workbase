/** Geometry for the image-save capsule hover zone. Pure — no DOM. */

export interface HoverRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Keep the picture itself tight: leaving the photo must hide the capsule. */
export const IMAGE_HOVER_PAD = 0;
/** Slop around the capsule so the last pixels before click still count. */
export const CAPSULE_HOVER_PAD = 16;
/**
 * If viewport clamping parks the capsule just outside the photo, allow a
 * short corridor only as wide as the capsule — not a pad around the whole
 * image.
 */
export const HOVER_BRIDGE_MAX_GAP = 80;

export function pointInRect(x: number, y: number, rect: HoverRect, pad = 0): boolean {
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

export function inImageHoverZone(
  x: number,
  y: number,
  image: HoverRect,
  capsule: HoverRect | null,
): boolean {
  if (pointInRect(x, y, image, IMAGE_HOVER_PAD)) return true;
  if (capsule && pointInRect(x, y, capsule, CAPSULE_HOVER_PAD)) return true;
  if (capsule && inCapsuleCorridor(x, y, image, capsule)) return true;
  return false;
}

/** Capsule-sized strip between the photo and a clamped button. */
export function inCapsuleCorridor(x: number, y: number, image: HoverRect, capsule: HoverRect): boolean {
  const gapX = Math.max(0, image.left - capsule.right, capsule.left - image.right);
  const gapY = Math.max(0, image.top - capsule.bottom, capsule.top - image.bottom);
  if (gapX === 0 && gapY === 0) return false;
  if (gapX > HOVER_BRIDGE_MAX_GAP || gapY > HOVER_BRIDGE_MAX_GAP) return false;

  const capLeft = capsule.left - CAPSULE_HOVER_PAD;
  const capRight = capsule.right + CAPSULE_HOVER_PAD;
  const capTop = capsule.top - CAPSULE_HOVER_PAD;
  const capBottom = capsule.bottom + CAPSULE_HOVER_PAD;

  if (gapY > 0) {
    if (capsule.bottom <= image.top) {
      if (x >= capLeft && x <= capRight && y >= capTop && y <= image.top) return true;
    } else if (capsule.top >= image.bottom) {
      if (x >= capLeft && x <= capRight && y >= image.bottom && y <= capBottom) return true;
    }
  }

  if (gapX > 0) {
    if (capsule.right <= image.left) {
      if (y >= capTop && y <= capBottom && x >= capLeft && x <= image.left) return true;
    } else if (capsule.left >= image.right) {
      if (y >= capTop && y <= capBottom && x >= image.right && x <= capRight) return true;
    }
  }

  return false;
}
