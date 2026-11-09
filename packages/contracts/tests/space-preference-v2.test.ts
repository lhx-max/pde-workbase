import { expect, it } from 'vitest';
import { isSpacePreferenceBundlePath, spacePreferenceBundle } from '../src/api/space-brief.js';

it.each([1, 2] as const)('recognizes schemaVersion %s without losing file content', schemaVersion => {
  const bundle = { schemaVersion, spaceId: 'brand', files: [{ path: 'SKILL.md', content: 'exact' }] };
  expect(spacePreferenceBundle({ kind: 'preference-confirmed', data: { bundle } })).toBe(bundle);
});
it.each(['system-overview.md', 'validation/cases.json', 'validation/results.md', 'styles/quiet/identity.md', 'styles/quiet/decisions.json', 'styles/quiet/recipes.md'])('allows %s only in v2', path => {
  expect(isSpacePreferenceBundlePath(path, 1)).toBe(false);
  expect(isSpacePreferenceBundlePath(path, 2)).toBe(true);
});
it.each(['SKILL.md', 'visual-rules.md', 'evidence.md', 'references/index.json', 'styles/old-style.md'])('retains legacy %s in both versions', path => {
  expect(isSpacePreferenceBundlePath(path, 1)).toBe(true);
  expect(isSpacePreferenceBundlePath(path, 2)).toBe(true);
});
it.each(['../SKILL.md', '/SKILL.md', 'styles/../identity.md', 'styles/a/run.js', 'styles/a/unknown.md', 'styles/a/b/identity.md', 'styles\\a.md', 'styles/a.sh', 'styles/a//identity.md', 'styles/a/identity.md\n'])('refuses unsafe or arbitrary file %j', path => {
  expect(isSpacePreferenceBundlePath(path, 1)).toBe(false);
  expect(isSpacePreferenceBundlePath(path, 2)).toBe(false);
});
