import { captureMessages } from '../locales/browser-capture-messages.js';
import { randomBytes } from 'node:crypto';
import type { BrowserAssetInspectorOperation } from '@bezier/contracts';

/** Only assets created through this desktop capture session are addressable. */
export function createBrowserAssetInspectorSessions(now = Date.now) {
  const sessions = new Map<string, {assetId: string; expires: number}>();
  function prune() { for (const [id, entry] of sessions) if (entry.expires <= now()) sessions.delete(id); }
  return {
    create(assetId: string) {
      prune();
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, {assetId, expires: now() + 30 * 60_000});
      return id;
    },
    resolve(raw: unknown): BrowserAssetInspectorOperation {
      prune();
      if (!raw || typeof raw !== 'object') throw new Error(captureMessages().invalid);
      const value = raw as Record<string, unknown>;
      const session = typeof value.sessionId === 'string' ? sessions.get(value.sessionId) : undefined;
      if (value.schema !== 'design-ai.browser-asset-inspector.v1' || !session) throw new Error(captureMessages().expired);
      if (!['read','update','analyze','prompt'].includes(String(value.action))) throw new Error(captureMessages().unsupported);
      if (value.action === 'update') {
        if (!value.patch || typeof value.patch !== 'object' || Array.isArray(value.patch)) throw new Error(captureMessages().badPatch);
        const patch = value.patch as Record<string, unknown>;
        if (Object.keys(patch).some(key => !['name','description','style','usage','tags','rating','spaceId','revision'].includes(key)) || !Number.isInteger(patch.revision)) throw new Error(captureMessages().badFields);
      }
      return {assetId: session.assetId, action: value.action as BrowserAssetInspectorOperation['action'], ...(value.action === 'update' ? {patch: value.patch as BrowserAssetInspectorOperation['patch']} : {})};
    },
    clear() {sessions.clear();},
  };
}
