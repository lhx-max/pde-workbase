'use client';
/** Original CanvasWorkspace host assembly, with product services injected rather than chat/library imports. */
import { useMemo,useRef,useEffect } from 'react';
import {requestSaveAsset} from '../../state/save-asset';
import { renderWorkspaceAssetPicker } from '../asset-library/WorkspaceAssetPicker';
import { SelectableTemplateGrid } from '../asset-library/SelectableImageMasonry';
import { templateCategoryLabel } from '../asset-library/template-category-label';
import {projectFileUrl} from '../../providers/registry';
import {usePersonalAssetInProject} from '../../providers/asset-library';
import {openAssetLibrary} from '../../state/asset-library-navigation';
import {createAssetLibraryReferenceAdapter} from '../asset-library-reference-adapter';
import { CanvasWorkbenchSurface, type CanvasWorkbenchSurfaceProps, type CanvasUiHost } from '@bezier/canvas-workbench';
import { WorkflowCanvasQuestion } from './WorkflowCanvasQuestion';
import type {QuestionReferenceAdapter} from '../QuestionForm';
import {useWorkflowArtifacts} from './use-workflow-artifacts';
import { useWorkflowCanvasRuns } from './use-workflow-canvas-runs';
import { MarkdownWordDocument } from '../MarkdownWordDocument';
import { useI18n } from '../../i18n';
import { downloadProjectResource } from '../../providers/project-usage';
import { CanvasArtifactPreview } from './CanvasArtifactPreview';
import { CanvasArtifactThumbnail, cacheCanvasArtifactThumbnail } from './CanvasArtifactThumbnail';
import { renderCanvasWorkbenchDialog, renderCanvasWorkbenchHoverCard, renderCanvasWorkbenchMenu, renderCanvasWorkbenchPopover, renderCanvasWorkbenchTabs, renderCanvasWorkbenchTemplateCategories } from '../home-hero/WorkbenchOverlayShells';
export type CanvasWorkspaceProps = Omit<CanvasWorkbenchSurfaceProps, 'uiHost' | 'locale'> & {
    uiHost?: Partial<CanvasUiHost>;
    referenceAdapter?:QuestionReferenceAdapter;
};
export function CanvasWorkspace({ uiHost,referenceAdapter, ...props }: CanvasWorkspaceProps) {
    const { locale,t } = useI18n();
    const referenceSelection=useRef<AbortController|null>(null);
    useEffect(()=>()=>{referenceSelection.current?.abort();referenceSelection.current=null;},[props.projectId,props.workspaceContext]);
    const resolvedReferenceAdapter=useMemo(()=>referenceAdapter??createAssetLibraryReferenceAdapter(props.projectId),[referenceAdapter,props.projectId]);
    const workflowRunState = useWorkflowCanvasRuns(props.projectId, props.workspaceContext ?? null);
    const workflowArtifacts=useWorkflowArtifacts(props.projectId,props.workspaceContext);
    const host = useMemo<CanvasUiHost>(() => ({
        renderAssetPicker: picker => renderWorkspaceAssetPicker(picker, JSON.stringify([props.projectId, props.workspaceContext ?? null])),
        renderTemplateGrid: grid => <SelectableTemplateGrid {...grid}/>,
        formatTemplateCategory: category => templateCategoryLabel(locale, category, t),
        renderWorkflowQuestion:snapshot=><WorkflowCanvasQuestion snapshot={snapshot} context={props.workspaceContext} referenceAdapter={resolvedReferenceAdapter}/>,
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
    return <CanvasWorkbenchSurface workflowRuns={workflowRunState.runs} workflowRunsError={workflowRunState.error||workflowArtifacts.error} workflowArtifacts={workflowArtifacts.artifacts} onWorkflowArtifactsRefresh={workflowArtifacts.refresh} onInteractionActiveChange={workflowArtifacts.onInteractionActiveChange} {...props} uiHost={host} locale={locale}/>;
}
export default CanvasWorkspace;
