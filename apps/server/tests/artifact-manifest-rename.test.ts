import { describe, expect, it } from 'vitest';
import {
  rewriteArtifactManifestRenameRefs,
  rewriteManifestRefForRename,
} from '../src/artifacts/manifest-rename.js';

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  kind: 'html',
  title: 'doc',
  entry: 'docs/app.html',
  renderer: 'html',
  status: 'complete',
  exports: ['html'],
  ...over,
});

describe('rewriteArtifactManifestRenameRefs', () => {
  it('rewrites entry/primary/supporting refs to the moved file across match forms', () => {
    const result = rewriteArtifactManifestRenameRefs(manifest({
      entry: 'docs/app.html',
      primary: 'app.html',
      supportingFiles: ['app.html', 'docs/app.html', 'img.png'],
    }), { ownerName: 'docs/app.html', oldName: 'docs/app.html', newName: 'docs/sub/b.html' });
    expect(result.changed).toBe(true);
    expect(result.manifest).toMatchObject({
      // project-root match keeps the root-relative destination form.
      entry: 'docs/sub/b.html',
      // owner-relative match becomes relative to the owner's directory.
      primary: 'sub/b.html',
      // literal root-spelled supporting refs take the root-relative form too.
      supportingFiles: ['sub/b.html', 'docs/sub/b.html', 'img.png'],
    });
  });

  it('rewrites relative refs owned by a different artifact against that owner directory', () => {
    const result = rewriteArtifactManifestRenameRefs(manifest({
      entry: 'docs/owner.html',
      supportingFiles: ['lib.js', 'docs/lib.js'],
    }), { ownerName: 'docs/owner.html', oldName: 'docs/lib.js', newName: 'docs/assets/lib.js' });
    expect(result.changed).toBe(true);
    expect(result.manifest.entry).toBe('docs/owner.html');
    expect(result.manifest.supportingFiles).toEqual(['assets/lib.js', 'docs/assets/lib.js']);
  });

  it('falls back to the root-relative form when the owner directory cannot reach the destination', () => {
    const result = rewriteArtifactManifestRenameRefs(manifest({
      entry: 'a/b/c.html',
      supportingFiles: ['data.json'],
    }), { ownerName: 'a/b/c.html', oldName: 'a/b/data.json', newName: 'x/y/data.json' });
    expect(result.changed).toBe(true);
    // ../../x/y/data.json would escape the owner subtree — the root form wins.
    expect(result.manifest.supportingFiles).toEqual(['x/y/data.json']);
  });

  it('preserves external URLs, query strings, fragments and non-string refs untouched', () => {
    const refs = [
      'https://cdn.example.com/lib.js',
      '//cdn.example.com/lib.js',
      'data:text/javascript;base64,xx',
      'lib.js?v=2',
      'lib.js#frag',
      '  ',
      42,
      null,
    ];
    const input = manifest({ entry: 'docs/owner.html', supportingFiles: [...refs] });
    const result = rewriteArtifactManifestRenameRefs(input, {
      ownerName: 'docs/owner.html',
      oldName: 'docs/lib.js',
      newName: 'docs/lib2.js',
    });
    expect(result.changed).toBe(false);
    expect(result.manifest.supportingFiles).toEqual(refs);
    expect(input.supportingFiles).toEqual(refs);
  });

  it('keeps the existing traversal-normalization semantics of the local helper', () => {
    // A '..' ref that still resolves inside the project root is treated like
    // the local sidecar code treats it: it may match and is rewritten.
    const inside = rewriteManifestRefForRename('sub/../lib.js', 'docs/o.html', 'docs/lib.js', 'docs/lib2.js');
    expect(inside).toEqual({ changed: true, value: 'lib2.js' });
    // A '..' ref escaping the root never matches.
    const escaped = rewriteManifestRefForRename('../../lib.js', 'docs/o.html', 'lib.js', 'lib2.js');
    expect(escaped).toEqual({ changed: false, value: '../../lib.js' });
    // Absolute paths never match.
    const absolute = rewriteManifestRefForRename('/docs/lib.js', 'docs/o.html', 'docs/lib.js', 'docs/lib2.js');
    expect(absolute).toEqual({ changed: false, value: '/docs/lib.js' });
  });

  it('reports changed=false and does not mutate the input when nothing references the moved file', () => {
    const input = manifest({ supportingFiles: ['img.png'] });
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = rewriteArtifactManifestRenameRefs(input, {
      ownerName: 'docs/app.html',
      oldName: 'docs/lib.js',
      newName: 'docs/lib2.js',
    });
    expect(result.changed).toBe(false);
    expect(input).toEqual(snapshot);
  });
});

describe('rewriteManifestRefForRename', () => {
  it('prefers the project-root match for entry/primary style refs', () => {
    // 'docs/lib.js' resolves to oldName from the project root even though it
    // would resolve to 'docs/docs/lib.js' relative to the owner.
    expect(rewriteManifestRefForRename('docs/lib.js', 'docs/o.html', 'docs/lib.js', 'x/lib.js', { preferProjectRoot: true }))
      .toEqual({ changed: true, value: 'x/lib.js' });
  });

  it('resolves plain relative refs against the owner directory', () => {
    expect(rewriteManifestRefForRename('lib.js', 'docs/o.html', 'docs/lib.js', 'docs/lib2.js'))
      .toEqual({ changed: true, value: 'lib2.js' });
    // Without the owner-directory match the bare literal oldName still wins.
    expect(rewriteManifestRefForRename('docs/lib.js', 'docs/o.html', 'docs/lib.js', 'docs/lib2.js'))
      .toEqual({ changed: true, value: 'docs/lib2.js' });
  });
});
