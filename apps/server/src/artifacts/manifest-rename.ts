// Adapted from Bezier/Loom 319e5eee, Apache-2.0.
//
// Pure artifact-manifest reference rewrite for file renames. This is the exact
// reference algorithm the local `.artifact.json` sidecar path applies in
// projects.ts (rewriteArtifactManifestRenameRefs / rewriteManifestRefForRename
// and their helpers), extracted into a standalone module so the cloud
// artifact-metadata slot can apply identical manifest reference semantics
// without importing the filesystem-backed module. No filesystem, no I/O, no
// projects.ts runtime dependency — `node:path` is used for pure string-level
// POSIX path arithmetic only.
//
// Semantics preserved from the local path:
// - `entry`/`primary` first try a project-root match (a ref already spelled
//   root-relative resolves against the project root and rewrites to the
//   root-relative destination), then an owner-relative match (rewritten to the
//   destination expressed relative to the owner's directory, falling back to
//   the root-relative form when `..` would be required), then literal string
//   equality (rewritten to the root-relative destination).
// - `supportingFiles` entries skip the project-root-first step but keep the
//   owner-relative and literal-match steps.
// - Non-strings, empty refs, absolute paths, root-escaping traversals and refs with a
//   URI scheme (external URLs) never match, so external links, query strings
//   and fragments are preserved untouched.

import path from 'node:path';

type JsonRecord = Record<string, unknown>;

export interface ArtifactManifestRename {
  /** Project-relative path of the artifact file that owns the manifest being
   * rewritten; manifest-relative refs resolve against its directory. */
  ownerName: string;
  /** Project-relative source path of the renamed file. */
  oldName: string;
  /** Project-relative destination path of the renamed file. */
  newName: string;
}

export interface ManifestRefRewriteResult {
  changed: boolean;
  value: unknown;
}

export interface ArtifactManifestRewriteResult {
  changed: boolean;
  manifest: JsonRecord;
}

/** Rewrites `entry`, `primary` and `supportingFiles` references inside one
 * manifest so refs to `oldName` point at `newName`, resolving relative refs
 * against the owner artifact's directory. Returns the same field selection as
 * the input plus a `changed` flag; the input is not mutated. */
export function rewriteArtifactManifestRenameRefs(
  manifest: JsonRecord,
  rename: ArtifactManifestRename,
): ArtifactManifestRewriteResult {
  const { ownerName, oldName, newName } = rename;
  let changed = false;
  const next: JsonRecord = { ...manifest };

  const entry = rewriteManifestRefForRename(next.entry, ownerName, oldName, newName, {
    preferProjectRoot: true,
  });
  if (entry.changed) {
    next.entry = entry.value;
    changed = true;
  }

  if (typeof next.primary === 'string') {
    const primary = rewriteManifestRefForRename(next.primary, ownerName, oldName, newName, {
      preferProjectRoot: true,
    });
    if (primary.changed) {
      next.primary = primary.value;
      changed = true;
    }
  }

  if (Array.isArray(next.supportingFiles)) {
    const supportingFiles = next.supportingFiles.map((ref) => {
      const updated = rewriteManifestRefForRename(ref, ownerName, oldName, newName);
      if (updated.changed) changed = true;
      return updated.value;
    });
    if (changed) next.supportingFiles = supportingFiles;
  }

  return { changed, manifest: next };
}

/** Rewrites a single manifest reference for a rename. Matching rules, in
 * order: with `preferProjectRoot` a ref that resolves to `oldName` from the
 * project root rewrites to `newName`; a ref that resolves to `oldName`
 * relative to the owner's directory rewrites to `newName` expressed relative
 * to that directory; literal equality with `oldName` rewrites to `newName`.
 * Anything else — including external URLs and refs carrying query/fragment
 * suffixes — is returned unchanged. */
export function rewriteManifestRefForRename(
  ref: unknown,
  ownerName: string,
  oldName: string,
  newName: string,
  options: { preferProjectRoot?: boolean } = {},
): ManifestRefRewriteResult {
  if (typeof ref !== 'string') return { changed: false, value: ref };
  const normalized = ref.replace(/\\/g, '/').trim();
  if (!normalized) return { changed: false, value: ref };

  if (options.preferProjectRoot && normalizeManifestProjectRootRef(normalized) === oldName) {
    return { changed: true, value: newName };
  }

  if (normalizeManifestProjectRef(normalized, ownerName) === oldName) {
    return {
      changed: true,
      value: relativeManifestRefForOwner(ownerName, newName),
    };
  }

  if (normalized === oldName) {
    return { changed: true, value: newName };
  }

  return { changed: false, value: ref };
}

function relativeManifestRefForOwner(ownerName: string, targetName: string): string {
  const ownerDir = path.posix.dirname(ownerName);
  if (ownerDir === '.') return targetName;
  const relative = path.posix.relative(ownerDir, targetName);
  if (!relative || relative === '.' || relative.startsWith('../') || relative.includes('/../')) {
    return targetName;
  }
  return relative;
}

function normalizeManifestProjectRootRef(ref: string): string | null {
  return normalizeManifestProjectRef(ref, '');
}

function normalizeManifestProjectRef(ref: unknown, ownerName: string): string | null {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const value = ref.trim().replace(/\\/g, '/');
  if (value.includes('\0') || value.startsWith('/')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const ownerDir = path.posix.dirname(ownerName);
  const joined = ownerDir === '.' ? value : `${ownerDir}/${value}`;
  const normalized = path.posix.normalize(joined).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) return null;
  if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  return normalized;
}
