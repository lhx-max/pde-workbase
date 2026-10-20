import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BROWSER_EXTENSION_ID, BROWSER_BRIDGE_DISCOVERY_PORTS } from '../../src/main/browser-extension-identity.js';
import { PINTEREST_CONNECTOR_ID, PINTEREST_NATIVE_HOST } from '../../src/main/pinterest-native-relay.js';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const derivedId = (manifest: { key: string }) => [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

describe('independent extension identities and build boundaries', () => {
  it('matches the bundled capture identity and never discovers the original application', () => {
    expect(derivedId(JSON.parse(source('../../browser-extension/manifest.json')))).toBe(BROWSER_EXTENSION_ID);
    expect(BROWSER_BRIDGE_DISCOVERY_PORTS).toEqual([18373,18374,18375,18376,18377,18378,18379,18380,18381,18382]);
    expect(source('../../browser-extension/da-discovery.ts')).toContain('browser-extension-identity.js');
    expect(source('../../browser-extension/background.ts')).toContain('com.canvas_workspace.browser_bridge');
    expect(source('../../browser-extension/background.ts')).not.toContain('com.designai.browser_bridge');
  });
  it('keeps Pinterest native framing on the independent connector allowlist', () => {
    expect(derivedId(JSON.parse(source('../../experiments/pinterest-auth/manifest.json')))).toBe(PINTEREST_CONNECTOR_ID);
    expect(source('../../src/main/pinterest-native-host.cts')).toContain(`chrome-extension://${PINTEREST_CONNECTOR_ID}/`);
    expect(PINTEREST_NATIVE_HOST).toBe('com.canvas_workspace.pinterest_auth');
    expect(source('../../experiments/pinterest-auth/background.ts')).toContain(PINTEREST_NATIVE_HOST);
  });
  it('packages source under dist and does not execute a user profile installer', () => {
    const builder = source('../../browser-extension/build.ts');
    expect(builder).toContain("resolve(here, '../dist')");
    expect(builder).not.toMatch(/NativeMessagingHosts|appData|Library\/Application Support|shell\.open/);
    expect(builder).toContain('browser-extension.zip'); expect(builder).toContain('pinterest-auth-extension');
  });
});
