import { du } from "./locales/desktop-ui.js";
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Cookie, CookiesSetDetails, Session } from 'electron';

/** Local development experiment. Never log payloads or connection codes. */
export function parsePinterestCookies(raw: unknown): CookiesSetDetails[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) throw new Error('Invalid cookies');
  const seen = new Set<string>();
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid cookie');
    const c = item as Record<string, unknown>;
    if (!['pinterest.com', '.pinterest.com', 'www.pinterest.com'].includes(String(c.domain))) throw new Error('Wrong domain');
    if (typeof c.name !== 'string' || !c.name || c.name.length > 256 || typeof c.value !== 'string' || c.value.length > 16384) throw new Error('Invalid cookie');
    if (typeof c.path !== 'string' || !c.path.startsWith('/') || c.path.length > 2048 || /[\r\n]/.test(c.path)) throw new Error('Invalid path');
    if (c.partitionKey !== undefined) throw new Error('Partitioned cookies are not supported by this experiment');
    const key = `${c.domain}|${c.path}|${c.name}`;
    if (seen.has(key)) throw new Error('Duplicate cookie');
    seen.add(key);
    if (c.expirationDate !== undefined && (typeof c.expirationDate !== 'number' || !Number.isFinite(c.expirationDate) || c.expirationDate <= Date.now() / 1000)) throw new Error('Expired cookie');
    const sameSite = c.sameSite === 'no_restriction' ? 'no_restriction' : c.sameSite === 'strict' ? 'strict' : c.sameSite === 'lax' ? 'lax' : 'unspecified';
    const host = String(c.domain).replace(/^\./, '');
    return {
      url: `https://${host}${c.path}`, name: c.name, value: c.value,
      ...(c.hostOnly === true ? {} : { domain: String(c.domain) }),
      path: c.path, secure: true, httpOnly: c.httpOnly === true, sameSite,
      ...(typeof c.expirationDate === 'number' ? { expirationDate: c.expirationDate } : {}),
    };
  });
}

/** Roll back changed keys on a failed import; never clear unrelated browsing data. */
export async function importPinterestCookies(target: Pick<Session, 'cookies'>, cookies: CookiesSetDetails[], signal?: AbortSignal) {
  const previous = await target.cookies.get({ domain: 'pinterest.com' });
  const touched: CookiesSetDetails[] = [];
  try {
    for (const cookie of cookies) { signal?.throwIfAborted(); touched.push(cookie); await target.cookies.set(cookie); }
    signal?.throwIfAborted();
    await target.cookies.flushStore();
    signal?.throwIfAborted();
  } catch {
    let restored = true;
    for (const cookie of touched.reverse()) {
      const host = new URL(cookie.url).hostname;
      const old = previous.find((c: Cookie) => c.name === cookie.name && c.path === cookie.path && c.domain === (cookie.domain ?? host));
      try {
        if (old) await target.cookies.set({ url: cookie.url, name: old.name, value: old.value, ...(old.hostOnly ? {} : { domain: old.domain }), path: old.path, secure: old.secure, httpOnly: old.httpOnly, sameSite: old.sameSite, expirationDate: old.expirationDate });
        else if (cookie.name) await target.cookies.remove(cookie.url, cookie.name);
      } catch { restored = false; }
    }
    try { await target.cookies.flushStore(); } catch { restored = false; }
    throw new Error(restored ? du().importRestored : du().importRestoreFailed);
  }
}

export async function startPinterestAuthBridge(options: {
  accept: (cookies: CookiesSetDetails[], signal: AbortSignal) => Promise<boolean>;
  ttlMs?: number;
}) {
  const token = randomBytes(32).toString('hex');
  let used = false;
  let closed = false;
  const lifetime = new AbortController();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const reply = (status: number, message: string) => { response.writeHead(status); response.end(JSON.stringify({ message })); };
    const address = server.address();
    const expectedHost = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    const origin = request.headers.origin;
    const supplied = Buffer.from((request.headers.authorization || '').replace(/^Bearer /, ''));
    const validToken = supplied.length === token.length && timingSafeEqual(supplied, Buffer.from(token));
    if (closed || used || request.headers.host !== expectedHost || request.method !== 'POST' || request.url !== '/connect' || !validToken || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) { reply(403, du().badConnectionCode); return; }
    if (!request.headers['content-type']?.startsWith('application/json')) { reply(415, du().badRequestFormat); return; }
    used = true;
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > 65536) throw new Error('Payload too large');
        chunks.push(Buffer.from(chunk));
      }
      const cookies = parsePinterestCookies(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (closed) { reply(410, du().connectionExpired); return; }
      const accepted = await options.accept(cookies, lifetime.signal);
      reply(accepted ? 200 : 409, accepted ? du().sessionReceived : du().sessionNotConnected);
    } catch { reply(400, du().connectFailedReturn); }
    finally { close(); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const timer = setTimeout(() => close(), options.ttlMs ?? 300000);
  timer.unref();
  function close() { closed = true; lifetime.abort(); clearTimeout(timer); server.close(); server.closeIdleConnections(); }
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local bridge unavailable');
  return { code: `http://127.0.0.1:${address.port}/#${token}`, close };
}
