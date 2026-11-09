import type { ByokChatProviderConfig } from './chat.js';

/** Explicit execution choice for one request. API credentials are ephemeral:
 * never serialize this object into jobs, workflow definitions, logs or config.
 * Headless callers must provide their own snapshot; browser state is not a daemon default. */
export type ExecutionSnapshot =
  | { mode: 'cli'; agentId: string; model?: string; reasoning?: string; serviceTier?: string }
  | { mode: 'api'; model: string; byokProvider: ByokChatProviderConfig };
