import type { ArtifactTextOptions } from '@bezier/contracts';
import { basicNodeCopy } from '../locales/basic-node';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function textOptions(value: unknown): value is ArtifactTextOptions {
  if (!record(value)) return false;
  return (value.length === undefined || value.length === 'auto' || value.length === 'short' || value.length === 'medium' || value.length === 'long')
    && (value.templatePrompt === undefined || typeof value.templatePrompt === 'string')
    && (value.templateId === undefined || typeof value.templateId === 'string')
    && (value.templateTitle === undefined || typeof value.templateTitle === 'string');
}

/**
 * Let a host override the delivery instruction of an exact canonical text-node
 * prompt. Reconstruct the entire original template from its submission snapshot
 * before replacing its first generated paragraph. Never search/strip phrases in
 * user requests, current text, template guidance, or arbitrary custom prompts.
 * Missing, malformed, or mismatched snapshots leave the original prompt intact.
 */
export function overrideCanvasTextDeliveryInstruction(prompt: string, baseVersionSource: string | undefined, instruction: string): string {
  if (typeof baseVersionSource !== 'string') return prompt;
  try {
    const snapshot: unknown = JSON.parse(baseVersionSource);
    if (!record(snapshot) || typeof snapshot.text !== 'string' || typeof snapshot.prompt !== 'string' || !textOptions(snapshot.options)) return prompt;
    for (const locale of ['en', 'zh-CN'] as const) {
      const canonical = basicNodeCopy(locale).prompts.textGeneration(snapshot.prompt.trim(), snapshot.text, snapshot.options);
      if (prompt !== canonical) continue;
      const boundary = canonical.indexOf('\n\n');
      return boundary > 0 ? instruction + prompt.slice(boundary) : prompt;
    }
  } catch { /* An unparseable snapshot is not permission to rewrite a prompt. */ }
  return prompt;
}
