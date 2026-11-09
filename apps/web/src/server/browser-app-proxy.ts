
/** Same-origin doorway to the Browser App's own backend.
 *
 * The mounted browser surface builds its API calls (`/api/projects`,
 * `/api/browser-preferences`, `/api/asset-library`) on the `/api/browser-app`
 * prefix. This handler forwards ONLY those paths to the explicitly configured
 * browser service — it is not a generic URL proxy, never falls back to the
 * canvas backend, and never lets request bytes pick an upstream. */
const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/** Paths the Browser App backend actually serves (see designai-app-browser
 * routes: project files/tabs/events, shared preferences, asset library). */
const ALLOWED_PATH = /^\/api\/(?:health|projects|browser-preferences|asset-library)(?:\/|$)/;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Business headers the browser service consumes. Host, Origin, Referer,
 * Cookie and ambient maintainer credentials are NOT on this list — the
 * upstream only ever sees transport headers we set ourselves plus the
 * caller's business scope/auth. */
const FORWARD_HEADERS = new Set([
  'accept', 'accept-language', 'authorization', 'cache-control', 'content-type',
  'idempotency-key', 'if-match', 'if-none-match', 'if-modified-since', 'if-range', 'if-unmodified-since',
  'range',
  'x-team-id', 'x-user-id', 'x-browser-resource-token',
  'x-mav-sso-authorization', 'x-mav-tenant', 'x-mav-application-instance-id',
]);

function unavailable(status: number, code: string, message = 'Browser App backend is not available'): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/** The upstream origin is trusted configuration only: BROWSER_APP_API_ORIGIN,
 * or the loopback dev service — and that default only exists for an explicit
 * `next dev` runtime, never in production or test. */
function browserAppOrigin(): URL | Response {
  const configured = process.env.BROWSER_APP_API_ORIGIN;
  if (!configured) {
    if (process.env.NODE_ENV === 'development') return new URL('http://127.0.0.1:17620');
    return unavailable(503, 'BROWSER_APP_API_NOT_CONFIGURED');
  }
  try {
    const origin = new URL(configured);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid origin');
    return origin;
  } catch {
    return unavailable(503, 'BROWSER_APP_API_CONFIG_INVALID');
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Same forged-Host guard as the canvas proxy: a DNS-rebound or spoofed Host
 * must never turn into authenticated access to the browser service. */
function trustedWebAuthority(request: Request, incoming: URL): URL | Response {
  let expected: URL | undefined;
  try {
    if (process.env.CANVAS_WEB_URL) {
      expected = new URL(process.env.CANVAS_WEB_URL);
      if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password) throw new Error('Invalid web URL');
    }
  } catch { return unavailable(503, 'CANVAS_WEB_CONFIG_INVALID', 'Web host configuration is invalid'); }
  try {
    const authority = new URL(`${expected?.protocol ?? incoming.protocol}//${request.headers.get('host') ?? incoming.host}`);
    if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash) {
      return unavailable(403, 'CANVAS_WEB_HOST_FORBIDDEN', 'Request host is not trusted');
    }
    const allowed = expected ? authority.host === expected.host : isLoopback(authority.hostname);
    return allowed ? authority : unavailable(403, 'CANVAS_WEB_HOST_FORBIDDEN', 'Request host is not trusted');
  } catch { return unavailable(403, 'CANVAS_WEB_HOST_FORBIDDEN', 'Request host is not trusted'); }
}

/** A browser-sent request carries Origin. When it is present it must be the
 * trusted web authority itself — otherwise a third-party page could drive
 * this proxy with the deployment's service credentials. Origin-less calls
 * (same-origin fetches, CLI, daemons) are still allowed. */
function trustedRequestOrigin(request: Request, authority: URL): Response | null {
  const header = request.headers.get('origin');
  if (header === null) return null;
  try {
    if (new URL(header).origin === authority.origin) return null;
  } catch { /* 'null' and malformed origins are untrusted */ }
  return unavailable(403, 'BROWSER_APP_ORIGIN_FORBIDDEN', 'Request origin is not trusted');
}

function cleanResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  const connectionFields = headers.get('connection')?.split(',').map(value => value.trim()) ?? [];
  for (const field of [...hopByHop, ...connectionFields]) if (field) headers.delete(field);
  // fetch decodes Content-Encoding; retaining its encoded size corrupts files.
  headers.delete('content-encoding');
  headers.delete('content-length');
  // The browser service is API-only: upstream cookies must never be
  // established inside the canvas session.
  headers.delete('set-cookie');
  headers.delete('set-cookie2');
  return headers;
}

export async function proxyBrowserAppRequest(request: Request, params: { path?: string[] } | Promise<{ path?: string[] }>): Promise<Response> {
  const segments = (await params)?.path ?? [];
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return unavailable(404, 'BROWSER_APP_PATH_FORBIDDEN', 'Path is not served by the Browser App backend');
  }
  const joined = `/${segments.join('/')}`;
  if (!ALLOWED_PATH.test(joined)) {
    return unavailable(404, 'BROWSER_APP_PATH_FORBIDDEN', 'Path is not served by the Browser App backend');
  }
  if (!ALLOWED_METHODS.has(request.method)) {
    return unavailable(405, 'BROWSER_APP_METHOD_FORBIDDEN', 'Method is not served by the Browser App backend');
  }
  const origin = browserAppOrigin();
  if (origin instanceof Response) return origin;
  const incoming = new URL(request.url);
  const authority = trustedWebAuthority(request, incoming);
  if (authority instanceof Response) return authority;
  const originCheck = trustedRequestOrigin(request, authority);
  if (originCheck) return originCheck;
  // Re-encode each segment so a decoded '/', '..' or '?' can never escape the
  // allowlisted prefix or be reinterpreted as an upstream path of its own.
  const encodedPath = `/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
  const target = `${origin.origin}${encodedPath}${incoming.search}`;
  if (new URL(target).pathname !== encodedPath) {
    return unavailable(404, 'BROWSER_APP_PATH_FORBIDDEN', 'Path is not served by the Browser App backend');
  }
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (FORWARD_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  headers.set('x-forwarded-host', authority.host);
  headers.set('x-forwarded-proto', authority.protocol.slice(0, -1));
  // A configured service token belongs to THIS deployment's trusted backend —
  // it overrides the caller's header exactly like CANVAS_AUTH_TOKEN does, and
  // it never rides a plaintext remote link.
  if (process.env.BROWSER_APP_AUTH_TOKEN) {
    if (origin.protocol !== 'https:' && !isLoopback(origin.hostname)) {
      return unavailable(503, 'BROWSER_APP_API_CONFIG_INVALID', 'Refusing to send service credentials over a plaintext remote upstream');
    }
    headers.set('authorization', `Bearer ${process.env.BROWSER_APP_AUTH_TOKEN}`);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method, headers, redirect: 'manual', cache: 'no-store', signal: request.signal,
    ...(hasBody && request.body ? { body: request.body, duplex: 'half' as const } : {}),
  };
  try {
    const upstream = await fetch(target, init);
    // The browser API never redirects. Handing a 3xx back would let the
    // caller replay credentialled requests at an arbitrary Location.
    if (upstream.status >= 300 && upstream.status < 400) {
      void upstream.body?.cancel().catch(() => undefined);
      return unavailable(502, 'BROWSER_APP_REDIRECT_FORBIDDEN', 'Upstream redirect refused');
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: cleanResponseHeaders(upstream.headers),
    });
  } catch {
    return unavailable(502, 'BROWSER_APP_API_UNAVAILABLE');
  }
}
