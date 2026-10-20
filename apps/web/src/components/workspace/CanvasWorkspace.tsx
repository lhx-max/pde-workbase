'use client';
/** Original CanvasWorkspace host assembly, with product services injected rather than chat/library imports. */
import { useMemo } from 'react';
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
    const { locale } = useI18n();
    const workflowRunState = useWorkflowCanvasRuns(props.projectId, props.workspaceContext ?? null);
    const workflowArtifacts=useWorkflowArtifacts(props.projectId,props.workspaceContext);
    const host = useMemo<CanvasUiHost>(() => ({
        renderWorkflowQuestion:snapshot=><WorkflowCanvasQuestion snapshot={snapshot} context={props.workspaceContext} referenceAdapter={referenceAdapter}/>,
        renderArtifactPreview: preview => <CanvasArtifactPreview key={preview.src} {...preview}/>,
        renderArtifactThumbnail: preview => <CanvasArtifactThumbnail key={preview.src} {...preview}/>,
        cacheArtifactThumbnail: cacheCanvasArtifactThumbnail,
        renderTextEditor: editor => <MarkdownWordDocument markdown={editor.markdown} onChange={editor.onChange} editable inline onOpenDetail={editor.onOpenDetail} renderToolbar={editor.renderToolbar}/>,
        renderPopover: renderCanvasWorkbenchPopover, renderHoverCard: renderCanvasWorkbenchHoverCard, renderDialog: renderCanvasWorkbenchDialog, renderMenu: renderCanvasWorkbenchMenu, renderTabs: renderCanvasWorkbenchTabs, renderTemplateCategories: renderCanvasWorkbenchTemplateCategories,
        downloadResource: input => downloadProjectResource(props.projectId, input, props.workspaceContext),
        saveResource: async () => { throw new Error('External asset library is not configured'); },
        ...uiHost,
    }), [uiHost, props.projectId, props.workspaceContext,referenceAdapter]);
    return <CanvasWorkbenchSurface workflowRuns={workflowRunState.runs} workflowRunsError={workflowRunState.error||workflowArtifacts.error} workflowArtifacts={workflowArtifacts.artifacts} onWorkflowArtifactsRefresh={workflowArtifacts.refresh} onInteractionActiveChange={workflowArtifacts.onInteractionActiveChange} {...props} uiHost={host} locale={locale}/>;
}
export default CanvasWorkspace;
