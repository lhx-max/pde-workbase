import { describe, expect, it } from 'vitest';
import {
  BROWSER_CAPTURE_IMAGE_CONTENT_TYPE,
  BrowserCaptureValidationError,
  decodeBrowserCaptureImageBody,
  encodeBrowserCaptureImageBody,
  parseBrowserCaptureEnvelope,
  sniffImageMime,
} from '../src/api/browser-capture.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const imageMeta = {
  schema: 'bezier-design.browser-capture.v1',
  captureId: 'cap_img_test',
  kind: 'image',
  intent: 'save_personal_asset',
  source: { pageUrl: 'https://example.test/gallery', title: 'Gallery' },
  resource: { url: 'https://example.test/pic.png', mime: 'image/png', alt: 'hero' },
  asset: { name: 'hero.png' },
  provenance: {
    captureMode: 'original-resource',
    capturedAt: '2026-09-20T00:00:00.000Z',
    extensionVersion: '0.2.0',
  },
};

describe('browser capture image bytes', () => {
  it('sniffs png and jpeg from magic bytes, not from a json wrapper', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array([0, 1, 2, 3]))).toBeNull();
  });

  it('packs metadata then raw image bytes so the body after the prefix is the picture', () => {
    const body = encodeBrowserCaptureImageBody(imageMeta, PNG);
    const decoded = decodeBrowserCaptureImageBody(body);
    expect(BROWSER_CAPTURE_IMAGE_CONTENT_TYPE).toContain('capture-image');
    expect(decoded.imageBytes).toEqual(PNG);
    expect(decoded.metadata).toMatchObject({ kind: 'image', resource: { mime: 'image/png' } });
    expect(JSON.stringify(decoded.metadata)).not.toContain('\u0089PNG');
  });

  it('accepts the in-app 0–5 star rating on save_personal_asset', () => {
    const parsed = parseBrowserCaptureEnvelope({ ...imageMeta, asset: { name: 'hero.png', rating: 5 } });
    expect(parsed.asset?.rating).toBe(5);
    expect(() => parseBrowserCaptureEnvelope({ ...imageMeta, asset: { name: 'hero.png', rating: 9 } })).toThrow(BrowserCaptureValidationError);
  });

  it('parses image metadata without a base64 payload field', () => {
    const parsed = parseBrowserCaptureEnvelope(imageMeta);
    expect(parsed.kind).toBe('image');
    expect(parsed.payload).toBeUndefined();
    expect(parsed.resource).toMatchObject({ url: 'https://example.test/pic.png', mime: 'image/png' });
  });

  it('rejects stuffing the picture into json as base64', () => {
    expect(() => parseBrowserCaptureEnvelope({
      ...imageMeta,
      payload: { mime: 'image/png', encoding: 'base64', data: 'AAAA' },
    })).toThrow(BrowserCaptureValidationError);
  });
});
