/**
 * External-browser capture contract for the DA Browser Extension bridge.
 *
 * Validated kinds: `selection` (JSON body) and `image` (length-prefixed
 * metadata JSON + raw image bytes). Other kinds stay reserved and reject with
 * `UNSUPPORTED_CAPTURE_KIND` so a half-built path never reaches storage.
 * Image bytes are never base64-wrapped in JSON — the picture stays a picture.
 *
 * See docs/plans/da-browser-extension-mvp.md §7 for the full target shape
 * and size limits this parser enforces.
 */

export type BrowserCaptureKind =
  | 'page'
  | 'selection'
  | 'image'
  | 'video'
  | 'audio'
  | 'link'
  | 'visible-screenshot'
  | 'full-page-screenshot';

export type BrowserCaptureIntent =
  | 'save_project'
  | 'save_personal_asset'
  | 'add_to_chat'
  | 'add_to_canvas'
  | 'explain'
  | 'transcribe_video';

export type BrowserCaptureMode =
  | 'original-resource'
  | 'visible-snapshot'
  | 'full-page-snapshot'
  | 'dom-extraction'
  | 'selection'
  | 'link';

export interface BrowserCaptureSource {
  pageUrl: string;
  title?: string;
  canonicalUrl?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  faviconUrl?: string;
}

export interface BrowserCaptureSelection {
  text: string;
  markdown?: string;
  html?: string;
}

export interface BrowserCapturePage {
  excerpt?: string;
  text?: string;
  markdown?: string;
  html?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface BrowserCaptureResource {
  url: string;
  mime?: string;
  alt?: string;
  width?: number;
  height?: number;
  posterUrl?: string;
}

export interface BrowserCapturePayload {
  filenameHint?: string;
  mime: string;
  /** Original image bytes. Attached by the binary transport, never JSON. */
  bytes: Uint8Array;
}

export interface BrowserCaptureProvenance {
  captureMode: BrowserCaptureMode;
  capturedAt: string;
  extensionVersion: string;
}

/**
 * Asset metadata collected by the extension's save dialog when
 * `intent === 'save_personal_asset'`. Mirrors the fields the in-app
 * `SaveAssetDialog` gathers so the extension reuses the same personal-asset
 * storage path instead of inventing a parallel one.
 *
 * Absent for `save_project`, which writes to PROJECT_LAYOUT.collected.
 */
export interface BrowserCaptureAsset {
  name: string;
  spaceId?: string;
  description?: string;
  style?: string;
  usage?: string;
  tags?: string[];
  /** Integer 0 (unrated) or 1–5. Same field as in-app SaveAssetDialog. */
  rating?: number;
  aiFill?: boolean;
}

export interface BrowserCaptureEnvelopeV1 {
  schema: 'bezier-design.browser-capture.v1';
  captureId: string;
  kind: BrowserCaptureKind;
  intent: BrowserCaptureIntent;
  source: BrowserCaptureSource;
  page?: BrowserCapturePage;
  selection?: BrowserCaptureSelection;
  resource?: BrowserCaptureResource;
  payload?: BrowserCapturePayload;
  asset?: BrowserCaptureAsset;
  provenance: BrowserCaptureProvenance;
}

export const BROWSER_CAPTURE_SCHEMA = 'bezier-design.browser-capture.v1' as const;

/** Byte/char limits from docs/plans/da-browser-extension-mvp.md §7.1. */
export const BROWSER_CAPTURE_LIMITS = {
  pageUrlChars: 8 * 1024,
  titleChars: 2 * 1024,
  selectionTextBytes: 256 * 1024,
  captureIdChars: 128,
  extensionVersionChars: 32,
  // Mirror the in-app SaveAssetDialog's own field limits so the extension
  // cannot submit metadata the dialog itself would have refused.
  assetNameChars: 240,
  assetTextChars: 4 * 1024,
  assetTagChars: 80,
  assetTagCount: 30,
  assetSpaceIdChars: 128,
  // Original-image bytes, counted on the raw picture, not a JSON wrapper.
  imagePayloadBytes: 25 * 1024 * 1024,
  imageMetadataBytes: 64 * 1024,
  imageFilenameChars: 240,
  imageMimeChars: 64,
  imageAltChars: 1024,
} as const;

export type BrowserCaptureErrorCode =
  | 'INVALID_ENVELOPE'
  | 'UNKNOWN_SCHEMA'
  | 'UNSUPPORTED_CAPTURE_KIND'
  | 'NO_SELECTION'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE_MIME';

/**
 * Original-image MIME types the extension may fetch and forward. SVG is
 * deliberately excluded for now — per the plan §9.5 it carries an executable
 * surface and is not stored as raw text until sanitisation lands. Magic-byte
 * verification on the DA side is the real gate; this list is the first filter.
 */
export const ALLOWED_IMAGE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
];

export class BrowserCaptureValidationError extends Error {
  readonly code: BrowserCaptureErrorCode;
  constructor(code: BrowserCaptureErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `TextEncoder` (not `Buffer`) so this module stays safe inside the web
// bundle that also imports `@bezier/contracts`, not just the Electron main
// process where the real parsing happens.
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function requireString(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', `字段 ${field} 缺失或不是字符串`);
  }
  if (value.length > maxChars) {
    throw new BrowserCaptureValidationError('PAYLOAD_TOO_LARGE', `字段 ${field} 超过 ${maxChars} 字符上限`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxChars: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field, maxChars);
}

/**
 * Like `optionalString`, but an empty string is a legitimate value rather than
 * a missing one: the asset dialog's free-text boxes (description/style/usage)
 * are simply blank when the user types nothing, and a blank box must not be
 * rejected as a malformed envelope. Normalised to `undefined` so downstream
 * code never has to tell "absent" from "present but empty".
 *
 * Deliberately not folded into `requireString` — fields like `pageUrl` must
 * keep rejecting the empty string.
 */
function optionalText(value: unknown, field: string, maxChars: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', `字段 ${field} 不是字符串`);
  }
  if (value.length > maxChars) {
    throw new BrowserCaptureValidationError('PAYLOAD_TOO_LARGE', `字段 ${field} 超过 ${maxChars} 字符上限`);
  }
  return value.length === 0 ? undefined : value;
}

const KNOWN_KINDS: readonly BrowserCaptureKind[] = [
  'page', 'selection', 'image', 'video', 'audio', 'link', 'visible-screenshot', 'full-page-screenshot',
];
const KNOWN_INTENTS: readonly BrowserCaptureIntent[] = [
  'save_project', 'save_personal_asset', 'add_to_chat', 'add_to_canvas', 'explain', 'transcribe_video',
];

/**
 * Parses capture metadata. For `kind: 'image'` this is the JSON prefix only —
 * the picture itself is the remaining body bytes, attached later as
 * `payload.bytes`. A JSON `payload` field is rejected so the picture cannot
 * be smuggled through as base64.
 */
export function parseBrowserCaptureEnvelope(raw: unknown): BrowserCaptureEnvelopeV1 {
  if (!isRecord(raw)) throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '请求体不是合法的 JSON 对象');
  if (raw.schema !== BROWSER_CAPTURE_SCHEMA) {
    throw new BrowserCaptureValidationError('UNKNOWN_SCHEMA', `不支持的 schema：${String(raw.schema)}`);
  }
  const captureId = requireString(raw.captureId, 'captureId', BROWSER_CAPTURE_LIMITS.captureIdChars);
  if (!/^[A-Za-z0-9_-]+$/.test(captureId)) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'captureId 含非法字符');
  }
  if (typeof raw.kind !== 'string' || !KNOWN_KINDS.includes(raw.kind as BrowserCaptureKind)) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', `未知的 kind：${String(raw.kind)}`);
  }
  const kind = raw.kind as BrowserCaptureKind;
  // `selection` and `image` are the two fully-validated kinds this round. All
  // other known kinds are still rejected outright so a half-built path can
  // never silently reach project storage.
  if (kind !== 'selection' && kind !== 'image') {
    throw new BrowserCaptureValidationError('UNSUPPORTED_CAPTURE_KIND', `本轮仅支持 selection / image 采集，尚未支持 ${kind}`);
  }
  if (typeof raw.intent !== 'string' || !KNOWN_INTENTS.includes(raw.intent as BrowserCaptureIntent)) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', `未知的 intent：${String(raw.intent)}`);
  }
  const intent = raw.intent as BrowserCaptureIntent;

  if (!isRecord(raw.source)) throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '缺少 source 字段');
  const pageUrl = requireString(raw.source.pageUrl, 'source.pageUrl', BROWSER_CAPTURE_LIMITS.pageUrlChars);
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'source.pageUrl 必须是 http(s) 链接');
  }
  const title = optionalString(raw.source.title, 'source.title', BROWSER_CAPTURE_LIMITS.titleChars);
  const source: BrowserCaptureSource = {
    pageUrl,
    ...(title !== undefined ? { title } : {}),
  };

  if (!isRecord(raw.provenance)) throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '缺少 provenance 字段');
  const capturedAt = requireString(raw.provenance.capturedAt, 'provenance.capturedAt', 64);
  const extensionVersion = requireString(
    raw.provenance.extensionVersion,
    'provenance.extensionVersion',
    BROWSER_CAPTURE_LIMITS.extensionVersionChars,
  );

  // --- selection branch ----------------------------------------------------
  let selection: BrowserCaptureSelection | undefined;
  if (kind === 'selection') {
    if (!isRecord(raw.selection)) throw new BrowserCaptureValidationError('NO_SELECTION', '缺少 selection 内容');
    const text = requireString(raw.selection.text, 'selection.text', Number.MAX_SAFE_INTEGER);
    if (utf8ByteLength(text) > BROWSER_CAPTURE_LIMITS.selectionTextBytes) {
      throw new BrowserCaptureValidationError('PAYLOAD_TOO_LARGE', '选区内容超过 256 KiB 上限');
    }
    selection = { text };
    if (raw.provenance.captureMode !== 'selection') {
      throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'selection 采集的 captureMode 必须是 selection');
    }
  }

  // --- image branch --------------------------------------------------------
  let resource: BrowserCaptureResource | undefined;
  if (kind === 'image') {
    if (!isRecord(raw.resource)) {
      throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'image 采集缺少 resource 字段');
    }
    const url = requireString(raw.resource.url, 'resource.url', BROWSER_CAPTURE_LIMITS.pageUrlChars);
    const mime = requireString(raw.resource.mime, 'resource.mime', BROWSER_CAPTURE_LIMITS.imageMimeChars).toLowerCase();
    if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
      throw new BrowserCaptureValidationError('UNSUPPORTED_IMAGE_MIME', `不支持的图片类型：${mime}（可改存可视截图）`);
    }
    if (!/^(https?:|data:|blob:)/i.test(url)) {
      throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'resource.url 必须是 http(s)/data/blob 链接');
    }
    const alt = optionalString(raw.resource.alt, 'resource.alt', BROWSER_CAPTURE_LIMITS.imageAltChars);
    resource = {
      url,
      mime,
      ...(alt !== undefined ? { alt } : {}),
    };
    if (raw.payload !== undefined) {
      throw new BrowserCaptureValidationError(
        'INVALID_ENVELOPE',
        '图片不要放进 JSON，请发送原图字节',
      );
    }
    if (raw.provenance.captureMode !== 'original-resource') {
      throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'image 采集的 captureMode 必须是 original-resource');
    }
  }

  // `save_personal_asset` carries the dialog's metadata; every other intent
  // (notably the original `save_project` path) must stay byte-identical to
  // before, so the block is only read when that intent asks for it.
  let asset: BrowserCaptureAsset | undefined;
  if (intent === 'save_personal_asset') {
    if (!isRecord(raw.asset)) {
      throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'save_personal_asset 缺少 asset 字段');
    }
    const name = requireString(raw.asset.name, 'asset.name', BROWSER_CAPTURE_LIMITS.assetNameChars);
    if (!name.trim()) throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'asset.name 不能为空');
    const spaceId = optionalString(raw.asset.spaceId, 'asset.spaceId', BROWSER_CAPTURE_LIMITS.assetSpaceIdChars);
    const description = optionalText(raw.asset.description, 'asset.description', BROWSER_CAPTURE_LIMITS.assetTextChars);
    const style = optionalText(raw.asset.style, 'asset.style', BROWSER_CAPTURE_LIMITS.assetTextChars);
    const usage = optionalText(raw.asset.usage, 'asset.usage', BROWSER_CAPTURE_LIMITS.assetTextChars);
    let tags: string[] | undefined;
    if (raw.asset.tags !== undefined) {
      if (!Array.isArray(raw.asset.tags) || raw.asset.tags.length > BROWSER_CAPTURE_LIMITS.assetTagCount) {
        throw new BrowserCaptureValidationError('INVALID_ENVELOPE', `asset.tags 最多 ${BROWSER_CAPTURE_LIMITS.assetTagCount} 个`);
      }
      tags = raw.asset.tags.map((tag, index) =>
        requireString(tag, `asset.tags[${index}]`, BROWSER_CAPTURE_LIMITS.assetTagChars),
      );
    }
    if (raw.asset.aiFill !== undefined && typeof raw.asset.aiFill !== 'boolean') {
      throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'asset.aiFill 必须是布尔值');
    }
    let rating: number | undefined;
    if (raw.asset.rating !== undefined) {
      if (typeof raw.asset.rating !== 'number' || !Number.isInteger(raw.asset.rating) || raw.asset.rating < 0 || raw.asset.rating > 5) {
        throw new BrowserCaptureValidationError('INVALID_ENVELOPE', 'asset.rating 必须是 0 到 5 的整数');
      }
      rating = raw.asset.rating;
    }
    asset = {
      name,
      ...(spaceId !== undefined ? { spaceId } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(style !== undefined ? { style } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(raw.asset.aiFill !== undefined ? { aiFill: raw.asset.aiFill as boolean } : {}),
    };
  }

  return {
    schema: BROWSER_CAPTURE_SCHEMA,
    captureId,
    kind,
    intent,
    source,
    ...(selection !== undefined ? { selection } : {}),
    ...(resource !== undefined ? { resource } : {}),
    ...(asset !== undefined ? { asset } : {}),
    provenance: {
      captureMode: kind === 'image' ? 'original-resource' : 'selection',
      capturedAt,
      extensionVersion,
    },
  };
}


export const BROWSER_CAPTURE_IMAGE_CONTENT_TYPE = 'application/vnd.bezierdesign.capture-image.v1';

function asBytes(input: Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** Identify an original image from its magic bytes. SVG is not in this list. */
export function sniffImageMime(input: Uint8Array): string | null {
  const u = asBytes(input);
  const at = (offset: number, sig: number[]) =>
    u.length >= offset + sig.length && sig.every((b, i) => u[offset + i] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  if (at(4, [0x66, 0x74, 0x79, 0x70]) && u.length >= 12) {
    const brand = String.fromCharCode(u[8] ?? 0, u[9] ?? 0, u[10] ?? 0, u[11] ?? 0);
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return 'image/avif';
  }
  return null;
}

export function assertImageBytes(input: Uint8Array, declaredMime?: string): string {
  const bytes = asBytes(input);
  if (bytes.byteLength === 0) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '图片内容为空');
  }
  if (bytes.byteLength > BROWSER_CAPTURE_LIMITS.imagePayloadBytes) {
    throw new BrowserCaptureValidationError('PAYLOAD_TOO_LARGE', `图片超过 ${BROWSER_CAPTURE_LIMITS.imagePayloadBytes} 字节上限`);
  }
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || !ALLOWED_IMAGE_MIMES.includes(sniffed)) {
    throw new BrowserCaptureValidationError('UNSUPPORTED_IMAGE_MIME', `无法识别的图片类型${declaredMime ? `（声明为 ${declaredMime}）` : ''}`);
  }
  if (declaredMime && declaredMime !== sniffed) {
    throw new BrowserCaptureValidationError('UNSUPPORTED_IMAGE_MIME', `图片类型与声明不一致：声明 ${declaredMime}，实际 ${sniffed}`);
  }
  return sniffed;
}

/** Wire body: 4-byte big-endian metadata length, UTF-8 JSON, then the picture. */
export function encodeBrowserCaptureImageBody(metadata: unknown, imageBytes: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  if (json.byteLength > BROWSER_CAPTURE_LIMITS.imageMetadataBytes) {
    throw new BrowserCaptureValidationError('PAYLOAD_TOO_LARGE', '图片元数据过大');
  }
  const out = new Uint8Array(4 + json.byteLength + imageBytes.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength);
  out.set(json, 4);
  out.set(imageBytes, 4 + json.byteLength);
  return out;
}

export function decodeBrowserCaptureImageBody(input: Uint8Array): { metadata: unknown; imageBytes: Uint8Array } {
  const body = asBytes(input);
  if (body.byteLength < 4) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '图片采集正文不完整');
  }
  const jsonLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
  if (jsonLength <= 0 || jsonLength > BROWSER_CAPTURE_LIMITS.imageMetadataBytes) {
    throw new BrowserCaptureValidationError('PAYLOAD_TOO_LARGE', '图片元数据过大');
  }
  if (4 + jsonLength > body.byteLength) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '图片采集正文不完整');
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + jsonLength)));
  } catch {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '图片元数据不是合法 JSON');
  }
  return { metadata, imageBytes: body.subarray(4 + jsonLength) };
}

export function attachImageBytes(envelope: BrowserCaptureEnvelopeV1, imageBytes: Uint8Array): BrowserCaptureEnvelopeV1 {
  if (envelope.kind !== 'image' || !envelope.resource) {
    throw new BrowserCaptureValidationError('INVALID_ENVELOPE', '只有 image 采集才能附带原图字节');
  }
  const mime = assertImageBytes(imageBytes, envelope.resource.mime);
  const filenameHint = envelope.asset?.name;
  return {
    ...envelope,
    resource: { ...envelope.resource, mime },
    payload: {
      mime,
      bytes: asBytes(imageBytes),
      ...(filenameHint ? { filenameHint } : {}),
    },
  };
}

/** A short-lived capability for the asset saved by this capture, not a general API proxy. */
export type BrowserAssetInspectorAction = 'read' | 'update' | 'analyze' | 'prompt';
export interface BrowserAssetInspectorRequest {
  schema: 'design-ai.browser-asset-inspector.v1';
  sessionId: string;
  action: BrowserAssetInspectorAction;
  patch?: import('./personal-assets.js').PersonalAssetPatch;
}
/** Internal desktop-to-renderer operation; assetId is resolved by the trusted host. */
export interface BrowserAssetInspectorOperation {
  assetId: string;
  action: BrowserAssetInspectorAction;
  patch?: import('./personal-assets.js').PersonalAssetPatch;
}
export interface BrowserAssetInspectorData {
  asset: import('./personal-assets.js').PersonalAsset;
  analysis?: import('./hooks.js').AssetAnalysisStatus;
  promptStatus?: import('./hooks.js').AssetAnalysisStatus;
}
