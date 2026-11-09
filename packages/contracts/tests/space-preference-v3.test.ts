import { describe, expect, it } from 'vitest';
import { isSpacePreferenceBundlePath, spacePreferenceBundle, spacePreferenceReviewDocuments, spacePreferenceReviewFiles, spacePreferenceRequiresAtomicReview, type SpaceBrief } from '../src/api/space-brief.js';

describe('compact production preference contract', () => {
  it('separates production paths from human evidence and old fragmented modules', () => {
    for (const path of ['SKILL.md', 'foundations.md', 'recipes.md', 'references/index.json', 'styles/flat.md']) expect(isSpacePreferenceBundlePath(path, 3)).toBe(true);
    for (const path of ['evidence.md', 'validation/results.md', 'styles/flat/identity.md', '../SKILL.md', 'styles/a/b.md']) expect(isSpacePreferenceBundlePath(path, 3)).toBe(false);
    expect(isSpacePreferenceBundlePath('evidence.md', 2)).toBe(true);
  });
  it('keeps human review documents outside the runtime bundle', () => {
    const section = { kind: 'preference-confirmed', data: { bundle: { schemaVersion: 3, spaceId: 's', files: [{ path: 'SKILL.md', content: 'runtime' }] }, reviewDocuments: [{ path: 'evidence.md', content: 'human only' }] } };
    expect(spacePreferenceBundle(section)?.files).toEqual([{ path: 'SKILL.md', content: 'runtime' }]);
    expect(spacePreferenceReviewDocuments(section)).toEqual([{ path: 'evidence.md', content: 'human only' }]);
  });
  it('shows durable staged file decisions without pretending the confirmed files changed', () => {
    const brief: SpaceBrief = { spaceId: 's', scope: 'local', version: 1, updatedAt: 0, sections: {
      'confirmed-image': { kind: 'preference-confirmed', data: { type: 'image', bundle: { schemaVersion: 2, spaceId: 's', files: [{ path: 'SKILL.md', content: 'old' }] } } },
      'suggested-image': { kind: 'preference-candidate', data: { type: 'image', bundle: { schemaVersion: 3, spaceId: 's', files: [{ path: 'SKILL.md', content: 'new' }] }, reviewResolutions: { 'SKILL.md': { action: 'apply', content: 'edited' } } } },
    } };
    expect(spacePreferenceReviewFiles(brief, 'suggested-image')).toEqual([{ path: 'SKILL.md', before: 'old', after: 'edited', resolution: 'apply' }]);
    expect(spacePreferenceReviewFiles(brief, 'confirmed-image')).toEqual([{ path: 'SKILL.md', before: 'old', after: 'old' }]);
    expect(spacePreferenceRequiresAtomicReview(brief, 'suggested-image')).toBe(true);
    (brief.sections['confirmed-image']!.data as { bundle: { schemaVersion: number } }).bundle.schemaVersion = 3;
    expect(spacePreferenceRequiresAtomicReview(brief, 'suggested-image')).toBe(true);
    delete brief.sections['confirmed-image'];
    expect(spacePreferenceRequiresAtomicReview(brief, 'suggested-image')).toBe(true);
  });
});
