/** Appwrite Function HTTP transport contract v1 (shared Root contract):
 *
 * - Standard requests map natively: method/path/query/headers/body.
 * - Binary request bodies arrive ONLY inside the media type
 *   `application/vnd.designai.function-request+json`, with
 *   `{version:1, bodyEncoding:'base64', contentType, body}`.
 *   Nothing else may trigger decoding; the wrapper can never replace
 *   method/path/headers or inject identity.
 * - Binary responses are JSON-wrapped while the original HTTP status is
 *   preserved: `{functionTransport:'designai.function-http/v1',
 *   bodyEncoding:'base64', body, headers:{content-type,etag?,
 *   content-range?,accept-ranges?}}`. Only those fixed response headers pass;
 *   Set-Cookie/Location/CORS and internal headers never leak.
 */

export const BINARY_REQUEST_MEDIA_TYPE = 'application/vnd.designai.function-request+json';
export const BINARY_RESPONSE_TRANSPORT = 'designai.function-http/v1';

/** Decoded business bytes are bounded; the wrapper adds ~4/3 base64. */
export const MAX_WRAPPED_BODY_BYTES = 32 * 1024 * 1024;
export const MAX_RAW_BODY_CHARS = 64 * 1024 * 1024;

const RESPONSE_HEADER_ALLOWLIST = new Set(['content-type', 'etag', 'content-range', 'accept-ranges', 'x-content-revision', 'x-sketch-draft-scope', 'last-modified']);

const FIXED_STAGE = /^[a-z][a-z-]{1,30}$/;
export class TransportError extends Error {
  /** Fixed pipeline stage where the failure occurred; safe to log. */
  stage?: string;
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) {
    super(message);
  }
  at(stage: string): this {
    if (FIXED_STAGE.test(stage)) this.stage = stage;
    return this;
  }
}

export interface FnRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText?: string;
  bodyRaw?: string;
  bodyBinary?: ArrayBuffer | Uint8Array;
  body?: unknown;
  query?: Record<string, string> | string;
  queryString?: string;
}

export interface DecodedRequest {
  method: string;
  /** Path component only, already normalized (no query, no trailing slash except '/'). */
  path: string;
  /** Raw query string, without the leading '?'. */
  queryString: string;
  headers: Record<string, string>;
  /** Raw business body bytes; undefined for bodyless requests. */
  body: Uint8Array | undefined;
  /** Effective content type of the business body (after unwrapping). */
  contentType: string | undefined;
}

const headerValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value.join(',') : value;

const mediaType = (contentType: string | undefined): string =>
  (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();

/** Decode the platform request. Only the dedicated media type unwraps; every
 * other content type passes bytes through verbatim (JSON included). */
export function decodeRequest(req: FnRequest): DecodedRequest {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : '';
  if (!/^[A-Z]+$/.test(method)) throw new TransportError(400, 'FUNCTION_TRANSPORT_INVALID', 'Invalid request method');
  const rawPath = typeof req.path === 'string' ? req.path : '/';
  const qIndex = rawPath.indexOf('?');
  const pathOnly = qIndex < 0 ? rawPath : rawPath.slice(0, qIndex);
  const path = pathOnly.replace(/\/+$/, '') || '/';
  const inlineQuery = qIndex < 0 ? '' : rawPath.slice(qIndex + 1);
  const queryString = typeof req.queryString === 'string' && req.queryString
    ? req.queryString.replace(/^\?/, '')
    : inlineQuery;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    const v = headerValue(value);
    if (v !== undefined) headers[key.toLowerCase()] = v;
  }

  const rawText = typeof req.bodyText === 'string' ? req.bodyText
    : typeof req.bodyRaw === 'string' ? req.bodyRaw
    : typeof req.body === 'string' ? req.body
    : '';
  if (rawText.length > MAX_RAW_BODY_CHARS) throw new TransportError(413, 'FUNCTION_BODY_TOO_LARGE', 'Request body exceeds the transport limit');
  const binaryBody = req.bodyBinary !== undefined ? new Uint8Array(req.bodyBinary as ArrayBuffer) : undefined;
  const contentType = mediaType(headers['content-type']);

  if (contentType === BINARY_REQUEST_MEDIA_TYPE) {
    let wrapper: unknown;
    try { wrapper = JSON.parse(rawText); } catch { throw new TransportError(400, 'FUNCTION_TRANSPORT_INVALID', 'Malformed function-request wrapper JSON'); }
    if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper))
      throw new TransportError(400, 'FUNCTION_TRANSPORT_INVALID', 'Malformed function-request wrapper');
    const w = wrapper as Record<string, unknown>;
    if (w.version !== 1 || w.bodyEncoding !== 'base64' || typeof w.contentType !== 'string' || typeof w.body !== 'string'
      || Object.keys(w).some(k => !['version', 'bodyEncoding', 'contentType', 'body'].includes(k)))
      throw new TransportError(400, 'FUNCTION_TRANSPORT_INVALID', 'Unsupported function-request wrapper shape');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(w.body) || w.body.length % 4 !== 0)
      throw new TransportError(400, 'FUNCTION_TRANSPORT_INVALID', 'Invalid base64 body encoding');
    // The wrapper's contentType is forwarded verbatim (including a multipart
    // boundary) but may never smuggle CR/LF or other control bytes.
    if (w.contentType.length === 0 || w.contentType.length > 500 || /[\x00-\x1f\x7f]/.test(w.contentType))
      throw new TransportError(400, 'FUNCTION_TRANSPORT_INVALID', 'Invalid wrapped content type');
    const body = new Uint8Array(Buffer.from(w.body, 'base64'));
    if (body.byteLength > MAX_WRAPPED_BODY_BYTES)
      throw new TransportError(413, 'FUNCTION_BODY_TOO_LARGE', 'Wrapped body exceeds the transport limit');
    // Trusted headers stay the real request headers; the wrapper may only
    // supply the business content type and bytes.
    return { method, path, queryString, headers, body, contentType: w.contentType };
  }

  const body = binaryBody ?? (rawText ? new Uint8Array(new TextEncoder().encode(rawText)) : undefined);
  return { method, path, queryString, headers, body, contentType: headers['content-type'] };
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface EncodedResponse {
  kind: 'json' | 'wrapped';
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const isJsonMedia = (contentType: string): boolean => {
  const mt = mediaType(contentType);
  return mt === 'application/json' || mt.endsWith('+json');
};

/** JSON business responses pass through unchanged; every other response is a
 * bounded base64 wrapper under the original status. */
export function encodeResponse(upstream: UpstreamResponse): EncodedResponse {
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(upstream.headers)) {
    const k = key.toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(k)) allowed[k] = value;
  }
  const contentType = mediaType(upstream.headers['content-type']);
  if (isJsonMedia(contentType)) {
    try { return { kind: 'json', status: upstream.status, body: JSON.parse(new TextDecoder().decode(upstream.body)), headers: allowed }; }
    catch { /* fall through to the byte wrapper on malformed upstream JSON */ }
  }
  if (upstream.body.byteLength === 0 && upstream.status >= 200 && upstream.status < 300 && !isJsonMedia(contentType)) {
    // Never report an empty byte stream as a successful binary payload.
    throw new TransportError(502, 'FUNCTION_EMPTY_RESPONSE', 'Business response was empty');
  }
  return {
    kind: 'wrapped',
    status: upstream.status,
    body: {
      functionTransport: BINARY_RESPONSE_TRANSPORT,
      bodyEncoding: 'base64',
      body: Buffer.from(upstream.body).toString('base64'),
      headers: allowed,
    },
  };
}

/** Headers never forwarded into the business app: hop-by-hop, platform
 * identity, cookies and upstream proxy fields. */
const STRIP_FORWARD_HEADERS = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'cookie', 'accept-encoding', 'x-appwrite-key', 'x-appwrite-response-format',
  'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-real-ip', 'forwarded',
]);

export function forwardHeaders(headers: Record<string, string>, host: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (STRIP_FORWARD_HEADERS.has(k) || k.startsWith('x-appwrite-')) continue;
    out[k] = value;
  }
  out['host'] = host;
  return out;
}
