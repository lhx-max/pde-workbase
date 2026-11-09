import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectFile, WorkspaceCollabContext } from '@bezier/contracts';
import { SketchEditor } from '../SketchEditor';
import { readSketchWorkspaceDocument, serializeExcalidrawSketchScene, type ExcalidrawSketchScene, type ParsedSketchWorkspaceDocument } from '../sketch-model';
import { fetchProjectFileText, writeProjectTextFile, writeProjectBase64File } from '../../providers/registry';
import { useT } from '../../i18n';

interface Props {
  projectId: string;
  file: ProjectFile;
  workspaceContext?: WorkspaceCollabContext | null;
  onRefreshFiles: () => Promise<void>;
  onOpenFile: (name: string) => void;
  onRename: (from: string, to: string) => Promise<ProjectFile | null>;
  onDirtyChange: (dirty: boolean) => void;
  registerFlush: (flush: (() => Promise<boolean>) | null) => void;
}
interface SketchState {
  document: ParsedSketchWorkspaceDocument | null;
  scene: ExcalidrawSketchScene | null;
  sourceKey?: string;
  hydrationKey?: string;
  revision: number;
  dirty: boolean;
  saving: boolean;
  savedAt?: number;
  loadError: boolean;
  error: string;
}

// Adapted from the original FileWorkspace sketch lifecycle: disk identity and
// engine hydration identity are separate, so local-save echoes preserve undo.
function sketchFileSourceKey(projectId: string, file: ProjectFile): string {
  return `${projectId}:${file.path ?? file.name}:${file.size}:${file.mtime}`;
}
function sameSketchDrawing(left: ExcalidrawSketchScene, right: ExcalidrawSketchScene): boolean {
  const content = (scene: ExcalidrawSketchScene) => JSON.stringify({
    elements: scene.elements, files: scene.files,
    background: scene.appState?.viewBackgroundColor ?? '#ffffff',
  });
  return content(left) === content(right);
}

/** Keep pending reads, writes and editor drafts owned by one project document. */
export function SketchWorkspaceTab(props: Props) {
  return <SketchWorkspaceSession key={`${props.projectId}:${props.file.name}:${props.workspaceContext?.workspaceId ?? ''}:${props.workspaceContext?.workspaceMemberId ?? ''}`} {...props} />;
}

function SketchWorkspaceSession({ projectId, file, workspaceContext, onRefreshFiles, onOpenFile, onRename, onDirtyChange, registerFlush }: Props) {
  const t = useT();
  const [state, setState] = useState<SketchState>({ document: null, scene: null, revision: 0, dirty: false, saving: false, loadError: false, error: '' });
  const current = useRef(state);
  const mounted = useRef(true);
  const lastSaved = useRef('');
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pendingReads = useRef(new Map<string, Promise<ParsedSketchWorkspaceDocument>>());
  const latestLoadSource = useRef('');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onRefreshFiles, onDirtyChange });
  callbacks.current = { onRefreshFiles, onDirtyChange };
  const sourceKey = sketchFileSourceKey(projectId, file);

  const update = useCallback((patch: Partial<SketchState>) => {
    const previous = current.current;
    current.current = { ...previous, ...patch };
    if (mounted.current) {
      setState(current.current);
      if (previous.dirty !== current.current.dirty) callbacks.current.onDirtyChange(current.current.dirty);
    }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    latestLoadSource.current = sourceKey;
    const startedRevision = current.current.revision;
    const protectedScene = () => current.current.dirty || current.current.saving || !!inFlight.current;
    if (protectedScene() || (current.current.document && !current.current.loadError && current.current.sourceKey === sourceKey)) return;
    let pending = pendingReads.current.get(sourceKey);
    if (!pending) {
      pending = fetchProjectFileText(projectId, file.name, { workspaceContext }).then(readSketchWorkspaceDocument);
      pendingReads.current.set(sourceKey, pending);
    }
    const canApply = () => !cancelled && mounted.current && latestLoadSource.current === sourceKey
      && current.current.revision === startedRevision && !protectedScene();
    void pending.then(document => {
      if (!canApply()) return;
      const previous = current.current;
      if (previous.document?.version === 2 && document.version === 2 && previous.scene
        && sameSketchDrawing(previous.scene, document.scene)) {
        // Selection, viewport and tools are not drawing edits. Do not replace
        // the scene object or engine key on a metadata-only/local-save echo.
        update({ sourceKey, loadError: false, error: '' });
        return;
      }
      lastSaved.current = serializeExcalidrawSketchScene(document.scene, file.name);
      update({ document, scene: document.scene, sourceKey, hydrationKey: sourceKey, revision: 0, dirty: false, loadError: false, error: '' });
    }).catch(cause => {
      if (canApply()) update({ loadError: true, error: cause instanceof Error ? cause.message : String(cause) });
    }).finally(() => {
      if (pendingReads.current.get(sourceKey) === pending) pendingReads.current.delete(sourceKey);
    });
    return () => { cancelled = true; };
  }, [projectId, file, sourceKey, workspaceContext, state.dirty, state.saving, update]);

  const save = useCallback(async (next?: ExcalidrawSketchScene): Promise<boolean> => {
    if (!current.current.document || !current.current.scene || current.current.loadError) return false;
    if (autosaveTimer.current !== null) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
    if (next) update({ scene: next, revision: current.current.revision + 1, dirty: true });
    if (inFlight.current) return inFlight.current;
    if (!current.current.dirty) return true;
    update({ saving: true, error: '' });
    // Assign the promise before any branch can finish synchronously. Every
    // flush waiter observes the same drain, including edits made during a write.
    const work = Promise.resolve().then(async () => {
      try {
        while (current.current.dirty && current.current.scene) {
          const { scene, revision } = current.current;
          const content = serializeExcalidrawSketchScene(scene, file.name);
          if (content === lastSaved.current) { update({ dirty: false, error: '' }); break; }
          const saved = await writeProjectTextFile(projectId, file.name, content, undefined, workspaceContext);
          if (!saved) throw new Error(t('workspace.file.sketchCreateFailed'));
          lastSaved.current = content;
          const stillCurrent = current.current.revision === revision;
          update({
            sourceKey: sketchFileSourceKey(projectId, saved), error: '',
            ...(stillCurrent ? {
              dirty: false, savedAt: Date.now(),
              document: { version: 2, items: [], rawItems: [], scene, format: 'excalidraw' },
            } : {}),
          });
          try { await callbacks.current.onRefreshFiles(); }
          catch (cause) { console.warn('[SketchWorkspaceTab] saved sketch, but refresh failed', cause); }
        }
        return true;
      } catch (cause) {
        update({ dirty: true, error: cause instanceof Error ? cause.message : String(cause) });
        return false;
      } finally {
        inFlight.current = null;
        update({ saving: false });
      }
    });
    inFlight.current = work;
    return work;
  }, [projectId, file.name, workspaceContext, t, update]);

  useEffect(() => { registerFlush(save); return () => registerFlush(null); }, [registerFlush, save]);
  useEffect(() => {
    if (!state.dirty) return;
    autosaveTimer.current = setTimeout(() => { autosaveTimer.current = null; void save(); }, 700);
    return () => { if (autosaveTimer.current !== null) clearTimeout(autosaveTimer.current); autosaveTimer.current = null; };
  }, [state.revision, state.dirty, save]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current.dirty || current.current.saving) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);

  if (!state.document || !state.scene || state.loadError) return <div className="viewer-empty" role={state.error ? 'alert' : undefined}>{state.error || t('fileViewer.loading')}</div>;
  return <><SketchEditor
    scene={state.scene} legacyItems={state.document.items}
    hasPreservedRawItems={state.document.rawItems.length > state.document.items.length}
    fileName={file.name} sceneRevision={state.hydrationKey}
    saving={state.saving} dirty={state.dirty} savedAt={state.savedAt} saveError={!!state.error}
    onSceneChange={(scene, options) => {
      if (current.current.loadError) return;
      update({ scene, revision: current.current.revision + 1,
        ...(options?.discardLegacyItems && current.current.document ? { document: { ...current.current.document, items: [], rawItems: [] } } : {}),
        ...(options?.markDirty !== false ? { dirty: true } : {}),
      });
    }}
    onSave={save}
    onRename={async (title, scene) => {
      if (!await save(scene)) return false;
      const dir = file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/') + 1) : '';
      return !!await onRename(file.name, `${dir}${title.replace(/\.(excalidraw|sketch\.json)$/i, '')}.excalidraw`);
    }}
    onExportImage={async (base64, name) => {
      const result = await writeProjectBase64File(projectId, name, base64, workspaceContext);
      if (!result) throw new Error(t('workspace.file.sketchCreateFailed'));
      await onRefreshFiles();
      return { fileName: result.name };
    }}
    onOpenExportedImage={onOpenFile}
  />{state.error && <div className="df-upload-banner" role="alert">{state.error}</div>}</>;
}
