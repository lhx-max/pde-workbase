// Adapted from upstream 319e5eee: original asset operations behind independent persistence.
import type { ProjectFileCanvasAddOptions } from '@bezier/contracts';
import { isCollectedPath } from '@bezier/contracts';
import { tActive } from '../i18n';
import { localizeApiMessage } from '../i18n/api-errors';
import { requestSaveAsset } from '../state/save-asset';
import { workspaceProjectHeaders } from '../collab/workspace-identity';
import { requestJson } from './registry';
import type { ProjectFile, PersonalAssetVersion, AssetLibraryInfo, AssetLibrarySpacesPatch, AssetLibrarySpacesResponse } from '@bezier/contracts';
import {
  PERSONAL_ASSET_CHANGED_EVENT,
  PROJECT_FILE_ADD_TO_CANVAS_EVENT,
  type PersonalAsset,
  type PersonalAssetBatchAction,
  type PersonalAssetBatchResponse,
  type PersonalAssetPromptStatus,
  type AssetAnalysisStatus,
  type PersonalAssetCreate,
  type PersonalAssetCreateRequest,
  type PersonalAssetAnalysisRequest,
  type PersonalAssetPatch,
  type PersonalAssetUse,
  type WorkspaceCollabContext,
} from "@bezier/contracts";
import { projectFileUrl,fetchProjectFiles,writeProjectBase64File } from './registry';


export class PersonalAssetRequestError extends Error {
  constructor(readonly diagnosticMessage: string, readonly status: number) { super(localizeApiMessage(diagnosticMessage, tActive('asset.error.unavailable'), { status })); }
}
export function isTemporaryAssetRequestError(error: unknown): boolean {
  return error instanceof PersonalAssetRequestError ? [502, 503, 504].includes(error.status) : error instanceof TypeError;
}
export type AssetLibrarySpaces = AssetLibrarySpacesResponse;
export function createHttpAssetLibrary(base = '/api/asset-library') {
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(base + path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const error = body?.error;
    const message = typeof error === 'string' ? error
      : error && typeof error === 'object' && !Array.isArray(error) && 'message' in error && typeof error.message === 'string'
        ? error.message : '';
    throw new PersonalAssetRequestError(message.trim() || `Asset request failed (${response.status})`, response.status);
  }
  const value = (await response.json()) as T;
  if (init?.method && init.method !== "GET") {
    window.dispatchEvent(new Event(PERSONAL_ASSET_CHANGED_EVENT));
    try {
      const channel = new BroadcastChannel(PERSONAL_ASSET_CHANGED_EVENT);
      channel.postMessage("changed");
      channel.close();
    } catch {
      /* one-window fallback */
    }
  }
  return value;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
/** Optional enrichment is an adapter responsibility, never an implicit agent run. */
function assetAnalysisSubmission(): PersonalAssetAnalysisRequest { return {executionRequired: true}; }

return {
  info: (signal?: AbortSignal) => request<AssetLibraryInfo>('/info', { signal }),
  get: (id: string, signal?: AbortSignal) => request<{asset:PersonalAsset}>(`/${encodeURIComponent(id)}`, { signal }),
  analysisStatus: (id: string) => request<AssetAnalysisStatus>(`/${encodeURIComponent(id)}/analysis`),
  promptStatus: (id: string) => request<PersonalAssetPromptStatus>(`/${encodeURIComponent(id)}/prompt`),
  generatePrompt: (id: string) => request<AssetAnalysisStatus>(`/${encodeURIComponent(id)}/prompt`, json('POST', { executionRequired: true, execution: undefined })),
  analyze: (id: string) => request<AssetAnalysisStatus>(`/${encodeURIComponent(id)}/analysis`, json('POST', { execution: undefined })),
  // Idempotent bootstrap; do not emit a change event and cause a refresh/import loop.
  importTemplates: async (templates: (PersonalAssetCreate & {description?:string;tags?:string[]})[]) => {
    const response = await fetch(`${base}/import-templates`, json('POST',{templates}));
    if (!response.ok) throw new Error(tActive('asset.error.templateConnect'));
    return response.json() as Promise<{assets:PersonalAsset[]}>;
  },
  list: async (signal?: AbortSignal) => {
    const result = await request<{ assets: PersonalAsset[] }>("", { signal });
    if (!Array.isArray(result?.assets))
      throw new Error(tActive('asset.error.unavailable'));
    return result;
  },
  create: (input: PersonalAssetCreateRequest) =>
    request<{ asset: PersonalAsset }>("", json("POST", { ...input, ...(input.aiFill ? assetAnalysisSubmission() : {}) })),
  patch: (id: string, patch: PersonalAssetPatch) =>
    request<{ asset: PersonalAsset }>(
      `/${encodeURIComponent(id)}`,
      json("PATCH", patch),
    ),
  batch: (ids: string[], action: PersonalAssetBatchAction, patch?: PersonalAssetPatch) =>
    request<PersonalAssetBatchResponse>(
      "/batch",
      json("POST", { ids, action, patch }),
    ),
  upload(
    file: File,
    parentId: string | null,
    source?: PersonalAsset["source"],
    spaceId?: string,
    metadata?: Partial<Pick<PersonalAssetCreate, 'name'|'description'|'style'|'usage'|'tags'|'kind'|'rating'>> & {aiFill?: boolean;captureId?:string},
  ) {
    const body = new FormData();
    body.append("file", file);
    body.append("name", metadata?.name || file.name);
    if(metadata?.captureId)body.append('captureId',metadata.captureId);
    if(metadata?.description!==undefined)body.append('description',metadata.description);
    if(metadata?.style!==undefined)body.append('style',metadata.style);
    if(metadata?.usage!==undefined)body.append('usage',metadata.usage);
    if(metadata?.rating!==undefined)body.append('rating',String(metadata.rating));
    if(metadata?.aiFill) {
      body.append('aiFill','true');
      const analysis = assetAnalysisSubmission();
      body.append('executionRequired', 'true');
      if (analysis.execution) body.append('execution', JSON.stringify(analysis.execution));
    }
    if(metadata?.tags)body.append('tags',JSON.stringify(metadata.tags));
    if(metadata?.kind)body.append('kind',metadata.kind);
    if (spaceId) body.append("spaceId", spaceId);
    if (parentId) body.append("parentId", parentId);
    if (source) body.append("source", JSON.stringify(source));
    return request<{ asset: PersonalAsset }>("/upload", {
      method: "POST",
      body,
    });
  },
  version(asset: PersonalAsset, content: string | File) {
    if (typeof content === "string")
      return request<{ asset: PersonalAsset }>(
        `/${asset.id}/versions`,
        json("POST", { content, revision: asset.revision }),
      );
    const body = new FormData();
    body.append("file", content);
    body.append("name", content.name);
    body.append("revision", String(asset.revision));
    return request<{ asset: PersonalAsset }>(`/${asset.id}/versions`, {
      method: "POST",
      body,
    });
  },
  importIntoProject: async (projectId:string,assetId:string,versionId?:string,context?:WorkspaceCollabContext|null):Promise<{asset:PersonalAsset;version:PersonalAssetVersion;files:ProjectFile[]}> => {
    if(base==='/api/asset-library')return requestJson(`/api/projects/${encodeURIComponent(projectId)}/asset-library/import`, {method:'POST',headers:{'Content-Type':'application/json',...(context?workspaceProjectHeaders(context):{})},body:JSON.stringify({assetId,versionId})});
    // A separately hosted source does not own local project files. Materialize its
    // selected version through the project API, not the built-in source's id space.
    const {asset}=await request<{asset:PersonalAsset}>(`/${encodeURIComponent(assetId)}`);
    const version=versionId?asset.versions.find(item=>item.id===versionId):asset.versions.at(-1);
    if(!version)throw new Error(tActive('asset.error.pickAsset'));
    const previous=(await request<{uses:PersonalAssetUse[]}>(`/${encodeURIComponent(assetId)}/uses`)).uses.find(use=>use.projectId===projectId&&use.versionId===version.id);
    let file=previous?(await fetchProjectFiles(projectId,{fresh:true,workspaceContext:context})).find(item=>item.name===previous.filename):undefined;
    if(!file){const response=await fetch(`${base}/${encodeURIComponent(assetId)}/content?version=${encodeURIComponent(version.id)}`);if(!response.ok)throw new Error(tActive('asset.error.readContent'));const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));const saved=await writeProjectBase64File(projectId,`asset-${crypto.randomUUID()}-${version.filename.split(/[\\/]/).at(-1)||'asset'}`,btoa(binary),context);if(saved)file=saved;}
    if(!file)throw new Error(tActive('asset.error.addToProject'));
    await request(`/${encodeURIComponent(assetId)}/uses`,json('POST',{projectId,versionId:version.id,filename:file.name}));return {asset,version,files:[file]};
  },
  spaces: (scope = 'local', signal?: AbortSignal) => request<AssetLibrarySpaces>(`/spaces?scope=${encodeURIComponent(scope)}`, { signal }),
  patchSpaces: (scope: string, input: AssetLibrarySpacesPatch) => request<AssetLibrarySpaces>(`/spaces?scope=${encodeURIComponent(scope)}`, json('POST',input)),
  recordUse: (id:string, use:PersonalAssetUse) => request<{ok:true}>(`/${encodeURIComponent(id)}/uses`,json('POST',use)),
  exportUrl: (ids:string[]) => `${base}/export?ids=${encodeURIComponent(ids.join(','))}`,
  uses: (id: string) => request<{ uses: PersonalAssetUse[] }>(`/${id}/uses`),
  contentUrl: (asset: PersonalAsset, versionId?: string, download = false) =>
    `${base}/${encodeURIComponent(asset.id)}/content?version=${encodeURIComponent(versionId || asset.versions.at(-1)?.id || "")}${download ? "&download=1" : ""}`,
};
}
export type AssetLibraryAdapter = ReturnType<typeof createHttpAssetLibrary>;
const localAssetLibrary = createHttpAssetLibrary();
let externalAdapter: AssetLibraryAdapter | undefined;
let selectedSource: 'local'|'external' = 'local';
let currentAdapter: AssetLibraryAdapter = localAssetLibrary;
export function getAssetLibrarySourceId() { return selectedSource; }
/** Capture a source port before awaiting, so source switching cannot redirect writes. */
export function getActiveAssetLibraryAdapter() { return currentAdapter; }
export function hasExternalAssetLibrary() { return Boolean(externalAdapter); }
function notifyLibraryChanged() { if(typeof window!=='undefined')window.dispatchEvent(new Event(PERSONAL_ASSET_CHANGED_EVENT)); }
export function selectAssetLibrarySource(id:'local'|'external') {
 if(id==='external'&&!externalAdapter)throw new Error(tActive('assetLibrary.externalUnavailable'));
 selectedSource=id;currentAdapter=id==='external'?externalAdapter!:localAssetLibrary;notifyLibraryChanged();
}
/** Register a replaceable external source, preserving access to the built-in library. */
export function configureAssetLibraryAdapter(adapter?: AssetLibraryAdapter): () => void {
 const previous=externalAdapter, previousSource=selectedSource;
 externalAdapter=adapter;selectAssetLibrarySource(adapter?'external':'local');
 return ()=>{if(externalAdapter===adapter) {externalAdapter=previous;selectAssetLibrarySource(previousSource==='external'&&previous?'external':'local');}};
}
export const personalAssets = new Proxy({} as AssetLibraryAdapter, {get:(_target,key)=>{const value=Reflect.get(currentAdapter,key);return typeof value==='function'?value.bind(currentAdapter):value;}});

/** Browser-owned fetch: no server-side URL proxy and no cookies shared with source sites. */
export async function readPersonalAssetUrl(input: string): Promise<File> {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error(tActive('asset.error.badUrl')); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error(tActive('asset.error.urlCredentials'));
  const limit = 200 * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    let response: Response;
    try {
      response = await fetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    } catch {
      throw new Error(tActive('asset.error.urlBlocked'));
    }
    if (!response.ok || !response.body) throw new Error(tActive('asset.error.urlUnavailable'));
    if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error(tActive('asset.error.fileTooLarge')); }
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error(tActive('asset.error.fileTooLarge')); }
        chunks.push(new Uint8Array(value).buffer);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error(tActive('asset.error.emptyFile'));
    let filename = "resource";
    try { filename = decodeURIComponent(url.pathname.split("/").pop() || "resource"); } catch { /* fallback */ }
    const mime = (response.headers.get("content-type")?.split(";")[0] || "application/octet-stream").trim().toLowerCase();
    const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/avif": ".avif", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/flac": ".flac", "application/pdf": ".pdf" };
    const extension = extensions[mime];
    if (extension && !filename.toLowerCase().endsWith(extension)) filename += extension;
    return new File(chunks, filename, { type: mime });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(tActive('asset.error.readTimeout'));
    throw error;
  } finally { clearTimeout(timeout); controller.abort(); }
}

export async function saveProjectFileAsAsset(
  projectId: string,
  filename: string,
  context?: WorkspaceCollabContext | null,
) {
  const response = await fetch(projectFileUrl(projectId, filename, context));
  if (!response.ok) throw new Error(tActive('asset.error.projectRead'));
  const bytes = await response.blob();
  let url: string | undefined;
  if (isCollectedPath(filename)) {
    const source = await fetch(
      projectFileUrl(projectId, `${filename}.source.json`, context),
    ).catch(() => null);
    const metadata = source?.ok ? await source.json().catch(() => null) : null;
    const candidate = metadata?.pageUrl || metadata?.sourceUrl || metadata?.url;
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate))
      url = candidate;
  }
  const result = await requestSaveAsset({name:filename.split('/').pop()!,filename:filename.split('/').pop()!,mime:bytes.type,url:projectFileUrl(projectId,filename,context),source:{projectId,filename,...(url?{url}:{})},workspaceContext:context});
  if(!result) throw new Error(tActive('asset.error.saveCancelled'));
  return {asset:result};
}

export async function usePersonalAssetInProject(
  asset: PersonalAsset,
  projectId: string,
  context?: WorkspaceCollabContext | null,
  position?: ProjectFileCanvasAddOptions,
) {
  const adapter=currentAdapter;
  if(currentAdapter!==adapter || (position?.shouldApply && !position.shouldApply())) throw new Error(tActive('asset.error.saveCancelled'));
  const version = asset.versions.at(-1);
  if (!version) throw new Error(tActive('asset.error.pickAsset'));
  let content: Blob | undefined;
  const readContent = async () => {
    if (content) return content;
    const response = await fetch(adapter.contentUrl(asset,version.id));
    if (!response.ok) throw new Error(tActive('asset.error.readContent'));
    content = await response.blob();
    return content;
  };
  // The server authorizes the project, reuses this exact version and records its
  // use atomically. Importing bytes is deliberately separate from canvas acceptance.
  const imported = await adapter.importIntoProject(projectId,asset.id,version.id,context);
  const file = imported.files[0];
  if (!file) throw new Error(tActive('asset.error.addToProject'));
  if(currentAdapter!==adapter || (position?.shouldApply && !position.shouldApply())) throw new Error(tActive('asset.error.saveCancelled'));
  const sourceAsset = {
    kind: asset.kind,
    name: asset.name,
    description: asset.description,
    ...(asset.source.template
      ? {
          template: {
            ...asset.source.template,
            prompt: await (await readContent()).text(),
          },
        }
      : {}),
  };
  if(currentAdapter!==adapter || (position?.shouldApply && !position.shouldApply())) throw new Error(tActive('asset.error.saveCancelled'));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('canvas-workspace:files-changed',{detail:{projectId}}));
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () =>
        reject(new Error(tActive('asset.error.canvasNoResponse'))),
      15000,
    );
    const onComplete = (success: boolean) => {
      window.clearTimeout(timer);
      if (success) resolve();
      else reject(new Error(tActive('asset.error.canvasAddFailed')));
    };
    window.dispatchEvent(
      new CustomEvent(PROJECT_FILE_ADD_TO_CANVAS_EVENT, {
        detail: { ...file, projectId, sourceAsset, ...position, onComplete },
      }),
    );
  });
  return file;
}
