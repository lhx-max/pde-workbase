import { describe, expect, it } from 'vitest';
import { EXTENSION_HEARTBEAT_MS, isExtensionHeartbeatLive } from '../../src/main/browser-extension-heartbeat.js';

describe('extension heartbeat', () => {
  it('is live only while a probe arrived inside the window', () => {
    expect(isExtensionHeartbeatLive(null, 1000)).toBe(false);
    expect(isExtensionHeartbeatLive(1000, 1000 + EXTENSION_HEARTBEAT_MS)).toBe(true);
    expect(isExtensionHeartbeatLive(1000, 1000 + EXTENSION_HEARTBEAT_MS + 1)).toBe(false);
  });
});
