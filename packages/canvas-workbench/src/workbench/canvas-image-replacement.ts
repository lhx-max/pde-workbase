import { withCanvasResultHistory } from '@bezier/contracts';
import type { WorkbenchImage } from './ImageAssetNode';

/** Settle already accepted legacy tasks; new image requests use connected child nodes. */
export function applyCanvasImageReplacement(
  images: WorkbenchImage[],
  target: { imageId: string; requestId: string },
  completed: Array<{ path: string; src: string; naturalWidth?: number; naturalHeight?: number }>,
): WorkbenchImage[] {
  return images.map(image => {
    if (image.id !== target.imageId || image.replacementRequestId !== target.requestId) return image;
    let next = image;
    for (const result of completed) {
      // Replayed deliveries must not switch the user's currently selected version.
      if (!result.path || next.resultHistory?.some(snapshot => snapshot.path === result.path)) continue;
      next = withCanvasResultHistory(next, { ...result, status: 'ready' as const, error: undefined },
        ['path', 'src', 'naturalWidth', 'naturalHeight']);
    }
    return next;
  });
}
