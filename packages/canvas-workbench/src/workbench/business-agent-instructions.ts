/** Product instructions only; canvas execution, state and rendering remain shared. */
export interface CanvasBusinessAgentInstructions {
  intake(input: { title: string; path?: string; attachmentInstruction: string; hasAttachments: boolean }): string;
  visualPlan(input: { directoryPath: string; requestId: string; instanceId: string; apiOrigin: string }): string;
  visualEvaluation(input: {
    directoryPath?: string;
    outputs: readonly { path: string; model?: string; slotId?: string }[];
    model: string;
    styleLabel: string;
  }): string | null;
}
