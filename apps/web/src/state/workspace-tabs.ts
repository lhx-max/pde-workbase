import type { ProjectTabsState as OpenTabsState, WorkspaceCollabContext } from '@bezier/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { requestJson } from '../providers/registry';
const key = (projectId: string) => `canvas-workspace:tabs:${projectId}`;
export function normalizeTabs(value: unknown): OpenTabsState | null {
    if (!value || typeof value !== 'object')
        return null;
    const state = value as OpenTabsState;
    if (!Array.isArray(state.tabs) || state.tabs.some(tab => typeof tab !== 'string'))
        return null;
    return { ...state, tabs: [...new Set(state.tabs)], active: typeof state.active === 'string' ? state.active : null, browserTabs: state.browserTabs?.filter(tab => typeof tab.id === 'string' && typeof tab.label === 'string') };
}
export async function loadTabs(projectId: string, context?: WorkspaceCollabContext | null): Promise<OpenTabsState> {
    let cached: OpenTabsState | null = null;
    try {
        cached = normalizeTabs(JSON.parse(localStorage.getItem(key(projectId)) || 'null'));
    }
    catch { /* Browser storage is optional. */ }
    const saved = normalizeTabs(await requestJson(`/api/projects/${encodeURIComponent(projectId)}/tabs`, { headers: context ? workspaceProjectHeaders(context) : undefined }));
    if (cached && (cached.updatedAt || 0) > (saved?.updatedAt || 0)) {
        await persistTabs(projectId, cached, context);
        return cached;
    }
    return saved || { tabs: [], active: '__design_files__' };
}
/** Repeated browser metadata notifications are not navigation or persistence changes. */
export function updateBrowserTabInfo(state:OpenTabsState,id:string,info:{title:string;url:string;iconUrl?:string}):OpenTabsState{
 const tab=state.browserTabs?.find(item=>item.id===id);
 if(!tab||(tab.title===info.title&&tab.url===info.url&&tab.iconUrl===info.iconUrl))return state;
 return {...state,browserTabs:state.browserTabs?.map(item=>item.id===id?{...item,...info}:item)};
}
export function cacheTabs(projectId: string, state: OpenTabsState): OpenTabsState {
    const next = { ...state, updatedAt: Date.now(), hasSavedState: true };
    try {
        localStorage.setItem(key(projectId), JSON.stringify(next));
    }
    catch { /* Canonical HTTP persistence below remains required. */ }
    return next;
}
export async function persistTabs(projectId: string, state: OpenTabsState, context?: WorkspaceCollabContext | null) { await requestJson(`/api/projects/${encodeURIComponent(projectId)}/tabs`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(context ? workspaceProjectHeaders(context) : {}) }, body: JSON.stringify(state), keepalive: true }); }
/** Order is the tab state order, including browser tabs, never a parallel implicit order. */
export function moveWorkspaceTab(tabs: string[], source: string, target: string, after: boolean): string[] { if (source === target || !tabs.includes(source) || !tabs.includes(target))
    return tabs; const next = tabs.filter(id => id !== source); next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source); return next; }
