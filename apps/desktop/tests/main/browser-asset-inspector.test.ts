import {describe, expect, it, vi} from 'vitest';
import {createBrowserAssetInspectorSessions} from '../../src/main/browser-asset-inspector.js';
import {startBrowserCaptureBridge} from '../../src/main/browser-bridge.js';
const schema = 'design-ai.browser-asset-inspector.v1';

describe('browser asset inspector capabilities', () => {
  it('scopes every operation to the captured asset, expires sessions, and rejects destructive patches', () => {
    let now = 1;
    const sessions = createBrowserAssetInspectorSessions(() => now);
    const sessionId = sessions.create('saved-asset');
    expect(sessions.resolve({schema, sessionId, action: 'prompt', assetId: 'another-asset'})).toEqual({assetId: 'saved-asset', action: 'prompt'});
    expect(() => sessions.resolve({schema, sessionId, action: 'delete'})).toThrow();
    expect(() => sessions.resolve({schema, sessionId, action: 'update', patch: {revision: 1, deletedAt: 123}})).toThrow();
    expect(() => sessions.resolve({schema, sessionId, action: 'update', patch: {name: 'new'}})).toThrow();
    expect(sessions.resolve({schema, sessionId, action: 'update', patch: {revision: 1, name: 'new'}})).toMatchObject({assetId: 'saved-asset', patch: {revision: 1, name: 'new'}});
    now += 30 * 60_000;
    expect(() => sessions.resolve({schema, sessionId, action: 'read'})).toThrow(/已过期/);
  });

  it('uses the authenticated one-use bridge and returns the renderer result', async () => {
    const accept = vi.fn();
    const inspectAsset = vi.fn(async () => ({status: 'saved' as const, message: '已更新', assetData: {asset: {id: 'saved-asset', prompt: {text: 'actual prompt'}}}}));
    const bridge = await startBrowserCaptureBridge({accept, inspectAsset, context: {connected: true, canWrite: true, projectName: null}});
    const body = JSON.stringify({schema, sessionId: 'session', action: 'prompt'});
    try {
      const denied = await fetch(bridge.claim.uploadUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body});
      expect(denied.status).toBe(403);
      expect(inspectAsset).not.toHaveBeenCalled();
      const response = await fetch(bridge.claim.uploadUrl, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${bridge.claim.token}`}, body});
      expect(await response.json()).toMatchObject({ok: true, assetData: {asset: {prompt: {text: 'actual prompt'}}}});
      expect(inspectAsset).toHaveBeenCalledOnce();
      expect(accept).not.toHaveBeenCalled();
      await expect(fetch(bridge.claim.uploadUrl)).rejects.toThrow();
    } finally {bridge.close();}
  });
});
