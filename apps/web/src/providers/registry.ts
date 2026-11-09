import type { ProjectFile, ProjectFolder, WorkspaceCollabContext, ProjectFileTextPreviewResponse, ProjectFileVersion, RenameProjectFileResponse } from '@bezier/contracts';
import { openHostExternalUrl, isBezierHostAvailable } from '@bezier/host';
import { workspaceProjectHeaders, workspaceResourceUrl } from '../collab/workspace-identity';
import { localizeApiMessage } from '../i18n/api-errors';
import { tActive } from '../i18n';
type Context = WorkspaceCollabContext | null | undefined;
const root = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
export class WorkspaceApiError extends Error {
    constructor(public readonly diagnosticMessage: string, public status: number, public code?: string) { super(localizeApiMessage(diagnosticMessage, tActive('api.error.generic'), { status, code })); }
}
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new WorkspaceApiError(body?.message || (typeof body?.error === 'string' ? body.error : body?.error?.message) || `${response.status} ${response.statusText}`, response.status, body?.code || body?.error?.code);
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
}
function headers(context: Context, json = false): HeadersInit { return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(context ? workspaceProjectHeaders(context) : {}) }; }
export function projectFileUrl(id: string, name: string, context?: Context) { return projectRawUrl(id, name, context); }
const versionUrl = (id: string, name: string) => `${root(id)}/files/${name.split('/').map(encodeURIComponent).join('/')}/versions`;
export async function fetchProjectFileVersions(id: string, name: string, context?: Context): Promise<import('@bezier/contracts').ProjectFileVersionsResponse | null> { return requestJson(versionUrl(id, name), { cache: 'no-store', headers: headers(context) }); }
export async function fetchProjectFileVersion(id: string, name: string, versionId: string, context?: Context): Promise<import('@bezier/contracts').ProjectFileVersionResponse | null> { return requestJson(`${versionUrl(id, name)}/${encodeURIComponent(versionId)}`, { cache: 'no-store', headers: headers(context) }); }
export async function restoreProjectFileVersion(id: string, name: string, version: Pick<ProjectFileVersion, 'id'>, context?: Context): Promise<import('@bezier/contracts').RestoreProjectFileVersionResponse | null> { return requestJson(`${versionUrl(id, name)}/${encodeURIComponent(version.id)}/restore`, { method: 'POST', headers: headers(context, true), body: '{}' }); }
export async function fetchProjectPreviewBaseHref(id: string, name: string, context: WorkspaceCollabContext): Promise<string | null> { const result = await requestJson<{
    url: string;
}>(workspaceResourceUrl(`${root(id)}/preview-url?file=${encodeURIComponent(name)}`, context), { headers: headers(context), cache: 'no-store' }); const parsed = new URL(result.url, location.origin); const prefix = `${root(id)}/preview/`; if (!parsed.pathname.startsWith(prefix))
    throw new Error('Preview capability URL is outside this project'); return parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/') + 1); }
export function projectRawUrl(id: string, name: string, context?: Context) { return workspaceResourceUrl(`${root(id)}/raw/${name.split('/').map(encodeURIComponent).join('/')}`, context); }
export async function fetchProjectFiles(id: string, options?: {
    signal?: AbortSignal;
    workspaceContext?: Context;
    fresh?: boolean;
    requireAuthoritative?: boolean;
    scope?: string;
}) {
    return (await requestJson<{
        files: ProjectFile[];
    }>(`${root(id)}/files${options?.scope === 'all' ? '?scope=all' : ''}`, { signal: options?.signal, cache: 'no-store', headers: headers(options?.workspaceContext) })).files;
}
export async function fetchProjectFolders(id: string, context?: Context) { return (await requestJson<{
    folders: ProjectFolder[];
}>(`${root(id)}/folders`, { headers: headers(context) })).folders; }
export async function fetchProjectFileText(id: string, name: string, options?: {
    cache?: RequestCache;
    cacheBustKey?: string | number;
    signal?: AbortSignal;
    workspaceContext?: Context;
}): Promise<string | null> {
    const url = projectFileUrl(id, name, options?.workspaceContext);
    const response = await fetch(url + (options?.cacheBustKey == null ? '' : `${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(options.cacheBustKey)}`), { cache: options?.cache || 'no-store', signal: options?.signal, headers: headers(options?.workspaceContext) });
    if (!response.ok)
        throw new WorkspaceApiError(`Could not read ${name} (${response.status})`, response.status);
    return response.text();
}
export async function fetchProjectFileTextPreview(id: string, name: string, options?: {
    limit?: number;
    cacheBustKey?: string | number;
    workspaceContext?: Context;
}): Promise<ProjectFileTextPreviewResponse | null> {
    return requestJson(`${root(id)}/text-preview/${name.split('/').map(encodeURIComponent).join('/')}?limit=${options?.limit || 2400}&v=${options?.cacheBustKey || 0}`, { headers: headers(options?.workspaceContext) });
}
export type ProjectFilePreview = import('@bezier/contracts').ProjectDocumentPreview;
export async function fetchProjectFilePreview(id: string, name: string, context?: Context): Promise<ProjectFilePreview | null> { return requestJson(`${root(id)}/files/${encodeURIComponent(name)}/preview`, { headers: headers(context) }); }
type WriteOptions = {
    artifactManifest?: ProjectFile['artifactManifest'];
    versionSource?: string;
    versionLabel?: string;
    versionPrompt?: string | null;
    parentVersionId?: string;
};
export async function writeProjectTextFileDetailed(id: string, name: string, content: string, options?: WriteOptions, context?: Context): Promise<{
    ok: true;
    file: ProjectFile;
    version?: ProjectFileVersion | null;
} | {
    ok: false;
    message: string;
    status?: number;
    code?: string;
}> {
    try {
        const result = await requestJson<{
            file: ProjectFile;
            version?: ProjectFileVersion | null;
        }>(`${root(id)}/files`, { method: 'POST', headers: headers(context, true), body: JSON.stringify({ name, content, ...options }) });
        return { ok: true, ...result };
    }
    catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error), ...(error instanceof WorkspaceApiError ? { status: error.status, code: error.code } : {}) };
    }
}
export async function writeProjectTextFile(id: string, name: string, content: string, options?: WriteOptions, context?: Context): Promise<ProjectFile | null> { const result = await writeProjectTextFileDetailed(id, name, content, options, context); if (!result.ok)
    throw new Error(result.message); return result.file; }
export async function writeProjectBase64File(id: string, name: string, base64: string, context?: Context): Promise<ProjectFile | null> { return (await requestJson<{
    file: ProjectFile;
}>(`${root(id)}/files`, { method: 'POST', headers: headers(context, true), body: JSON.stringify({ name, content: base64.replace(/^data:[^,]*,/, ''), encoding: 'base64' }) })).file; }
export async function deleteProjectFile(id: string, name: string, context?: Context) { await requestJson(projectRawUrl(id, name, context), { method: 'DELETE', headers: headers(context) }); return true; }
export async function renameProjectFile(id: string, from: string, to: string, context?: Context): Promise<RenameProjectFileResponse> { return requestJson(`${root(id)}/files/rename`, { method: 'POST', headers: headers(context, true), body: JSON.stringify({ from, to }) }); }
export async function createProjectFolder(id: string, path: string, context?: Context) { return requestJson(`${root(id)}/folders`, { method: 'POST', headers: headers(context, true), body: JSON.stringify({ path }) }); }
export async function deleteProjectFolder(id: string, path: string, context?: Context) { return requestJson(`${root(id)}/folders`, { method: 'DELETE', headers: headers(context, true), body: JSON.stringify({ path }) }); }
export interface UploadProjectFilesResult {
    uploaded: {
        name: string;
        path: string;
        size?: number;
        kind: 'image' | 'file';
    }[];
    failed: {
        name: string;
        error: string;
    }[];
    error?: string;
}
export async function uploadProjectFiles(id: string, files: File[], dir?: string, context?: Context): Promise<UploadProjectFilesResult> {
    // Independently acknowledged files preserve successful uploads when a later file fails.
    const uploaded: UploadProjectFilesResult['uploaded'] = [];
    const failed: UploadProjectFilesResult['failed'] = [];
    for (const incoming of files) {
        const form = new FormData();
        if (dir !== undefined)
            form.append('dir', dir);
        form.append('files', incoming);
        try {
            const result = await requestJson<{
                files: {
                    name: string;
                    path: string;
                    size?: number;
                    originalName?: string;
                }[];
            }>(`${root(id)}/upload`, { method: 'POST', headers: headers(context), body: form });
            uploaded.push(...result.files.map(file => ({ ...file, name: file.originalName || file.name, kind: /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name) ? 'image' as const : 'file' as const })));
        }
        catch (error) {
            failed.push({ name: incoming.name, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { uploaded, failed, ...(failed.length ? { error: failed.map(item => `${item.name}: ${item.error}`).join('\n') } : {}) };
}
export async function openExternalUrl(url: string): Promise<void> { if (isBezierHostAvailable()) {
    await openHostExternalUrl(url);
    return;
} if (!/^https?:\/\//i.test(url))
    throw new Error('Only HTTP(S) links can be opened in a web host'); window.open(url, '_blank', 'noopener,noreferrer'); }
