import { useT } from '../../i18n';
import { useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import type { WorkspaceCollabContext } from '@bezier/contracts';
import type { ProjectFile } from '../../types';
import { Button } from '../ui';
import { Icon } from '../Icon';
import { SketchPreview } from '../SketchPreview';
import { serializeExcalidrawSketchScene, type ExcalidrawSketchScene } from '../sketch-model';
import { sketchPreviewChannel, sketchPreviewKey } from '../../state/sketch-preview-channel';
import styles from './CanvasSketchCard.module.css';

/** Preview only: editing and saving remain owned by FileWorkspace's sketch TAB. */
export function CanvasSketchCard({ path, projectId, selected, file, scene, workspaceContext, onOpen, previewScope = 'local' }: {
  previewScope?: string;
  path: string;
  projectId: string;
  selected: boolean;
  file?: ProjectFile;
  scene?: ExcalidrawSketchScene;
  workspaceContext?: WorkspaceCollabContext | null;
  onOpen: (path: string) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const opening = useRef(false);
  const key = sketchPreviewKey(previewScope, projectId, path);
  const live = useSyncExternalStore(
    useCallback(listener => sketchPreviewChannel.subscribe(key, listener), [key]),
    () => sketchPreviewChannel.read(key),
    () => undefined,
  );
  const sourceText = useMemo(() => scene ? serializeExcalidrawSketchScene(scene, path) : undefined, [scene, path]);
  async function open() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError('');
    try { await onOpen(path); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('canvas.sketch.openFailed')); }
    finally { opening.current = false; setBusy(false); }
  }
  return <div className={styles.card} onDoubleClick={event => { event.stopPropagation(); void open(); }}>
    {file || scene || live !== undefined ? <SketchPreview identityScope={previewScope} projectId={projectId} file={file || { kind: 'sketch', name: path, mtime: 0 }} sourceText={live ?? sourceText} workspaceContext={workspaceContext} className={styles.preview} /> :
      <div className={styles.empty}><Icon name="pencil" size={32} /><span>{t('canvas.sketch.empty')}</span></div>}
    {selected && <Button variant="default" size="sm" className={`${styles.edit} nodrag nopan`} disabled={busy} onClick={() => void open()}><Icon name="pencil" size={14} />{busy ? t('canvas.sketch.opening') : t('canvas.sketch.edit')}</Button>}
    {error && <div className={`${styles.error} nodrag`} role="alert">{error}</div>}
  </div>;
}
