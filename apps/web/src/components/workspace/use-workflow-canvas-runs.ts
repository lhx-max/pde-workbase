import { assetInspectorCopy } from '../../i18n/locales/asset-inspector-copy';
import { useI18n } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowCanvasRun, WorkflowCanvasRunsResponse, WorkspaceCollabContext } from '@bezier/contracts';
import { workspaceProjectHeaders } from '../../collab/workspace-identity';

/** One host-owned poll for the canvas's run collection, including runs with no results. */
export function useWorkflowCanvasRuns(projectId: string, context: WorkspaceCollabContext | null | undefined) {
  const { locale } = useI18n();
  const copyRef = useRef(assetInspectorCopy(locale));
  copyRef.current = assetInspectorCopy(locale);
  const headersKey = JSON.stringify(context ? workspaceProjectHeaders(context) : {});
  const scope = `${projectId}:${headersKey}`;
  const [state, setState] = useState<{ project: string; runs: WorkflowCanvasRun[]; error?: string }>({ project: scope, runs: [] });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        if (document.visibilityState === 'hidden') return;
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workflow-graph-runs`, {
          headers: JSON.parse(headersKey), signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error(copyRef.current.syncFailed);
        const payload = await response.json() as WorkflowCanvasRunsResponse;
        if (!Array.isArray(payload.runs)) throw new Error(copyRef.current.syncIncomplete);
        if (!disposed) setState(current => current.project === scope && !current.error && JSON.stringify(current.runs) === JSON.stringify(payload.runs)
          ? current : { project: scope, runs: payload.runs });
      } catch (error) {
        if (!disposed) setState(current => ({ project: scope, runs: current.project === scope ? current.runs : [], error: error instanceof Error ? error.message : copyRef.current.syncFailed }));
      } finally {
        if (!disposed) timer = setTimeout(refresh, 2000);
      }
    };
    // Wait for workspace authority resolution before the first request.
    if (context !== undefined) void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [projectId, headersKey, scope, context === undefined]);
  return state.project === scope ? state : { project: scope, runs: [] };
}
