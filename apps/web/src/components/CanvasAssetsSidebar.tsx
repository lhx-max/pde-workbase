// Extracted original project-file sidebar; external library and collector are host-owned ports.
import { isCollectedPath, isCanvasTextPath, PROJECT_FILE_DRAG_MIME, PROJECT_FILE_ADD_TO_CANVAS_EVENT, type ProjectFile, type ProjectFileKind } from '@bezier/contracts';
import { Button, Input, Select, ConfirmDialog, Tabs, TabsList, TabsTrigger } from './ui';
import { AssetLibraryPanel, type AssetLibraryPanelProps } from './AssetLibraryPanel';
import { BrowserCollectorPanel } from './BrowserCollectorPanel';
import type { BrowserPageExtractionRequest } from './browser-page-extraction';
import { saveProjectFileAsAsset } from '../providers/asset-library';
import { Icon } from './Icon';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useProjectCollabContext } from '../collab/collab-context';
import { appendResourceQuery } from '../collab/workspace-identity';
import { fetchProjectFileTextPreview, projectFileUrl } from '../providers/registry';
import {isVisibleProjectFilePath} from '../state/visible-project-files';
import { useI18n } from '../i18n';
import { SketchPreview } from './SketchPreview';
import { CanvasArtifactThumbnail } from './workspace/CanvasArtifactThumbnail';
import { CanvasResourceThumbnail } from './CanvasResourceThumbnail';
import styles from './CanvasAssetsSidebar.module.css';
function HtmlTemplateThumb({template}:{foreground?:boolean;template:{title:string;type:string;previewSrc:string}}) {return <CanvasArtifactThumbnail src={template.previewSrc} title={template.title} presentation={template.type==='Slides'} />;}
interface Props extends Pick<AssetLibraryPanelProps,'installedTemplates'|'designSystems'|'onUseTemplate'|'onOpenDesignSystem'|'onOpenAssetLibrary'|'onCancelSelection'|'openRequest'> {
 onExtractPage?:(request:BrowserPageExtractionRequest)=>Promise<void>;extractPageDisabled?:boolean;
 active?:boolean; projectId:string;projectName?:string;rootDirName?:string;files:ProjectFile[];viewerOnly?:boolean;reloading?:boolean;
 onClose:()=>void;onRenameFile:(from:string,to:string)=>Promise<ProjectFile|null>|ProjectFile|null;onDeleteFile:(name:string)=>void;onDeleteFiles?:(names:string[])=>Promise<string[]>;
 onRefreshFiles:()=>Promise<void>|void;onUpload:()=>void;onWidthChange?:(width:number)=>void;width?:number;onLocateFile?:(name:string)=>void;onOpenFile?:(name:string)=>void;
 onRevealInFinder?:(name?:string)=>Promise<boolean>|boolean;onSaveToLibrary?:(file:ProjectFile)=>Promise<void>;
}
function formatBytes(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type LibraryTab = 'canvas' | 'assets' | 'collect';
type ViewMode = 'list' | 'grid';
type TimeFilter = 'all' | 'today' | 'week' | 'month';
type AssetOwner = 'personal' | 'team';
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_COMPACT_THRESHOLD = 248;
const SIDEBAR_DEFAULT_WIDTH = 320;
const PREVIEW_DELAY_MS = 180;
const PREVIEW_HIDE_DELAY_MS = 90;

type FilePreviewState = {
  file: ProjectFile;
  left: number;
  top: number;
};

const FILE_KIND_KEYS: Partial<Record<ProjectFileKind, 'entry.canvasAssets.kind.html' | 'entry.canvasAssets.kind.image' | 'entry.canvasAssets.kind.video' | 'entry.canvasAssets.kind.audio' | 'entry.canvasAssets.kind.sketch' | 'entry.canvasAssets.kind.text' | 'entry.canvasAssets.kind.code' | 'entry.canvasAssets.kind.pdf' | 'entry.canvasAssets.kind.document' | 'entry.canvasAssets.kind.presentation' | 'entry.canvasAssets.kind.spreadsheet' | 'entry.canvasAssets.kind.binary'>> = {
  html: 'entry.canvasAssets.kind.html',
  image: 'entry.canvasAssets.kind.image',
  video: 'entry.canvasAssets.kind.video',
  audio: 'entry.canvasAssets.kind.audio',
  sketch: 'entry.canvasAssets.kind.sketch',
  text: 'entry.canvasAssets.kind.text',
  code: 'entry.canvasAssets.kind.code',
  pdf: 'entry.canvasAssets.kind.pdf',
  document: 'entry.canvasAssets.kind.document',
  presentation: 'entry.canvasAssets.kind.presentation',
  spreadsheet: 'entry.canvasAssets.kind.spreadsheet',
  binary: 'entry.canvasAssets.kind.binary',
};

function isPresentationFile(file: ProjectFile): boolean {
  if (file.kind === 'presentation' || file.artifactKind === 'deck' || file.artifactManifest?.kind === 'deck') {
    return true;
  }
  return (file.kind === 'html' || /\.html?$/i.test(file.name)) && /ppt|deck|slide/i.test(file.name);
}

function assetSortRank(file: ProjectFile): number {
  if (file.kind === 'image') return 0;
  if (file.kind === 'video') return 1;
  if (isPresentationFile(file)) return 2;
  if (file.kind === 'html' || /\.html?$/i.test(file.name)) return 3;
  if (file.kind === 'text') return 4;
  return 5;
}

function compareCanvasAssets(a: ProjectFile, b: ProjectFile): number {
  return assetSortRank(a) - assetSortRank(b)
    || b.mtime - a.mtime
    || a.name.localeCompare(b.name);
}

function matchesTime(timestamp: number, filter: TimeFilter): boolean {
  if (filter === 'all') return true;
  const age = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (filter === 'today') return age <= day;
  if (filter === 'week') return age <= 7 * day;
  return age <= 30 * day;
}

function fileBaseName(path: string): string {
  return path.split('/').pop() || path;
}

function fileDirectory(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

function formatModifiedTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function FileGlyph({ kind }: { kind: ProjectFileKind }) {
  if (kind === 'image') return <Icon name="image" size={15} />;
  if (kind === 'video' || kind === 'audio') return <Icon name="video-ai" size={15} />;
  if (kind === 'html' || kind === 'code') return <Icon name="file-code" size={15} />;
  return <Icon name="file-text" size={15} />;
}

// These files remain available to persistence and internal consumers. They
// are system records rather than independently usable assets in this sidebar.
function isCanvasSystemRecord(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const isLegacyRootCanvasTextCopy = !normalized.includes('/')
    && /^basic-text-[a-z0-9]+-[a-z0-9]+(?:-\d+)?\.md$/i.test(normalized);
  return normalized === '画布文本'
    || isCanvasTextPath(normalized)
    || isLegacyRootCanvasTextCopy
    || (isCollectedPath(normalized) && normalized.endsWith('.source.json'));
}

export function CanvasAssetsSidebar({active=true,projectId,projectName,rootDirName,files:projectFiles,viewerOnly=false,reloading=false,onClose,onRenameFile,onDeleteFile,onDeleteFiles,onRefreshFiles,onUpload,onWidthChange,width=SIDEBAR_DEFAULT_WIDTH,onLocateFile,onOpenFile,onRevealInFinder,onSaveToLibrary,onExtractPage,extractPageDisabled,openRequest,onCancelSelection,onOpenAssetLibrary,installedTemplates,designSystems,onUseTemplate,onOpenDesignSystem}:Props) {
  const files = useMemo(() => projectFiles.filter(file => isVisibleProjectFilePath(file.name)&&!isCanvasSystemRecord(file.name)), [projectFiles]);
  const { locale, t } = useI18n();
  const fileKindLabel = (kind: ProjectFileKind) => {
    const key = FILE_KIND_KEYS[kind];
    return key ? t(key) : t('entry.canvasAssets.kind.file');
  };
  const { workspaceContext } = useProjectCollabContext();
  const [addingFile, setAddingFile] = useState<string | null>(null);
  const [fileReferences, setFileReferences] = useState<Record<string, string[]>>({});
  useEffect(() => {
    setFileReferences({});
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; references: Record<string, string[]> }>).detail;
      if (detail?.projectId === projectId) setFileReferences(detail.references);
    };
    window.addEventListener('bezier-design:project-file-references', receive);
    window.dispatchEvent(new CustomEvent('bezier-design:request-project-file-references', { detail: { projectId } }));
    return () => window.removeEventListener('bezier-design:project-file-references', receive);
  }, [projectId]);
  const [selecting, setSelecting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setSelectedFiles([]);
    setSelecting(false);
    setConfirmBatchDelete(false);
  }, [projectId]);
  useEffect(() => {
    setSelectedFiles(current => current.filter(name => files.some(file => file.name === name)));
  }, [files]);
  const toggleSelectedFile = (name: string) => setSelectedFiles(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name]);
  const [libraryTab,setLibraryTab]=useState<LibraryTab>('canvas');
  const [collectorVisited,setCollectorVisited]=useState(false);
  useEffect(()=>{if(libraryTab==='collect')setCollectorVisited(true);},[libraryTab]);
  useEffect(()=>{if(openRequest)setLibraryTab('assets');},[openRequest]);
  const saveToSource=useCallback(async(file:ProjectFile)=>{if(onSaveToLibrary)await onSaveToLibrary(file);else await saveProjectFileAsAsset(projectId,file.name,workspaceContext);},[onSaveToLibrary,projectId,workspaceContext]);
  const [viewMode,setViewMode]=useState<ViewMode>('list');
  const [query,setQuery]=useState('');
  const contentRef=useRef<HTMLDivElement>(null);
  const [kindFilter, setKindFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [draggingFileName, setDraggingFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewState | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const previewShowTimerRef = useRef<number | null>(null);
  const previewHideTimerRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const compact = width <= SIDEBAR_COMPACT_THRESHOLD;
  const searchQuery=query;const setSearchQuery=setQuery;
  const clearPreviewTimers = useCallback(() => {
    if (previewShowTimerRef.current != null) window.clearTimeout(previewShowTimerRef.current);
    if (previewHideTimerRef.current != null) window.clearTimeout(previewHideTimerRef.current);
    previewShowTimerRef.current = null;
    previewHideTimerRef.current = null;
  }, []);

  useEffect(() => () => clearPreviewTimers(), [clearPreviewTimers]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    const file = preview?.file;
    if (!file || !['text', 'code', 'html', 'sketch'].includes(file.kind)) {
      setPreviewText(null);
      return;
    }
    let active = true;
    setPreviewText(null);
    void fetchProjectFileTextPreview(projectId, file.name, {
      limit: 2400,
      cacheBustKey: Math.floor(file.mtime),
      workspaceContext,
    }).then((result) => {
      if (active && result) setPreviewText(result.text);
    }).catch(cause => { if (active) setNotice(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      active = false;
    };
  }, [preview?.file, projectId, workspaceContext]);

  useEffect(() => {
    const onLocationResult = (event: Event) => {
      const detail = (event as CustomEvent<{ fileName?: string; found?: boolean }>).detail;
      if (!detail?.fileName || !files.some(file => file.name === detail.fileName)) return;
      setNotice(detail.found ? t('entry.canvasAssets.notice.located') : t('entry.canvasAssets.notice.notOnCanvas'));
    };
    window.addEventListener('bezier-design:project-file-location-result', onLocationResult);
    return () => window.removeEventListener('bezier-design:project-file-location-result', onLocationResult);
  }, [files]);

  const showFilePreview = useCallback((file: ProjectFile, anchor: HTMLElement) => {
    clearPreviewTimers();
    const rect = anchor.getBoundingClientRect();
    previewShowTimerRef.current = window.setTimeout(() => {
      const previewWidth = 304;
      const previewHeight = 470;
      const left = rect.right + 10 + previewWidth <= window.innerWidth
        ? rect.right + 10
        : Math.max(12, rect.left - previewWidth - 10);
      const top = Math.min(
        Math.max(12, rect.top - 46),
        Math.max(12, window.innerHeight - previewHeight - 12),
      );
      setPreview({ file, left, top });
    }, PREVIEW_DELAY_MS);
  }, [clearPreviewTimers]);

  const hideFilePreview = useCallback(() => {
    if (previewShowTimerRef.current != null) window.clearTimeout(previewShowTimerRef.current);
    previewShowTimerRef.current = null;
    if (previewHideTimerRef.current != null) window.clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = window.setTimeout(() => setPreview(null), PREVIEW_HIDE_DELAY_MS);
  }, []);

  const keepFilePreview = useCallback(() => {
    if (previewHideTimerRef.current != null) window.clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (active) return;
    clearPreviewTimers();
    setPreview(null);
    setActiveMenu(null);
  }, [active, clearPreviewTimers]);

  const locateFile = useCallback((file: ProjectFile) => {
    setSelectedFileName(file.name);
    setNotice(t('entry.canvasAssets.notice.locating'));
    onLocateFile?.(file.name);
  }, [onLocateFile]);

  const addFileToCanvas = async (file: ProjectFile) => {
    if (addingFile) return;
    setActiveMenu(null); setAddingFile(file.name); setNotice(null);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(t('asset.error.canvasNoResponse'))), 15000);
        window.dispatchEvent(new CustomEvent(PROJECT_FILE_ADD_TO_CANVAS_EVENT, { detail: {
          projectId, name: file.name, size: file.size, mtime: file.mtime, kind: file.kind, mime: file.mime,
          onComplete: (success: boolean) => { window.clearTimeout(timer); if (success) resolve(); else reject(new Error(t('asset.error.canvasAddFailed'))); },
        } }));
      });
      setNotice(t('entry.canvasAssets.addedToCanvas'));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('asset.error.canvasAddFailed')); }
    finally { setAddingFile(null); }
  };

  const startFileDrag = useCallback((event: ReactDragEvent<HTMLElement>, file: ProjectFile) => {
    clearPreviewTimers();
    setPreview(null);
    setDraggingFileName(file.name);
    setSelectedFileName(file.name);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(PROJECT_FILE_DRAG_MIME, JSON.stringify({
      projectId,
      name: file.name,
      size: file.size,
      mtime: file.mtime,
      kind: file.kind,
      artifactKind: file.artifactManifest?.kind ?? file.artifactKind,
      mime: file.mime,
    }));
    event.dataTransfer.setData('text/plain', file.name);
  }, [clearPreviewTimers, projectId]);


  useEffect(() => {
    if (!activeMenu) return;
    const close = () => setActiveMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [activeMenu]);

  const fileKinds = useMemo(
    () => [...new Set(files.map((file) => file.kind))].sort(),
    [files],
  );

  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return files
      .filter((file) => kindFilter === 'all' || file.kind === kindFilter)
      .filter((file) => matchesTime(file.mtime, timeFilter))
      .filter((file) => !needle || file.name.toLocaleLowerCase().includes(needle))
      .sort(compareCanvasAssets);
  }, [files, kindFilter, query, timeFilter]);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      await onRefreshFiles();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); } finally {
      setRefreshing(false);
    }
  };

  const renameFile = async (file: ProjectFile) => {
    const base = fileBaseName(file.name);
    const nextBase = window.prompt(t('entry.canvasAssets.renamePrompt'), base)?.trim();
    if (!nextBase || nextBase === base) return;
    const dir = fileDirectory(file.name);
    await onRenameFile(file.name, dir ? `${dir}/${nextBase}` : nextBase);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    const handle = event.currentTarget;
    const sidebar = handle.parentElement;
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const panel = handle.closest<HTMLElement>('[data-resizable-file-panel]') ?? sidebar;
    const startWidth = panel?.getBoundingClientRect().width ?? 320;
    let pendingWidth = startWidth;
    let animationFrame: number | null = null;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    panel?.setAttribute('data-resizing', 'true');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const paint = () => {
      animationFrame = null;
      panel?.style.setProperty('--design-files-panel-width', `${pendingWidth}px`);
      sidebar?.setAttribute('data-compact', pendingWidth <= SIDEBAR_COMPACT_THRESHOLD ? 'true' : 'false');
      handle.setAttribute('aria-valuenow', String(Math.round(pendingWidth)));
    };
    const move = (moveEvent: PointerEvent) => {
      pendingWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + moveEvent.clientX - startX),
      );
      if (animationFrame == null) animationFrame = window.requestAnimationFrame(paint);
    };
    const cleanup = () => {
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', cancel);
      panel?.removeAttribute('data-resizing');
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null;
    };
    const stop = (stopEvent: PointerEvent) => {
      if (Number.isFinite(stopEvent.clientX)) {
        pendingWidth = Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(SIDEBAR_MAX_WIDTH, startWidth + stopEvent.clientX - startX),
        );
      }
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
      paint();
      cleanup();
      onWidthChange(pendingWidth);
    };
    const cancel = () => {
      pendingWidth = startWidth;
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
      paint();
      cleanup();
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', cancel);
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    const next = event.key === 'Home'
      ? SIDEBAR_MIN_WIDTH
      : event.key === 'End'
        ? SIDEBAR_MAX_WIDTH
        : event.key === 'ArrowLeft'
          ? Math.max(SIDEBAR_MIN_WIDTH, width - 16)
          : event.key === 'ArrowRight'
            ? Math.min(SIDEBAR_MAX_WIDTH, width + 16)
            : null;
    if (next == null) return;
    event.preventDefault();
    onWidthChange(next);
  };

  const canvasContentCount = visibleFiles.length;
 const contentCount=canvasContentCount;
 const heading=projectName?.trim()||rootDirName?.trim()||t('entry.canvasAssets.currentProject');
 const subtitle=rootDirName&&rootDirName!==heading?rootDirName:projectId;
  if (!active) return null;

  return (
    <section
      className={styles.sidebar}
      data-testid="canvas-assets-sidebar"
      data-compact={compact ? 'true' : 'false'}
      data-library-tab={libraryTab}
    >
      <header className={styles.header}>
        <div className={styles.headingWrap}>
          <h2 className={styles.heading} title={heading}>
            {heading}
          </h2>
          {true ? <p className={styles.subtitle} title={subtitle}>
            {subtitle}
          </p> : null}
        </div>
        <div className={styles.headerActions}>
          <Button
            type="button"
            className={`${styles.iconButton} bezier-tooltip`}
            title={t('entry.canvasAssets.close')}
            aria-label={t('entry.canvasAssets.close')}
            data-tooltip={t('entry.canvasAssets.close')}
            data-tooltip-placement="bottom"
            onClick={onClose}
          >
            <Icon name="close" size={17} />
          </Button>
        </div>
      </header>
      <Tabs value={libraryTab} onValueChange={value=>{onCancelSelection?.();setLibraryTab(value as LibraryTab);}} className={styles.libraryTabs}>
        <TabsList className={styles.libraryTabsList} aria-label={t('entry.canvasAssets.libraryViewsAria')}>
          <TabsTrigger value="canvas" className={styles.libraryTabsTrigger} onClick={()=>{if(libraryTab!=='canvas')onCancelSelection?.();setLibraryTab('canvas');}}><Icon name="grid" size={14}/>{t('entry.canvasAssets.tab.canvas')}</TabsTrigger>
          <TabsTrigger value="assets" className={styles.libraryTabsTrigger} onClick={()=>{if(libraryTab!=='assets')onCancelSelection?.();setLibraryTab('assets');}}><Icon name="image" size={14}/>{t('entry.canvasAssets.tab.assetsShort')}</TabsTrigger>
          {!viewerOnly?<TabsTrigger value="collect" className={styles.libraryTabsTrigger} onClick={()=>{if(libraryTab!=='collect')onCancelSelection?.();setLibraryTab('collect');}}><Icon name="globe" size={14}/>{t('entry.canvasAssets.tab.collectShort')}</TabsTrigger>:null}
        </TabsList>
      </Tabs>
      <div className={styles.collectorView} hidden={libraryTab!=='collect'}>{collectorVisited&&!viewerOnly?<BrowserCollectorPanel projectId={projectId} workspaceContext={workspaceContext} files={files} onRefreshFiles={onRefreshFiles} onExtractPage={onExtractPage} extractPageDisabled={extractPageDisabled} onSaveToAssetSource={saveToSource}/>:null}</div>
      {libraryTab==='assets'?<AssetLibraryPanel projectId={projectId} viewerOnly={viewerOnly} openRequest={openRequest} onCancelSelection={onCancelSelection} onOpenAssetLibrary={onOpenAssetLibrary} installedTemplates={installedTemplates} designSystems={designSystems} onUseTemplate={onUseTemplate} onOpenDesignSystem={onOpenDesignSystem} onRefreshFiles={onRefreshFiles}/>:null}
      {libraryTab === 'canvas' ? <>

      <div className={styles.toolbar}>
        <label className={styles.searchBox}>
          <Icon name="search" size={15} />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('entry.canvasAssets.searchFiles')}
            aria-label={t('entry.canvasAssets.searchFiles')}
          />
          {searchQuery ? (
            <Button
              type="button"
              className="bezier-tooltip"
              title={t('entry.canvasAssets.clearSearch')}
              aria-label={t('entry.canvasAssets.clearSearch')}
              data-tooltip={t('entry.canvasAssets.clearSearch')}
              data-tooltip-placement="bottom"
              onClick={() => setSearchQuery('')}
            >
              <Icon name="close" size={13} />
            </Button>
          ) : null}
        </label>
        {libraryTab === 'canvas' ? (
          <div className={styles.viewToggle} aria-label={t('entry.canvasAssets.viewModeAria')}>
            <Button
              type="button"
              className={`${viewMode === 'list' ? styles.viewActive : ''} bezier-tooltip`}
              aria-pressed={viewMode === 'list'}
              aria-label={t('entry.canvasAssets.listView')}
              title={t('entry.canvasAssets.listView')}
              data-tooltip={t('entry.canvasAssets.listView')}
              data-tooltip-placement="bottom"
              onClick={() => setViewMode('list')}
            >
              <Icon name="list" size={16} />
            </Button>
            <Button
              type="button"
              className={`${viewMode === 'grid' ? styles.viewActive : ''} bezier-tooltip`}
              aria-pressed={viewMode === 'grid'}
              aria-label={t('entry.canvasAssets.gridView')}
              title={t('entry.canvasAssets.gridView')}
              data-tooltip={t('entry.canvasAssets.gridView')}
              data-tooltip-placement="bottom"
              onClick={() => setViewMode('grid')}
            >
              <Icon name="grid" size={15} />
            </Button>
          </div>
        ) : null}
        {libraryTab === 'canvas' ? (
          <Button
            type="button"
            className={`${styles.refreshButton} bezier-tooltip`}
            aria-label={t('entry.canvasAssets.refresh')}
            title={t('entry.canvasAssets.refresh')}
            data-tooltip={refreshing || reloading ? t('entry.canvasAssets.refreshing') : t('entry.canvasAssets.refresh')}
            data-tooltip-placement="bottom"
            onClick={() => void refresh()}
            disabled={refreshing || reloading}
          >
            <Icon name="refresh" size={16} className={refreshing || reloading ? styles.spinning : undefined} />
          </Button>
        ) : null}
      </div>

      <div className={styles.filters}>
        <label className={styles.selectWrap}>
          <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label={t('entry.canvasAssets.filter.type')}>
            <option value="all">{t('entry.canvasAssets.filter.type')}</option>
            {fileKinds.map((kind) => (
              <option key={kind} value={kind}>
                {fileKindLabel(kind as ProjectFileKind)}
              </option>
            ))}
          </Select>
          <Icon name="chevron-down" size={13} />
        </label>
        <label className={`${styles.selectWrap} ${styles.selectDisabled}`}>
          <Icon name="layers-filled" size={13} className={styles.selectLeadIcon} />
          <Select aria-label={t('entry.canvasAssets.filter.tag')} disabled title={t('entry.canvasAssets.filter.tagDisabled')}>
            <option value="all">{t('entry.canvasAssets.filter.tag')}</option>
          </Select>
          <Icon name="chevron-down" size={13} />
        </label>
        <label className={styles.selectWrap}>
          <Select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as TimeFilter)} aria-label={t('entry.canvasAssets.filter.time')}>
            <option value="all">{t('entry.canvasAssets.filter.time')}</option>
            <option value="today">{t('entry.canvasAssets.filter.today')}</option>
            <option value="week">{t('entry.canvasAssets.filter.week')}</option>
            <option value="month">{t('entry.canvasAssets.filter.month')}</option>
          </Select>
          <Icon name="chevron-down" size={13} />
        </label>
      </div>

      <div className={styles.resultMeta}>
        <span>{t('entry.canvasAssets.canvasResources')}</span>
        <span>{contentCount}</span>
        {!viewerOnly && onDeleteFiles && <Button size="xs" variant="ghost" className={styles.batchEntry} disabled={deleting} onClick={() => {setSelecting(!selecting);setSelectedFiles([]);setActiveMenu(null);setPreview(null);}}>{selecting ? t('entry.canvasAssets.done') : t('entry.canvasAssets.select')}</Button>}
      </div>

      {libraryTab === 'canvas' && selecting && <div className={styles.batchBar}>
        <Button size="xs" variant="ghost" disabled={deleting} onClick={() => setSelectedFiles(visibleFiles.every(file => selectedFiles.includes(file.name)) ? [] : visibleFiles.map(file => file.name))}>{t('entry.canvasAssets.selectAll')}</Button>
        <span>{t('entry.canvasAssets.selectedCount', { count: selectedFiles.length })}</span>
        <Button size="xs" variant="ghost" className={styles.danger} disabled={deleting || selectedFiles.length === 0} onClick={() => setConfirmBatchDelete(true)}><Icon name="trash" size={14}/>{deleting ? t('entry.canvasAssets.deleting') : t('entry.canvasAssets.delete')}</Button>
      </div>}
      {confirmBatchDelete && <ConfirmDialog title={t('entry.canvasAssets.deleteBatchTitle', { count: selectedFiles.length })} description={t('entry.canvasAssets.deleteBatchBody')} confirmLabel={t('entry.canvasAssets.deleteConfirm')} cancelLabel={t('entry.canvasAssets.cancel')} onCancel={() => setConfirmBatchDelete(false)} onConfirm={() => {
        setConfirmBatchDelete(false);setDeleting(true);
        void onDeleteFiles?.(selectedFiles).then(deleted => {
          setSelectedFiles(current => current.filter(name => !deleted.includes(name)));
          setNotice(deleted.length === selectedFiles.length ? t('entry.canvasAssets.notice.deletedAll', { count: deleted.length }) : t('entry.canvasAssets.notice.deletedPartial', { deleted: deleted.length, remaining: selectedFiles.length - deleted.length }));
        }).catch(() => setNotice(t('entry.canvasAssets.notice.deleteIncomplete'))).finally(() => setDeleting(false));
      }}/>}
      <div ref={contentRef} className={styles.content} data-view={viewMode}>
        {visibleFiles.map((file) => {
          const name = fileBaseName(file.name);
          const isImage = file.kind === 'image';
          return (
            <article
              key={file.name}
              className={`${styles.item}${selectedFileName === file.name ? ` ${styles.itemSelected}` : ''}${draggingFileName === file.name ? ` ${styles.itemDragging}` : ''}${activeMenu === file.name ? ` ${styles.itemActionsOpen}` : ''}`}
              data-testid={`canvas-sidebar-file-${file.name}`}
              draggable={!selecting}
              aria-grabbed={draggingFileName === file.name}
              onDragStart={(event) => startFileDrag(event, file)}
              onDragEnd={() => setDraggingFileName(null)}
              onMouseEnter={(event) => { if (!selecting) showFilePreview(file, event.currentTarget); }}
              onMouseLeave={hideFilePreview}
            >
              <Button
                type="button"
                className={styles.itemMain}
                onClick={() => { if (selecting) toggleSelectedFile(file.name); else setSelectedFileName(file.name); }}
                disabled={deleting}
                aria-pressed={selecting ? selectedFiles.includes(file.name) : undefined}
                title={file.name}
              >
                {selecting && <span className={styles.selectionCheck} data-selected={selectedFiles.includes(file.name)} aria-hidden="true">{selectedFiles.includes(file.name) && <Icon name="check" size={12}/>}</span>}
                <span className={styles.thumbnail} data-kind={file.kind}>
                  {isImage ? (
                    <CanvasResourceThumbnail
                      src={appendResourceQuery(
                        projectFileUrl(projectId, file.name, workspaceContext),
                        `odThumbnailWidth=${viewMode === 'grid' ? 320 : 64}&v=${Math.floor(file.mtime)}`,
                      )}
                    />
                  ) : file.kind === 'html' || /\.html?$/i.test(file.name) ? (
                    <HtmlTemplateThumb foreground template={{title: name, type: isPresentationFile(file) ? 'Slides' : 'Prototype', previewSrc: appendResourceQuery(projectFileUrl(projectId, file.name, workspaceContext), `v=${file.mtime}`)}} />
                  ) : file.kind === 'sketch' ? (
                    <SketchPreview file={file} projectId={projectId} workspaceContext={workspaceContext}/>
                  ) : file.kind === 'video' ? (
                    <video src={projectFileUrl(projectId, file.name, workspaceContext)} muted preload="metadata" />
                  ) : (
                    <FileGlyph kind={file.kind} />
                  )}
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{name}</span>
                  <span className={styles.itemPath}>
                    {isPresentationFile(file) ? 'PPT' : fileKindLabel(file.kind)}
                    {fileReferences[file.name]?.length ? t('entry.canvasAssets.canvasRefs', { count: fileReferences[file.name]!.length }) : ''}
                  </span>
                </span>
              </Button>
              <div className={styles.itemActions} hidden={selecting} data-testid={`canvas-sidebar-actions-${file.name}`}>
                <Button
                  type="button"
                  className={`${styles.locateButton} bezier-tooltip`}
                  aria-label={t('entry.canvasAssets.locateAria', { name })}
                  title={(fileReferences[file.name]?.length ?? 0) > 1 ? t('entry.canvasAssets.locateCycleTitle') : t('entry.canvasAssets.locateTitle')}
                  data-tooltip={t('entry.canvasAssets.locateTitle')}
                  data-tooltip-placement="left"
                  onClick={(event) => {
                    event.stopPropagation();
                    locateFile(file);
                  }}
                >
                  <Icon name="search" size={15} />
                </Button>
                {viewerOnly ? null : (
                  <div className={styles.menuAnchor} onPointerDown={(event) => event.stopPropagation()}>
                    <Button
                      type="button"
                      className={`${styles.moreButton} bezier-tooltip`}
                      aria-label={t('entry.canvasAssets.moreActionsAria', { name })}
                      title={t('entry.canvasAssets.moreActions')}
                      data-tooltip={t('entry.canvasAssets.moreActions')}
                      data-tooltip-placement="left"
                      aria-expanded={activeMenu === file.name}
                      onClick={() => setActiveMenu((current) => (current === file.name ? null : file.name))}
                    >
                      <Icon name="more-horizontal" size={16} />
                    </Button>
                    {activeMenu === file.name ? (
                      <div className={styles.itemMenu} role="menu">
                        {isImage && <Button type="button" role="menuitem" disabled={addingFile !== null} onClick={() => void addFileToCanvas(file)}><Icon name="plus" size={13}/>{t('entry.canvasAssets.addToCanvas')}</Button>}
                        <Button type="button" role="menuitem" onClick={() => {
                          setActiveMenu(null); setNotice(t('entry.canvasAssets.notice.savingPersonal'));
                          void saveToSource(file).then(() => setNotice(t('entry.canvasAssets.notice.savedPersonal'))).catch(error => setNotice(error instanceof Error ? error.message : t('entry.canvasAssets.notice.saveFailed')));
                        }}><Icon name="folder" size={13} />{t('entry.canvasAssets.saveAsPersonal')}</Button>
                        <Button type="button" role="menuitem" onClick={() => void renameFile(file)}>
                          <Icon name="pencil" size={13} />{t('entry.canvasAssets.rename')}
                        </Button>
                        <Button
                          type="button"
                          role="menuitem"
                          className={styles.danger}
                          onClick={() => onDeleteFile(file.name)}
                        >
                          <Icon name="trash" size={13} />{t('entry.canvasAssets.delete')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {contentCount === 0 ? (
          <div className={styles.empty}>{query || kindFilter !== 'all' || timeFilter !== 'all' ? t('entry.canvasAssets.emptyFiltered') : t('entry.canvasAssets.emptyFiles')}</div>
        ) : null}
      </div>

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <footer className={styles.footer}>
        <Button type="button" className={styles.uploadButton} disabled={viewerOnly} onClick={onUpload}>
          <Icon name="upload" size={16} />
          <span>{t('entry.canvasAssets.upload')}</span>
        </Button>
      </footer>
      </> : null}

      <div
        className={styles.resizeHandle}
        role="separator"
        aria-label={t('entry.canvasAssets.resizeAria')}
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
      />

      {preview && typeof document !== 'undefined' ? createPortal((() => {
        const file = preview.file;
        const previewFallbackSrc = appendResourceQuery(
          projectFileUrl(projectId, file.name, workspaceContext),
          `v=${Math.floor(file.mtime)}`,
        );
        const previewSrc = file.kind === 'image'
          ? appendResourceQuery(
              projectFileUrl(projectId, file.name, workspaceContext),
              `odThumbnailWidth=512&v=${Math.floor(file.mtime)}`,
            )
          : previewFallbackSrc;
        const textual = ['text', 'code', 'html', 'sketch'].includes(file.kind);
        return (
          <aside
            className={styles.previewCard}
            style={{ left: preview.left, top: preview.top }}
            onMouseEnter={keepFilePreview}
            onMouseLeave={hideFilePreview}
            aria-label={t('entry.canvasAssets.previewAria', { name: fileBaseName(file.name) })}
          >
            <div className={styles.previewHeader}>
              <strong title={file.name}>{fileBaseName(file.name)}</strong>
              <Button
                type="button"
                className="bezier-tooltip"
                aria-label={t('entry.canvasAssets.locateAria', { name: fileBaseName(file.name) })}
                title={t('entry.canvasAssets.locateTitle')}
                data-tooltip={t('entry.canvasAssets.locateTitle')}
                data-tooltip-placement="left"
                onClick={() => locateFile(file)}
              >
                <Icon name="search" size={16} />
              </Button>
            </div>
            <div className={styles.previewMedia} data-kind={file.kind}>
              {file.kind === 'image' ? (
                <img
                  src={previewSrc}
                  alt=""
                  decoding="async"
                  onError={(event) => {
                    if (event.currentTarget.dataset.fallbackApplied) return;
                    event.currentTarget.dataset.fallbackApplied = 'true';
                    event.currentTarget.src = previewFallbackSrc;
                  }}
                />
              ) : file.kind === 'video' ? (
                <video src={previewSrc} muted autoPlay loop playsInline preload="metadata" />
              ) : file.kind === 'html' || /\.html?$/i.test(file.name) ? (
                <HtmlTemplateThumb foreground template={{ title: file.name, type: file.artifactManifest?.kind === 'deck' || /ppt|deck|slide/i.test(file.name) ? 'Slides' : 'Prototype', previewSrc }} />
              ) : file.kind === 'sketch' ? (
                <SketchPreview projectId={projectId} file={file} workspaceContext={workspaceContext} />
              ) : textual ? (
                <pre>{previewText ?? t('entry.canvasAssets.readingPreview')}</pre>
              ) : (
                <span className={styles.previewGlyph}><FileGlyph kind={file.kind} /></span>
              )}
            </div>
            <dl className={styles.previewMeta}>
              <dt>{t('entry.canvasAssets.meta.type')}</dt><dd>{fileKindLabel(file.kind)}</dd>
              <dt>{t('entry.canvasAssets.meta.format')}</dt><dd>{file.mime || '—'}</dd>
              <dt>{t('entry.canvasAssets.meta.size')}</dt><dd>{formatBytes(file.size) || '—'}</dd>
              <dt>{t('entry.canvasAssets.meta.modified')}</dt><dd>{formatModifiedTime(file.mtime)}</dd>
            </dl>
          </aside>
        );
      })(), document.body) : null}
    </section>
  );
}
