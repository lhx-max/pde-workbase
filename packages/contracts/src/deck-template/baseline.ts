import type { DeckTemplate } from './schemas.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Baseline payload must be JSON');
  return serialized;
}

/** SHA256 this UTF8 string. Only the self digest and declared review status are excluded.
 * All normalized files (including passive reference and default content) are byte-hashed;
 * original source evidence can remain private outside the package. Object keys sort by JS
 * UTF16 order, array order is preserved, no whitespace, newline prefix is part of the hash.
 */
export function deckTemplateBaselinePayload(template: DeckTemplate, files: readonly { path: string; sha256: string }[]): string {
  const { provenance, ...rest } = template;
  const { normalizedDigest: _digest, review: _review, ...source } = provenance;
  const digests = files.filter(file => file.path !== 'deck.manifest.json').map(file => ({ path: file.path, sha256: file.sha256.toLowerCase() })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return `bd-deck-baseline-v1\n${canonical({ manifest: { ...rest, provenance: source }, files: digests })}`;
}
