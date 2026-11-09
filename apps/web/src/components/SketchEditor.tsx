import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  exportToBlob,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { useI18n, type Locale } from '../i18n';
import { excalidrawLangCode } from './sketch-locale';
import {
  SKETCH_EMBED_BLOCKED_PHRASES,
  SKETCH_WHITELIST_PHRASES,
  ZH_CN_SKETCH_TEXT_OVERRIDES,
  ZH_TW_SKETCH_TEXT_OVERRIDES,
  SKETCH_INSERT_LABEL,
} from '../i18n/locales/sketch-excalidraw-overrides';
import { Icon } from './Icon';
import { Button, Input } from '@/src/components/ui';
import { createSketchStarter, type SketchStarterKind } from './sketch-starters';
import { sketchReferenceScene, type SketchReferenceRequest, type SketchReferenceScope } from './sketch-reference';
import styles from './SketchEditor.module.css';
import { SketchViewControls } from './SketchViewControls';
import { Toast } from './Toast';
import { readDefaultSketchToolColor } from './sketch-colors';
import { applySketchPropertyTooltips } from './sketch-properties';
import {
  emptySketchScene,
  sanitizeExcalidrawAppState,
  sketchSceneHasContent,
  serializeExcalidrawSketchScene,
  type ExcalidrawSketchScene,
  type SketchItem,
} from './sketch-model';

const EXPORTED_IMAGE_MIME_TYPE = 'image/png';

interface SketchSceneChangeOptions {
  markDirty?: boolean;
  discardLegacyItems?: boolean;
}

interface SketchExportedImageResult {
  fileName: string;
}

type SketchExportImageResult = boolean | void | SketchExportedImageResult;

interface SketchToastState {
  message: string;
  details?: string | null;
  tone: 'default' | 'success' | 'error' | 'loading';
  actionFileName?: string;
}

type SketchTooltipLabelKey =
  | 'lock'
  | 'hand'
  | 'selection'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'
  | 'frame'
  | 'embeddable'
  | 'laser'
  | 'moreTools';

type SketchTooltipLabels = Record<SketchTooltipLabelKey, string>;

interface Props {
  scene: ExcalidrawSketchScene;
  legacyItems?: SketchItem[];
  hasPreservedRawItems?: boolean;
  onSceneChange: (scene: ExcalidrawSketchScene, options?: SketchSceneChangeOptions) => void;
  /** Changes only after loading a new disk scene, never for local save echoes. */
  sceneRevision?: string;
  saveError?: boolean;
  onStageReference?: (request: SketchReferenceRequest) => Promise<void>;
  onRename?: (title: string, scene: ExcalidrawSketchScene) => Promise<boolean>;
  onSave: (scene?: ExcalidrawSketchScene) => Promise<boolean | void> | boolean | void;
  onExportImage?: (
    base64: string,
    fileName: string,
    scene: ExcalidrawSketchScene,
  ) => Promise<SketchExportImageResult> | SketchExportImageResult;
  onOpenExportedImage?: (fileName: string) => void;
  saving?: boolean;
  dirty?: boolean;
  savedAt?: number;
  fileName: string;
}

/** UI drafts and async feedback belong to one document. Switching files must
 * not carry a failed save, dismissed starter, or pending rename into the next
 * editor; local autosave echoes keep the same session and undo history. */
export function SketchEditor(props: Props) {
  return <SketchEditorSession key={`${props.fileName}:${props.sceneRevision ?? 'initial'}`} {...props} />;
}

function SketchEditorSession({
  scene,
  legacyItems = [],
  hasPreservedRawItems = false,
  onSceneChange,
  sceneRevision,
  saveError = false,
  onStageReference,
  onRename,
  onSave,
  onExportImage,
  onOpenExportedImage,
  saving = false,
  dirty = false,
  savedAt,
  fileName,
}: Props) {
  const { t, locale } = useI18n();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [localSaveError, setLocalSaveError] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [emptyDismissed, setEmptyDismissed] = useState(false);
  const [staging, setStaging] = useState(false);
  const stagingRef = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const renamingRef = useRef(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const title = fileName.split('/').pop()?.replace(/\.sketch\.json$/i, '') ?? fileName;
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState(readExcalidrawTheme);
  const [toast, setToast] = useState<SketchToastState | null>(null);
  const onSceneChangeRef = useLatestRef(onSceneChange);
  const onSaveRef = useLatestRef(onSave);
  const onExportImageRef = useLatestRef(onExportImage);
  const onOpenExportedImageRef = useLatestRef(onOpenExportedImage);
  const sceneRef = useLatestRef(scene);
  const fileNameRef = useLatestRef(fileName);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const skipHydrationChangeRef = useRef(true);
  const lastContentSignatureRef = useRef<string | null>(null);
  const editorInstanceKey = `${fileName}:${sceneRevision ?? 'initial'}`;
  const previousEditorInstanceKeyRef = useRef<string | null>(null);
  const initialDataRef = useRef<{
    key: string;
    value: ExcalidrawInitialDataState;
  } | null>(null);

  if (previousEditorInstanceKeyRef.current !== editorInstanceKey) {
    previousEditorInstanceKeyRef.current = editorInstanceKey;
    skipHydrationChangeRef.current = true;
    lastContentSignatureRef.current = null;
  }

  let initialDataEntry = initialDataRef.current;
  if (!initialDataEntry || initialDataEntry.key !== editorInstanceKey) {
    initialDataEntry = {
      key: editorInstanceKey,
      value: buildInitialData(scene, legacyItems, fileName),
    };
    initialDataRef.current = initialDataEntry;
  }
  const initialData = initialDataEntry.value;

  useEffect(() => {
    // React 18 does not model inert as a boolean attribute. Block all engine
    // menus as well as drawing while its file identity is being changed.
    canvasWrapRef.current?.toggleAttribute('inert', renaming);
  }, [renaming]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(readExcalidrawTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => setTheme(readExcalidrawTheme());
    media?.addEventListener('change', handleSystemThemeChange);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    if (savedAt && !dirty && !saving) setLocalSaveError(false);
  }, [dirty, savedAt, saving]);

  const sketchTooltipLabels = useMemo<SketchTooltipLabels>(() => ({
    lock: t('sketch.tooltipLock'),
    hand: t('sketch.tooltipHand'),
    selection: t('sketch.tooltipSelection'),
    rectangle: t('sketch.tooltipRectangle'),
    diamond: t('sketch.tooltipDiamond'),
    ellipse: t('sketch.tooltipEllipse'),
    arrow: t('sketch.tooltipArrow'),
    line: t('sketch.tooltipLine'),
    freedraw: t('sketch.tooltipFreedraw'),
    text: t('sketch.tooltipText'),
    image: t('sketch.tooltipImage'),
    eraser: t('sketch.tooltipEraser'),
    frame: t('sketch.tooltipFrame'),
    embeddable: t('sketch.tooltipEmbeddable'),
    laser: t('sketch.tooltipLaser'),
    moreTools: t('sketch.tooltipMoreTools'),
  }), [t]);

  const closeActiveSketchDialog = useCallback(() => {
    apiRef.current?.updateScene({ appState: { openDialog: null } });
  }, []);

  useEffect(() => {
    const root = canvasWrapRef.current;
    if (!root) return;

    let frame: number | null = null;
    const applyEnhancements = () => {
      frame = null;
      applySketchEditorTooltips(root, sketchTooltipLabels);
      applySketchDomI18nOverrides(root, locale);
      applySketchPropertyTooltips(root);
      applySketchContextMenuSimplification(root, root);
      applySketchContextMenuSimplification(document.body, root);
      rewriteExcalidrawUnableToEmbedToasts(root, sketchTooltipLabels.embeddable);
      rewriteExcalidrawUnableToEmbedToasts(document.body, sketchTooltipLabels.embeddable);
      enhanceSketchExcalidrawPortals(locale, closeActiveSketchDialog);
    };
    const scheduleEnhancements = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(applyEnhancements);
    };
    scheduleEnhancements();

    const observer = new MutationObserver(records => {
      // React replaces native control classes when a property changes. Reapply
      // their tooltip metadata, but ignore unrelated class churn on the canvas.
      if (records.some(record => record.type !== 'attributes' || (
        record.target instanceof Element
        && record.target.matches('button, label, input')
        && record.target.closest('.selected-shape-actions')
      ))) scheduleEnhancements();
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'title', 'aria-label'] });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!document.querySelector('.bezier-sketch-modal .Modal')) return;
      event.preventDefault();
      event.stopPropagation();
      closeActiveSketchDialog();
    };
    const handleCommandEnter = (event: KeyboardEvent) => {
      handleSketchPortalCommandEnter(event);
    };
    document.addEventListener('keydown', handleEscape, true);
    document.addEventListener('keydown', handleCommandEnter, true);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleEscape, true);
      document.removeEventListener('keydown', handleCommandEnter, true);
    };
  }, [closeActiveSketchDialog, locale, sketchTooltipLabels]);

  const handleChange = useCallback<NonNullable<ExcalidrawProps['onChange']>>((elements, appState, files) => {
    setHasSelection(Object.values(appState.selectedElementIds ?? {}).some(Boolean));
    setZoom(appState.zoom?.value ?? 1);
    const contentSignature = sceneContentSignature(elements, appState, files);
    if (skipHydrationChangeRef.current) {
      skipHydrationChangeRef.current = false;
      lastContentSignatureRef.current = contentSignature;
      return;
    }
    if (lastContentSignatureRef.current === contentSignature) return;
    lastContentSignatureRef.current = contentSignature;

    onSceneChangeRef.current(sceneFromExcalidraw(elements, appState, files), {
      markDirty: true,
      discardLegacyItems: true,
    });
  }, [onSceneChangeRef]);

  const currentScene = useCallback((): ExcalidrawSketchScene => {
    const api = apiRef.current;
    if (!api) return sceneRef.current;
    return sceneFromExcalidraw(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
      api.getFiles(),
    );
  }, [sceneRef]);

  // Normal edits are autosaved by FileWorkspace; explicit writes are only a
  // recovery action after failure, using the engine's latest scene snapshot.
  const handleRetrySave = useCallback(async () => {
    if (renamingRef.current) return;
    let ok: boolean | void;
    try {
      ok = await onSaveRef.current(currentScene());
    } catch {
      ok = false;
    }
    if (ok === false) {
      setLocalSaveError(true);
      return;
    }
    setLocalSaveError(false);
    setToast({ message: t('sketch.saved'), tone: 'success' });
  }, [currentScene, onSaveRef, t]);

  const handleStarter = (kind: SketchStarterKind) => {
    const api = apiRef.current;
    if (!api || renamingRef.current || api.getSceneElementsIncludingDeleted().some(element => !element.isDeleted)) return;
    const starter = createSketchStarter(kind, {
      screen: t('sketch.starterScreen'), start: t('sketch.starterStart'), step: t('sketch.starterStep'),
      end: t('sketch.starterEnd'), topic: t('sketch.starterTopic'), branch: t('sketch.starterBranch'),
    }, readDefaultSketchToolColor());
    const elements = [...api.getSceneElementsIncludingDeleted(), ...starter.elements] as OrderedExcalidrawElement[];
    // The starter is one ordinary edit, not a replacement or a new editor.
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.scrollToContent(elements, { fitToContent: true });
    setEmptyDismissed(true);
  };

  const handleStageReference = async (scope: SketchReferenceScope) => {
    const api = apiRef.current;
    const stage = onStageReference;
    if (!api || !stage || stagingRef.current) return;
    stagingRef.current = true;
    setStaging(true);
    try {
      const selection = scope === 'selection'
        ? new Set(Object.entries(api.getAppState().selectedElementIds ?? {}).filter(([, selected]) => selected).map(([id]) => id))
        : undefined;
      const snapshot = sketchReferenceScene(currentScene(), selection);
      // Editable image objects retain their source pixels, including crop-outs.
      // Make that scope explicit rather than silently sharing hidden image data.
      if (snapshot.elements.some(element => (element as { type?: string }).type === 'image')
        && !window.confirm(t('sketch.referenceImagesConfirm'))) return;
      const sourceName = fileName;
      const stem = `sketch-reference-${crypto.randomUUID()}`;
      const blob = await exportToBlob({
        elements: snapshot.elements as Parameters<typeof exportToBlob>[0]['elements'],
        appState: { ...snapshot.appState, exportBackground: true },
        files: snapshot.files as BinaryFiles, mimeType: 'image/png', exportPadding: 24, maxWidthOrHeight: 1600,
      });
      await stage({ sourceName, scope, elementIds: snapshot.elements.map(element => (element as { id: string }).id), files: [
        new File([blob], `${stem}.png`, { type: 'image/png' }),
        new File([serializeExcalidrawSketchScene(snapshot, stem)], `${stem}.sketch.json`, { type: 'application/json' }),
      ] });
      setToast({ message: t('sketch.referenceStaged'), tone: 'success' });
    } catch {
      setToast({ message: t('sketch.referenceFailed'), tone: 'error' });
    } finally {
      stagingRef.current = false;
      setStaging(false);
    }
  };

  const handleRename = async () => {
    if (!onRename || !titleDraft?.trim() || renamingRef.current) return;
    renamingRef.current = true;
    setRenaming(true);
    try {
      if (!await onRename(titleDraft.trim(), currentScene())) throw new Error('Rename failed');
      setTitleDraft(null);
    } catch {
      setToast({ message: t('sketch.renameFailed'), tone: 'error' });
    } finally {
      renamingRef.current = false;
      setRenaming(false);
    }
  };

  const handleExportImage = useCallback(async () => {
    const exportHandler = onExportImageRef.current;
    if (!exportHandler || exporting) return;
    const exportedScene = currentScene();
    const exportedElements = exportedScene.elements.filter(isNonDeletedExcalidrawElement) as Parameters<typeof exportToBlob>[0]['elements'];
    const exportedAppState = {
      ...sanitizeExcalidrawAppState(exportedScene.appState),
      exportBackground: true,
      viewBackgroundColor: typeof exportedScene.appState?.viewBackgroundColor === 'string'
        ? exportedScene.appState.viewBackgroundColor
        : '#ffffff',
    } as Parameters<typeof exportToBlob>[0]['appState'];
    setExporting(true);
    try {
      const blob = await exportToBlob({
        elements: exportedElements,
        appState: exportedAppState,
        files: exportedScene.files as Parameters<typeof exportToBlob>[0]['files'],
        mimeType: EXPORTED_IMAGE_MIME_TYPE,
        exportPadding: 16,
      });
      const base64 = await blobToBase64(blob);
      const requestedFileName = exportedImageFileName(fileNameRef.current);
      const result = await exportHandler(base64, requestedFileName, exportedScene);
      if (result === false) return;
      const savedFileName = exportedImageResultFileName(result, requestedFileName);
      setToast({
        message: t('fileViewer.exportImageSaved'),
        details: savedFileName,
        tone: 'success',
        actionFileName: savedFileName,
      });
    } catch (err) {
      console.warn('[SketchEditor] export image failed', err);
      alert(t('common.exportImageFailed'));
    } finally {
      setExporting(false);
    }
  }, [currentScene, exporting, fileNameRef, onExportImageRef, t]);

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  const unsaved = dirty || saveError || localSaveError;
  const saveState = saving ? 'saving' : unsaved ? 'dirty' : 'saved';
  const saveLabel = saving ? t('sketch.saving') : unsaved ? t('sketch.tooltipDirty') : t('sketch.saved');

  const excalidrawUIOptions = useMemo<ExcalidrawProps['UIOptions']>(() => ({
    canvasActions: {
      clearCanvas: false,
      changeViewBackgroundColor: false,
      saveToActiveFile: false,
      loadScene: false,
      toggleTheme: false,
      saveAsImage: false,
      export: false,
    },
    tools: {
      image: true,
    },
  }), []);

  const hasContent = sketchSceneHasContent(scene) || legacyItems.length > 0 || hasPreservedRawItems;

  return (
    <div className={`sketch-editor ${styles.editor}`}>
      <header className={styles.header} data-testid="sketch-header">
        {titleDraft !== null ? <form className={styles.titleForm} onSubmit={event => { event.preventDefault(); void handleRename(); }}>
          <Input autoFocus aria-label={t('sketch.title')} value={titleDraft} disabled={renaming}
            onChange={event => setTitleDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape' && !renaming) setTitleDraft(null); }} />
          <Button size="sm" variant="ghost" type="submit" disabled={renaming || !titleDraft.trim()}>{t('common.save')}</Button>
          <Button size="sm" variant="ghost" type="button" disabled={renaming} onClick={() => setTitleDraft(null)}>{t('common.cancel')}</Button>
        </form> : <Button variant="ghost" size="sm" className={styles.title} title={fileName}
          disabled={!onRename || staging} onClick={() => setTitleDraft(title)} aria-label={t('sketch.renameTitle', { title })}>
          <Icon name="edit" size={14} /><span>{title}</span>
        </Button>}
        <span className={styles.saveState} data-state={saveState} data-testid="sketch-save-state" role="status" aria-live="polite">
          <Icon name={saving ? 'spinner' : unsaved ? 'alert-triangle' : 'check'} size={12} className={saving ? 'icon-spin' : undefined} />
          {saveLabel}
        </span>
        <div className={styles.actions}>
          {onExportImage && <Button size="sm" variant="ghost" data-testid="sketch-export-image" disabled={exporting || !hasContent || renaming}
            onClick={() => void handleExportImage()}><Icon name="download" size={14} />{t('common.exportImage')}</Button>}
          {onStageReference && <Button size="sm" variant="ghost" disabled={staging || !hasContent || renaming}
            onClick={() => void handleStageReference(hasSelection ? 'selection' : 'scene')}>
            <Icon name={staging ? 'spinner' : 'comment'} size={14} />{t(hasSelection ? 'sketch.referenceSelection' : 'sketch.referenceScene')}
          </Button>}
          <span className={styles.divider} aria-hidden />
          <Button size="sm" variant="ghost" disabled={renaming} onClick={() => apiRef.current?.updateScene({ appState: { openDialog: { name: 'help' } } })}>
            <Icon name="help-circle" size={15} />{t('sketch.help')}
          </Button>
        </div>
      </header>
      {(saveError || localSaveError) && <div className={styles.error} role="alert">
        <span>{t('sketch.saveFailed')}</span>
        <Button variant="ghost" size="sm" disabled={saving} onClick={() => void handleRetrySave()}>{t('sketch.retrySave')}</Button>
      </div>}
      <div ref={canvasWrapRef} className="sketch-canvas-wrap sketch-excalidraw-wrap" data-testid="sketch-excalidraw-editor"
        onKeyDownCapture={event => {
          // Do not let the vendor shortcut reopen the removed canvas finder.
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            event.stopPropagation();
          }
        }}>
        <Excalidraw
          key={editorInstanceKey}
          initialData={initialData}
          excalidrawAPI={handleExcalidrawAPI}
          onChange={handleChange}
          langCode={excalidrawLangCode(locale)}
          theme={theme}
          detectScroll={false}
          handleKeyboardGlobally={false}
          autoFocus
          viewModeEnabled={renaming}
          name={fileName}
          UIOptions={excalidrawUIOptions}
          validateEmbeddable={validateSketchEmbeddableUrl}
        >
          {/* Suppress the engine's default action list. Its fixed trigger and
              footer help are removed by the scoped third-party CSS adapter. */}
          <MainMenu />
        </Excalidraw>
        <SketchViewControls apiRef={apiRef} canvasRef={canvasWrapRef} zoom={zoom} disabled={renaming} />
        {!hasContent && !emptyDismissed && <div className={styles.empty}>
          <h2>{t('sketch.emptyTitle')}</h2>
          <p>{t('sketch.emptyHint')}</p>
          <div className={styles.starters}>
            {(['wireframe', 'flowchart', 'structure'] as const).map(kind => <Button key={kind} variant="ghost" size="sm"
              disabled={renaming} onClick={() => handleStarter(kind)}>{t(`sketch.starter.${kind}`)}</Button>)}
            <Button variant="ghost" size="sm" disabled={renaming} onClick={() => {
              setEmptyDismissed(true);
              apiRef.current?.setActiveTool({ type: 'freedraw' });
            }}>{t('sketch.starter.free')}</Button>
          </div>
        </div>}
      </div>
      {toast ? (
        <Toast
          message={toast.message}
          details={toast.details}
          tone={toast.tone}
          ttlMs={toast.actionFileName ? 5000 : 2200}
          actionLabel={toast.actionFileName ? t('workspace.openFile') : undefined}
          onAction={toast.actionFileName ? () => {
            const fileNameToOpen = toast.actionFileName;
            if (!fileNameToOpen) return;
            onOpenExportedImageRef.current?.(fileNameToOpen);
            setToast(null);
          } : undefined}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

function buildInitialData(
  scene: ExcalidrawSketchScene,
  legacyItems: SketchItem[],
  fileName: string,
): ExcalidrawInitialDataState {
  const convertedLegacyElements = legacyItems.length > 0
    ? convertLegacySketchItemsToExcalidrawElements(legacyItems)
    : null;
  const initialElements = convertedLegacyElements ?? scene.elements;
  return {
    elements: initialElements as ExcalidrawInitialDataState['elements'],
    appState: {
      ...sanitizeExcalidrawAppState(scene.appState),
      name: fileName,
      currentItemStrokeColor: readDefaultSketchToolColor(),
      viewBackgroundColor: typeof scene.appState?.viewBackgroundColor === 'string'
        ? scene.appState.viewBackgroundColor
        : '#ffffff',
    } as ExcalidrawInitialDataState['appState'],
    files: scene.files as ExcalidrawInitialDataState['files'],
    scrollToContent: initialElements.length > 0,
  };
}

function sceneFromExcalidraw(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): ExcalidrawSketchScene {
  return {
    elements: cloneJson<unknown[]>(elements, []),
    appState: sanitizeExcalidrawAppState(cloneJson<Record<string, unknown> | null>(appState as unknown, null)),
    files: cloneJson<Record<string, unknown>>(files, {}),
  };
}

function isNonDeletedExcalidrawElement(element: unknown): boolean {
  return Boolean(
    element &&
    typeof element === 'object' &&
    (element as { isDeleted?: unknown }).isDeleted !== true,
  );
}

function exportedImageFileName(fileName: string): string {
  const slash = fileName.lastIndexOf('/');
  const baseName = slash >= 0 ? fileName.slice(slash + 1) : fileName;
  const stem = baseName.replace(/\.sketch\.json$/i, '') || 'sketch';
  return `${stem}.png`;
}

function exportedImageResultFileName(result: SketchExportImageResult, fallback: string): string {
  if (result && typeof result === 'object' && typeof result.fileName === 'string') {
    return result.fileName;
  }
  return fallback;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read exported image'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function sceneContentSignature(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): string {
  const elementSignature = elements.map((element) => {
    if (typeof element.version === 'number') {
      return [
        element.id,
        element.version,
        element.versionNonce,
        element.isDeleted ? 1 : 0,
      ].join(':');
    }
    return stableJsonStringify(element);
  }).join('|');
  const fileSignature = Object.keys(files).sort().map((id) => {
    const file = files[id];
    if (!file || typeof file !== 'object') return id;
    const record = file as Record<string, unknown>;
    const dataURL = record.dataURL;
    return [
      id,
      record.mimeType ?? '',
      record.created ?? '',
      typeof dataURL === 'string' ? dataURL.length : 0,
    ].join(':');
  }).join('|');
  const viewBackgroundColor = typeof appState.viewBackgroundColor === 'string'
    ? appState.viewBackgroundColor
    : '';
  return `${elementSignature}\n${fileSignature}\n${viewBackgroundColor}`;
}

function stableJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(value));
  } catch {
    return '';
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = sortJsonValue(record[key]);
    return acc;
  }, {});
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function convertLegacySketchItemsToExcalidrawElements(items: SketchItem[]): unknown[] {
  const skeletons: unknown[] = [];
  for (const item of items) {
    if (item.kind === 'rect') {
      const x = Math.min(item.x, item.x + item.w);
      const y = Math.min(item.y, item.y + item.h);
      skeletons.push({
        type: 'rectangle',
        x,
        y,
        width: Math.abs(item.w),
        height: Math.abs(item.h),
        strokeColor: item.color,
        backgroundColor: 'transparent',
        strokeWidth: item.size,
        roughness: 1,
      });
      continue;
    }
    if (item.kind === 'arrow') {
      skeletons.push({
        type: 'arrow',
        x: item.x1,
        y: item.y1,
        points: [[0, 0], [item.x2 - item.x1, item.y2 - item.y1]],
        strokeColor: item.color,
        backgroundColor: 'transparent',
        strokeWidth: item.size,
        endArrowhead: 'arrow',
        roughness: 1,
      });
      continue;
    }
    if (item.kind === 'text') {
      skeletons.push({
        type: 'text',
        x: item.x,
        y: item.y - item.size,
        text: item.text,
        fontSize: Math.max(12, item.size),
        strokeColor: item.color,
        backgroundColor: 'transparent',
      });
      continue;
    }
    if (item.points.length === 0) continue;
    const origin = item.points[0]!;
    skeletons.push({
      type: 'line',
      x: origin.x,
      y: origin.y,
      points: item.points.map((point) => [point.x - origin.x, point.y - origin.y]),
      strokeColor: item.color,
      backgroundColor: 'transparent',
      strokeWidth: item.size,
      roughness: 1,
    });
  }

  try {
    return convertToExcalidrawElements(skeletons as never[], { regenerateIds: true }) as unknown[];
  } catch {
    return [];
  }
}


const SKETCH_TOOLTIP_TARGETS: Array<{
  selector: string;
  target?: 'closest-label';
  label: SketchTooltipLabelKey;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}> = [
  { selector: '[data-testid="toolbar-lock"]', target: 'closest-label', label: 'lock', placement: 'bottom' },
  { selector: '[data-testid="toolbar-hand"]', target: 'closest-label', label: 'hand', placement: 'bottom' },
  { selector: '[data-testid="toolbar-selection"]', target: 'closest-label', label: 'selection', placement: 'bottom' },
  { selector: '[data-testid="toolbar-rectangle"]', target: 'closest-label', label: 'rectangle', placement: 'bottom' },
  { selector: '[data-testid="toolbar-diamond"]', target: 'closest-label', label: 'diamond', placement: 'bottom' },
  { selector: '[data-testid="toolbar-ellipse"]', target: 'closest-label', label: 'ellipse', placement: 'bottom' },
  { selector: '[data-testid="toolbar-arrow"]', target: 'closest-label', label: 'arrow', placement: 'bottom' },
  { selector: '[data-testid="toolbar-line"]', target: 'closest-label', label: 'line', placement: 'bottom' },
  { selector: '[data-testid="toolbar-freedraw"]', target: 'closest-label', label: 'freedraw', placement: 'bottom' },
  { selector: '[data-testid="toolbar-text"]', target: 'closest-label', label: 'text', placement: 'bottom' },
  { selector: '[data-testid="toolbar-image"]', target: 'closest-label', label: 'image', placement: 'bottom' },
  { selector: '[data-testid="toolbar-eraser"]', target: 'closest-label', label: 'eraser', placement: 'bottom' },
  { selector: '[data-testid="toolbar-frame"]', target: 'closest-label', label: 'frame', placement: 'bottom' },
  { selector: '[data-testid="toolbar-embeddable"]', target: 'closest-label', label: 'embeddable', placement: 'bottom' },
  { selector: '[data-testid="toolbar-laser"]', target: 'closest-label', label: 'laser', placement: 'bottom' },
  { selector: '.App-toolbar__extra-tools-trigger', label: 'moreTools', placement: 'bottom' },
];

export function applySketchEditorTooltips(root: HTMLElement, labels: SketchTooltipLabels): void {
  const decorated = new Set<HTMLElement>();
  for (const entry of SKETCH_TOOLTIP_TARGETS) {
    for (const trigger of Array.from(root.querySelectorAll<HTMLElement>(entry.selector))) {
      const target = entry.target === 'closest-label'
        ? trigger.closest<HTMLElement>('label')
        : trigger;
      if (!target || decorated.has(target)) continue;

      const label = normalizeTooltipLabel(labels[entry.label]);
      if (!label) continue;

      // Drive ONLY the shared TooltipLayer (`.bezier-tooltip[data-tooltip]`): it
      // renders a single styled, viewport-aware bubble and suppresses the
      // native browser `title` on hover. Painting our own
      // `data-bezier-sketch-tooltip` ::after or a redundant `title` on top of it is
      // what produced the duplicate white + black tooltips.
      setTooltipAttribute(target, 'data-tooltip', label);
      setTooltipAttribute(target, 'data-tooltip-placement', entry.placement ?? 'bottom');
      if (!target.classList.contains('bezier-tooltip')) target.classList.add('bezier-tooltip');
      setTooltipAttribute(trigger, 'aria-label', label);
      decorated.add(target);
    }
  }
}

function normalizeTooltipLabel(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized : null;
}

function setTooltipAttribute(target: HTMLElement, name: string, value: string): void {
  if (target.getAttribute(name) === value) return;
  target.setAttribute(name, value);
}

const SKETCH_CONTEXT_MENU_ACTION_ORDER = ['copy', 'paste', 'copyAsPng', 'copyAsSvg'] as const;
const SKETCH_CONTEXT_MENU_KNOWN_ACTIONS = new Set<string>([
  ...SKETCH_CONTEXT_MENU_ACTION_ORDER,
  'addToLibrary',
  'bringForward',
  'bringToFront',
  'copyStyles',
  'cut',
  'delete',
  'duplicate',
  'flipHorizontal',
  'flipVertical',
  'lock',
  'pasteStyles',
  'sendBackward',
  'sendToBack',
  'toggleGrid',
]);
const SKETCH_CONTEXT_MENU_ALLOWED_ACTIONS = new Set<string>(SKETCH_CONTEXT_MENU_ACTION_ORDER);
const SKETCH_CONTEXT_MENU_MARGIN = 8;

export function applySketchContextMenuSimplification(root: HTMLElement, viewportRoot: HTMLElement = root): void {
  for (const menu of Array.from(root.querySelectorAll<HTMLUListElement>('ul.context-menu'))) {
    const popover = menu.closest<HTMLElement>('.popover') ?? menu.parentElement;
    if (!popover) continue;
    const hasSketchAction = Array.from(menu.querySelectorAll<HTMLLIElement>('li[data-testid]')).some((item) => (
      SKETCH_CONTEXT_MENU_KNOWN_ACTIONS.has(item.getAttribute('data-testid') ?? '')
    ));
    if (!hasSketchAction) continue;

    menu.classList.add('bezier-sketch-context-menu');
    popover.classList.add('bezier-sketch-context-popover');

    const allowedByAction = new Map<string, HTMLLIElement>();
    for (const child of Array.from(menu.children)) {
      if (child instanceof HTMLHRElement) {
        child.remove();
        continue;
      }
      if (!(child instanceof HTMLLIElement)) continue;
      const actionName = child.getAttribute('data-testid') ?? '';
      if (!SKETCH_CONTEXT_MENU_ALLOWED_ACTIONS.has(actionName)) {
        child.remove();
        continue;
      }
      allowedByAction.set(actionName, child);
    }

    const orderedItems = SKETCH_CONTEXT_MENU_ACTION_ORDER
      .map((actionName) => allowedByAction.get(actionName))
      .filter((item): item is HTMLLIElement => Boolean(item));
    if (orderedItems.length === 0) {
      popover.remove();
      continue;
    }
    // Only touch the DOM when the order is actually wrong. This runs on every
    // MutationObserver tick, and re-`appendChild`-ing nodes that are already in
    // place detaches and re-inserts them each frame. Because those mutations
    // re-trigger the observer, an unconditional reorder becomes a self-sustaining
    // per-frame churn that cancels the in-flight pointer interaction, making the
    // menu items impossible to click.
    const currentItems = Array.from(menu.children).filter(
      (child): child is HTMLLIElement => child instanceof HTMLLIElement,
    );
    const alreadyOrdered = currentItems.length === orderedItems.length
      && currentItems.every((item, index) => item === orderedItems[index]);
    if (!alreadyOrdered) {
      for (const item of orderedItems) menu.appendChild(item);
    }

    clampSketchContextPopover(popover, viewportRoot);
  }
}

function clampSketchContextPopover(popover: HTMLElement, viewportRoot: HTMLElement): void {
  const viewportRect = viewportRoot.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  let nextLeft = Number.parseFloat(popover.style.left || `${rect.left}`);
  let nextTop = Number.parseFloat(popover.style.top || `${rect.top}`);
  if (!Number.isFinite(nextLeft) || !Number.isFinite(nextTop)) return;

  const maxRight = viewportRect.right - SKETCH_CONTEXT_MENU_MARGIN;
  const minLeft = viewportRect.left + SKETCH_CONTEXT_MENU_MARGIN;
  const maxBottom = viewportRect.bottom - SKETCH_CONTEXT_MENU_MARGIN;
  const minTop = viewportRect.top + SKETCH_CONTEXT_MENU_MARGIN;

  if (rect.right > maxRight) nextLeft -= rect.right - maxRight;
  if (rect.left < minLeft) nextLeft += minLeft - rect.left;
  if (rect.bottom > maxBottom) nextTop -= rect.bottom - maxBottom;
  if (rect.top < minTop) nextTop += minTop - rect.top;

  if (nextLeft !== Number.parseFloat(popover.style.left || 'NaN')) popover.style.left = `${Math.max(0, Math.round(nextLeft))}px`;
  if (nextTop !== Number.parseFloat(popover.style.top || 'NaN')) popover.style.top = `${Math.max(0, Math.round(nextTop))}px`;
}

const SKETCH_TEXT_OVERRIDE_ATTRS = ['title', 'aria-label', 'placeholder'] as const;

function sketchTextOverrides(locale: Locale): Record<string, string> | null {
  if (locale === 'zh-CN') return ZH_CN_SKETCH_TEXT_OVERRIDES;
  if (locale === 'zh-TW') return ZH_TW_SKETCH_TEXT_OVERRIDES;
  return null;
}

function applySketchDomI18nOverrides(root: ParentNode, locale: Locale): void {
  const overrides = sketchTextOverrides(locale);
  if (!overrides || typeof document === 'undefined') return;
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = textWalker.nextNode();
  while (node) {
    const next = translateSketchTextValue(node.nodeValue ?? '', overrides);
    if (next !== null && next !== node.nodeValue) node.nodeValue = next;
    node = textWalker.nextNode();
  }
  const elements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
    : Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (const element of elements) {
    for (const attr of SKETCH_TEXT_OVERRIDE_ATTRS) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const next = translateSketchTextValue(value, overrides);
      if (next !== null && next !== value) element.setAttribute(attr, next);
    }
  }
}

function translateSketchTextValue(value: string, overrides: Record<string, string>): string | null {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const leading = match?.[1] ?? '';
  const core = match?.[2] ?? value;
  const trailing = match?.[3] ?? '';
  const normalized = core.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const exact = overrides[normalized];
  if (exact) return `${leading}${exact}${trailing}`;
  for (const [source, replacement] of Object.entries(overrides)) {
    for (const separator of [' — ', ' - ', ': ']) {
      if (normalized.startsWith(`${source}${separator}`)) {
        return `${leading}${replacement}${normalized.slice(source.length)}${trailing}`;
      }
    }
  }
  return null;
}

function rewriteExcalidrawUnableToEmbedToasts(root: HTMLElement, replacement: string): void {
  const normalizedReplacement = normalizeTooltipLabel(replacement);
  if (!normalizedReplacement) return;
  for (const messageNode of Array.from(root.querySelectorAll<HTMLElement>('.Toast__message'))) {
    const current = normalizeTooltipLabel(messageNode.textContent);
    if (!current || current === normalizedReplacement || !isExcalidrawUnableToEmbedToast(current)) continue;
    messageNode.textContent = normalizedReplacement;
    messageNode.closest<HTMLElement>('.Toast')?.setAttribute('data-bezier-embed-toast-rewritten', 'true');
  }
}

function isExcalidrawUnableToEmbedToast(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('embedding this url is currently not allowed')) return true;
  if (SKETCH_EMBED_BLOCKED_PHRASES.some(phrase => message.includes(phrase))) return true;
  return lower.includes('github')
    && (lower.includes('issue') || lower.includes('whitelist') || SKETCH_WHITELIST_PHRASES.some(phrase => message.includes(phrase)));
}

function enhanceSketchExcalidrawPortals(locale: Locale, onClose: () => void): void {
  for (const portal of Array.from(document.querySelectorAll<HTMLElement>('.excalidraw-modal-container'))) {
    portal.classList.add('bezier-sketch-modal');
    portal.classList.toggle('bezier-sketch-help-modal', Boolean(portal.querySelector('.HelpDialog__header')));
    applySketchDomI18nOverrides(portal, locale);
    for (const content of Array.from(portal.querySelectorAll<HTMLElement>('.Modal__content'))) {
      removeSketchMermaidShortcutHints(content);
      let close = content.querySelector<HTMLButtonElement>(':scope > .bezier-sketch-dialog-close');
      if (!close) {
        close = document.createElement('button');
        close.type = 'button';
        close.className = 'bezier-sketch-dialog-close';
        close.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        });
        content.appendChild(close);
      }
      const label = sketchTextOverrides(locale)?.Close ?? 'Close';
      close.setAttribute('aria-label', label);
      close.setAttribute('title', label);
    }
  }
}

function removeSketchMermaidShortcutHints(content: HTMLElement): void {
  const insertButton = findSketchMermaidInsertButton(content);
  if (!insertButton) return;
  for (const hint of Array.from(insertButton.querySelectorAll('kbd'))) {
    hint.remove();
  }
  for (const hint of Array.from(content.querySelectorAll('.ttd-dialog-submit-shortcut'))) {
    hint.remove();
  }
}

function handleSketchPortalCommandEnter(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const portal = target.closest<HTMLElement>('.bezier-sketch-modal');
  const content = target.closest<HTMLElement>('.Modal__content');
  if (!portal || !content || !portal.contains(content)) return;
  if (!content.querySelector('textarea')) return;

  const insertButton = findSketchMermaidInsertButton(content);
  if (!insertButton || insertButton.disabled || insertButton.getAttribute('aria-disabled') === 'true') return;

  event.preventDefault();
  event.stopPropagation();
  insertButton.click();
}

function findSketchMermaidInsertButton(content: HTMLElement): HTMLButtonElement | null {
  const dialogText = normalizeTooltipLabel(content.textContent);
  if (!dialogText || !/Mermaid/i.test(dialogText)) return null;
  for (const button of Array.from(content.querySelectorAll<HTMLButtonElement>('button'))) {
    const label = normalizeTooltipLabel(button.textContent) ?? normalizeTooltipLabel(button.getAttribute('aria-label'));
    if (!label) continue;
    if (new RegExp(`^(?:Insert|${SKETCH_INSERT_LABEL})(?:\\s|$|→)`, 'i').test(label)) return button;
  }
  return null;
}

function validateSketchEmbeddableUrl(link: string): boolean {
  const trimmed = link.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function readExcalidrawTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function cloneJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return fallback;
  }
}
