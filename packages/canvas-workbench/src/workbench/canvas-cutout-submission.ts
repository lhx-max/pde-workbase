import { apiErrorMessage } from '../platform/api-base';
import type { WorkbenchImage } from './ImageAssetNode';
import { cr } from '../locales/canvas-remainder';

/** A rejected submission only clears markers belonging to that exact attempt.
 * Source pixels/history and newer attempts or delivered results stay intact. */
export function failCanvasCutout(
  images: WorkbenchImage[],
  attempt: { sourceId: string; derivativeId: string; taskId: string },
  error: string,
): WorkbenchImage[] {
  return images.map(image => {
    if (image.id === attempt.derivativeId && image.taskId === attempt.taskId
      && image.cutoutTaskId === attempt.taskId && image.status === 'generating' && !image.path) {
      return { ...image, status: 'failed', error, cutoutTaskId: undefined };
    }
    if (image.id === attempt.sourceId && image.cutoutTaskId === attempt.taskId) {
      return { ...image, cutoutTaskId: undefined };
    }
    return image;
  });
}

/** Persist before submission; never apply an old project's async outcome to the
 * active canvas. Capability/auth rejections remain the daemon's exact error. */
export async function submitCanvasCutout(port: {
  isCurrent: () => boolean;
  stage: () => void;
  flush: () => Promise<unknown>;
  exists: () => boolean;
  submit: () => Promise<Response>;
  accepted: () => void;
  failed: (message: string) => void;
}): Promise<void> {
  if (!port.isCurrent()) return;
  try {
    port.stage();
    await port.flush();
    if (!port.isCurrent() || !port.exists()) return;
    const response = await port.submit();
    const payload = await response.json().catch(() => null) as { taskId?: unknown; error?: unknown } | null;
    if (!port.isCurrent()) return;
    if (!response.ok || typeof payload?.taskId !== 'string' || !payload.taskId) {
      throw new Error(apiErrorMessage(payload?.error, cr().cutoutHttpFail(response.status)));
    }
    port.accepted();
  } catch (error) {
    if (port.isCurrent()) port.failed(error instanceof Error ? error.message : cr().cutoutFail);
  }
}
