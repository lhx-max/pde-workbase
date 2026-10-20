import { BROWSER_EXTENSION_ID } from '../../src/main/browser-extension-identity.js';
import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_CAPTURE_IMAGE_CONTENT_TYPE,
  encodeBrowserCaptureImageBody,
  type BrowserCaptureEnvelopeV1,
} from '@bezier/contracts';
import { startBrowserCaptureBridge, startBrowserDiscovery } from '../../src/main/browser-bridge.js';

const selectionEnvelope = {
  schema: 'bezier-design.browser-capture.v1',
  captureId: 'cap_synthetic_test_only',
  kind: 'selection',
  intent: 'save_project',
  source: { pageUrl: 'https://example.test/article', title: 'Example' },
  selection: { text: 'synthetic selection content' },
  provenance: { captureMode: 'selection', capturedAt: '2026-09-15T00:00:00.000Z', extensionVersion: '0.1.0' },
};

describe('DA browser capture bridge', () => {
  it('updates connection presence for extension probes without an Origin header', async () => {
    const onExtensionSeen = vi.fn();
    const mintClaim = vi.fn(async () => 'synthetic-pairing-code');
    const discovery = await startBrowserDiscovery({
      readStatus: () => ({ connected: true, projectName: null, canWrite: true }),
      mintClaim,
      onExtensionSeen,
    });
    const statusUrl = `http://127.0.0.1:${discovery.port}/v1/status`;
    try {
      const response = await fetch(statusUrl, { headers: { 'x-canvas-extension-id': BROWSER_EXTENSION_ID } });
      expect(await response.json()).toMatchObject({ status: { connected: true } });
      expect(onExtensionSeen).toHaveBeenCalledTimes(1);
      expect(mintClaim).not.toHaveBeenCalled();

      const claim = await fetch(`http://127.0.0.1:${discovery.port}/v1/claim`, { method: 'POST', headers: { 'x-canvas-extension-id': BROWSER_EXTENSION_ID } });
      expect(await claim.json()).toEqual({ code: 'synthetic-pairing-code' });
      expect(onExtensionSeen).toHaveBeenCalledTimes(2);

      const denied = await fetch(statusUrl, { headers: { Origin: 'https://attacker.test' } });
      expect(denied.status).toBe(403);
      expect((await fetch(statusUrl, { method: 'OPTIONS', headers: { Origin: `chrome-extension://${BROWSER_EXTENSION_ID}` } })).status).toBe(204);
      expect((await fetch(`http://127.0.0.1:${discovery.port}/unknown`, { headers: { 'x-canvas-extension-id': BROWSER_EXTENSION_ID } })).status).toBe(404);
      expect(onExtensionSeen).toHaveBeenCalledTimes(2);
    } finally { discovery.close(); }
  });

  it('rejects incorrect tokens and webpage origins without consuming the valid attempt', async () => {
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => ({ status: 'saved' as const, message: 'saved' }));
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: '品牌提案', canWrite: true } });
    const { uploadUrl, token } = bridge.claim;
    try {
      expect((await fetch(uploadUrl, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status).toBe(403);
      expect((await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.test' } })).status).toBe(403);
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: `chrome-extension://${BROWSER_EXTENSION_ID}` },
        body: JSON.stringify(selectionEnvelope),
      });
      expect(response.status).toBe(200);
      expect(accept).toHaveBeenCalledTimes(1);
      expect(accept.mock.calls[0]![0]).toMatchObject({ kind: 'selection', selection: { text: 'synthetic selection content' } });
      // Token is single-use: a second POST against the same claim must fail, not re-accept.
      await expect(fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })).rejects.toThrow();
    } finally { bridge.close(); }
  });


  it('accepts an original image as raw bytes, not a json wrapper', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => {
      return { status: 'saved' as const, message: '已保存图片' };
    });
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: null, canWrite: true } });
    const { uploadUrl, token } = bridge.claim;
    try {
      const metadata = {
        schema: 'bezier-design.browser-capture.v1',
        captureId: 'cap_img_bridge',
        kind: 'image',
        intent: 'save_personal_asset',
        source: { pageUrl: 'https://example.test/gallery' },
        resource: { url: 'https://example.test/pic.png', mime: 'image/png' },
        asset: { name: 'pic.png' },
        provenance: { captureMode: 'original-resource', capturedAt: '2026-09-20T00:00:00.000Z', extensionVersion: '0.2.0' },
      };
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': BROWSER_CAPTURE_IMAGE_CONTENT_TYPE },
        body: new Uint8Array(encodeBrowserCaptureImageBody(metadata, png)).buffer,
      });
      expect(response.status).toBe(200);
      expect(accept).toHaveBeenCalledTimes(1);
      const envelope = accept.mock.calls[0]![0];
      expect(envelope.kind).toBe('image');
      expect(envelope.payload).not.toHaveProperty('encoding');
      expect(new Uint8Array(envelope.payload?.bytes ?? [])).toEqual(png);
    } finally { bridge.close(); }
  });

  it('rejects wrapping the picture in application/json', async () => {
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => ({ status: 'saved' as const, message: 'saved' }));
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: null, canWrite: true } });
    const { uploadUrl, token } = bridge.claim;
    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selectionEnvelope,
          kind: 'image',
          resource: { url: 'https://example.test/pic.png', mime: 'image/png' },
          provenance: { captureMode: 'original-resource', capturedAt: '2026-09-20T00:00:00.000Z', extensionVersion: '0.2.0' },
        }),
      });
      expect(response.status).toBe(400);
      expect(accept).not.toHaveBeenCalled();
    } finally { bridge.close(); }
  });

  it('rejects a payload declaring an unsupported capture kind instead of half-trusting it', async () => {
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => ({ status: 'saved' as const, message: 'saved' }));
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: null, canWrite: true } });
    const { uploadUrl, token } = bridge.claim;
    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selectionEnvelope, kind: 'page' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { code: string };
      expect(body.code).toBe('UNSUPPORTED_CAPTURE_KIND');
      expect(accept).not.toHaveBeenCalled();
    } finally { bridge.close(); }
  });

  it('rejects a payload over the transport size ceiling before parsing it', async () => {
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => ({ status: 'saved' as const, message: 'saved' }));
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: null, canWrite: true } });
    const { uploadUrl, token } = bridge.claim;
    try {
      const oversized = { ...selectionEnvelope, selection: { text: 'x'.repeat(2 * 1024 * 1024) } };
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(oversized),
      });
      expect(response.status).toBe(413);
      expect(accept).not.toHaveBeenCalled();
    } finally { bridge.close(); }
  });

  it('expires an unused receiver and never calls the accept callback', async () => {
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => ({ status: 'saved' as const, message: 'saved' }));
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: null, canWrite: true }, ttlMs: 1 });
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(fetch(bridge.claim.uploadUrl)).rejects.toThrow();
    expect(accept).not.toHaveBeenCalled();
    bridge.close();
  });

  it('reports a renderer timeout as 202 pending, never as a false "saved"', async () => {
    const accept = vi.fn(async (_envelope: BrowserCaptureEnvelopeV1) => ({ status: 'pending' as const, message: '已送达 DA，正在等待写入结果' }));
    const bridge = await startBrowserCaptureBridge({ accept, context: { connected: true, projectName: null, canWrite: true } });
    const { uploadUrl, token } = bridge.claim;
    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(selectionEnvelope),
      });
      expect(response.status).toBe(202);
      const body = await response.json() as { ok: boolean; status: string };
      expect(body.ok).toBe(false);
      expect(body.status).toBe('pending');
    } finally { bridge.close(); }
  });

  it('allows only the independent extension identity, rejecting foreign extensions and web pages', async () => {
    const discovery = await startBrowserDiscovery({
      readStatus: () => ({ connected: true, projectName: '品牌提案', canWrite: true, spaces: [], tags: [] }),
      mintClaim: async () => JSON.stringify({ protocolVersion: 1, uploadUrl: 'http://127.0.0.1:9/v1/captures', token: 'a'.repeat(64), expiresAt: Date.now() + 1000, context: { connected: true, canWrite: true, projectName: '品牌提案' } }),
    });
    try {
      const foreign = await fetch(`http://127.0.0.1:${discovery.port}/v1/status`, { headers: { Origin: `chrome-extension://${'b'.repeat(32)}`, 'x-canvas-extension-id': BROWSER_EXTENSION_ID } });
      expect(foreign.status).toBe(403);
      const origin = `chrome-extension://${BROWSER_EXTENSION_ID}`;
      const ok = await fetch(`http://127.0.0.1:${discovery.port}/v1/status`, { headers: { Origin: origin, 'x-canvas-extension-id': BROWSER_EXTENSION_ID } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ status: { projectName: '品牌提案', canWrite: true } });
      const denied = await fetch(`http://127.0.0.1:${discovery.port}/v1/status`, { headers: { Origin: 'https://attacker.test' } });
      expect(denied.status).toBe(403);
      const claimed = await fetch(`http://127.0.0.1:${discovery.port}/v1/claim`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-canvas-extension-id': BROWSER_EXTENSION_ID }, body: '{}' });
      expect(claimed.status).toBe(200);
      expect(typeof (await claimed.json() as { code: string }).code).toBe('string');
    } finally { discovery.close(); }
  });
});
