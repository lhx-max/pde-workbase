/**
 * 共享画布的项目与平台 API 边界。
 * canvasFetch / projectFetch / platformFetch 不依赖业务模块。
 * projectApiFetch 保留旧路径兼容；共享路径会转发到通用端点。
 * 所有请求使用宿主注入的 projectId 与 Workspace 身份。
 */

import type { WorkspaceCollabContext } from '@bezier/contracts';
import { localizeDaemonMessage } from '../locales/daemon-messages';
import { getCanvasActiveLocale } from './canvas-locale';
import { setCanvasMediaPolicy } from './media-policy';

/**
 * Workspace 身份头。
 *
 * 与宿主 `apps/web/src/collab/workspace-identity.ts` 是同一份线上契约。
 * 这里内联而非跨包 import，是为了让本包不反向依赖 apps/web——包只依赖
 * contracts，宿主可独立替换。字段增减时两处必须同步。
 */
function workspaceProjectHeaders(context: WorkspaceCollabContext): Record<string, string> {
  return {
    'x-bezier-workspace-id': context.workspaceId,
    'x-bezier-workspace-type': context.workspaceType,
    'x-bezier-workspace-member-id': context.workspaceMemberId,
    'x-bezier-workspace-role': context.role,
    'x-bezier-workspace-lifecycle-state': context.lifecycleState,
    'x-bezier-workspace-member-status': context.memberStatus,
    'x-bezier-workspace-can-share-projects': String(context.permissions.canShareProjects),
    'x-bezier-workspace-can-write-synced-files': String(context.permissions.canWriteSyncedFiles),
  };
}

/**
 * 浏览器自身发起的导航（img / a / iframe）无法附加请求头，
 * 因此把身份放进 query——daemon 会重新校验这两个值。
 */
function workspaceResourceUrl(
  path: string,
  context: WorkspaceCollabContext | null | undefined,
): string {
  if (!context) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}workspaceId=${encodeURIComponent(context.workspaceId)}`
    + `&workspaceMemberId=${encodeURIComponent(context.workspaceMemberId)}`;
}

/** Runtime-only transport injection. Credentials are never stored in canvas JSON. */
export interface CanvasTransport {
  /** API origin, optionally including a reverse-proxy prefix. Defaults to same origin. */
  baseUrl?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  headers?: () => Record<string, string>;
  /** Optional signed/cookie-authorized URL for browser image/frame navigation. */
  resourceUrl?: (url: string) => string;
}

/** 由宿主（CanvasWorkspace）在挂载时注入的运行时上下文。 */
export type CanvasHostContext = {
  projectId: string;
  transport?: CanvasTransport;
  businessModules?: readonly string[];
  disabledMediaProviders?: readonly string[];
  workspaceContext?: WorkspaceCollabContext | null;
};

let hostContext: CanvasHostContext | null = null;

/** 宿主在渲染画布前必须先调用，否则所有请求会立即失败。 */
export function setCanvasHostContext(context: CanvasHostContext | null): void {
  hostContext = context;
  setCanvasMediaPolicy(context?.disabledMediaProviders ?? []);
}

export function getCanvasHostContext(): CanvasHostContext {
  if (!hostContext) {
    throw new Error('Canvas host context is not initialized; call setCanvasHostContext first');
  }
  return hostContext;
}

/** DA 项目作用域 API 前缀。 */
function projectApiBase(): string {
  const { projectId } = getCanvasHostContext();
  return canvasApiUrl(`/api/projects/${encodeURIComponent(projectId)}`, getCanvasHostContext());
}

export function canvasApiUrl(path: string, context: CanvasHostContext): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = context.transport?.baseUrl?.replace(/\/$/, '') ?? '';
  if (base && (!/^https?:\/\//i.test(base) && !base.startsWith('/') || base.startsWith('//'))) throw new Error('Invalid canvas API base URL');
  if (base && path.startsWith(`${base}/`)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function fetchForContext(context: CanvasHostContext, path: string, init?: RequestInit): Promise<Response> {
  const url = canvasApiUrl(path, context);
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const allowed = new URL(context.transport?.baseUrl || origin, origin);
  if (new URL(url, origin).origin !== allowed.origin) {
    throw new Error('Canvas API request cannot send credentials to an external origin');
  }
  return (context.transport?.fetch ?? fetch)(url, { ...init, headers: headersForContext(context, init) });
}

function browserResourceUrl(path: string, context: CanvasHostContext): string {
  const url = canvasApiUrl(workspaceResourceUrl(path, context.workspaceContext), context);
  return context.transport?.resourceUrl?.(url) ?? url;
}

/** Resolve saved image URLs through the same browser resource authorization as new images. */
export function resolveCanvasImageSrc(src: string | undefined): string {
  if (!src) return '';
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (/^\/api\/projects\/[^/]+\/(?:files|image-app)(?:\/|\?)/.test(src)) {
    return browserResourceUrl(src, getCanvasHostContext());
  }
  return projectScopedUrl(src);
}

/**
 * 逻辑路径（原版扁平 `/api/xxx`）→ DA 真实路径。
 *
 * 只做前缀替换，query string 与动态段一律原样保留，
 * 这样调用点的 `?stage=`、`?path=` 等参数不需要任何改动。
 */
export function projectScopedUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  let rest = path;
  if (!rest.startsWith('/')) rest = `/${rest}`;
  // Imported/persisted media already carries its owning project and workspace
  // query. Re-scoping it would duplicate /projects/:id and break the image URL.
  if (rest.startsWith('/api/projects/')) return canvasApiUrl(rest, getCanvasHostContext());
  if (rest.startsWith('/api/')) rest = rest.slice('/api'.length);
  else if (rest === '/api') rest = '';

  // `/api/files?path=...` 是 daemon 自身的项目文件读取端点。
  if (rest === '/files' || rest.startsWith('/files?') || rest.startsWith('/files/')) {
    const context = getCanvasHostContext();
    const projectPath = `/api/projects/${encodeURIComponent(context.projectId)}${rest}`;
    return browserResourceUrl(projectPath, context);
  }

  return `${projectApiBase()}${rest}`;
}

/** Stable service descriptor; never include a browser bridge, credentials or host prefix. */
export function canonicalProjectFileUrl(relativePath: string, context = getCanvasHostContext()): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('invalid project file path');
  }
  const encodedPath = normalized.split('/').map(encodeURIComponent).join('/');
  return `/api/projects/${encodeURIComponent(context.projectId)}/files/${encodedPath}`;
}

/** Build a browser-navigable URL for a project-relative file. */
export function projectFileUrl(relativePath: string, context = getCanvasHostContext()): string {
  return browserResourceUrl(canonicalProjectFileUrl(relativePath, context), context);
}

/**
 * 合并调用点自带的头和 Workspace 身份头。
 *
 * 返回**普通对象**而不是 `Headers` 实例——这不是风格问题：Next dev 的
 * `/api` 代理转发 `Headers` 实例时会丢掉自定义头，daemon 于是回
 * `WORKSPACE_CONTEXT_REQUIRED`（同一组头用普通对象传是 200，用 Headers
 * 传是 400，已实测）。
 */
function headersForContext(context: CanvasHostContext, init?: RequestInit): Record<string, string> {
  const { workspaceContext } = context;
  const headers = new Headers(init?.headers);
  if (workspaceContext) {
    for (const [key, value] of new Headers(workspaceProjectHeaders(workspaceContext)).entries()) {
      if (!headers.has(key)) headers.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(context.transport?.headers?.() ?? {})) headers.set(key, value);
  return Object.fromEntries(headers.entries());
}

export function projectFetchWithContext(context: CanvasHostContext, path: string, init?: RequestInit): Promise<Response> {
  const { projectId, workspaceContext } = context;
  const rest = path.startsWith('/') ? path : `/${path}`;
  const url = workspaceResourceUrl(
    `/api/projects/${encodeURIComponent(projectId)}${rest}`,
    workspaceContext,
  );
  return fetchForContext(context, url, init);
}

/** 与 `fetch` 同签名，重写 URL 并注入 Workspace 身份。 */
export function projectApiFetch(input: string, init?: RequestInit): Promise<Response> {
  // Shared capabilities must not inherit a business-module gate.
  const rest = input.replace(/^\/api(?=\/)/, '');
  if (/^\/canvas\/(state|revision)(?:\?|$)/.test(rest)) return canvasFetch(rest, init);
  if (/^\/files(?:[/?]|$)/.test(rest)) return projectFetch(rest, init);
  if (rest === '/system/open-external') return platformFetch('/api/system/open-external', init);
  return fetchForContext(getCanvasHostContext(), projectScopedUrl(input), init);
}

/** Shared persistence protocol for every product. */
export function canvasFetch(input: string, init?: RequestInit): Promise<Response> {
  return canvasFetchForContext(getCanvasHostContext(), input, init);
}

/** Canvas persistence pinned to the provider's owning project. */
export function canvasFetchForContext(context: CanvasHostContext, input: string, init?: RequestInit): Promise<Response> {
  const rest = input.replace(/^\/api/, '');
  if (!/^\/canvas\/(state|revision)(?:\?|$)/.test(rest)) throw new Error('Invalid canvas endpoint');
  return projectFetchWithContext(context, rest, init);
}

export function isCanvasBusinessModuleEnabled(id: string): boolean {
  return getCanvasHostContext().businessModules?.includes(id) ?? false;
}

/** Project-scoped platform API. */
export function projectFetch(path: string, init?: RequestInit, context = getCanvasHostContext()): Promise<Response> {
  return projectFetchWithContext(context, path, init);
}

/** Platform API outside the project URL namespace, with the same workspace identity. */
export function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  return platformFetchWithContext(getCanvasHostContext(), path, init);
}

export function platformFetchWithContext(context: CanvasHostContext, path: string, init?: RequestInit): Promise<Response> {
  return fetchForContext(context, workspaceResourceUrl(path, context.workspaceContext), init);
}

/** Project-scoped origin embedded in AI task instructions. */
export function projectApiOrigin(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const context = getCanvasHostContext();
  const url = canvasApiUrl(`/api/projects/${encodeURIComponent(context.projectId)}`, context);
  return /^https?:\/\//i.test(url) ? url : `${origin}${url}`;
}

/**
 * Daemon 路由返回 `{ error: { code, message } }`，历史前端则按字符串处理。
 * 统一在边界层解析，避免用户只看到 `[object Object]`。
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return localizeDaemonMessage(error.trim(), getCanvasActiveLocale());
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string' && error.message.trim()) return localizeDaemonMessage(error.message.trim(), getCanvasActiveLocale());
    if ('code' in error && typeof error.code === 'string' && error.code.trim()) return error.code.trim();
  }
  return fallback;
}
