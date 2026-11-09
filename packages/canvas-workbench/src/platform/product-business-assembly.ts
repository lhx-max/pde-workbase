import type { CanvasBusinessAgentInstructions } from '../workbench/business-agent-instructions';
import type { CanvasBusinessCaseOperations } from '../workbench/business-case-operations';

export async function loadCanvasBusinessAgentInstructions(): Promise<CanvasBusinessAgentInstructions | null> {
  return null;
}

export async function requireCanvasBusinessAgentInstructions(): Promise<CanvasBusinessAgentInstructions> {
  throw new Error('No business instruction module is installed');
}

export async function loadCanvasBusinessCaseOperations(): Promise<CanvasBusinessCaseOperations | null> {
  return null;
}
