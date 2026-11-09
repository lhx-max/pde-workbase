/** Image-tool artifact binary store (persistence primitive, no tool semantics).
 *
 * Bytes live either in the injected ImageFileStorage pipeline (image/*) or in
 * the configured Appwrite bucket as content-addressed `tla-` blobs
 * (application/json). The per-(namespace, projectId, path) head index is one
 * JsonStatePort slot; there is no collection, no filesystem and no
 * browser-supplied file id anywhere in the lookup path.
 *
 * Every method authorizes the caller-supplied scope first — including replay
 * and failure branches — and assumes the explicit single-writer namespace
 * contract JsonStatePort documents. Per-slot serialization is shared by every
 * adapter instance on the same port object (WeakMap state -> lock map).
 * Nothing here logs artifact bytes or caller parameters. */

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CanvasStateError } from '@bezier/canvas-core';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { AppwriteClient, appwriteEnc as enc } from './appwrite-client.js';
import type { ImageFileStorage } from './cloud-image-files.js';

export interface Scope {
  namespace: string;
  projectId: string;
}

export type ArtifactRole = 'result' | 'preview' | 'mask' | 'vector' | 'layer' | 'edit-state' | 'surface';

export interface ArtifactWrite {
  id: string;
  role: ArtifactRole;
  path: string;
  mime: string;
  content: Uint8Array;
  width?: number;
  height?: number;
}

export interface StoredArtifact {
  id: string;
  role: ArtifactRole;
  path: string;
  mime: string;
  byteLength: number;
  sha256: string;
  width?: number;
  height?: number;
}

export interface CloudToolArtifactFilesOptions {
  client: AppwriteClient;
  state: JsonStatePort;
  bucketId: string;
  images: ImageFileStorage;
  authorize: (scope: Scope, mode: 'read' | 'write') => Promise<void>;
}

interface IndexRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  scope: Scope;
  artifact: StoredArtifact;
  fileId?: string;
  storage: 'image' | 'blob';
}

const SCHEMA_VERSION = 'image-tool-file/v1' as const;
const SLOT_PREFIX = 'image-tool-file-';
const MAX_ARTIFACT_BYTES = 30_000_000;
const MAX_PIXELS = 32_000_000;
const MAX_JSON_DEPTH = 12;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const NAMESPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/u;
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BLOB_FILE_ID_RE = /^tla-[a-f0-9]{30}$/u;
const FORBIDDEN_PATH_CHARS = /[:%?#\\\x00-\x1f\x7f-\x9f]/u;
const ROLES: ReadonlySet<string> = new Set(['result', 'preview', 'mask', 'vector', 'layer', 'edit-state', 'surface']);
const ALLOWED_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/json']);
const RASTER_FORMATS: ReadonlyMap<string, 'png' | 'jpeg' | 'webp'> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
]);
const INDEX_FIELDS = new Set(['schemaVersion', 'scope', 'artifact', 'fileId', 'storage']);
const SCOPE_FIELDS = new Set(['namespace', 'projectId']);
const ARTIFACT_FIELDS = new Set(['id', 'role', 'path', 'mime', 'byteLength', 'sha256', 'width', 'height']);

const sha256hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

function invalid(message: string): never {
  throw new CanvasStateError(400, 'IMAGE_TOOL_ARTIFACT_INVALID', message);
};
function conflict(message: string): never {
  throw new CanvasStateError(409, 'IMAGE_TOOL_ARTIFACT_CONFLICT', message);
};
function corrupt(message: string): never {
  throw new CanvasStateError(503, 'IMAGE_TOOL_ARTIFACT_CORRUPT', message);
};

/** Errors this adapter did not produce are collapsed into short generic
 * shapes — never provider bodies, tokens or request details. Denial statuses
 * keep their 401/403; own IMAGE_TOOL_* errors pass through untouched. */
function sanitized(error: unknown): CanvasStateError {
  if (error instanceof CanvasStateError) {
    if (error.code.startsWith('IMAGE_TOOL_')) return error;
    if (error.status === 401 || error.status === 403) {
      return new CanvasStateError(error.status, 'IMAGE_TOOL_ARTIFACT_DENIED', 'tool artifact storage access denied');
    }
    if (error.status === 400) return new CanvasStateError(400, 'IMAGE_TOOL_ARTIFACT_INVALID', 'tool artifact input rejected');
    if (error.status === 404) return new CanvasStateError(503, 'IMAGE_TOOL_ARTIFACT_CORRUPT', 'indexed artifact storage record is missing');
    if (error.status === 409) return new CanvasStateError(409, 'IMAGE_TOOL_ARTIFACT_CONFLICT', 'tool artifact storage conflict');
  }
  if(error&&typeof error==='object'&&'status' in error&&(error.status===401||error.status===403))return new CanvasStateError(error.status,'IMAGE_TOOL_ARTIFACT_DENIED','tool artifact storage access denied');
  return new CanvasStateError(503, 'IMAGE_TOOL_ARTIFACT_IO', 'tool artifact storage request failed');
}

function checkScope(raw: unknown): Scope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('tool artifact scope is required');
  const { namespace, projectId } = raw as { namespace?: unknown; projectId?: unknown };
  if (typeof namespace !== 'string' || !NAMESPACE_RE.test(namespace)) return invalid('invalid tool artifact namespace');
  if (typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) return invalid('invalid tool artifact project id');
  return { namespace, projectId };
}

/** Project-relative artifact path: reject (never fix) absolute, backslash,
 * dot-segment, colon, control, %, ? and # forms before the shared normalizer
 * runs; the result must already be canonical. */
function checkPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return invalid('artifact path is out of bounds');
  if (FORBIDDEN_PATH_CHARS.test(raw)) return invalid('artifact path contains forbidden characters');
  let normalized: string;
  try {
    normalized = normalizeSafeProjectFilePath(raw);
  } catch {
    return invalid('artifact path is not a safe project-relative path');
  }
  if (normalized !== raw) return invalid('artifact path must be normalized');
  return normalized;
}

interface CheckedWrite {
  id: string;
  role: ArtifactRole;
  path: string;
  mime: string;
  byteLength: number;
  sha256: string;
  width?: number;
  height?: number;
}

function checkWrite(input: ArtifactWrite): CheckedWrite {
  if (!input || typeof input !== 'object') return invalid('artifact write input is required');
  if (typeof input.id !== 'string' || !ARTIFACT_ID_RE.test(input.id)) return invalid('artifact id is invalid');
  if (typeof input.role !== 'string' || !ROLES.has(input.role)) return invalid('artifact role is invalid');
  const path = checkPath(input.path);
  if (typeof input.mime !== 'string' || !ALLOWED_MIMES.has(input.mime)) return invalid('artifact mime is not supported');
  if (!(input.content instanceof Uint8Array) || input.content.byteLength === 0 || input.content.byteLength > MAX_ARTIFACT_BYTES) {
    return invalid('artifact bytes are out of bounds');
  }
  const { width, height } = input;
  if ((width === undefined) !== (height === undefined)) return invalid('artifact dimensions must be supplied together');
  if (width !== undefined && (
    typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width * height > MAX_PIXELS
  )) {
    return invalid('artifact dimensions are invalid');
  }
  const checked: CheckedWrite = {
    id: input.id,
    role: input.role as ArtifactRole,
    path,
    mime: input.mime,
    byteLength: input.content.byteLength,
    sha256: sha256hex(input.content),
  };
  if (width !== undefined) {
    checked.width = width;
    checked.height = height as number;
  }
  return checked;
}

function rasterSignatureOk(mime: string, bytes: Uint8Array): boolean {
  if (mime === 'image/png') {
    return bytes.byteLength >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mime === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return bytes.byteLength >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

const SVG_ROOT = /<svg[\s>]/iu;
const SVG_PRIMITIVE = /<(path|rect|circle|ellipse|line|polyline|polygon|text|use|symbol|g|defs|clippath|lineargradient|radialgradient|pattern|mask|title|desc)[\s>/]/iu;
const SVG_FORBIDDEN: readonly RegExp[] = [
  /<\?/u, // processing instructions, including the XML declaration
  /<!doctype/iu,
  /<!entity/iu,
  /<\/?\s*script[\s>/]/iu,
  /<\/?\s*image[\s>/]/iu,
  /<\/?\s*foreignobject[\s>/]/iu,
  /\son[a-z0-9]+\s*=/iu, // inline event handlers
  /@import/iu,
  /javascript\s*:/iu,
];
const SVG_REF_ATTR = /(?:href|src|srcset|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/giu;
const SVG_CSS_URL = /url\(\s*([^)]*)\)/giu;

function assertSvgArtifact(content: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return invalid('svg artifact is not valid utf-8');
  }
  if (!SVG_ROOT.test(text)) return invalid('svg artifact lacks an svg root element');
  if (!SVG_PRIMITIVE.test(text)) return invalid('svg artifact lacks vector content');
  for (const pattern of SVG_FORBIDDEN) {
    if (pattern.test(text)) return invalid('svg artifact contains forbidden content');
  }
  for (const match of text.matchAll(SVG_REF_ATTR)) {
    const value = (match[1] ?? '').replace(/^["']|["']$/gu, '');
    if (!value.startsWith('#')) return invalid('svg artifact references an external resource');
  }
  for (const match of text.matchAll(SVG_CSS_URL)) {
    const value = (match[1] ?? '').trim().replace(/^["']|["']$/gu, '');
    if (!value.startsWith('#')) return invalid('svg artifact references an external resource');
  }
}

/** Credential-shaped key names from the frozen spec, matched as whole words
 * inside any naming convention (exact alnum-stripped key, camel/snake word
 * segments, and compounds ending in the highest-risk names). Free-text
 * VALUES are never inspected — only keys. */
const CREDENTIAL_KEYWORDS = new Set([
  'token', 'secret', 'password', 'authorization', 'cookie', 'bearer', 'apikey',
  'session', 'header', 'oauth', 'jwt', 'signature', 'auth',
]);
const CREDENTIAL_SUFFIXES = ['token', 'secret', 'password', 'signature', 'authorization'];
const POLLUTION_KEYS = new Set(['proto', 'constructor', 'prototype']);

function assertSafeJsonKey(key: string): void {
  const lower = key.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]/gu, '');
  if (lower === '__proto__' || POLLUTION_KEYS.has(stripped)) return invalid('json artifact contains a forbidden object key');
  if (
    CREDENTIAL_KEYWORDS.has(stripped)
    || stripped.includes('apikey')
    || CREDENTIAL_SUFFIXES.some((word) => stripped.endsWith(word))
  ) {
    return invalid('json artifact contains a credential-shaped key');
  }
  for (const segment of key.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/u)) {
    if (segment && CREDENTIAL_KEYWORDS.has(segment.toLowerCase())) return invalid('json artifact contains a credential-shaped key');
  }
}

function assertJsonValue(value: unknown, depth: number): void {
  if (value !== null && typeof value === 'object') {
    if (depth >= MAX_JSON_DEPTH) return invalid('json artifact nesting exceeds the limit');
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, depth + 1);
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        assertSafeJsonKey(key);
        assertJsonValue(child, depth + 1);
      }
    }
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return invalid('json artifact contains a non-finite number');
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean' && value !== null) {
    return invalid('json artifact contains a non-JSON value');
  }
}

function assertJsonArtifact(content: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return invalid('json artifact is not valid utf-8');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid('json artifact is malformed');
  }
  assertJsonValue(value, 0);
}

function cloneArtifact(artifact: StoredArtifact): StoredArtifact {
  const clone: StoredArtifact = {
    id: artifact.id,
    role: artifact.role,
    path: artifact.path,
    mime: artifact.mime,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
  };
  if (artifact.width !== undefined) {
    clone.width = artifact.width;
    clone.height = artifact.height as number;
  }
  return clone;
}

function parseStoredArtifact(raw: unknown, path: string): StoredArtifact {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return corrupt('artifact index entry is not an object');
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ARTIFACT_FIELDS.has(key)) return corrupt('artifact index entry has unknown field');
  }
  if (typeof record.id !== 'string' || !ARTIFACT_ID_RE.test(record.id)) return corrupt('artifact index id is invalid');
  if (typeof record.role !== 'string' || !ROLES.has(record.role)) return corrupt('artifact index role is invalid');
  if (record.path !== path) return corrupt('artifact index path mismatch');
  if (typeof record.mime !== 'string' || !ALLOWED_MIMES.has(record.mime)) return corrupt('artifact index mime is invalid');
  if (
    typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength)
    || record.byteLength <= 0 || record.byteLength > MAX_ARTIFACT_BYTES
  ) {
    return corrupt('artifact index byte length is invalid');
  }
  if (typeof record.sha256 !== 'string' || !SHA256_RE.test(record.sha256)) return corrupt('artifact index checksum is invalid');
  const { width, height } = record;
  if ((width === undefined) !== (height === undefined)) return corrupt('artifact index dimensions are inconsistent');
  if (width !== undefined && (
    typeof width !== 'number' || typeof height !== 'number'
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width * height > MAX_PIXELS
  )) {
    return corrupt('artifact index dimensions are invalid');
  }
  const artifact: StoredArtifact = {
    id: record.id,
    role: record.role as ArtifactRole,
    path,
    mime: record.mime,
    byteLength: record.byteLength as number,
    sha256: record.sha256,
  };
  if (width !== undefined) {
    artifact.width = width as number;
    artifact.height = height as number;
  }
  return artifact;
}

function parseIndexRecord(raw: unknown, scope: Scope, path: string): IndexRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return corrupt('artifact index record is not an object');
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!INDEX_FIELDS.has(key)) return corrupt('artifact index record has unknown field');
  }
  if (record.schemaVersion !== SCHEMA_VERSION) return corrupt('artifact index schema version mismatch');
  if (!record.scope || typeof record.scope !== 'object' || Array.isArray(record.scope)) return corrupt('artifact index scope is invalid');
  const recordScope = record.scope as Record<string, unknown>;
  for (const key of Object.keys(recordScope)) {
    if (!SCOPE_FIELDS.has(key)) return corrupt('artifact index scope has unknown field');
  }
  if (recordScope.namespace !== scope.namespace || recordScope.projectId !== scope.projectId) return corrupt('artifact index scope mismatch');
  if (record.storage !== 'image' && record.storage !== 'blob') return corrupt('artifact index storage kind is invalid');
  if (record.fileId !== undefined && (typeof record.fileId !== 'string' || !BLOB_FILE_ID_RE.test(record.fileId))) {
    return corrupt('artifact index file id is invalid');
  }
  if (record.storage === 'blob' && record.fileId === undefined) return corrupt('artifact index blob record lacks a file id');
  const artifact = parseStoredArtifact(record.artifact, path);
  if ((record.storage === 'blob' && artifact.mime !== 'application/json') || (record.storage === 'image' && !artifact.mime.startsWith('image/'))) {
    return corrupt('artifact index storage and mime do not match');
  }
  const parsed: IndexRecord = { schemaVersion: SCHEMA_VERSION, scope, artifact, storage: record.storage };
  if (record.fileId !== undefined) parsed.fileId = record.fileId as string;
  return parsed;
}

function sameArtifact(stored: StoredArtifact, checked: CheckedWrite): boolean {
  return stored.id === checked.id
    && stored.role === checked.role
    && stored.path === checked.path
    && stored.mime === checked.mime
    && stored.byteLength === checked.byteLength
    && stored.sha256 === checked.sha256
    && stored.width === checked.width
    && stored.height === checked.height;
}

const slotLocks = new WeakMap<JsonStatePort, Map<string, Promise<void>>>();

export class CloudToolArtifactFiles {
  private readonly client: AppwriteClient;
  private readonly state: JsonStatePort;
  private readonly bucketId: string;
  private readonly images: ImageFileStorage;
  private readonly authorize: CloudToolArtifactFilesOptions['authorize'];

  constructor(options: CloudToolArtifactFilesOptions) {
    const missing = !options || typeof options !== 'object'
      || !options.client || typeof options.client.upload !== 'function' || typeof options.client.download !== 'function'
      || !options.state || typeof options.state.read !== 'function' || typeof options.state.write !== 'function' || typeof options.state.flush !== 'function'
      || !options.images || typeof options.images.write !== 'function' || typeof options.images.read !== 'function'
      || typeof options.authorize !== 'function'
      || typeof options.bucketId !== 'string' || options.bucketId.trim() === '';
    if (missing) throw new CanvasStateError(503, 'IMAGE_TOOL_ARTIFACT_UNAVAILABLE', 'tool artifact storage is not configured');
    this.client = options.client;
    this.state = options.state;
    this.bucketId = options.bucketId;
    this.images = options.images;
    this.authorize = options.authorize;
  }

  private slotFor(scope: Scope, path: string): string {
    return SLOT_PREFIX + sha256hex(JSON.stringify([scope.namespace, scope.projectId, path])).slice(0, 40);
  }

  /** Serialized read-modify-write per slot, shared across every adapter
   * instance built on the same JsonStatePort object. */
  private async withSlotLock<T>(slot: string, fn: () => Promise<T>): Promise<T> {
    let locks = slotLocks.get(this.state);
    if (!locks) {
      locks = new Map();
      slotLocks.set(this.state, locks);
    }
    const previous = locks.get(slot) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current, () => current);
    locks.set(slot, chained);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(slot) === chained) locks.delete(slot);
    }
  }

  private readIndex(slot: string, scope: Scope, path: string): IndexRecord | null {
    const raw = this.state.read(slot);
    if (raw === undefined) return null;
    return parseIndexRecord(raw, scope, path);
  }

  private blobDownloadPath(fileId: string): string {
    return `/storage/buckets/${enc(this.bucketId)}/files/${enc(fileId)}/download`;
  }

  private async downloadBlob(fileId: string): Promise<Uint8Array> {
    if (!BLOB_FILE_ID_RE.test(fileId)) return corrupt('indexed blob file id is invalid');
    return this.client.download(this.blobDownloadPath(fileId));
  }

  /** Adopt a pre-existing deterministic blob only after its bytes verify;
   * a mismatch is a refusal, never a false adoption. */
  private async verifyBlob(fileId: string, byteLength: number, sha256: string): Promise<void> {
    const bytes = await this.downloadBlob(fileId);
    if (bytes.byteLength !== byteLength || sha256hex(bytes) !== sha256) {
      return conflict('existing cloud artifact bytes do not match');
    }
  }

  private async verifyRaster(mime: string, content: Uint8Array, expected?:{width?:number;height?:number}): Promise<void> {
    if (!rasterSignatureOk(mime, content)) return invalid('image bytes do not match the declared mime type');
    const meta = await sharp(content, { limitInputPixels: MAX_PIXELS }).metadata()
      .catch(() => invalid('image bytes could not be decoded or exceed the pixel limit'));
    if (meta.format !== RASTER_FORMATS.get(mime)) return invalid('decoded image format does not match the declared mime type');
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) return invalid('image dimensions exceed the pixel limit');
    if (expected?.width !== undefined && (meta.width !== expected.width || meta.height !== expected.height)) {
      return invalid('declared dimensions do not match image bytes');
    }
  }

  private async storeBytes(
    scope: Scope,
    checked: CheckedWrite,
    content: Uint8Array,
  ): Promise<{ artifact: StoredArtifact; storage: 'image' | 'blob'; fileId?: string }> {
    const artifact: StoredArtifact = {
      id: checked.id,
      role: checked.role,
      path: checked.path,
      mime: checked.mime,
      byteLength: checked.byteLength,
      sha256: checked.sha256,
    };
    if (checked.width !== undefined) {
      artifact.width = checked.width;
      artifact.height = checked.height as number;
    }
    if (checked.mime === 'application/json') {
      assertJsonArtifact(content);
      const fileId = `tla-${sha256hex(JSON.stringify([scope.namespace, scope.projectId, checked.path, checked.sha256])).slice(0, 30)}`;
      const last = checked.path.split('/').pop() ?? 'artifact';
      const name = last.endsWith('.json') ? last : `${last}.json`;
      try {
        await this.client.upload(this.bucketId, fileId, name, content, 'application/json');
      } catch (error) {
        if (!(error instanceof CanvasStateError && error.status === 409)) throw error;
        await this.verifyBlob(fileId, checked.byteLength, checked.sha256);
      }
      return { artifact, storage: 'blob', fileId };
    }
    if (checked.mime === 'image/svg+xml') {
      assertSvgArtifact(content);
      const meta=await sharp(content,{limitInputPixels:MAX_PIXELS}).metadata();
      if(meta.format!=='svg'||!meta.width||!meta.height||meta.width*meta.height>MAX_PIXELS)invalid('vector dimensions exceed the pixel limit');
      if(checked.width!==undefined&&(meta.width!==checked.width||meta.height!==checked.height))invalid('declared vector dimensions do not match bytes');
    }
    else await this.verifyRaster(checked.mime, content,checked);
    const written = await this.images.write(scope.projectId, checked.path, content, checked.mime);
    if (!written || typeof written !== 'object' || written.name !== checked.path) {
      throw new CanvasStateError(503, 'IMAGE_TOOL_ARTIFACT_IO', 'image storage returned an unexpected artifact path');
    }
    return { artifact, storage: 'image' };
  }

  private async readImageBytes(scope: Scope, artifact: StoredArtifact): Promise<Uint8Array> {
    const result = await this.images.read(scope.projectId, artifact.path);
    if (!result || !(result.buffer instanceof Uint8Array)) return corrupt('indexed artifact bytes are missing from image storage');
    if (!result.file || typeof result.file !== 'object' || result.file.mime !== artifact.mime) {
      return corrupt('indexed artifact mime does not match image storage');
    }
    return result.buffer;
  }

  async put(rawScope: Scope, input: ArtifactWrite): Promise<StoredArtifact> {
    try {
      await this.authorize(rawScope, 'write');
      await this.state.ready;
      const scope = checkScope(rawScope);
      if (!input || !(input.content instanceof Uint8Array)) return invalid('artifact bytes are required');
      const frozen = { ...input, content: new Uint8Array(input.content) };
      const checked = checkWrite(frozen);
      const slot = this.slotFor(scope, checked.path);
      return await this.withSlotLock(slot, async () => {
        const existing = this.readIndex(slot, scope, checked.path);
        if (existing) {
          if (sameArtifact(existing.artifact, checked)) {await this.state.flush();return cloneArtifact(existing.artifact);}
          return conflict('a different tool artifact already occupies this path');
        }
        const stored = await this.storeBytes(scope, checked, frozen.content);
        const record: IndexRecord = { schemaVersion: SCHEMA_VERSION, scope, artifact: stored.artifact, storage: stored.storage };
        if (stored.fileId !== undefined) record.fileId = stored.fileId;
        this.state.write(slot, record);
        await this.state.flush();
        return cloneArtifact(stored.artifact);
      });
    } catch (error) {
      throw sanitized(error);
    }
  }

  async read(rawScope: Scope, rawPath: string): Promise<{ artifact: StoredArtifact; content: Uint8Array } | null> {
    try {
      await this.authorize(rawScope, 'read');
      await this.state.ready;
      await this.state.flush();
      const scope = checkScope(rawScope);
      const path = checkPath(rawPath);
      const record = this.readIndex(this.slotFor(scope, path), scope, path);
      if (!record) return null;
      if (record.storage === 'blob' && record.fileId !== `tla-${sha256hex(JSON.stringify([scope.namespace, scope.projectId, path, record.artifact.sha256])).slice(0, 30)}`) {
        return corrupt('blob reference does not belong to the scoped artifact');
      }
      const bytes = record.storage === 'image'
        ? await this.readImageBytes(scope, record.artifact)
        : await this.downloadBlob(record.fileId as string);
      if (bytes.byteLength !== record.artifact.byteLength || sha256hex(bytes) !== record.artifact.sha256) {
        return corrupt('stored artifact bytes failed integrity verification');
      }
      if (RASTER_FORMATS.has(record.artifact.mime) && !rasterSignatureOk(record.artifact.mime, bytes)) {
        return corrupt('stored artifact bytes failed signature verification');
      }
      return { artifact: cloneArtifact(record.artifact), content: bytes };
    } catch (error) {
      throw sanitized(error);
    }
  }
}
