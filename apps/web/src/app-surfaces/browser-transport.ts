'use client';
/** Transport wiring for the Browser App surface (`@ks-designai/browser-surface`).
 *
 * The component appends its API paths (`/api/projects`,
 * `/api/browser-preferences`, `/api/asset-library`) to `baseUrl`. Pointing
 * that at the same-origin `/api/browser-app` proxy keeps every browser
 * request off the canvas backend — no global fetch patching, no canvas
 * project store. */

/** Structural match for the package's `BrowserTransport` contract — declared
 * locally so the host compiles before the tarball is installed. Once
 * `@ks-designai/browser-surface` is a dependency this stays assignable to its
 * `BrowserTransport` ({baseUrl, fetch?, resourceUrl?}). */
export interface BrowserAppTransport {
  baseUrl: string;
  fetch?: typeof fetch;
  resourceUrl?: (url: string) => string;
}

export const BROWSER_APP_API_PREFIX = '/api/browser-app';

/** Same path allowlist as the server-side proxy — only browser-backend API
 * URLs may ride the same-origin doorway. */
const BROWSER_API_PATH = /^\/api\/(?:health|projects|browser-preferences|asset-library)(?:\/|$)/;

function pageOrigin(): string {
  return typeof location === 'undefined' ? 'http://localhost' : location.origin;
}

/** Same dev-mode tenant contract as `tenantHeaders()` in ./index — the
 * browser backend scopes by x-team-id/x-user-id, and a deployed host gateway
 * injects verified identity instead. */
function scopedTenantHeaders(): Record<string, string> {
  return {
    'x-team-id': process.env.NEXT_PUBLIC_TEAM_ID ?? 'local',
    'x-user-id': process.env.NEXT_PUBLIC_USER_ID ?? 'local',
  };
}

/** resourceUrl contract: the component hands back URLs its own API produced.
 * Only URLs that are already inside this page's control — relative paths, or
 * absolute URLs on this origin — may be rebound onto the browser proxy. An
 * external origin that merely happens to contain `/api/projects` is left
 * alone: it was never the browser API, and rebinding it would silently
 * redirect a third-party resource onto our backend. */
export function browserAppResourceUrl(url: string): string {
  try {
    const parsed = new URL(url, `${pageOrigin()}/`);
    if (parsed.origin !== pageOrigin()) return url;
    if (parsed.pathname === BROWSER_APP_API_PREFIX || parsed.pathname.startsWith(`${BROWSER_APP_API_PREFIX}/`)) {
      return `${parsed.pathname}${parsed.search}`;
    }
    if (!BROWSER_API_PATH.test(parsed.pathname)) return url;
    return `${BROWSER_APP_API_PREFIX}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Headers that carry business identity or host credentials — they exist for
 * the browser backend only and must never reach an external site. */
const EXTERNAL_CREDENTIAL_PATTERN = /^(authorization|proxy-authorization|cookie|cookie2|set-cookie|idempotency-key|x-team-id|x-user-id|x-browser-resource-token|x-forwarded-.+|x-mav-.+|x-canvas-.+|x-workspace-.+|x-bezier-.+)$/i;

/** Scoped fetch for the browser surface:
 * - same-origin requests MUST target the browser proxy — a same-origin call
 *   that missed the rewrite would land on the canvas API, so it is refused;
 * - proxy requests get the tenant scope headers filled in;
 * - external targets are read-only resource fetches: business credentials are
 *   stripped and cookies are omitted, so the transport can never smuggle host
 *   identity off the doorway. */
export async function browserAppFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const headers = new Headers(request?.headers);
  if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const target = new URL(request?.url ?? input.toString(), `${pageOrigin()}/`);
  const proxyPath = target.pathname === BROWSER_APP_API_PREFIX || target.pathname.startsWith(`${BROWSER_APP_API_PREFIX}/`);
  if (target.origin === pageOrigin()) {
    if (!proxyPath) {
      throw new Error(`Browser surface requests must stay on ${BROWSER_APP_API_PREFIX} — refusing same-origin ${target.pathname} that would reach canvas APIs`);
    }
    for (const [name, value] of Object.entries(scopedTenantHeaders())) if (!headers.has(name)) headers.set(name, value);
  } else {
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') throw new Error('External browser resources are read-only');
    for (const name of [...headers.keys()]) if (EXTERNAL_CREDENTIAL_PATTERN.test(name)) headers.delete(name);
  }
  return fetch(request ?? input, { ...init, headers, credentials: 'omit' });
}

export const browserAppTransport: BrowserAppTransport = {
  baseUrl: BROWSER_APP_API_PREFIX,
  fetch: browserAppFetch,
  resourceUrl: browserAppResourceUrl,
};
