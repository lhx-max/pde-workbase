import { timingSafeEqual } from 'node:crypto';

export const DESIGN_BROWSER_PARTITION = 'persist:bezier-design-browser';

export function localAppUrl(input: string | undefined, name: string): URL {
  if (!input) throw new Error(`${name} is required; launch through tools-dev`);
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.hash || url.search) throw new Error(`${name} must be a credential-free loopback HTTP(S) URL`);
  return url;
}

/** Only the configured application document, never same-origin previews/API documents. */
export function trustedDocument(input: string, configured: URL): boolean {
  try {
    const url = new URL(input);
    return url.origin === configured.origin && url.pathname === configured.pathname && !url.username && !url.password;
  } catch { return false; }
}

function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  // WHATWG URL already normalizes decimal, short, octal and hexadecimal IPv4.
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]'
    || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)
    || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host);
}
function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'http:' || url.protocol === 'ws:' ? '80' : url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '');
}
/** Loopback host aliases and HTTP/WebSocket scheme changes do not cross the host boundary. */
function privilegedTarget(url: URL, blockedOrigins: readonly string[]): boolean {
  const target = url.protocol === 'blob:' && url.origin !== 'null' ? new URL(url.origin) : url;
  return blockedOrigins.some(origin => {
    const blocked = new URL(origin);
    return target.origin === blocked.origin || (effectivePort(target) === effectivePort(blocked)
      && (target.hostname === blocked.hostname || loopbackHost(target.hostname) && loopbackHost(blocked.hostname)));
  });
}
export function allowedBrowserSubresourceUrl(input: unknown, blockedOrigins: readonly string[] = []): boolean {
  if (typeof input !== 'string' || input.length > 8192) return false;
  try {
    const url = new URL(input);
    return ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(url.protocol)
      && !url.username && !url.password && !privilegedTarget(url, blockedOrigins);
  } catch { return false; }
}

export function allowedBrowserUrl(input: unknown, blockedOrigins: readonly string[] = []): boolean {
  if (input === 'about:blank') return true;
  if (typeof input !== 'string' || input.length > 8192) return false;
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !privilegedTarget(url, blockedOrigins);
  } catch { return false; }
}

export function requireHostToken(value: unknown): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256 || /[^A-Za-z0-9_-]/.test(value)) {
    throw new Error('CANVAS_DESKTOP_AUTH_TOKEN requires a random 32+ character base64url secret');
  }
  return value;
}
export function authenticates(header: string | undefined, token: string): boolean {
  const received = Buffer.from(header ?? ''); const expected = Buffer.from(`Bearer ${token}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
export function captureClip(value: unknown, bounds: { width: number; height: number }) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Invalid capture clip');
  const c = value as Record<string, unknown>;
  if (![c.x, c.y, c.width, c.height].every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid capture clip');
  const x = Math.floor(c.x as number), y = Math.floor(c.y as number), width = Math.floor(c.width as number), height = Math.floor(c.height as number);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > bounds.width || y + height > bounds.height) throw new Error('Capture clip is outside the window');
  return { x, y, width, height };
}
