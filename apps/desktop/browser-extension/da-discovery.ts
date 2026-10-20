/** Loopback discovery — the extension finds DA in whatever browser it is installed in. */

import { BROWSER_BRIDGE_DISCOVERY_PORTS as DA_DISCOVERY_PORTS, BROWSER_EXTENSION_ID } from '../src/main/browser-extension-identity.js';
export { DA_DISCOVERY_PORTS };

export type DaDiscoveryStatus = {
  connected: boolean;
  projectName: string | null;
  canWrite: boolean;
  spaces?: Array<{ id: string; name: string }>;
  defaultSpaceId?: string;
  tags?: string[];
  locale?: string;
};

export async function discoverDaBridge(fetchImpl: typeof fetch = fetch, timeoutMs = 400): Promise<{ port: number; status: DaDiscoveryStatus } | null> {
  for (const port of DA_DISCOVERY_PORTS) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/v1/status`, { headers: { 'x-canvas-extension-id': BROWSER_EXTENSION_ID }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) continue;
      const body = await response.json() as { status?: DaDiscoveryStatus };
      if (body?.status && typeof body.status.canWrite === 'boolean') return { port, status: body.status };
    } catch { /* next port */ }
  }
  return null;
}

export async function claimDaBridge(port: number, payload: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(`http://127.0.0.1:${port}/v1/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-canvas-extension-id': BROWSER_EXTENSION_ID },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4500),
  });
  return response.json();
}
