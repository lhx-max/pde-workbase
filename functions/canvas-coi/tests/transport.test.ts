import { describe, expect, it } from 'vitest';
import {
  BINARY_REQUEST_MEDIA_TYPE, decodeRequest, encodeResponse, forwardHeaders,
  MAX_WRAPPED_BODY_BYTES, type FnRequest,
} from '../src/transport.js';

const base = (over: Partial<FnRequest> = {}): FnRequest => ({
  method: 'POST', path: '/api/apps/canvas/instances/c1/state', headers: {}, bodyText: '', ...over,
});

const wrap = (w: unknown, extraHeaders: Record<string, string> = {}): FnRequest =>
  base({ headers: { 'content-type': BINARY_REQUEST_MEDIA_TYPE, ...extraHeaders }, bodyText: JSON.stringify(w) });

describe('decodeRequest', () => {
  it('passes standard JSON requests through natively', () => {
    const d = decodeRequest(base({
      headers: { 'content-type': 'application/json', 'x-mav-tenant': 'team1' },
      bodyText: '{"a":1}', queryString: 'x=1&y=2',
    }));
    expect(d.method).toBe('POST');
    expect(d.path).toBe('/api/apps/canvas/instances/c1/state');
    expect(d.queryString).toBe('x=1&y=2');
    expect(d.contentType).toBe('application/json');
    expect(new TextDecoder().decode(d.body)).toBe('{"a":1}');
  });

  it('decodes the dedicated binary wrapper and preserves a multipart boundary', () => {
    const boundary = '----formboundaryXYZ9';
    const raw = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n\x00\x01\x02BIN\r\n--${boundary}--\r\n`;
    const d = decodeRequest(wrap({
      version: 1, bodyEncoding: 'base64',
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: Buffer.from(raw, 'utf8').toString('base64'),
    }));
    expect(d.contentType).toBe(`multipart/form-data; boundary=${boundary}`);
    expect(new TextDecoder().decode(d.body)).toBe(raw);
  });

  it('rejects wrappers with extra or identity-claiming keys', () => {
    for (const w of [
      { version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA', method: 'DELETE' },
      { version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA', headers: { authorization: 'Bearer x' } },
      { version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA', actor: 'admin' },
      { version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA', path: '/api/admin' },
      { version: 2, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA' },
      { version: 1, bodyEncoding: 'utf8', contentType: 'a/b', body: 'AAAA' },
      { version: 1, bodyEncoding: 'base64', contentType: 'a/b' },
      'not-an-object', 42, null,
    ]) expect(() => decodeRequest(wrap(w))).toThrowError(/transport|wrapper/i);
  });

  it('rejects wrapper content types carrying CR/LF or control bytes', () => {
    for (const ct of ['text/plain\r\nX-Evil: 1', 'a/b\nX: y', 'a/b\x00', '']) {
      expect(() => decodeRequest(wrap({ version: 1, bodyEncoding: 'base64', contentType: ct, body: 'AAAA' })))
        .toThrowError(/content type|transport/i);
    }
  });

  it('rejects malformed base64 and oversized wrapped bodies', () => {
    expect(() => decodeRequest(wrap({ version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: '!!!' }))).toThrowError(/base64/i);
    const big = Buffer.alloc(MAX_WRAPPED_BODY_BYTES + 1).toString('base64');
    expect(() => decodeRequest(wrap({ version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: big }))).toThrowError(/limit/i);
  });

  it('does not decode bodies under any other media type', () => {
    const d = decodeRequest(base({
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ version: 1, bodyEncoding: 'base64', contentType: 'a/b', body: 'AAAA' }),
    }));
    // The wrapper-looking JSON stays raw business bytes.
    expect(d.contentType).toBe('application/json');
    expect(new TextDecoder().decode(d.body)).toContain('"version"');
  });
});

describe('encodeResponse', () => {
  it('keeps version headers on JSON and rejects an empty successful byte payload', () => {
    const out=encodeResponse({status:200,headers:{'content-type':'application/json',etag:'"v1"','x-content-revision':'7','set-cookie':'private'},body:new TextEncoder().encode('{}')});
    expect(out.headers).toEqual({'content-type':'application/json',etag:'"v1"','x-content-revision':'7'});
    expect(()=>encodeResponse({status:200,headers:{'content-type':'image/png'},body:new Uint8Array()})).toThrow(/empty/);
  });
  it('passes JSON business responses through at the original status', () => {
    const out = encodeResponse({ status: 207, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{"a":1}') });
    expect(out).toEqual({ kind: 'json', status: 207, body: { a: 1 }, headers: { 'content-type': 'application/json' } });
  });

  it('wraps binary responses with only the fixed header set at the original status', () => {
    const out = encodeResponse({
      status: 206,
      headers: {
        'content-type': 'application/zip', 'content-range': 'bytes 0-9/20', 'accept-ranges': 'bytes',
        etag: '"v1"', 'set-cookie': 'session=evil', location: 'https://evil', 'x-appwrite-key': 'leak',
        'access-control-allow-origin': '*', 'x-content-revision': '7', 'last-modified': 'today', 'x-sketch-draft-scope': 's1',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(out.kind).toBe('wrapped');
    expect(out.status).toBe(206);
    const body = out.body as { functionTransport: string; bodyEncoding: string; body: string; headers: Record<string, string> };
    expect(body.functionTransport).toBe('designai.function-http/v1');
    expect(Buffer.from(body.body, 'base64')).toEqual(Buffer.from([1, 2, 3]));
    expect(Object.keys(body.headers).sort()).toEqual(['accept-ranges', 'content-range', 'content-type', 'etag', 'last-modified', 'x-content-revision', 'x-sketch-draft-scope']);
  });
});

describe('forwardHeaders', () => {
  it('strips hop-by-hop, platform key, cookie and proxy headers but keeps business identity', () => {
    const out = forwardHeaders({
      'x-mav-sso-authorization': 'Bearer sso', 'x-mav-tenant': 't', 'idempotency-key': 'k1',
      'x-appwrite-key': 'INTERNAL-KEY', 'x-appwrite-project': 'p', 'cookie': 'admin=1',
      'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8', 'connection': 'keep-alive', 'host': 'evil',
      'content-length': '999', 'transfer-encoding': 'chunked',
    }, '127.0.0.1:1234');
    expect(out['x-mav-sso-authorization']).toBe('Bearer sso');
    expect(out['idempotency-key']).toBe('k1');
    for (const bad of ['x-appwrite-key', 'x-appwrite-project', 'cookie', 'x-forwarded-for', 'x-real-ip', 'connection', 'content-length', 'transfer-encoding'])
      expect(out[bad]).toBeUndefined();
    expect(out['host']).toBe('127.0.0.1:1234');
  });
});
