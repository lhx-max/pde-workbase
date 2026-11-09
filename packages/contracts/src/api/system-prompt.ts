/** Editable core charter; runtime-specific output contracts remain composed separately. */
export interface SystemPromptOverride {
  variant: 'slim' | 'classic';
  text: string;
}
export interface SystemPromptSettings extends SystemPromptOverride {
  defaultText: string;
  customized: boolean;
}
export const SYSTEM_PROMPT_MAX_LENGTH = 60000;
export function isSystemPromptOverride(value: unknown): value is SystemPromptOverride {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SystemPromptOverride>;
  if ((v.variant !== 'slim' && v.variant !== 'classic') || typeof v.text !== 'string'
    || !v.text.trim() || v.text.length > SYSTEM_PROMPT_MAX_LENGTH) return false;
  const tokens = v.variant === 'slim'
    ? ['%%BEZIER_SLIM_EXECUTION_CONTEXT%%', '%%BEZIER_SLIM_HANDOFF%%']
    : ['%%BEZIER_EXECUTION_CONTEXT%%', '%%BEZIER_WORKFLOW_HANDOFF%%'];
  return tokens.every((token) => v.text!.split(token).length === 2);
}
