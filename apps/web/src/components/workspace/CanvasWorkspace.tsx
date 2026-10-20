'use client';
/** Original CanvasWorkspace host assembly, with product services injected rather than chat/library imports. */
import { useMemo,useRef,useEffect,useState } from 'react';
import {requestSaveAsset} from '../../state/save-asset';
import { renderWorkspaceAssetPicker } from '../asset-library/WorkspaceAssetPicker';
import { SelectableTemplateGrid } from '../asset-library/SelectableImageMasonry';
import { templateCategoryLabel } from '../asset-library/template-category-label';
import {projectFileUrl} from '../../providers/registry';
import {usePersonalAssetInProject} from '../../providers/asset-library';
import {openAssetLibrary} from '../../state/asset-library-navigation';
import {createAssetLibraryReferenceAdapter} from '../asset-library-reference-adapter';
import { CanvasWorkbenchSurface, CanvasKindAvailability, type CanvasWorkbenchSurfaceProps, type CanvasUiHost } from '@bezier/canvas-workbench';
import type { QuestionReferenceAdapter } from '../question-form-reference-adapter';
import { MarkdownWordDocument } from '@doc/surface';
import { useI18n } from '../../i18n';
import { downloadProjectResource } from '../../providers/project-usage';
import { CanvasArtifactPreview } from './CanvasArtifactPreview';
import { CanvasArtifactThumbnail, cacheCanvasArtifactThumbnail } from './CanvasArtifactThumbnail';
import { renderCanvasWorkbenchDialog, renderCanvasWorkbenchHoverCard, renderCanvasWorkbenchMenu, renderCanvasWorkbenchPopover, renderCanvasWorkbenchTabs, renderCanvasWorkbenchTemplateCategories } from '../home-hero/WorkbenchOverlayShells';
export type CanvasWorkspaceProps = Omit<CanvasWorkbenchSurfaceProps, 'uiHost' | 'locale'> & {
    uiHost?: Partial<CanvasUiHost>;
    referenceAdapter?:QuestionReferenceAdapter;
};
/** Kinds that are always canvas-native — no external editor App required
 * (spec: text/image/video/storyboard edit inside canvas). */
const NATIVE_CARD_KINDS = new Set(['image', 'video', 'storyboard']);

/** Card-kind availability from the App registry (rule: App-backed kinds only
 * show while their editor App is registered and active; native kinds always
 * show). Fetches the canvas manifest + the app catalogue once per mount and
 * revalidates every 15s so freshly-registered Apps appear without a reload. */
function useRegisteredKindAvailability(): ReadonlySet<string> | null {
    const [allowed, setAllowed] = useState<ReadonlySet<string> | null>(null);
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [manifestRes, appsRes] = await Promise.all([
                    fetch('/api/apps/canvas'), fetch('/api/apps'),
                ]);
                if (!manifestRes.ok || !appsRes.ok) return;
                const manifest = (await manifestRes.json())?.data ?? {};
                const apps: { appId: string; status?: string }[] = (await appsRes.json())?.data?.apps ?? [];
                const activeApps = new Set(apps.filter(a => a.status !== 'disabled').map(a => a.appId));
                const editorApps: Record<string, string> = manifest?.editorApps ?? {};
                const next = new Set<string>();
                for (const kind of (manifest?.nodeKinds ?? []) as string[]) {
                    const appId = editorApps[kind];
                    if (NATIVE_CARD_KINDS.has(kind) || (appId && activeApps.has(appId))) next.add(kind);
                }
                if (!cancelled) setAllowed(next);
            } catch { /* registry unreachable → keep the full catalogue */ }
        };
        void load();
        const timer = setInterval(load, 15000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);
    return allowed;
}

export function CanvasWorkspace({ uiHost,referenceAdapter, ...props }: CanvasWorkspaceProps) {
    const { locale,t } = useI18n();
    const kindAvailability = useRegisteredKindAvailability();
    const referenceSelection=useRef<AbortController|null>(null);
    useEffect(()=>()=>{referenceSelection.current?.abort();referenceSelection.current=null;},[props.projectId,props.workspaceContext]);
    const resolvedReferenceAdapter=useMemo(()=>referenceAdapter??createAssetLibraryReferenceAdapter(props.projectId),[referenceAdapter,props.projectId]);
    const host = useMemo<CanvasUiHost>(() => ({
        renderAssetPicker: picker => renderWorkspaceAssetPicker(picker, JSON.stringify([props.projectId, props.workspaceContext ?? null])),
        renderTemplateGrid: grid => <SelectableTemplateGrid {...grid}/>,
        formatTemplateCategory: category => templateCategoryLabel(locale, category, t),
        renderArtifactPreview: preview => <CanvasArtifactPreview key={preview.src} {...preview}/>,
        renderArtifactThumbnail: preview => <CanvasArtifactThumbnail key={preview.src} {...preview}/>,
        cacheArtifactThumbnail: cacheCanvasArtifactThumbnail,
        renderTextEditor: editor => <MarkdownWordDocument markdown={editor.markdown} onChange={editor.onChange} editable inline onOpenDetail={editor.onOpenDetail} renderToolbar={editor.renderToolbar}/>,
        renderPopover: renderCanvasWorkbenchPopover, renderHoverCard: renderCanvasWorkbenchHoverCard, renderDialog: renderCanvasWorkbenchDialog, renderMenu: renderCanvasWorkbenchMenu, renderTabs: renderCanvasWorkbenchTabs, renderTemplateCategories: renderCanvasWorkbenchTemplateCategories,
        downloadResource: input => downloadProjectResource(props.projectId, input, props.workspaceContext),
        saveResource: async input => {
          const asset=await requestSaveAsset({...input,projectId:props.projectId,workspaceContext:props.workspaceContext,url:input.url||(input.sourcePath?projectFileUrl(props.projectId,input.sourcePath,props.workspaceContext):undefined),source:{projectId:props.projectId,filename:input.sourcePath||input.filename,nodeId:input.nodeId}});
          if(!asset)throw new Error(t('asset.error.saveCancelled'));
        },
        selectTextReference: nodeId=>{
          referenceSelection.current?.abort();const controller=new AbortController();referenceSelection.current=controller;
          openAssetLibrary({spaceId:'default-project',kind:'image'},{purpose:'reference',controller,onSelect:async asset=>{
            if(controller.signal.aborted)return false;
            await usePersonalAssetInProject(asset,props.projectId,props.workspaceContext,{referenceTargetId:nodeId,shouldApply:()=>!controller.signal.aborted});
            if(controller.signal.aborted)return false;controller.abort();return true;
          }},props.projectId);
          return ()=>controller.abort();
        },
        ...uiHost,
    }), [uiHost, props.projectId, props.workspaceContext,resolvedReferenceAdapter,t,locale]);
    return <CanvasKindAvailability.Provider value={kindAvailability}><CanvasWorkbenchSurface {...props} uiHost={host} locale={locale}/></CanvasKindAvailability.Provider>;
}
export default CanvasWorkspace;
