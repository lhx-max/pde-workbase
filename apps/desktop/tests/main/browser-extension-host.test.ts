import { describe, expect, it, vi } from 'vitest';
import type { BrowserCaptureEnvelopeV1 } from '@bezier/contracts';
import { createBrowserExtensionHost } from '../../src/main/browser-extension-host.js';
import type { startBrowserCaptureBridge, startBrowserDiscovery } from '../../src/main/browser-bridge.js';

function fixture() {
  let discoveryOptions!: Parameters<typeof startBrowserDiscovery>[0];
  let receiverOptions!: Parameters<typeof startBrowserCaptureBridge>[0];
  const closeDiscovery = vi.fn(), closeReceiver = vi.fn();
  const consent = vi.fn(async () => true), send = vi.fn(), origin = vi.fn(), alive = vi.fn(() => true), install = vi.fn(async () => ({ ok: true as const, message: 'Exported, not installed.' }));
  const startDiscovery = vi.fn(async (options: Parameters<typeof startBrowserDiscovery>[0]) => { discoveryOptions = options; return { close: closeDiscovery, port: 18373 }; });
  const startReceiver = vi.fn(async (options: Parameters<typeof startBrowserCaptureBridge>[0]) => { receiverOptions = options; return { close: closeReceiver, claim: { protocolVersion: 1 as const, uploadUrl: 'http://127.0.0.1:23456/v1/captures', token: 'a'.repeat(64), expiresAt: Date.now() + 300000, context: options.context } }; });
  const host = createBrowserExtensionHost({ alive, send, receiverOrigin: origin, confirmEnable: consent, install, startDiscovery, startReceiver });
  host.context({ projectId: 'p', canWrite: true });
  return { host, alive, consent, send, origin, install, startDiscovery, startReceiver, closeDiscovery, closeReceiver,
    discovery: () => discoveryOptions, receiver: () => receiverOptions };
}
const capture = { schema: 'bezier-design.browser-capture.v1', captureId: 'capture-1', kind: 'selection', intent: 'save_personal_asset', source: { pageUrl: 'https://example.test/' }, selection: { text: 'selected by user' }, asset: { name: 'Selection' }, provenance: { capturedAt: new Date().toISOString(), captureMode: 'selection', extensionVersion: '0.3.0' } } as BrowserCaptureEnvelopeV1;
describe('external capture owner lifecycle', () => {
  it('does nothing without explicit native consent, and does not claim installed on export', async () => {
    const f = fixture(); f.consent.mockResolvedValue(false);
    expect((await f.host.install()).ok).toBe(false); expect(f.install).not.toHaveBeenCalled(); expect(f.startDiscovery).not.toHaveBeenCalled();
    f.consent.mockResolvedValue(true); expect(await f.host.install()).toEqual({ ok: true, message: 'Exported, not installed.' });
    expect(f.host.status().connected).toBe(false); f.discovery().onExtensionSeen?.(); expect(f.host.status().connected).toBe(true); f.host.stop();
  });
  it('uses one replaceable receiver, preserves captures and grants only saved asset inspector scope', async () => {
    const f = fixture(); await f.host.start();
    await f.discovery().mintClaim(); await f.discovery().mintClaim(); expect(f.closeReceiver).toHaveBeenCalledOnce();
    const saved = f.receiver().accept(capture); expect(f.send).toHaveBeenLastCalledWith('browser:capture-received', expect.objectContaining({ captureId: 'capture-1' }));
    expect(await f.discovery().mintClaim()).toBeNull();
    f.host.complete({ captureId: 'unknown', ok: true, message: 'ignored' });
    f.host.complete({ captureId: 'capture-1', ok: true, message: 'saved', assetData: { asset: { id: 'asset-1' } } });
    const result = await saved; expect(result.status).toBe('saved');
    if (result.status !== 'saved') throw new Error('Not saved');
    expect(result.sessionId).toMatch(/^[a-f0-9]{64}$/); expect(f.host.records()).toHaveLength(1);
    const inspected = f.receiver().inspectAsset!({ schema: 'design-ai.browser-asset-inspector.v1', sessionId: result.sessionId, action: 'read', assetId: 'another' });
    const event = f.send.mock.calls.at(-1)![1] as { captureId: string; assetOperation: unknown };
    expect(event.assetOperation).toEqual({ action: 'read', assetId: 'asset-1' });
    f.host.complete({ captureId: event.captureId, ok: true, message: 'read' }); await inspected; f.host.stop();
  });
  it('revokes pending captures, stale callbacks and inspector tokens on stop', async () => {
    const f = fixture(); await f.host.start(); await f.discovery().mintClaim();
    const accept = f.receiver().accept; const pending = accept(capture); f.host.stop();
    expect((await pending).status).toBe('rejected'); expect(f.closeReceiver).toHaveBeenCalledOnce(); expect(f.closeDiscovery).toHaveBeenCalledOnce();
    expect((await accept(capture)).status).toBe('rejected'); expect(await f.discovery().mintClaim()).toBeNull(); expect(f.origin).toHaveBeenLastCalledWith(null);
    f.host.complete({ captureId: 'capture-1', ok: true, message: 'too late' }); expect(f.host.records()).toEqual([]);
  });
  it('rejects unsupported intents and suspends receiver when current library becomes unavailable', async () => {
    const f = fixture(); await f.host.start(); await f.discovery().mintClaim();
    expect((await f.receiver().accept({ ...capture, intent: 'save_project' })).status).toBe('rejected');
    f.host.context({ projectId: 'p', canWrite: false }); expect(await f.discovery().mintClaim()).toBeNull(); f.host.stop();
  });
});
