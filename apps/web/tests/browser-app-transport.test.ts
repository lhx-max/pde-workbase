import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserAppFetch, browserAppResourceUrl, browserAppTransport, BROWSER_APP_API_PREFIX } from '../src/app-surfaces/browser-transport';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('browser surface transport', () => {
  it('anchors component API calls on the same-origin browser proxy', () => {
    expect(browserAppTransport.baseUrl).toBe('/api/browser-app');
    expect(BROWSER_APP_API_PREFIX).toBe('/api/browser-app');
  });
  it.each([
    ['/api/projects/p/raw/a.png', '/api/browser-app/api/projects/p/raw/a.png'],
    ['/api/browser-preferences', '/api/browser-app/api/browser-preferences'],
    ['/api/asset-library/a1/content', '/api/browser-app/api/asset-library/a1/content'],
    ['/api/browser-app/api/projects/p/x', '/api/browser-app/api/projects/p/x'],
    // Node test env has no location — absolute URLs are never this origin.
    ['http://127.0.0.1:17620/api/projects/p/x', 'http://127.0.0.1:17620/api/projects/p/x'],
    ['https://evil.example/api/projects/steal', 'https://evil.example/api/projects/steal'],
    ['/api/admin/secret', '/api/admin/secret'],
  ])('resourceUrl %s → %s', (input, expected) => {
    expect(browserAppResourceUrl(input)).toBe(expected);
  });
  it('injects tenant headers only onto same-origin proxy requests', async () => {
    const seen: Record<string, string | null>[] = [];
    const forwarded = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ team: headers.get('x-team-id'), user: headers.get('x-user-id'), auth: headers.get('authorization'), credentials: init?.credentials ?? null });
      return new Response('{}');
    });
    vi.stubGlobal('fetch', forwarded);
    await browserAppFetch('http://localhost/api/browser-app/api/projects');
    expect(seen.pop()).toMatchObject({ team: 'local', user: 'local', credentials: 'omit' });
    await browserAppFetch('http://localhost/api/browser-app/api/projects', { headers: { 'x-team-id': 'explicit' } });
    expect(seen.pop()).toMatchObject({ team: 'explicit', user: 'local' });
    await browserAppFetch('https://external.example/api/projects');
    expect(seen.pop()).toMatchObject({ team: null, user: null, credentials: 'omit' });
    // A same-origin /api call that missed the rewrite must be refused, never
    // allowed to land on the canvas API.
    await expect(browserAppFetch('http://localhost/api/projects')).rejects.toThrow();
    await expect(browserAppFetch('/api/projects/canvas-target')).rejects.toThrow();
    expect(forwarded).toHaveBeenCalledTimes(3);
  });
  it('strips caller-supplied business credentials from external resource reads', async () => {
    const forwarded = vi.fn(async (_input: unknown, init?: RequestInit) => new Response('img'));
    vi.stubGlobal('fetch', forwarded);
    await browserAppFetch('https://images.example/file.png', { headers: { authorization: 'Bearer a', 'x-mav-sso-authorization': 's', 'x-team-id': 't', 'x-workspace-id': 'w', cookie: 'c=1' } });
    const headers = new Headers((forwarded.mock.calls[0]?.[1] as RequestInit).headers);
    for (const name of ['authorization', 'x-mav-sso-authorization', 'x-team-id', 'x-workspace-id', 'cookie']) expect(headers.has(name)).toBe(false);
    await expect(browserAppFetch('https://images.example/file.png', { method: 'DELETE' })).rejects.toThrow();
  });
  it('merges caller init headers and preserves the request body contract', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    await browserAppFetch('http://localhost/api/browser-app/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer biz' }, body: '{}' });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer biz');
    expect(headers.get('x-team-id')).toBe('local');
    expect(init.method).toBe('POST');
  });
});
