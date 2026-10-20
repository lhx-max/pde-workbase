import { CanvasStateError } from '@bezier/canvas-core';

/** Shared Appwrite REST client for the canvas app backend.
 * Internal Appwrite (1.8.1) does not mint API keys or accept account JWTs on
 * the API path, and the proxy strips X-Appwrite-Session — verified
 * 2026-10-20. Session credentials must travel as a_session_<project> cookie. */
export interface AppwriteClientConfig {
  endpoint: string;          // e.g. https://frontend-cloud.corp.kuaishou.com/v1
  projectId: string;
  apiKey?: string;           // X-Appwrite-Key — Appwrite Functions mint one per execution
  sessionSecret?: string;    // X-Appwrite-Session (kept for compatible deployments)
  sessionCookie?: string;    // a_session_<project> cookie value
}

const enc = encodeURIComponent;

export class AppwriteClient {
  constructor(readonly config: AppwriteClientConfig) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'x-appwrite-project': this.config.projectId };
    if (this.config.apiKey) headers['x-appwrite-key'] = this.config.apiKey;
    else if (this.config.sessionSecret) headers['x-appwrite-session'] = this.config.sessionSecret;
    else if (this.config.sessionCookie) headers['cookie'] = this.config.sessionCookie;
    else throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'Appwrite credentials not configured');
    return headers;
  }

  async call<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
    const headers = { ...this.headers(), ...extra };
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart && !headers['content-type']) headers['content-type'] = 'application/json';
    const res = await fetch(`${this.config.endpoint}${path}`, { method, headers, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new CanvasStateError(res.status, 'CANVAS_FORBIDDEN', 'Appwrite rejected the request');
      if (res.status === 404) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'Appwrite document not found');
      if (res.status === 409) throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'Appwrite unique constraint conflict');
      throw new CanvasStateError(502, 'CANVAS_STORAGE_ERROR', `Appwrite ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /** GET that tolerates a missing document — returns null instead of throwing. */
  async getOrNull<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.config.endpoint}${path}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new CanvasStateError(res.status === 401 || res.status === 403 ? res.status : 502, 'CANVAS_STORAGE_ERROR', `Appwrite ${res.status}`);
    return res.json() as Promise<T>;
  }

  async download(path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.config.endpoint}${path}`, { headers: this.headers() });
    if (res.status === 404) throw new CanvasStateError(404, 'CANVAS_NOT_FOUND', 'Appwrite file not found');
    if (!res.ok) throw new CanvasStateError(res.status === 401 || res.status === 403 ? res.status : 502, 'CANVAS_STORAGE_ERROR', `Appwrite ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async upload(bucketId: string, fileId: string, name: string, bytes: Uint8Array, mime: string): Promise<{ $id: string }> {
    const form = new FormData();
    form.set('fileId', fileId);
    form.set('file', new File([bytes], name, { type: mime }));
    return this.call<{ $id: string }>('POST', `/storage/buckets/${enc(bucketId)}/files`, form);
  }

  docsPath(databaseId: string, collection: string): string {
    return `/databases/${enc(databaseId)}/collections/${enc(collection)}/documents`;
  }

  /** Internal Appwrite 1.8 only accepts the serialized Query object form. */
  static eq(key: string, value: string): string {
    return JSON.stringify({ method: 'equal', attribute: key, values: [value] });
  }

  static limit(n: number): string {
    return JSON.stringify({ method: 'limit', values: [n] });
  }

  static query(queries: string[]): string {
    return queries.map(q => `queries[]=${enc(q)}`).join('&');
  }

  fileViewUrl(bucketId: string, fileId: string): string {
    return `${this.config.endpoint}/storage/buckets/${enc(bucketId)}/files/${enc(fileId)}/view?project=${enc(this.config.projectId)}`;
  }
}

export { enc as appwriteEnc };
