'use client';
/** Standalone composition of the original FileWorkspace tabs, file panel and canvas. */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps,type DragEvent as ReactDragEvent } from 'react';
import type { ProjectFile, ProjectTabsState as OpenTabsState, WorkspaceCollabContext } from '@bezier/contracts';
import { createCanvasTaskSubmitter, type CanvasNodeCreationRequest, type CanvasTextGenerationResult, type CanvasArtifactGenerationResult, type TextDocumentChange, type CanvasUiHost } from '@bezier/canvas-workbench';
import { Button } from './ui';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import { AnimatePresence } from 'motion/react';
import { QuickSwitcher } from './QuickSwitcher';
import {visibleProjectFiles} from '../state/visible-project-files';
import { nextMarkdownDocumentPath, initialMarkdownDocument } from '../state/file-creation';
import type { TrackingProjectKind } from '@bezier/contracts/analytics';
import { workspaceResourceUrl, workspaceProjectHeaders } from '../collab/workspace-identity';
import { requestJson, projectFileUrl } from '../providers/registry';
import { messageContentWithCommentAttachments } from '../comments';
import { browserPageExtractionTurn } from './browser-page-extraction';
import type { CommentSendResult } from './comment-send-result';
import type { ChatCommentAttachment, ChatAttachment, CanvasTaskListResponse } from '@bezier/contracts';
import type { CanvasTransport, CanvasWorkbenchSurfaceProps } from '@bezier/canvas-workbench';
type AgentTaskSubmitter = NonNullable<CanvasWorkbenchSurfaceProps['onSubmitAgentTask']>;
import { CanvasAssetsSidebar } from './CanvasAssetsSidebar';
import {AssetLibraryBrowser} from './AssetLibraryBrowser';
import {SaveAssetDialogHost} from './SaveAssetDialog';
import {BrowserExtensionCaptureHost} from './BrowserExtensionCaptureHost';
import {WorkspaceReferenceTray} from './WorkspaceReferenceTray';
import {OPEN_ASSET_LIBRARY_EVENT,type AssetLibraryRequest} from '../state/asset-library-navigation';
import {OPEN_COLLECTOR_TAB_EVENT} from './browser-collector-tools';
import {saveProjectFileAsAsset} from '../providers/asset-library';
import type {AssetLibraryPanelProps} from './AssetLibraryPanel';
import { FileViewer } from './FileViewer';
import { IframeKeepAliveProvider,createManualEditRetention, type HtmlViewerAdapters } from './HtmlViewer';
import { DesignBrowserPanel } from './DesignBrowserPanel';
import { CanvasWorkspace } from './workspace/CanvasWorkspace';
import { TabLauncherMenu } from './workspace/TabLauncherMenu';
import { buildLauncherActions, type LauncherContext } from './workspace/tab-launcher';
import { AppTabSurface, createAppTab, createAppDocTab, tenantHeaders, type RegisteredAppEntry } from '../app-surfaces';
import { openBoundDoc, callDocAction } from '../app-surfaces/doc-protocol';
import { documentFileToMarkdown, documentDropTitle } from '../utils/document-import';
import type { ProjectAppWorkspaceTab } from '@bezier/contracts';
import { SketchWorkspaceTab } from './workspace/SketchWorkspaceTab';
import { CanvasSketchCard } from './workspace/CanvasSketchCard';
import { SketchEnginePrewarm } from './SketchEnginePrewarm';
import { emptySketchScene, serializeExcalidrawSketchScene, readSketchWorkspaceDocument } from './sketch-model';
import { deleteProjectFile, fetchProjectFiles, fetchProjectFileText, renameProjectFile, uploadProjectFiles, writeProjectTextFile, WorkspaceApiError } from '../providers/registry';
import { cacheTabs, loadTabs, persistTabs, moveWorkspaceTab,updateBrowserTabInfo } from '../state/workspace-tabs';
import '../styles/workspace/design-files.css';
export const DESIGN_FILES_TAB = '__design_files__';
export type WorkspacePorts = {
    onSubmitAgentTask?: AgentTaskSubmitter;
    transport?: CanvasTransport;
    htmlViewerAdapters?: HtmlViewerAdapters;
    previewAnnotations?:Pick<ComponentProps<typeof DesignBrowserPanel>,'previewComments'|'onSavePreviewComment'|'onRemovePreviewComment'>;
    isDeck?:boolean;
    referenceAdapter?:import('./QuestionForm').QuestionReferenceAdapter;
    uiHost?: Partial<CanvasUiHost>;
    workspaceContext?: WorkspaceCollabContext | null;
    saveToLibrary?: (file: ProjectFile) => Promise<void>;
    /** Accept a reference into the host's draft, without running an agent task. */
    onStageReference?: (attachment:ChatAttachment)=>void|Promise<void>;
    assetCatalogue?:Pick<AssetLibraryPanelProps,'installedTemplates'|'designSystems'|'onUseTemplate'|'onOpenDesignSystem'>;
    revealFile?: (name?: string) => Promise<boolean>;
    registerBeforeLeave?: (settle:(()=>Promise<boolean>)|null)=>void;
};
export function FileWorkspace({ projectId, projectName, projectKind = 'prototype', uploadDir = '', ports = {} }: {
    projectId: string;
    projectName?: string;
    projectKind?: TrackingProjectKind;
    uploadDir?: string;
    ports?: WorkspacePorts;
}) {
    const t = useT();
    const tRef = useRef(t);
    tRef.current = t;
    const [files, setFiles] = useState<ProjectFile[]>([]);
    const visibleFiles=useMemo(()=>visibleProjectFiles(files),[files]);
    const [tabs, setTabs] = useState<OpenTabsState>({ tabs: [], active: DESIGN_FILES_TAB });
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [launcherOpen, setLauncherOpen] = useState(false);
    const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
    const [assetRequest,setAssetRequest]=useState<AssetLibraryRequest|null>(null);
    const assetRequestRef=useRef<AssetLibraryRequest|null>(null);
    const [fullLibraryOpen,setFullLibraryOpen]=useState(false);
    const [stagedReferences,setStagedReferences]=useState<ChatAttachment[]>([]);
    const cancelAssetSelection=useCallback(()=>{const current=assetRequestRef.current;current?.selection?.controller.abort();if(current?.selection){assetRequestRef.current=null;setAssetRequest(null);}},[]);
    const closeAssetLibrary=useCallback(()=>{cancelAssetSelection();assetRequestRef.current=null;setAssetRequest(null);setFullLibraryOpen(false);setFilesDrawerOpen(false);},[cancelAssetSelection]);
    // One-click draft recovery for support: ?clearDraft=1 drops the canvas's
    // parked unsaved draft and reloads clean.
    useEffect(() => {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('clearDraft') !== '1') return;
            localStorage.removeItem(`canvas-unsaved:${projectId}`);
            url.searchParams.delete('clearDraft');
            window.location.replace(url.toString());
        } catch { /* ignore */ }
    }, [projectId]);
    useEffect(()=>{setStagedReferences([]);setFullLibraryOpen(false);cancelAssetSelection();assetRequestRef.current=null;setAssetRequest(null);return()=>assetRequestRef.current?.selection?.controller.abort();},[projectId,ports.workspaceContext,cancelAssetSelection]);
    const [filesDrawerWidth, setFilesDrawerWidth] = useState(() => { try {
        const width = Number(localStorage.getItem('bezier-design:canvas-assets-sidebar-width'));
        return width >= 240 && width <= 480 ? width : 320;
    }
    catch {
        return 320;
    } });
    const [draggedTab, setDraggedTab] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<{
        id: string;
        edge: 'before' | 'after';
    } | null>(null);
    const [nodeCreationRequest, setNodeCreationRequest] = useState<CanvasNodeCreationRequest | null>(null);
    const [textDocumentChange, setTextDocumentChange] = useState<TextDocumentChange | null>(null);
    const [textResults, setTextResults] = useState<CanvasTextGenerationResult[]>([]);
    const [artifactResults, setArtifactResults] = useState<CanvasArtifactGenerationResult[]>([]);
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
    const [mountedBrowserTabs, setMountedBrowserTabs] = useState<string[]>([]);
    const [mountedFileTabs, setMountedFileTabs] = useState<string[]>([]);
    const fileInput = useRef<HTMLInputElement>(null);
    const tabBar = useRef<HTMLDivElement>(null);
    const tabsRef = useRef(tabs);
    const persistence = useRef<Promise<void>>(Promise.resolve());
    const flushers = useRef(new Map<string, () => Promise<boolean>>());
    const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});
    const retention=useRef(createManualEditRetention());const navigationSequence=useRef(0);const fileSnapshots=useRef(new Map<string,ProjectFile>());
    const [protectedFiles,setProtectedFiles]=useState<Set<string>>(new Set());
    const syncProtection=useCallback(()=>{const next=retention.current.protectedFiles();setProtectedFiles(current=>current.size===next.size&&[...next].every(name=>current.has(name))?current:next);},[]);
    const viewerCallbacks=useMemo(()=>Object.fromEntries(tabs.tabs.map(name=>[name,{onRetainActivityChange:(_fileName:string,retain:boolean)=>{retention.current.onRetainActivityChange(name,retain);syncProtection();},onManualEditExitHandlerChange:(_fileName:string,handler:(()=>Promise<boolean>)|null)=>{retention.current.onManualEditExitHandlerChange(name,handler);syncProtection();}}])),[tabs.tabs,syncProtection]);
    for(const file of files)if(!retention.current.isProtected(file.name))fileSnapshots.current.set(file.name,file);
    const fileForViewer=(name:string)=>retention.current.isProtected(name)?fileSnapshots.current.get(name)||files.find(file=>file.name===name):files.find(file=>file.name===name);
    useEffect(()=>{const beforeUnload=(event:BeforeUnloadEvent)=>{if(retention.current.protectedFiles().size||Object.values(dirtyTabs).some(Boolean)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);},[dirtyTabs]);
    useEffect(()=>{ports.registerBeforeLeave?.(async()=>{if(!await retention.current.settleAll())return false;return (await Promise.all([...flushers.current.values()].map(flush=>flush()))).every(Boolean);});return()=>ports.registerBeforeLeave?.(null);},[ports.registerBeforeLeave]);
    useEffect(() => { const toggle = () => {if(filesDrawerOpen)closeAssetLibrary();else setFilesDrawerOpen(true);}; window.addEventListener('bezier-design:toggle-project-assets', toggle); return () => window.removeEventListener('bezier-design:toggle-project-assets', toggle); }, [filesDrawerOpen,closeAssetLibrary]);
    useEffect(() => { window.dispatchEvent(new CustomEvent('bezier-design:project-assets-state', { detail: { open: filesDrawerOpen } })); }, [filesDrawerOpen]);
    const active = tabs.active || DESIGN_FILES_TAB;
    const browserTabs = useMemo(() => tabs.browserTabs || [], [tabs.browserTabs]);
    useEffect(()=>{if(active!==DESIGN_FILES_TAB)cancelAssetSelection();},[active,cancelAssetSelection]);
    useEffect(()=>{const controller=assetRequest?.selection?.controller;if(!controller)return;const abort=()=>{if(assetRequestRef.current===assetRequest){const next={...assetRequest,selection:undefined};assetRequestRef.current=next;setAssetRequest(next);}};if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});return()=>controller.signal.removeEventListener('abort',abort);},[assetRequest]);
    const reportError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
    const renderScope=`${projectId}:${JSON.stringify(ports.workspaceContext??null)}`;const currentScope=useRef(renderScope);currentScope.current=renderScope;
    const refreshFiles = useCallback(async () => { const next = await fetchProjectFiles(projectId, { fresh: true, requireAuthoritative: true, workspaceContext: ports.workspaceContext }); if(currentScope.current===renderScope)setFiles(next); }, [projectId, ports.workspaceContext,renderScope]);
    useEffect(() => { let alive = true; setReady(false);setTextResults([]);setArtifactResults([]);setMountedBrowserTabs([]);setMountedFileTabs([]);setError(''); Promise.all([fetchProjectFiles(projectId, { requireAuthoritative: true, workspaceContext: ports.workspaceContext }), loadTabs(projectId, ports.workspaceContext)]).then(([nextFiles, nextTabs]) => { if (!alive)
        return; setFiles(nextFiles); tabsRef.current = nextTabs; setTabs(nextTabs); setReady(true); }).catch(reportError); return () => { alive = false; }; }, [projectId, ports.workspaceContext, reportError]);
    useEffect(() => { const receive = (event: Event) => { if ((event as CustomEvent<{
        projectId: string;
    }>).detail?.projectId === projectId)
        void refreshFiles().catch(reportError); }; window.addEventListener('canvas-workspace:files-changed', receive); return () => window.removeEventListener('canvas-workspace:files-changed', receive); }, [projectId, refreshFiles, reportError]);
    const updateTabs = useCallback((change: (current: OpenTabsState) => OpenTabsState) => { const changed=change(tabsRef.current);if(changed===tabsRef.current)return;const next = cacheTabs(projectId, changed); tabsRef.current = next; setTabs(next); persistence.current = persistence.current.catch(() => { }).then(() => persistTabs(projectId, next, ports.workspaceContext)); void persistence.current.catch(reportError); }, [projectId, ports.workspaceContext, reportError]);
    const browserInfoCallbacks=useMemo(()=>Object.fromEntries(tabs.tabs.map(id=>[id,(info:import('./DesignBrowserPanel').BrowserPageInfo)=>updateTabs(state=>updateBrowserTabInfo(state,id,info))])),[tabs.tabs,updateTabs]);
    const navigate=useCallback(async(change:()=>void,targetToSettle?:string)=>{const source=tabsRef.current.active||DESIGN_FILES_TAB;const sequence=++navigationSequence.current;const target=targetToSettle||source;if(retention.current.isProtected(target)){const settled=await retention.current.settle(target);syncProtection();if(!settled)return false;}if(sequence!==navigationSequence.current||(tabsRef.current.active||DESIGN_FILES_TAB)!==source)return false;change();return true;},[syncProtection]);
    const openFile=useCallback((name:string)=>{void navigate(()=>updateTabs(state=>({...state,tabs:name===DESIGN_FILES_TAB?state.tabs:state.tabs.includes(name)?state.tabs:[...state.tabs,name],active:name}))).catch(reportError);},[navigate,updateTabs,reportError]);
    const closeTab=useCallback(async(name:string)=>{const source=tabsRef.current.active;const sequence=++navigationSequence.current;const settled=await retention.current.settle(name);syncProtection();if(!settled)return;const flush=flushers.current.get(name);if(flush&&!await flush())return;if(sequence!==navigationSequence.current||tabsRef.current.active!==source)return;updateTabs(state=>{const index=state.tabs.indexOf(name);const next=state.tabs.filter(id=>id!==name);return {...state,tabs:next,browserTabs:state.browserTabs?.filter(tab=>tab.id!==name),appTabs:state.appTabs?.filter(tab=>tab.id!==name),active:state.active===name?next[Math.min(index,next.length-1)]||DESIGN_FILES_TAB:state.active};});},[updateTabs,syncProtection]);
    const showAssetLibrary=useCallback((request:AssetLibraryRequest)=>{
        if(request.selection?.controller.signal.aborted)return;
        void navigate(()=>{if(assetRequestRef.current?.selection?.controller!==request.selection?.controller)assetRequestRef.current?.selection?.controller.abort();assetRequestRef.current=request;setAssetRequest(request);setFullLibraryOpen(Boolean(request.full));setFilesDrawerOpen(!request.full);updateTabs(state=>({...state,active:DESIGN_FILES_TAB}));}).then(accepted=>{if(!accepted)request.selection?.controller.abort();}).catch(cause=>{request.selection?.controller.abort();reportError(cause);});
    },[navigate,updateTabs,reportError]);
    useEffect(()=>{const receive=(event:Event)=>{const request=(event as CustomEvent<AssetLibraryRequest>).detail;if(request&&(!request.projectId||request.projectId===projectId))showAssetLibrary(request);};window.addEventListener(OPEN_ASSET_LIBRARY_EVENT,receive);return()=>window.removeEventListener(OPEN_ASSET_LIBRARY_EVENT,receive);},[projectId,showAssetLibrary]);
    useEffect(()=>{const receive=(event:Event)=>{const detail=(event as CustomEvent<{projectId:string;url:string}>).detail;if(detail?.projectId!==projectId)return;let url:URL;try{url=new URL(detail.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;}catch{return;}void navigate(()=>updateTabs(state=>{const existing=state.browserTabs?.find(tab=>tab.url===url.href);if(existing)return {...state,active:existing.id};const id=`__browser__:${crypto.randomUUID()}`;return {...state,tabs:[...state.tabs,id],active:id,browserTabs:[...(state.browserTabs||[]),{id,label:t('workspace.newBrowser'),url:url.href}]};})).catch(reportError);};window.addEventListener(OPEN_COLLECTOR_TAB_EVENT,receive);return()=>window.removeEventListener(OPEN_COLLECTOR_TAB_EVENT,receive);},[projectId,navigate,updateTabs,reportError,t]);
    const [taskBridge,setTaskBridge]=useState<ReturnType<typeof createCanvasTaskSubmitter>|null>(null);
    useEffect(()=>{const client=createCanvasTaskSubmitter({context:{projectId,workspaceContext:ports.workspaceContext,transport:ports.transport},onTask:task=>{if(task.status==='failed'||task.status==='interrupted'||task.deliveryState==='delivery_failed')reportError(new Error(task.error||tRef.current('workspace.taskIncomplete', { id: task.id })));},onTextResult:result=>{setTextResults(current=>[...current.filter(item=>item.binding.nodeId!==result.binding.nodeId),result]);void refreshFiles().catch(reportError);},onArtifactResult:result=>{setArtifactResults(current=>[...current.filter(item=>item.binding.nodeId!==result.binding.nodeId),result]);void refreshFiles().catch(reportError);},onError:reportError});setTaskBridge(client);return()=>client.dispose();},[projectId,ports.workspaceContext,ports.transport,refreshFiles,reportError]);
    const submitAgentTask=useCallback<AgentTaskSubmitter>(async(text,display,attachments)=>{
        const staged=stagedReferences;
        const nextDisplay=staged.length?{...(display??{kind:'instruction-card' as const,title:text.split('\n')[0]!.slice(0,120)}),inputPaths:[...new Set([...(display?.inputPaths??[]),...staged.map(item=>item.path)])]}:display;
        if(ports.onSubmitAgentTask)await ports.onSubmitAgentTask(text,nextDisplay,attachments);
        else {if(!taskBridge)throw new Error(tRef.current('workspace.taskClientNotReady'));await taskBridge.submit(text,nextDisplay,attachments);}
        if(staged.length)setStagedReferences(current=>current.filter(item=>!staged.includes(item)));
    },[ports.onSubmitAgentTask,taskBridge,stagedReferences]);
    const sendComments = useCallback(async (attachments: ChatCommentAttachment[], images: File[] = []): Promise<CommentSendResult> => { await submitAgentTask(messageContentWithCommentAttachments('', attachments), undefined, images); return { status: 'accepted', commentIds: attachments.map(item => item.id) }; }, [submitAgentTask]);
    const sendImageReference = useCallback(async (attachment: ChatAttachment) => {
        if(currentScope.current!==renderScope)throw new Error(t('asset.error.saveCancelled'));
        if(ports.onStageReference){await ports.onStageReference(attachment);return;}
        setStagedReferences(current=>[...current.filter(item=>item.path!==attachment.path),attachment]);
    }, [ports.onStageReference,renderScope,t]);
    const saveToLibrary=useCallback(async(file:ProjectFile)=>{if(ports.saveToLibrary)await ports.saveToLibrary(file);else await saveProjectFileAsAsset(projectId,file.name,ports.workspaceContext);},[ports.saveToLibrary,projectId,ports.workspaceContext]);
    const extractPage=useCallback(async(request:import('./browser-page-extraction').BrowserPageExtractionRequest)=>{const turn=browserPageExtractionTurn(request,t('designBrowser.extractPage'),t);await submitAgentTask(turn.prompt,{kind:'instruction-card',title:t('designBrowser.extractPage'),visiblePrompt:turn.meta.visiblePrompt,executionContext:turn.meta,inputPaths:turn.inputPaths});},[submitAgentTask,t]);
    // Agent task recovery was removed with the server-side /agent/tasks API.
    useEffect(() => { if (typeof EventSource === 'undefined')
        return; const source = new EventSource(workspaceResourceUrl(`/api/projects/${encodeURIComponent(projectId)}/events`, ports.workspaceContext)); let timer: ReturnType<typeof setTimeout> | undefined; const changed = () => { if (timer)
        clearTimeout(timer); timer = setTimeout(() => void refreshFiles().catch(reportError), 120); }; source.addEventListener('file-changed', changed); source.addEventListener('ready', changed); return () => { if (timer)
        clearTimeout(timer); source.close(); }; }, [projectId, ports.workspaceContext, refreshFiles, reportError]);
    const rename = useCallback(async (from: string, to: string) => { try {
        if(!await retention.current.settle(from))return null;syncProtection();
        const flush = flushers.current.get(from);
        if (flush && !await flush())
            return null;
        const result = await renameProjectFile(projectId, from, to, ports.workspaceContext);
        if (!result.file)
            throw new Error(tRef.current('workspace.renameMissingFile'));
        const canonical = result.file.name;
        updateTabs(state => ({ ...state, tabs: state.tabs.map(id => id === from ? canonical : id), active: state.active === from ? canonical : state.active }));
        await refreshFiles();
        return result.file;
    }
    catch (cause) {
        reportError(cause);
        return null;
    } }, [projectId, ports.workspaceContext, updateTabs, refreshFiles, reportError]);
    const removeFiles = useCallback(async (names: string[]) => { const deleted: string[] = []; for (const name of names) {
        try {
            if(!await retention.current.settle(name))continue;syncProtection();const flush=flushers.current.get(name);if(flush&&!await flush())continue;
            await deleteProjectFile(projectId, name, ports.workspaceContext);
            deleted.push(name);
        }
        catch (cause) {
            reportError(cause);
        }
    } updateTabs(state => ({ ...state, tabs: state.tabs.filter(id => !deleted.includes(id)), active: deleted.includes(state.active || '') ? DESIGN_FILES_TAB : state.active })); await refreshFiles(); return deleted; }, [projectId, ports.workspaceContext, updateTabs, refreshFiles, reportError]);
    const createFile = useCallback(async (kind: 'text' | 'sketch') => { const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); const base = `sketch-${stamp}.sketch.json`; const name = kind === 'sketch' ? (uploadDir ? `${uploadDir}/${base}` : base) : nextMarkdownDocumentPath(files, uploadDir); const file = await writeProjectTextFile(projectId, name, kind === 'sketch' ? serializeExcalidrawSketchScene(emptySketchScene(name), name) : initialMarkdownDocument(name, projectKind, t), undefined, ports.workspaceContext); if (!file)
        throw new Error(tRef.current('workspace.createMissingFile')); await refreshFiles(); openFile(file.name); }, [files, projectId, projectKind, uploadDir, ports.workspaceContext, refreshFiles, openFile, t]);
    const [registeredApps, setRegisteredApps] = useState<RegisteredAppEntry[]>([]);
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch('/api/apps');
                if (!res.ok) return;
                const body = await res.json();
                const apps = ((body?.data?.apps ?? []) as RegisteredAppEntry[])
                    .filter(app => app.appId !== 'canvas' && app.status !== 'disabled' && app.endpoint);
                if (!cancelled) setRegisteredApps(apps);
            } catch { /* registry unreachable → menu stays empty */ }
        };
        void load();
        const timer = setInterval(load, 15000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);
    const cardWaiters = useRef(new Map<string, (nodeId: string) => void>());
    const requestCanvasCard = useCallback((kind: 'text', position?: { x: number; y: number }) => new Promise<string>((resolve, reject) => {
        const nonce = crypto.randomUUID();
        cardWaiters.current.set(nonce, resolve);
        setNodeCreationRequest({ nonce, kind, ...(position ? { position } : {}) });
        setTimeout(() => { if (cardWaiters.current.delete(nonce)) reject(new Error('card create timeout')); }, 8000);
    }), []);
    const openAppTab = useCallback((app: RegisteredAppEntry) => {
        void (async () => {
            // Tab ↔ card pairing goes through the canvas's own creation
            // channel — the card lands at viewport center and stays on the
            // workbench's revision chain (deletes/edits keep working).
            let tab;
            if (app.appId === 'doc') {
                const nodeId = await requestCanvasCard('text');
                const stRes = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`, { headers: tenantHeaders() });
                if (!stRes.ok) throw new Error(`canvas state ${stRes.status}`);
                const st = await stRes.json() as { data?: { state?: { workbenchBasicNodes?: { id: string; projectFilePath?: string }[] } } };
                const mirrorPath = st.data?.state?.workbenchBasicNodes?.find(n => n.id === nodeId)?.projectFilePath;
                const res = await fetch(`${app.endpoint}/actions/doc.create`, { method: 'POST', headers: { 'content-type': 'application/json', ...tenantHeaders() }, body: JSON.stringify({ input: { nodeId, name: '未命名文档', mirrorCanvasId: projectId, ...(mirrorPath ? { mirrorPath } : {}) } }) });
                if (!res.ok) throw new Error(`doc create ${res.status}`);
                const { instanceId } = (await res.json() as { data: { result: { instanceId: string } } }).data.result;
                tab = createAppDocTab('doc', instanceId, '未命名文档', mirrorPath);
            } else {
                tab = await createAppTab(app);
            }
            await navigate(() => updateTabs(state => ({ ...state, tabs: state.tabs.includes(tab.id) ? state.tabs : [...state.tabs, tab.id], active: tab.id, appTabs: [...(state.appTabs ?? []).filter(item => item.id !== tab.id), tab] })));
        })().catch(reportError);
    }, [navigate, updateTabs, reportError, requestCanvasCard, projectId]);
    /** OS document drop: each file becomes a bound doc (App-owned truth) +
     * text card at the drop point + an open editor tab. md/txt pass through;
     * .docx is converted to markdown in the browser first. */
    const handleDocumentsDrop = useCallback((files: File[], flowPosition: { x: number; y: number }) => {
        void (async () => {
            const docApp = registeredApps.find(app => app.appId === 'doc' && (!app.status || app.status === 'active'));
            const createdTabs: ProjectAppWorkspaceTab[] = [];
            for (const [index, file] of files.entries()) {
                const position = { x: flowPosition.x + index * 24, y: flowPosition.y + index * 24 };
                const content = await documentFileToMarkdown(file);
                // A File entry with no bytes (virtual drop source, or a truly
                // empty file) must not create a ghost card+doc pair — say so.
                if (!content.trim()) {
                    reportError(new Error(`「${file.name}」没有读到内容——若从聊天窗/下载栏拖入，请改用访达中的原文件。`));
                    continue;
                }
                const title = documentDropTitle(file.name);
                const nodeId = await requestCanvasCard('text', position);
                // mirrorPath is a hint, not required input — doc-side mirror
                // resolves the card's current file by nodeId on every write.
                let mirrorPath: string | undefined;
                for (let attempt = 0; attempt < 2 && !mirrorPath; attempt++) {
                    if (attempt) await new Promise(resolve => setTimeout(resolve, 600));
                    try {
                        const stRes = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`, { headers: tenantHeaders() });
                        if (stRes.ok) {
                            const st = await stRes.json() as { data?: { state?: { workbenchBasicNodes?: { id: string; projectFilePath?: string }[] } } };
                            mirrorPath = st.data?.state?.workbenchBasicNodes?.find(n => n.id === nodeId)?.projectFilePath;
                        }
                    } catch { /* state fetch is best-effort; the doc App re-resolves */ }
                }
                if (!docApp?.endpoint) {
                    // Doc app offline: honour the drop by writing straight into
                    // the card file so the import still lands on canvas.
                    if (mirrorPath) {
                        await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(mirrorPath)}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...tenantHeaders() }, body: JSON.stringify({ content }) });
                    }
                    continue;
                }
                const document = await openBoundDoc(docApp.endpoint, { nodeId, name: title, content, mirrorCanvasId: projectId, ...(mirrorPath ? { mirrorPath } : {}) }, tenantHeaders());
                // Write the IMPORTED text, not the dedupe-hit doc body — the
                // canvas-side doc synchronizer may have already bound an empty
                // doc (named after the card) to this fresh node.
                let written = await callDocAction(docApp.endpoint, 'doc.write', { content }, tenantHeaders(), document.instanceId);
                if (written.mirror?.status && written.mirror.status !== 'synced') {
                    // The fresh card's canvas op may still be in the persist
                    // queue — one delayed retry covers that sub-second race.
                    await new Promise(resolve => setTimeout(resolve, 800));
                    written = await callDocAction(docApp.endpoint, 'doc.write', { content }, tenantHeaders(), document.instanceId);
                }
                if (written.mirror?.status && written.mirror.status !== 'synced') reportError(new Error('文档已导入，但画布副本同步未确认。请保留文档正文后再试。'));
                // Push the imported text into the still-local card so it shows
                // content immediately — the server round-trip would take a
                // visible beat otherwise.
                if (mirrorPath) setTextDocumentChange({ path: mirrorPath, content, revision: Date.now() });
                // Dedupe may return the synchronizer's card-named doc — take
                // the file's name so the doc/tab reads like the dropped file.
                if (document.name && document.name !== title) {
                    await callDocAction(docApp.endpoint, 'doc.rename', { name: title }, tenantHeaders(), document.instanceId).catch(() => null);
                }
                createdTabs.push(createAppDocTab('doc', document.instanceId, title, mirrorPath));
            }
            if (createdTabs.length) {
                await navigate(() => updateTabs(state => {
                    const tabIds = [...state.tabs];
                    const appTabs = [...(state.appTabs ?? [])];
                    for (const tab of createdTabs) {
                        if (!tabIds.includes(tab.id)) tabIds.push(tab.id);
                        const existing = appTabs.findIndex(item => item.id === tab.id);
                        if (existing >= 0) appTabs[existing] = tab; else appTabs.push(tab);
                    }
                    return { ...state, tabs: tabIds, active: createdTabs[createdTabs.length - 1]!.id, appTabs };
                }));
            }
        })().catch(reportError);
    }, [navigate, updateTabs, reportError, requestCanvasCard, projectId, registeredApps]);
    const appTabs = tabs.appTabs ?? [];
    const launcherContext: LauncherContext = { projectId, openTab: openFile, apps: registeredApps, openAppTab, createBrowser: () => {void navigate(()=>{const id=`__browser__:${crypto.randomUUID()}`;updateTabs(state=>({...state,tabs:[...state.tabs,id],active:id,browserTabs:[...(state.browserTabs||[]),{id,label:t('workspace.newBrowser')}]}));}).catch(reportError);}, createSketch: () => void createFile('sketch').catch(reportError), createDocument: () => void createFile('text').catch(reportError), };
    const sketchCallbacks = useMemo(() => Object.fromEntries(tabs.tabs.map(name => [name, { onDirtyChange: (dirty: boolean) => setDirtyTabs(current => current[name] === dirty ? current : { ...current, [name]: dirty }), registerFlush: (flush: (() => Promise<boolean>) | null) => { if (flush)
                flushers.current.set(name, flush);
            else
                flushers.current.delete(name); } }])), [tabs.tabs]);
    useEffect(() => { const selected = tabBar.current?.querySelector<HTMLElement>('[aria-selected="true"]'); selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active]);
    useEffect(() => { if (browserTabs.some(tab => tab.id === active))
        setMountedBrowserTabs(current => [...current.filter(id => id !== active && tabs.tabs.includes(id)), active].slice(-3));
    else if (files.some(file => file.name === active))
        setMountedFileTabs(current => { const next = [...current.filter(id => id !== active && tabs.tabs.includes(id)), active]; const html = next.filter(id => files.find(file => file.name === id)?.kind === 'html'); return next.filter(id => !html.includes(id) || html.slice(-3).includes(id) || dirtyTabs[id] || protectedFiles.has(id)); }); }, [active, tabs.tabs, files, browserTabs, dirtyTabs,protectedFiles]);
    useEffect(() => { const onKeyDown = (e: KeyboardEvent) => { if (e.defaultPrevented || e.isComposing)
        return; const key = e.key; const primary = (e.metaKey || e.ctrlKey) && !e.altKey; const ctrl = e.ctrlKey && !e.metaKey && !e.altKey; const commandOption = e.metaKey && e.altKey && !e.ctrlKey; const ids = [DESIGN_FILES_TAB, ...tabs.tabs]; const consume = () => { e.preventDefault(); e.stopPropagation(); }; const offset = (delta: number) => openFile(ids[(Math.max(0, ids.indexOf(active)) + delta + ids.length) % ids.length]!); if (primary && !e.shiftKey && key.toLowerCase() === 't') {
        consume();
        setLauncherOpen(true);
    }
    else if (primary && !e.shiftKey && key.toLowerCase() === 'w') {
        consume();
        if (active !== DESIGN_FILES_TAB)
            void closeTab(active).catch(reportError);
    }
    else if (ctrl && key === 'Tab') {
        consume();
        offset(e.shiftKey ? -1 : 1);
    }
    else if (!e.shiftKey && ((ctrl && key === 'PageDown') || (commandOption && key === 'ArrowRight'))) {
        consume();
        offset(1);
    }
    else if (!e.shiftKey && ((ctrl && key === 'PageUp') || (commandOption && key === 'ArrowLeft'))) {
        consume();
        offset(-1);
    }
    else if (primary && !e.shiftKey && /^[1-9]$/.test(key)) {
        consume();
        const id = ids[key === '9' ? ids.length - 1 : Number(key) - 1];
        if (id)
            openFile(id);
    }
    else if ((/Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === 'p') {
        consume();
        setQuickSwitcherOpen(open => !open);
    }
    else if (key === 'Escape' && quickSwitcherOpen)
        setQuickSwitcherOpen(false); }; window.addEventListener('keydown', onKeyDown, { capture: true }); return () => window.removeEventListener('keydown', onKeyDown, { capture: true }); }, [active, tabs.tabs, openFile, closeTab, quickSwitcherOpen, reportError]);
    if (!ready)
        return <div className="viewer-empty" role={error ? 'alert' : undefined}>{error || t('fileViewer.loading')}</div>;
    return <IframeKeepAliveProvider><SaveAssetDialogHost/><BrowserExtensionCaptureHost projectId={projectId} projectName={projectName}/><div className="workspace" data-testid="file-workspace">
  <SketchEnginePrewarm />
  {fullLibraryOpen?<AssetLibraryBrowser {...ports.assetCatalogue} projectId={projectId} openRequest={assetRequest} onCancelSelection={cancelAssetSelection} onRefreshFiles={refreshFiles} onClose={closeAssetLibrary}/>:null}
  <div className="ws-tabs-shell">
   <div ref={tabBar} className="ws-tabs-bar" role="tablist" aria-label={t('workspace.pages')} onWheel={event => { if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX))
        event.currentTarget.scrollLeft += event.deltaY; }}>
    <Button type="button" className={`ws-tab design-files-tab ${active === DESIGN_FILES_TAB ? 'active' : ''}`} role="tab" aria-selected={active === DESIGN_FILES_TAB} data-testid="design-files-tab" onClick={() => openFile(DESIGN_FILES_TAB)}><span className="tab-icon" aria-hidden><Icon name="grid" size={14}/></span><span className="ws-tab-label">{projectName || t('workspace.designFiles')}</span></Button>
    {tabs.tabs.map(name => { const browser = browserTabs.find(tab => tab.id === name); const appTab = appTabs.find(tab => tab.id === name); const file = files.find(file => file.name === name); return <Tab key={name} label={`${appTab?.label || browser?.title || browser?.label || name}${dirtyTabs[name] ? ' •' : ''}`} title={appTab ? `${appTab.appId} · ${appTab.target ?? ''}` : browser?.url || name} kind={browser ? 'browser' : file?.kind}  active={active === name} onActivate={() => openFile(name)} onClose={() => void closeTab(name).catch(reportError)} draggable dragging={draggedTab === name} dragOverEdge={dragOver?.id === name ? dragOver.edge : null} onDragStart={event => { setDraggedTab(name); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', name); }} onDragOver={event => { event.preventDefault(); setDragOver({ id: name, edge: event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2 ? 'after' : 'before' }); }} onDrop={event => { event.preventDefault(); if (draggedTab)
        updateTabs(state => ({ ...state, tabs: moveWorkspaceTab(state.tabs, draggedTab, name, dragOver?.edge === 'after') })); setDraggedTab(null); setDragOver(null); }} onDragEnd={() => { setDraggedTab(null); setDragOver(null); }}/>; })}
   </div>
   <div className="ws-add-tab"><TabLauncherMenu open={launcherOpen} onOpenChange={setLauncherOpen} trigger={<Button type="button" className="icon-only ws-tab-add bezier-tooltip" data-testid="workspace-add-tab" aria-label={t('workspace.newTab')} title={t('workspace.newTab')}><Icon name="plus" size={15}/></Button>} actions={buildLauncherActions(launcherContext)} launcherContext={launcherContext}/></div>
   <div className="ws-tabs-actions"><WorkspaceReferenceTray projectId={projectId} workspaceContext={ports.workspaceContext} references={stagedReferences} onRemove={path=>setStagedReferences(current=>current.filter(item=>item.path!==path))} onClear={()=>setStagedReferences([])}/><div id="app-chrome-file-actions" className="ws-tabs-file-actions" data-app-chrome-file-actions="true"/></div>
  </div>
  <div className="ws-workspace-layout">
   <div className="ws-body">
   {error && <div className="df-upload-banner" data-testid="upload-error-banner" role="alert"><span>{error}</span><Button onClick={() => setError('')} aria-label={t('entry.canvasAssets.close')}><Icon name="close" size={14}/></Button></div>}
   {browserTabs.filter(browser => browser.id === active || mountedBrowserTabs.includes(browser.id)).map(browser => <div key={browser.id} className={`ws-browser-panel ${active === browser.id ? 'active' : ''}`} aria-hidden={active !== browser.id || undefined}><DesignBrowserPanel {...ports.previewAnnotations} workspaceContext={ports.workspaceContext} onExtractPage={extractPage} onSendBoardCommentAttachments={sendComments} onAddImageToChat={sendImageReference} projectId={projectId} browserTabId={browser.id} initialUrl={browser.url} initialTitle={browser.title} initialIconUrl={browser.iconUrl} onOpenFile={openFile} onBezierFiles={() => openFile(DESIGN_FILES_TAB)} onRefreshFiles={refreshFiles} onPageInfoChange={browserInfoCallbacks[browser.id]}/></div>)}
   {appTabs.filter(tab => tab.id === active).map(tab => <div key={tab.id} className="ws-app-panel" style={{ display: active === tab.id ? undefined : 'none', height: '100%', overflow: 'auto' }}><AppTabSurface tab={tab} app={registeredApps.find(app => app.appId === tab.appId)} canvasId={projectId} {...sketchCallbacks[tab.id]} onMirrorSaved={(path, content) => { setTextDocumentChange({ path, content, revision: Date.now() }); }}/></div>)}
   <div className="design-files-shell" data-testid="design-files-shell" style={{ display: active === DESIGN_FILES_TAB ? undefined : 'none' }}>
    <div className={`design-files-panel${filesDrawerOpen ? ' is-open' : ''}`} data-resizable-file-panel="true" style={{ ['--design-files-panel-width' as string]: `${filesDrawerWidth}px` }} role="region" aria-label={t('workspace.designFiles')} data-testid="design-files-panel" aria-hidden={!filesDrawerOpen || undefined}>
     <div className="design-files-panel-body"><CanvasAssetsSidebar {...ports.assetCatalogue} openRequest={assetRequest} onCancelSelection={cancelAssetSelection} onOpenAssetLibrary={showAssetLibrary} onExtractPage={extractPage} projectId={projectId} projectName={projectName} active={filesDrawerOpen} files={visibleFiles} onClose={closeAssetLibrary} width={filesDrawerWidth} onWidthChange={width => { setFilesDrawerWidth(width); try {
        localStorage.setItem('bezier-design:canvas-assets-sidebar-width', String(width));
    }
    catch { /* Optional local preference storage. */ } }} onRefreshFiles={refreshFiles} onOpenFile={openFile} onRenameFile={rename} onDeleteFiles={removeFiles} onDeleteFile={name => { if (window.confirm(t('entry.canvasAssets.deleteBatchBody')))
        void removeFiles([name]).catch(reportError); }} onUpload={() => fileInput.current?.click()} onLocateFile={name => window.dispatchEvent(new CustomEvent('bezier-design:locate-project-file', { detail: { projectId, fileName: name } }))} onSaveToLibrary={saveToLibrary} onRevealInFinder={ports.revealFile}/></div>
    </div>
    <div className="design-files-canvas-wrap"><div className="design-files-canvas-slot"><CanvasWorkspace onStageCanvasObject={undefined} onStageChatAttachments={undefined} referenceAdapter={ports.referenceAdapter} projectId={projectId} workspaceContext={ports.workspaceContext} transport={ports.transport} onSubmitAgentTask={submitAgentTask} textGenerationResults={textResults} artifactGenerationResults={artifactResults} textDocumentChange={textDocumentChange} nodeCreationRequest={nodeCreationRequest} onDocumentsDrop={handleDocumentsDrop} onNodeCreationConsumed={(nonce, id) => { setNodeCreationRequest(current => current?.nonce === nonce ? null : current); cardWaiters.current.get(nonce)?.(id); cardWaiters.current.delete(nonce); }} onOpenArtifact={async (resource) => { if (resource.kind !== 'project-file')
        throw new Error(tRef.current('workspace.externalArtifactRequired')); await refreshFiles(); openFile(resource.path); }} onOpenTextDocument={async (request) => { let content: string | null = null; try {
        content = await fetchProjectFileText(projectId, request.path, { workspaceContext: ports.workspaceContext });
    }
    catch (cause) {
        if (!(cause instanceof WorkspaceApiError && cause.status === 404))
            throw cause;
    } if (content === null || (request.preferContent && content !== request.content)) {
        await writeProjectTextFile(projectId, request.path, request.content, undefined, ports.workspaceContext);
        content = request.content;
    } setTextDocumentChange({ path: request.path, content, revision: Date.now() }); await refreshFiles(); const docApp = registeredApps.find(app => app.appId === 'doc' && (!app.status || app.status === 'active'));
    if (docApp) {
        const document = await openBoundDoc(docApp.endpoint, { ...(request.nodeId ? { nodeId: request.nodeId } : {}), name: request.title, content, mirrorCanvasId: projectId, mirrorPath: request.path }, tenantHeaders());
        // Read-only reconciliation: opening a tab must never decide that a
        // stale canvas mirror is newer than the App-owned document.
        if (document.content !== content) reportError(new Error('文档与画布副本尚未同步，已保留两边内容。详情显示文档 App 的正文，请确认内容后保存；不会自动覆盖。'));
        const detailTab = createAppDocTab('doc', document.instanceId, document.name || request.title, request.path);
        updateTabs(state => ({ ...state, tabs: state.tabs.includes(detailTab.id) ? state.tabs : [...state.tabs, detailTab.id], active: detailTab.id, appTabs: [...(state.appTabs ?? []).filter(item => item.id !== detailTab.id), detailTab] }));
        return { content };
    }
    openFile(request.path); return { content }; }} uiHost={{ ...ports.uiHost, renderSketch: ({ path, selected, pending, onCreated }) => <CanvasSketchCard path={path} projectId={projectId} selected={selected} file={files.find(file => file.name === path)} onOpen={async (path) => { try {
            const content = await fetchProjectFileText(projectId, path, { workspaceContext: ports.workspaceContext });
            readSketchWorkspaceDocument(content, tRef.current);
        }
        catch (cause) {
            if (!(pending && cause instanceof WorkspaceApiError && cause.status === 404))
                throw cause;
            await writeProjectTextFile(projectId, path, serializeExcalidrawSketchScene(emptySketchScene(path), path), undefined, ports.workspaceContext);
        } await refreshFiles(); await onCreated(); openFile(path); }}/>, duplicateSketch: async (source, destination, pending) => { let content: string | null = null; try {
            content = await fetchProjectFileText(projectId, source, { workspaceContext: ports.workspaceContext });
            readSketchWorkspaceDocument(content, tRef.current);
        }
        catch (cause) {
            if (pending && cause instanceof WorkspaceApiError && cause.status === 404)
                content = serializeExcalidrawSketchScene(emptySketchScene(destination), destination);
            else
                throw cause;
        } await writeProjectTextFile(projectId, destination, content!, undefined, ports.workspaceContext); await refreshFiles(); } }}/></div>
    </div>
   </div>
   {tabs.tabs.filter(name => !name.startsWith('app:') && !browserTabs.some(tab => tab.id === name) && (name === active || mountedFileTabs.includes(name)||protectedFiles.has(name))).map(name => { const file = fileForViewer(name); return <div key={name} className="standalone-file-panel" hidden={active !== name}>{file ? (file.kind === 'sketch' || /\.(excalidraw|sketch\.json)$/i.test(name)) ? <SketchWorkspaceTab workspaceContext={ports.workspaceContext} projectId={projectId} file={file} onRefreshFiles={refreshFiles} onOpenFile={openFile} onRename={rename} {...sketchCallbacks[name]!}/> : <FileViewer projectId={projectId} file={file} projectKind={projectKind} isDeck={ports.isDeck} projectName={projectName} {...viewerCallbacks[name]!} manualEditEntryAllowed={protectedFiles.size===0||protectedFiles.has(name)} adapters={ports.htmlViewerAdapters} onSendBoardCommentAttachments={sendComments} workspaceActive={active === name} onFileSaved={refreshFiles} onTextSaved={(path, content) => setTextDocumentChange({ path, content, revision: Date.now() })}/> : <div className="viewer-empty">{t('fileViewer.previewUnavailable')} — {name}</div>}</div>; })}
  </div>
  </div>
  <input ref={fileInput} type="file" multiple hidden onChange={event => { const selected = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; if (selected.length)
        void uploadProjectFiles(projectId, selected, uploadDir, ports.workspaceContext).then(async (result) => { if (result.uploaded.length) {
            await refreshFiles();
            openFile(result.uploaded[result.uploaded.length - 1]!.path);
        } if (result.failed.length)
            throw new Error(result.error || result.failed[0]?.error); }).catch(reportError); }}/>
 <AnimatePresence>{quickSwitcherOpen && <QuickSwitcher projectId={projectId} files={visibleFiles} onOpenFile={openFile} onOpenTab={openFile} workspaceContexts={browserTabs.map(tab => ({ id: tab.id, kind: 'browser', label: tab.title || tab.label, url: tab.url, tabId: tab.id }))} onClose={() => setQuickSwitcherOpen(false)}/>}</AnimatePresence>
 </div></IframeKeepAliveProvider>;
}
const Tab = memo(function Tab({ label, meta, title, active, onActivate, onClose, closable = true, kind, iconNameOverride, draggable = false, dragging = false, dragOverEdge, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, }: {
    label: string;
    meta?: string;
    title?: string;
    active: boolean;
    onActivate: () => void;
    onClose?: () => void;
    closable?: boolean;
    kind?: ProjectFile['kind'] | 'live-artifact' | 'browser';
    /** Force a specific icon (e.g. non-file tabs like terminal:<id> / chat:<id>). */
    iconNameOverride?: IconName;
    /** Team-share sync state for this tab's file. Replaces the file-type icon
     *  with an animated downloading/uploading badge while set. */
    draggable?: boolean;
    dragging?: boolean;
    dragOverEdge?: 'before' | 'after' | null;
    onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDragLeave?: () => void;
    onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDragEnd?: () => void;
}) {
    const t = useT();
    const iconName = iconNameOverride ?? kindIconName(kind);
    const tabTitle = title ?? (meta ? `${label} ${meta}` : label);
    const tabTooltip = tabTitle;
    return (<div className={[
            'ws-tab',
            'bezier-tooltip',
            meta ? 'has-meta' : '',
            kind === 'live-artifact' ? 'live-artifact-tab' : '',
            kind === 'browser' ? 'browser-tab' : '',
            active ? 'active' : '',
            draggable ? 'draggable' : '',
            dragging ? 'dragging' : '',
            dragOverEdge ? `drag-over-${dragOverEdge}` : '',
        ].filter(Boolean).join(' ')} onClick={onActivate} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate();
            }
        }} role="tab" aria-selected={active} tabIndex={0} title={tabTooltip} data-tooltip={tabTooltip} data-tooltip-placement="bottom" draggable={draggable} onDragStart={draggable ? onDragStart : undefined} onDragOver={draggable ? onDragOver : undefined} onDragLeave={draggable ? onDragLeave : undefined} onDrop={draggable ? onDrop : undefined} onDragEnd={draggable ? onDragEnd : undefined}>
      {iconName ? (<span className="tab-icon" aria-hidden>
          <Icon name={iconName} size={13}/>
        </span>) : null}
      <span className="ws-tab-text">
        <span className="ws-tab-label">{label}</span>
        {meta ? <span className="ws-tab-meta">{meta}</span> : null}
      </span>
      {closable && onClose ? (<Button type="button" className="ws-tab-close bezier-tooltip" onClick={(e) => {
                e.stopPropagation();
                onClose();
            }} title={t('workspace.closeTab')} data-tooltip={t('workspace.closeTab')} data-tooltip-placement="bottom" aria-label={t('workspace.closeTab')}>
          <Icon name="close" size={11}/>
        </Button>) : null}
    </div>);
});
function kindIconName(kind?: ProjectFile['kind'] | 'live-artifact' | 'browser'): IconName { if (kind === 'browser')
    return 'globe'; if (kind === 'image')
    return 'image'; if (kind === 'sketch')
    return 'pencil'; if (kind === 'video')
    return 'video-ai'; if (kind === 'audio')
    return 'mic'; if (kind === 'html' || kind === 'code')
    return 'file-code'; return 'file-text'; }
