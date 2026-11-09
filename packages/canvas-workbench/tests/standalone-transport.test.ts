import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveCanvasImageSrc, canonicalProjectFileUrl, canvasApiUrl, canvasFetch, canvasFetchForContext, getCanvasHostContext,
  platformFetch, platformFetchWithContext, projectApiFetch, projectApiOrigin,
  projectFetch, projectFileUrl, projectScopedUrl, setCanvasHostContext,
  type CanvasHostContext,
} from '../src/platform/api-base';

const response = () => new Response('{}', { status: 200 });
afterEach(() => { setCanvasHostContext(null); vi.unstubAllGlobals(); });

describe('standalone transport injection', () => {
  it('keeps media delivery descriptors canonical while browser images use the host resource bridge', () => {
    const bridge=vi.fn((path:string)=>`/private-resource?source=${encodeURIComponent(path)}`);
    const context:CanvasHostContext={projectId:'one',transport:{baseUrl:'/gateway',resourceUrl:bridge,headers:()=>({Authorization:'Bearer private'})}};
    expect(canonicalProjectFileUrl('outputs/images/a b.png',context)).toBe('/api/projects/one/files/outputs/images/a%20b.png');
    expect(bridge).not.toHaveBeenCalled();
    expect(projectFileUrl('outputs/images/a b.png',context)).toBe('/private-resource?source=%2Fgateway%2Fapi%2Fprojects%2Fone%2Ffiles%2Foutputs%2Fimages%2Fa%2520b.png');
    expect(()=>canonicalProjectFileUrl('../outside.png',context)).toThrow('invalid project file path');
  });
  it('routes project, canvas and platform operations through one custom API origin/prefix', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
    setCanvasHostContext({ projectId: 'project /a', transport: { baseUrl: 'https://canvas.example/edge/', fetch, headers: () => ({ Authorization: 'Bearer private', 'x-tenant': 'one' }) } });
    await projectFetch('/files?scope=all');
    await canvasFetch('/api/canvas/state');
    await platformFetch('/api/system/status');
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://canvas.example/edge/api/projects/project%20%2Fa/files?scope=all',
      'https://canvas.example/edge/api/projects/project%20%2Fa/canvas/state',
      'https://canvas.example/edge/api/system/status',
    ]);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer private', 'x-tenant': 'one' });
    expect(projectApiOrigin()).toBe('https://canvas.example/edge/api/projects/project%20%2Fa');
  });
  it('does not double prefix the compatibility API path', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
    setCanvasHostContext({ projectId: 'p', transport: { baseUrl: '/gateway/', fetch } });
    await projectApiFetch('/api/images/generate?quality=high');
    await projectApiFetch('/api/files?path=a%2Fb.png');
    await projectApiFetch('/api/canvas/revision');
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/gateway/api/projects/p/images/generate?quality=high',
      '/gateway/api/projects/p/files?path=a%2Fb.png',
      '/gateway/api/projects/p/canvas/revision',
    ]);
  });
  it('never forwards authorization to external absolute or protocol-relative URLs', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
    setCanvasHostContext({ projectId: 'p', transport: { baseUrl: 'https://api.example/prefix', fetch, headers: () => ({ authorization: 'Bearer secret' }) } });
    expect(() => platformFetch('https://attacker.example/collect')).toThrow(/external origin/);
    expect(() => projectApiFetch('https://attacker.example/collect')).toThrow(/external origin/);
    setCanvasHostContext({ projectId: 'p', transport: { fetch, headers: () => ({ authorization: 'Bearer secret' }) } });
    expect(() => platformFetch('//attacker.example/collect')).toThrow(/external origin/);
    expect(fetch).not.toHaveBeenCalled();
    expect(projectScopedUrl('https://cdn.example/image.png')).toBe('https://cdn.example/image.png');
  });
  it('keeps signed resource navigation separate from Authorization headers', () => {
    const resourceUrl = vi.fn((url: string) => `${url}?cap=temporary`);
    setCanvasHostContext({ projectId: 'p', transport: { baseUrl: 'https://api.example/prefix', headers: () => ({ authorization: 'Bearer NEVER-IN-URL' }), resourceUrl } });
    expect(projectFileUrl('inputs/a b/图.png')).toBe('https://api.example/prefix/api/projects/p/files/inputs/a%20b/%E5%9B%BE.png?cap=temporary');
    expect(resourceUrl).toHaveBeenCalledOnce();
    expect(resourceUrl.mock.calls[0]?.[0]).not.toContain('NEVER-IN-URL');
  });
  it('preserves already project-scoped resources and rejects traversal segments', () => {
    setCanvasHostContext({ projectId: 'current', transport: { baseUrl: '/proxy' } });
    expect(projectScopedUrl('/api/projects/original/files/picture.png?workspaceId=old')).toBe('/proxy/api/projects/original/files/picture.png?workspaceId=old');
    for (const path of ['', '../secret', 'a/../b', 'a/./b', 'a//b']) expect(() => projectFileUrl(path)).toThrow(/invalid project file path/);
    expect(projectFileUrl('folder\\file.txt')).toBe('/proxy/api/projects/current/files/folder/file.txt');
  });
  it('pins explicit operation contexts despite a different global active workspace', async () => {
    const fetchA = vi.fn(async (_url: string, _init?: RequestInit) => response());
    const fetchB = vi.fn(async (_url: string, _init?: RequestInit) => response());
    const a: CanvasHostContext = { projectId: 'a', transport: { baseUrl: 'https://a.example', fetch: fetchA, headers: () => ({ authorization: 'A' }) } };
    const b: CanvasHostContext = { projectId: 'b', transport: { baseUrl: 'https://b.example', fetch: fetchB, headers: () => ({ authorization: 'B' }) } };
    setCanvasHostContext(b);
    await canvasFetchForContext(a, '/canvas/state');
    await platformFetchWithContext(a, '/api/assets');
    await projectFetch('/files', undefined, a);
    expect(fetchB).not.toHaveBeenCalled();
    expect(fetchA.mock.calls.every(call => call[0].startsWith('https://a.example/'))).toBe(true);
    expect(fetchA.mock.calls.every(call => new Headers(call[1]?.headers).get('authorization') === 'A')).toBe(true);
    expect(getCanvasHostContext()).toBe(b);
  });
  it('merges caller headers and refreshes injected authorization per request', async () => {
    let token = 'first';
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
    setCanvasHostContext({ projectId: 'p', transport: { fetch, headers: () => ({ authorization: token }) } });
    await projectFetch('/files', { headers: { 'Content-Type': 'application/json', authorization: 'stale' } });
    token = 'rotated'; await projectFetch('/files');
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ authorization: 'first', 'content-type': 'application/json' });
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({ authorization: 'rotated' });
  });
  it('rejects uninitialized hosts, unsupported base protocols and invalid canvas routes', () => {
    expect(() => getCanvasHostContext()).toThrow(/not initialized/);
    for (const baseUrl of ['javascript:alert(1)', '//host.example', 'ftp://host.example']) expect(() => canvasApiUrl('/api/files', { projectId: 'p', transport: { baseUrl } })).toThrow(/Invalid canvas API base/);
    setCanvasHostContext({ projectId: 'p' });
    expect(() => canvasFetch('/canvas/delete-everything')).toThrow(/Invalid canvas endpoint/);
  });
});

it('routes persisted project image URLs through the browser resource bridge exactly once', () => {
 const resourceUrl=vi.fn((url:string)=>'/scoped-resource?source='+encodeURIComponent(url));
 setCanvasHostContext({projectId:'active',transport:{baseUrl:'/edge',headers:()=>({authorization:'private'}),resourceUrl}});
 expect(resolveCanvasImageSrc('/api/projects/owner/files/image.png')).toBe('/scoped-resource?source=%2Fedge%2Fapi%2Fprojects%2Fowner%2Ffiles%2Fimage.png');
 expect(resourceUrl).toHaveBeenCalledTimes(1);
 expect(resolveCanvasImageSrc('https://external.example/image.png')).toBe('https://external.example/image.png');
 expect(resolveCanvasImageSrc('blob:preview')).toBe('blob:preview');
 expect(resolveCanvasImageSrc(undefined)).toBe('');
 expect(resourceUrl.mock.calls[0]?.[0]).not.toContain('private');
});
