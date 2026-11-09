/** Appwrite Function entry for the Canvas App backend.
 *
 * The deployment is the FULL app backend (state/operations/receipts/files/
 * providers/asset library), not a door: each execution resolves platform
 * identity, takes the single-writer cloud lock, boots the real app service
 * against Appwrite, serves the request, flushes durable state and releases
 * only its own lock. No resident process, no trusted body actor, no proxied
 * upstream, no per-request process.env mutation. */
import { randomUUID } from 'node:crypto';
import { decodeRequest, encodeResponse, TransportError, type FnRequest } from './transport.js';
import { runInvocation, type FunctionDeps } from './runtime.js';

interface FnResponse {
  json: (body: unknown, status?: number, headers?: Record<string, string>) => unknown;
  text?: (body: string, status?: number, headers?: Record<string, string>) => unknown;
}
export interface FnContext {
  req: FnRequest;
  res: FnResponse;
  log: (m: string) => void;
  error: (m: string) => void;
}

const requestId = () => `req_${randomUUID()}`;

const errorBody = (status: number, code: string, message: string, retryable: boolean) => ({
  error: { code, message, retryable },
  requestId: requestId(),
});

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,60}$/;
/** Only TransportErrors (fixed validation strings) reach the caller verbatim.
 * Unknown exceptions collapse to a fixed status+code; raw messages, stacks
 * and codes are never logged or returned — they may carry credentials. */
const toError = (error: unknown): { status: number; code: string; message: string; retryable: boolean; stage: string } => {
  if (error instanceof TransportError)
    return { status: error.status, code: error.code, message: error.message, retryable: error.retryable, stage: error.stage ?? 'unknown' };
  const status = typeof (error as { status?: unknown })?.status === 'number' && (error as { status: number }).status >= 400 && (error as { status: number }).status <= 599
    ? (error as { status: number }).status : 500;
  const code = SAFE_CODE.test(String((error as { code?: unknown })?.code ?? '')) ? String((error as { code: string }).code) : 'CANVAS_FUNCTION_ERROR';
  return { status, code, message: status >= 500 ? 'Canvas function execution failed' : 'Request failed', retryable: status >= 500, stage: 'unknown' };
};

/** Factory seam: tests inject env, a canned server, lock and forwarder; the
 * default wiring boots the real app on Appwrite. */
export function createCanvasFunctionHandler(deps: FunctionDeps = {}) {
  return async ({ req, res, log, error: logError }: FnContext) => {
    try {
      let decoded;
      try { decoded = decodeRequest(req); }
      catch (error) { throw error instanceof TransportError ? error.at('decode') : error; }
      const upstream = await runInvocation(decoded, deps);
      const encoded = encodeResponse(upstream);
      return res.json(encoded.body, encoded.status, encoded.headers);
    } catch (error) {
      const { status, code, message, retryable, stage } = toError(error);
      // Fixed shape only: never the raw message/stack/cause.
      const line = `canvas function status=${status} code=${code} stage=${stage}`;
      if (status >= 500) logError(line);
      else log(line);
      return res.json(errorBody(status, code, message, retryable), status);
    }
  };
}
