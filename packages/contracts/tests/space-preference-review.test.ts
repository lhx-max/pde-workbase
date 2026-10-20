import { describe, expect, it } from 'vitest';
import {
  emptySpaceBrief, normalizePreferenceContent, spacePreferenceReviewFiles, spacePreferenceRequiresAtomicReview,
  type SpaceBrief, type SpaceBriefSection,
} from '../src/api/space-brief.js';

function section(kind: string, files: Record<string, string>): SpaceBriefSection {
  return { kind, data: { type: 'image', title: '图片偏好', bundle: {
    schemaVersion: 1, spaceId: 'brand', files: Object.entries(files).map(([path, content]) => ({ path, content })),
  } } };
}
function brief(before: Record<string, string> | undefined, after: Record<string, string>): SpaceBrief {
  return { ...emptySpaceBrief('brand'), sections: {
    ...(before ? { 'confirmed-image': section('preference-confirmed', before) } : {}),
    'suggested-image': section('preference-candidate', after),
  } };
}

describe('spacePreferenceReviewFiles', () => {
  it('requires atomic review only when candidate and confirmed bundle schemas differ', () => {
    const value = brief({ 'SKILL.md': 'old' }, { 'SKILL.md': 'new' });
    expect(spacePreferenceRequiresAtomicReview(value, 'suggested-image')).toBe(false);
    const candidate = value.sections['suggested-image']!.data as { bundle: { schemaVersion: number } };
    candidate.bundle.schemaVersion = 2;
    expect(spacePreferenceRequiresAtomicReview(value, 'suggested-image')).toBe(true);
    expect(spacePreferenceRequiresAtomicReview(value, 'confirmed-image')).toBe(false);
    expect(spacePreferenceRequiresAtomicReview(value, 'missing')).toBe(false);
    const confirmed = value.sections['confirmed-image']!.data as typeof candidate;
    confirmed.bundle.schemaVersion = 2;
    expect(spacePreferenceRequiresAtomicReview(value, 'suggested-image')).toBe(false);
  });
  it('compares a candidate with the matching confirmed version, not itself or another type', () => {
    const value = brief({ 'visual-rules.md': 'old', 'evidence.md': 'same' }, { 'visual-rules.md': 'new', 'evidence.md': 'same' });
    value.sections['confirmed-video'] = section('preference-confirmed', { 'visual-rules.md': 'unrelated' });
    expect(spacePreferenceReviewFiles(value, 'suggested-image')).toEqual([
      { path: 'visual-rules.md', before: 'old', after: 'new' },
      { path: 'evidence.md', before: 'same', after: 'same' },
    ]);
    expect(spacePreferenceReviewFiles(value, 'suggested-image').filter(file => file.before !== file.after).map(file => file.path))
      .toEqual(['visual-rules.md']);
    expect(spacePreferenceReviewFiles(value, 'confirmed-image').every(file => file.before === file.after)).toBe(true);
    expect(spacePreferenceReviewFiles(value, 'missing')).toEqual([]);
  });

  it('distinguishes absent files from empty files for additions, deletions and edits', () => {
    expect(spacePreferenceReviewFiles(brief({ 'evidence.md': '', 'visual-rules.md': 'old' }, {
      'SKILL.md': '', 'visual-rules.md': '',
    }), 'suggested-image')).toEqual([
      { path: 'SKILL.md', before: null, after: '' },
      { path: 'visual-rules.md', before: 'old', after: '' },
      { path: 'evidence.md', before: '', after: null },
    ]);
    expect(spacePreferenceReviewFiles(brief(undefined, { 'SKILL.md': '' }), 'suggested-image'))
      .toEqual([{ path: 'SKILL.md', before: null, after: '' }]);
  });

  it('does not flag lifecycle-only changes, but preserves real prose and whitespace changes', () => {
    const frontmatter = '---\nname: image-preferences\nstatus: confirmed\n---\n';
    const value = brief({ 'SKILL.md': `${frontmatter}# Same\n`, 'evidence.md': 'same\n' }, {
      'SKILL.md': `${frontmatter.replace('confirmed', 'candidate')}# Same\n`, 'evidence.md': 'same\n\n',
    });
    expect(spacePreferenceReviewFiles(value, 'suggested-image').filter(file => file.before !== file.after))
      .toEqual([{ path: 'evidence.md', before: 'same\n', after: 'same\n\n' }]);
  });

  it('compares legacy Markdown documents without the candidate title suffix', () => {
    const value: SpaceBrief = { ...emptySpaceBrief('brand'), sections: {
      'confirmed-image': { kind: 'preference-confirmed', data: { type: 'image', title: '图片偏好', text: '正文' } },
      'suggested-image': { kind: 'preference-candidate', data: { type: 'image', title: '图片偏好 · 待确认', text: '正文' } },
    } };
    expect(spacePreferenceReviewFiles(value, 'suggested-image')).toEqual([
      { path: 'document.md', before: '# 图片偏好\n\n正文', after: '# 图片偏好\n\n正文' },
    ]);
  });
});

describe('normalizePreferenceContent', () => {
  it.each(['\n', '\r\n'])('normalizes status as the first frontmatter field with %j line endings', newline => {
    const source = ['---', 'status: candidate', 'name: image-preferences', '---', '# Rules', ''].join(newline);
    expect(normalizePreferenceContent(source)).toBe(source.replace('status: candidate', 'status: confirmed'));
  });

  it('does not rewrite a status line in the Markdown body after closed frontmatter', () => {
    const source = '---\nname: image-preferences\n---\nstatus: candidate\n\n---\n';
    expect(normalizePreferenceContent(source)).toBe(source);
  });

  it.each(['status: candidate\n', '---\nname: x\nstatus: candidate\n', '---\nname: x\nstatus: rejected\n---\n'])
    ('preserves plain text, unclosed frontmatter and other statuses: %j', source => {
      expect(normalizePreferenceContent(source)).toBe(source);
    });
});
