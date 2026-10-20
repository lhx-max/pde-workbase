import type { Request, Response } from 'express';
import type { ExecutionSnapshot } from '@bezier/contracts';
export type AuthorizeProjectRequest = (req: Request, res: Response, projectId: string, options: { mode: 'read' | 'write'; capability?: 'writeFiles' }) => boolean | Promise<boolean>;
/** Host-selected execution and model discovery; no daemon CLI or global app configuration. */
export interface WorkflowAssistantPort {
  complete(input: { prompt: string; agentId?: string; model?: string; execution?: ExecutionSnapshot; timeoutMs?: number }): Promise<{ text: string; agentId: string }>;
  options?(agentId?: string): Promise<{ agent: { id: string; name: string; available: boolean }; model: string }>;
}
