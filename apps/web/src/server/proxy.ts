
/** Runtime-only backend proxy. Next rewrites bake environment values at build time. */
const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function cleanHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  const connectionFields = headers.get('connection')?.split(',').map(value => value.trim()) ?? [];
  for (const field of [...hopByHop, ...connectionFields]) if (field) headers.delete(field);
  return headers;
}

function unavailable(status: number, code: string): Response {
  return Response.json({ ok: false, error: { code, message: 'Canvas backend is not available' } }, { status });
}

/** Never turn a DNS-rebound or forged Host into authenticated backend access. */
function trustedWebAuthority(request: Request, incoming: URL): URL | Response {
  let expected: URL | undefined;
  try {
    if (process.env.CANVAS_WEB_URL) {
      expected = new URL(process.env.CANVAS_WEB_URL);
      if (!['http:', 'https:'].includes(expected.protocol) || expected.username || expected.password) throw new Error('Invalid web URL');
    }
  } catch { return unavailable(503, 'CANVAS_WEB_CONFIG_INVALID'); }
  try {
    const authority = new URL(`${expected?.protocol ?? incoming.protocol}//${request.headers.get('host') ?? incoming.host}`);
    if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash) {
      return unavailable(403, 'CANVAS_WEB_HOST_FORBIDDEN');
    }
    const allowed = expected ? authority.host === expected.host
      : authority.hostname === 'localhost' || authority.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(authority.hostname);
    return allowed ? authority : unavailable(403, 'CANVAS_WEB_HOST_FORBIDDEN');
  } catch { return unavailable(403, 'CANVAS_WEB_HOST_FORBIDDEN'); }
}

export async function proxyCanvasRequest(request: Request): Promise<Response> {
  // Never infer a target from the web port, build environment, or an ambient daemon.
  let origin: URL;
  try {
    const configured = process.env.CANVAS_SERVER_ORIGIN;
    if (!configured) return unavailable(503, 'CANVAS_BACKEND_NOT_CONFIGURED');
    origin = new URL(configured);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid backend origin');
  } catch {
    return unavailable(503, 'CANVAS_BACKEND_CONFIG_INVALID');
  }

  const incoming = new URL(request.url);
  const authority = trustedWebAuthority(request, incoming);
  if (authority instanceof Response) return authority;
  if (!/^\/(api|artifacts|frames)(\/|$)/.test(incoming.pathname)) return unavailable(404, 'NOT_FOUND');
  // Concatenation avoids interpreting a caller-controlled pathname as a new origin.
  const target = `${origin.origin}${incoming.pathname}${incoming.search}`;
  const headers = cleanHeaders(request.headers);
  headers.delete('host');
  // Origin 是浏览器 CSRF 语义：这里的转发已由 trustedWebAuthority 完成 Host 信任判定（服务间同机转发），
  // 透传浏览器 Origin（web 端口 ≠ canvas 端口）会被后端 ORIGIN_FORBIDDEN 误拒，导致保存/上传全部 403。
  headers.delete('origin');
  headers.delete('referer');
  headers.delete('content-length');
  headers.set('x-forwarded-host', authority.host);
  headers.set('x-forwarded-proto', authority.protocol.slice(0, -1));
  if (process.env.CANVAS_AUTH_TOKEN) headers.set('authorization', `Bearer ${process.env.CANVAS_AUTH_TOKEN}`);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method, headers, redirect: 'manual', cache: 'no-store', signal: request.signal,
    ...(hasBody && request.body ? { body: request.body, duplex: 'half' as const } : {}),
  };
  try {
    const upstream = await fetch(target, init);
    const responseHeaders = cleanHeaders(upstream.headers);
    // fetch decodes Content-Encoding; retaining its encoded size corrupts files.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: responseHeaders,
    });
  } catch {
    return unavailable(502, 'CANVAS_BACKEND_UNAVAILABLE');
  }
}
