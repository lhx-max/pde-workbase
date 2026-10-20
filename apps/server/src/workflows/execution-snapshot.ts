import type { ByokChatProtocol, ExecutionSnapshot } from '@bezier/contracts';
import { createHash } from 'node:crypto';
import { buildOpenCodeByokProviderConfig, BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE } from './provider-config.js';

/** Fetch does not support URL userinfo; fragments never reach the provider.
 * Queries remain executable but the durable identity only stores their fingerprint. */
function isSafeExecutionBaseUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username && !url.password && !url.href.includes('#');
  } catch { return false; }
}

/** Validate at ingress, before accepting work or reading daemon CLI defaults. */
export function parseExecutionSnapshot(value: unknown): ExecutionSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid execution snapshot');
  const input = value as Record<string, unknown>;
  if (input.mode === 'api') {
    const provider = input.byokProvider as Extract<ExecutionSnapshot, { mode: 'api' }>['byokProvider'];
    if (typeof provider?.baseUrl === 'string' && !isSafeExecutionBaseUrl(provider.baseUrl)) {
      throw new Error('Provider baseUrl must be an HTTP(S) endpoint without userinfo or fragment; use dedicated apiKey and apiVersion fields');
    }
    if (typeof input.model !== 'string' || !buildOpenCodeByokProviderConfig(provider, input.model)) throw new Error(BYOK_OPENCODE_PROVIDER_REQUIRED_MESSAGE);
    return { mode: 'api', model: input.model.trim(), byokProvider: {
      protocol: provider.protocol, apiKey: provider.apiKey ?? '',
      ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
      ...(provider.apiVersion !== undefined ? { apiVersion: provider.apiVersion } : {}),
      ...(provider.requiresApiKey !== undefined ? { requiresApiKey: provider.requiresApiKey } : {}),
    } };
  }
  if (input.mode !== 'cli' || typeof input.agentId !== 'string' || !input.agentId.trim() || input.agentId === 'byok-opencode') throw new Error('Invalid CLI execution snapshot; BYOK requires API provider configuration');
  for (const key of ['model', 'reasoning', 'serviceTier']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error('Invalid execution snapshot option');
  }
  return { mode: 'cli', agentId: input.agentId.trim(), ...(input.model ? { model: input.model as string } : {}), ...(input.reasoning ? { reasoning: input.reasoning as string } : {}), ...(input.serviceTier ? { serviceTier: input.serviceTier as string } : {}) };
}

/** Internal persistence DTO, deliberately NOT an executable API snapshot. */
export type ExecutionIdentity = Extract<ExecutionSnapshot, { mode: 'cli' }> | {
  mode: 'api'; model: string; protocol: ByokChatProtocol;
  endpointFingerprint: string; apiVersion?: string; requiresApiKey?: boolean;
};

/** Hash the full normalized endpoint (including query routing/credentials), not
 * just its origin. No plaintext origin, path, query or API key enters storage. */
export function executionSnapshotIdentity(snapshot: ExecutionSnapshot): ExecutionIdentity {
  const validated = parseExecutionSnapshot(snapshot)!;
  if (validated.mode === 'cli') return validated;
  const built = buildOpenCodeByokProviderConfig(validated.byokProvider, validated.model)!;
  const providers = built.config.provider as Record<string, { options: { baseURL: string } }>;
  const endpoint = new URL(providers[built.providerId]!.options.baseURL).toString();
  return { mode: 'api', model: validated.model, protocol: validated.byokProvider.protocol,
    endpointFingerprint: createHash('sha256').update(endpoint).digest('hex'),
    ...(validated.byokProvider.apiVersion !== undefined ? { apiVersion: validated.byokProvider.apiVersion } : {}),
    ...(validated.byokProvider.requiresApiKey !== undefined ? { requiresApiKey: validated.byokProvider.requiresApiKey } : {}),
  };
}

/** Compare old safe snapshot identities without ever executing their URL or
 * treating the fingerprint as a URL. A matching recovery rewrites the old row. */
export function matchesExecutionIdentity(previous: unknown, snapshot: ExecutionSnapshot): boolean {
  const expected = executionSnapshotIdentity(snapshot);
  if (JSON.stringify(previous) === JSON.stringify(expected)) return true;
  if (snapshot.mode !== 'api' || !previous || typeof previous !== 'object') return false;
  const old = previous as Record<string, unknown>;
  if (old.mode !== 'api' || typeof old.byokProvider !== 'object' || !old.byokProvider || Array.isArray(old.byokProvider)) return false;
  try {
    const legacy = parseExecutionSnapshot({ ...old, byokProvider: { ...old.byokProvider, apiKey: snapshot.byokProvider.apiKey } });
    return Boolean(legacy && JSON.stringify(executionSnapshotIdentity(legacy)) === JSON.stringify(expected));
  } catch { return false; }
}
