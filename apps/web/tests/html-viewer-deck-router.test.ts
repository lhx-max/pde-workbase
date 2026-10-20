import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '@bezier/contracts';
import { artifactRendererRegistry } from '../src/artifacts/renderer-registry';

const file: ProjectFile = { name: 'index.html', path: 'index.html', type: 'file', size: 1, mtime: 1, kind: 'html', mime: 'text/html' };
describe('original deck HTML renderer routing', () => {
  it('keeps ordinary HTML in the generic renderer without a deck hint', () => {
    expect(artifactRendererRegistry.resolve({ file, isDeckHint: false })?.renderer.id).toBe('html');
  });
  it.each(['deck.html', 'slides.html', 'pitch.html'])('preserves original filename inference for %s', name => {
    expect(artifactRendererRegistry.resolve({ file: { ...file, name }, isDeckHint: false })?.renderer.id).toBe('deck-html');
  });
  it('uses project deck hint for legacy HTML without a sidecar', () => {
    expect(artifactRendererRegistry.resolve({ file, isDeckHint: true })?.renderer.id).toBe('deck-html');
  });
  it.each([{ kind: 'deck', renderer: 'html' }, { kind: 'html', renderer: 'deck-html' }] as const)('honors explicit %j regardless of project kind', manifest => {
    const artifactManifest = { version: 1 as const, title: 'Slides', entry: file.name, exports: ['html' as const], ...manifest };
    expect(artifactRendererRegistry.resolve({ file: { ...file, artifactManifest }, isDeckHint: false })?.renderer.id).toBe('deck-html');
  });
});
