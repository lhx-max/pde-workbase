import type { Dispatch, SetStateAction } from 'react';
import type { WorkbenchImage } from './ImageAssetNode';

type ImageEdit = Pick<WorkbenchImage, 'src' | 'path' | 'name' | 'naturalWidth' | 'naturalHeight'>;
type HistoryTransaction = { run: <T>(action: () => T) => T };

/** Local image edits are undoable canvas mutations, not generated candidates.
 * Commit after asynchronous file work finishes: history.run captures only the
 * synchronous mutation. Existing generated history is preserved, never extended.
 */
export function commitCanvasImageEdit(
  history: HistoryTransaction,
  setImages: Dispatch<SetStateAction<WorkbenchImage[]>>,
  id: string,
  patch: ImageEdit,
) {
  history.run(() => setImages(current => current.map(image => image.id === id
    ? { ...image, ...patch, replacementRequestId: undefined }
    : image)));
}
