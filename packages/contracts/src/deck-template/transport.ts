import { z } from 'zod';
import { DeckPathSchema, type DeckTemplate } from './schemas.js';

/** Byte/node budgets shared by package readers, composition and the deck-only HTTP parser. */
export const DECK_RESOURCE_LIMITS = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  packageBytes: 24 * 1024 * 1024,
  renderedBytes: 40 * 1024 * 1024,
  httpBytes: 48 * 1024 * 1024,
  domNodes: 20_000,
});

export function deckTemplatePackagePaths(template: DeckTemplate): string[] {
  return ['deck.manifest.json', ...Object.values(template.entries), ...template.layouts.map(layout => layout.fragment), ...template.assets.map(asset => asset.path)];
}

/** Portable package upload; the daemon never accepts an arbitrary server filesystem path. */
export const DeckConsumeRequestSchema = z.object({
  operation: z.enum(['validate', 'render', 'verify']),
  files: z.array(z.object({ path: DeckPathSchema, encoding: z.enum(['utf8','base64']), content: z.string().max(12_000_000) }).strict()).min(4).max(400),
  instance: z.unknown().optional(),
}).strict();
export type DeckConsumeRequest = z.infer<typeof DeckConsumeRequestSchema>;
export interface DeckVerificationIssue { code: string; slideId?: string; binding?: string; message: string }
export interface DeckBrowserVerification {
  passed: boolean;
  slides: number;
  issues: DeckVerificationIssue[];
  checks: string[];
}
export interface DeckConsumeResponse {
  ok: true;
  template: { id: string; version: string };
  schemaVersion: 1;
  structureValid: true;
  sourceReview: 'pending' | 'verified';
  warnings: string[];
  html?: string;
  browser?: DeckBrowserVerification;
}
