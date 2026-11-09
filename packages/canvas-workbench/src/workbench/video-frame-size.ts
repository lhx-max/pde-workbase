export const VIDEO_FRAME_HEIGHT = 360;

export const VIDEO_FRAME_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 360, height: VIDEO_FRAME_HEIGHT },
  '3:4': { width: 270, height: VIDEO_FRAME_HEIGHT },
  '4:3': { width: 480, height: VIDEO_FRAME_HEIGHT },
  '9:16': { width: 203, height: VIDEO_FRAME_HEIGHT },
  '16:9': { width: 640, height: VIDEO_FRAME_HEIGHT },
};

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.round(Math.abs(left));
  let b = Math.round(Math.abs(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Return the exact reduced ratio stored on the connected source image. */
export function imageAspectFromDimensions(width?: number, height?: number): string | undefined {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

const LEGACY_VIDEO_FRAME_SIZES = [
  { width: 320, height: 320 },
  { width: 420, height: 315 },
  { width: 420, height: 236 },
  { width: 460, height: 560 },
  { width: 440, height: 520 },
  { width: 420, height: 440 },
];

export function getVideoFrameSize(aspect = '16:9') {
  return VIDEO_FRAME_SIZES[aspect] ?? VIDEO_FRAME_SIZES['16:9']!;
}

export function isLegacyVideoFrameSize(width?: number, height?: number) {
  if (!width || !height) return true;
  return LEGACY_VIDEO_FRAME_SIZES.some(size => size.width === width && size.height === height);
}

export function resolveVideoFrameSize(width?: number, height?: number, aspect = '16:9') {
  return isLegacyVideoFrameSize(width, height) ? getVideoFrameSize(aspect) : { width: width!, height: height! };
}
