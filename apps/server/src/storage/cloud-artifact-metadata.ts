// Cloud artifact metadata: per-project slot storing the sanitized artifact
// manifest of every published artifact file, keyed by project-relative path and
// bound to the canonical head bytes by a full sha256 revision. This replaces
// the local `<file>.artifact.json` sidecar on the cloud file route — no
// filesystem, no bucket object, no extra collection.
//
// The canonical file head (canvas_files row + immutable blob) remains owned by
// CloudProjectFiles. This module only records "path + revision -> manifest";
// `get` returns null the moment the supplied revision no longer matches, so a
// stale manifest can never resurface an artifact title for different bytes.
// Ordering across the two systems is NOT atomic: callers must mutate the file
// head first and this metadata second (see docs/CLOUD_ARTIFACT_METADATA.md for
// the failure-gap contract).

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CanvasStateError } from '@bezier/canvas-core';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { isProjectFileVersionPath } from '../project-file-versions.js';
import { validateArtifactManifestInput } from '../artifacts/manifest.js';
import {
  ArtifactManifestInvalidError,
  ArtifactManifestRequiredError,
  resolveCreateArtifactManifest,
} from '../artifacts/create.js';
import {
  ArtifactPublicationBlockedError,
  assertArtifactPublicationAllowed,
  isPublicationGuardedArtifactKind,
} from '../artifacts/publication-guard.js';
import {
  STUB_GUARDED_MANIFEST_KINDS,
  classifyArtifactStubGuard,
  readArtifactStubGuardConfigFromEnv,
  type ArtifactStubGuardConfig,
  type ArtifactStubGuardWarning,
  type PriorArtifactSibling,
} from '../artifacts/stub-guard.js';
import { rewriteArtifactManifestRenameRefs } from '../artifacts/manifest-rename.js';

type JsonRecord = Record<string, unknown>;

const DOCUMENT_VERSION = 1;
const MAX_ENTRIES = 256;
const MAX_DOCUMENT_BYTES = 1024 * 1024; // JsonStatePort payload bound — fail closed, never truncate
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SLOT_PREFIX = 'artifacts';
const DOCUMENT_FIELDS = new Set(['version', 'projectId', 'entries']);
const ENTRY_FIELDS = new Set(['revision', 'manifest']);
// The exact field selection sanitizeManifest emits; anything else in a stored
// manifest means the slot was tampered with, so it is corruption, not input.
const MANIFEST_FIELDS = new Set([
  'version', 'kind', 'title', 'entry', 'renderer', 'status', 'exports',
  'primary', 'supportingFiles', 'createdAt', 'updatedAt', 'sourceSkillId',
  'designSystemId', 'metadata',
]);

/** Kinds whose published file must keep the extension the artifact renderer
 * family expects. Mirrors inferLegacyManifest's extension map; kinds without
 * a canonical extension (react-component, diagram, code-snippet, mini-app,
 * design-system) are unconstrained. */
const ARTIFACT_KIND_EXTENSIONS: Record<string, readonly string[]> = {
  html: ['.html', '.htm'],
  deck: ['.html', '.htm'],
  'markdown-document': ['.md'],
  svg: ['.svg'],
};

const sha256hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const slotFor = (projectId: string) => `${SLOT_PREFIX}:${sha256hex(projectId)}`;

const corrupt = (why: string): never => {
  throw new CanvasStateError(503, 'CLOUD_ARTIFACT_METADATA_CORRUPT', `cloud artifact metadata is corrupt: ${why}`);
};

const invalid = (message: string): never => {
  throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', message);
};

const badRequest = (message: string): never => {
  throw new CanvasStateError(400, 'BAD_REQUEST', message);
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function checkProjectId(projectId: unknown): string {
  if (typeof projectId !== 'string' || projectId.length === 0) invalid('project id required');
  return projectId as string;
}

/** Strict artifact path: must already be canonical (the canonical helper only
 * normalizes separators/dots away — anything it would change is a rejected
 * input, not a fixup), never a traversal, never internal version storage. */
function checkArtifactPath(raw: unknown): string {
  if (typeof raw !== 'string') return invalid('artifact path must be a string');
  const value = raw;
  let normalized: string;
  try {
    normalized = normalizeSafeProjectFilePath(value);
  } catch {
    return invalid('invalid artifact path');
  }
  if (normalized !== value) invalid('artifact path must be normalized');
  if (isProjectFileVersionPath(normalized)) invalid('internal version-storage paths cannot be artifacts');
  return normalized;
}

function checkRevision(raw: unknown): string {
  if (typeof raw !== 'string' || !SHA256_RE.test(raw)) invalid('a full sha256 revision is required');
  return raw as string;
}

/** `__proto__` is a legal project filename, so entry records must have a null
 * prototype — assigning `entries['__proto__']` on a plain object would touch
 * the prototype instead of storing an own key. */
const cloneEntries = (entries: Record<string, ArtifactMetadataEntry>): Record<string, ArtifactMetadataEntry> =>
  Object.assign(Object.create(null) as Record<string, ArtifactMetadataEntry>, entries);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** A stored manifest can only move to a path whose extension still matches
 * what its kind renders as — `kind: html` on `notes.md` is nonsense. */
function assertKindExtensionCompatible(kind: unknown, path: string): void {
  const allowed = typeof kind === 'string' ? ARTIFACT_KIND_EXTENSIONS[kind] : undefined;
  if (allowed && !allowed.includes(extensionOf(path))) {
    badRequest(`artifact kind ${JSON.stringify(kind)} cannot move to ${JSON.stringify(extensionOf(path) || 'an extensionless')} path`);
  }
}

/** Caller-facing manifest validation for writes: sanitize through the shared
 * validator (its fixed field selection drops unknown caller fields such as
 * stray secrets), then pin `entry` to the actual artifact file path so a
 * manifest can never claim a different body under this slot key. */
function checkedCallerManifest(raw: unknown, path: string): JsonRecord {
  const result = validateArtifactManifestInput(raw, path);
  if (!result.ok) return badRequest(`invalid artifactManifest: ${result.error}`);
  const manifest = result.value;
  if (!manifest) return badRequest('artifact manifest is required');
  if (manifest.entry !== path) badRequest('artifactManifest.entry does not match the artifact file path');
  return cloneJson(manifest);
}

/** Stored-manifest validation: the same validator, but timestamps are carried
 * through unchanged (`preserveUpdatedAt`) and the field set is exact — a key
 * outside sanitizeManifest's output means the slot was written by something
 * other than this module. */
function checkedStoredManifest(raw: unknown, path: string): JsonRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return corrupt(`entry for ${JSON.stringify(path)} has no manifest object`);
  for (const key of Object.keys(raw as JsonRecord)) {
    if (!MANIFEST_FIELDS.has(key)) return corrupt(`stored manifest for ${JSON.stringify(path)} has unknown field ${JSON.stringify(key)}`);
  }
  const result = validateArtifactManifestInput(raw, path, { preserveUpdatedAt: true });
  if (!result.ok || !result.value) return corrupt(`stored manifest for ${JSON.stringify(path)} is invalid: ${result.ok ? 'empty' : result.error}`);
  if (result.value.entry !== path) return corrupt(`stored manifest entry does not match its slot key ${JSON.stringify(path)}`);
  return cloneJson(result.value);
}

interface ArtifactMetadataEntry {
  /** Full sha256 of the canonical head bytes this manifest describes. */
  revision: string;
  manifest: JsonRecord;
}

interface ArtifactMetadataDocument {
  version: number;
  projectId: string;
  entries: Record<string, ArtifactMetadataEntry>;
}

export interface PrepareCloudArtifactInput {
  /** Project-relative artifact file path; must already be normalized. */
  path: string;
  /** The exact canonical bytes the file head will store. */
  content: Uint8Array;
  /** Publish-as-artifact flag from the write request. */
  artifact?: boolean;
  /** Optional caller manifest; explicit null/undefined means a plain file. */
  artifactManifest?: unknown;
  /** Prior same-directory artifact siblings sharing this manifest's
   * metadata.identifier — `{name, size}` rows the caller derives from
   * canonical cloud listings/metadata. This module never touches disk, so the
   * stub guard only sees what the caller supplies. */
  priorSiblings?: readonly PriorArtifactSibling[];
  /** Test/config override; defaults to readArtifactStubGuardConfigFromEnv(). */
  stubGuardConfig?: ArtifactStubGuardConfig;
}

/** Validates and guards a would-be artifact publication BEFORE any mutation.
 * Returns the sanitized manifest the caller should persist through
 * `CloudArtifactMetadata.set` after the canonical write lands, or null for a
 * plain (non-artifact) file.
 *
 * The published artifact kind — not the request mime — decides which guards
 * run: HTML/deck bodies are decoded with strict UTF-8 (fatal) and scanned by
 * the publication placeholder guard, then the identifier-based stub guard
 * runs over caller-supplied prior siblings, exactly like the local
 * writeProjectFile path. All failures are CanvasStateError 400s with stable
 * codes (ARTIFACT_MANIFEST_REQUIRED / BAD_REQUEST /
 * ARTIFACT_PUBLICATION_BLOCKED / ARTIFACT_REGRESSION); nothing mutates and no
 * raw error internals are exposed. */
export function prepareCloudArtifact(input: PrepareCloudArtifactInput): JsonRecord | null {
  const path = checkArtifactPath(input?.path);
  const content = input?.content;
  if (!(content instanceof Uint8Array)) invalid('content must be a Uint8Array');

  let manifest: JsonRecord | null;
  if (input.artifact === true) {
    // Existing create-path contract: caller manifest wins, legacy extension
    // inference fills in for plain .html/.md/.svg, anything else is rejected.
    try {
      manifest = resolveCreateArtifactManifest({
        name: path,
        content: '',
        artifactManifest: input.artifactManifest,
      }) as JsonRecord;
    } catch (error) {
      if (error instanceof ArtifactManifestRequiredError) {
        throw new CanvasStateError(400, 'ARTIFACT_MANIFEST_REQUIRED', error.message);
      }
      if (error instanceof ArtifactManifestInvalidError) {
        throw new CanvasStateError(400, 'ARTIFACT_MANIFEST_INVALID', error.message);
      }
      throw error;
    }
  } else {
    if (input.artifactManifest === undefined || input.artifactManifest === null) return null;
    manifest = checkedCallerManifest(input.artifactManifest, path);
  }
  if (!manifest) return null;
  if (manifest.entry !== path) badRequest('artifactManifest.entry does not match the artifact file path');

  const kind = typeof manifest.kind === 'string' ? manifest.kind : '';
  const guarded = isPublicationGuardedArtifactKind(kind) || STUB_GUARDED_MANIFEST_KINDS.has(kind);
  if (guarded) {
    // Guarded bodies are rendered text: undecodable bytes cannot be scanned
    // for placeholders, so they are rejected instead of scanned as mojibake.
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      return badRequest('guarded artifact body is not valid UTF-8');
    }
    try {
      assertArtifactPublicationAllowed(text);
    } catch (error) {
      if (error instanceof ArtifactPublicationBlockedError) {
        throw new CanvasStateError(400, 'ARTIFACT_PUBLICATION_BLOCKED', error.message, {
          placeholders: [...error.placeholders],
        });
      }
      throw error;
    }

    const metadata = manifest.metadata;
    const identifier = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      && typeof (metadata as JsonRecord).identifier === 'string'
      ? (metadata as JsonRecord).identifier as string
      : '';
    if (identifier.length > 0 && STUB_GUARDED_MANIFEST_KINDS.has(kind)) {
      const config = input.stubGuardConfig ?? readArtifactStubGuardConfigFromEnv();
      const guard = classifyArtifactStubGuard([...(input.priorSiblings ?? [])], identifier, content.byteLength, config);
      if ((guard.outcome === 'reject' || guard.outcome === 'warn') && guard.warning) {
        // Same operator-visible signal as the local write path.
        console.warn(
          `[stub-guard] ${guard.outcome} identifier=${guard.warning.identifier} ` +
            `newSize=${guard.warning.newSize} priorSize=${guard.warning.priorSize} ` +
            `priorName=${guard.warning.priorName} path=${path}`,
        );
      }
      if (guard.outcome === 'reject' && guard.warning) {
        throw new CanvasStateError(400, 'ARTIFACT_REGRESSION', guard.warning.message, {
          identifier: guard.warning.identifier,
          newSize: guard.warning.newSize,
          priorSize: guard.warning.priorSize,
          priorName: guard.warning.priorName,
        });
      }
    }
  }
  return manifest;
}

export type { ArtifactStubGuardWarning };

/** Strict per-project artifact-manifest metadata on one JsonStatePort slot
 * (`artifacts:<sha256(projectId)>`). Authorization is the caller's job: every
 * method requires the caller to have already authorized the current project
 * access; no actor fields are accepted here.
 *
 * A missing state port is a hard wiring failure — there is no local or
 * in-memory fallback. */
export class CloudArtifactMetadata {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly state: JsonStatePort) {
    if (!state || typeof state.read !== 'function' || typeof state.write !== 'function' || typeof state.flush !== 'function') {
      throw new Error('CloudArtifactMetadata requires a JsonStatePort');
    }
  }

  /** One serialized queue per project — the whole document is per-project, so
   * a single key serializes every mutation without cross-project blocking. */
  private async serialized<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${SLOT_PREFIX}\0${projectId}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.then(() => current, () => current);
    this.locks.set(key, chained);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  /** Strict document load: unknown fields, malformed entries, an over-capacity
   * or oversize stored document are all corruption (503), never silently
   * reset, truncated or evicted. A missing slot is a legitimately empty
   * document for THIS project only — another project's slot key or projectId
   * can never satisfy the check, so scopes cannot clobber each other. */
  private loadDocument(projectId: string): ArtifactMetadataDocument {
    const raw = this.state.read(slotFor(projectId));
    if (raw === undefined) return { version: DOCUMENT_VERSION, projectId, entries: {} };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return corrupt('document is not an object');
    const serialized = JSON.stringify(raw);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_BYTES) {
      return corrupt('document exceeds the 1 MiB bound');
    }
    const doc = raw as JsonRecord;
    for (const key of Object.keys(doc)) if (!DOCUMENT_FIELDS.has(key)) return corrupt(`unknown field ${JSON.stringify(key)}`);
    if (doc.version !== DOCUMENT_VERSION) return corrupt(`unsupported version ${JSON.stringify(doc.version)}`);
    if (doc.projectId !== projectId) return corrupt('document projectId mismatch');
    if (!doc.entries || typeof doc.entries !== 'object' || Array.isArray(doc.entries)) return corrupt('entries is not an object');
    const rawEntries = doc.entries as Record<string, unknown>;
    const keys = Object.keys(rawEntries);
    if (keys.length > MAX_ENTRIES) return corrupt(`document holds ${keys.length} entries (max ${MAX_ENTRIES})`);
    const entries: Record<string, ArtifactMetadataEntry> = Object.create(null) as Record<string, ArtifactMetadataEntry>;
    for (const key of keys) {
      let normalized: string;
      try {
        normalized = normalizeSafeProjectFilePath(key);
      } catch {
        return corrupt(`entry path is unsafe: ${JSON.stringify(key)}`);
      }
      if (normalized !== key) return corrupt(`entry path is not normalized: ${JSON.stringify(key)}`);
      if (isProjectFileVersionPath(key)) return corrupt(`entry path is internal storage: ${JSON.stringify(key)}`);
      const rawEntry = rawEntries[key];
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return corrupt(`entry for ${JSON.stringify(key)} is not an object`);
      const record = rawEntry as JsonRecord;
      for (const field of Object.keys(record)) if (!ENTRY_FIELDS.has(field)) return corrupt(`entry for ${JSON.stringify(key)} has unknown field ${JSON.stringify(field)}`);
      if (typeof record.revision !== 'string' || !SHA256_RE.test(record.revision)) return corrupt(`entry for ${JSON.stringify(key)} has an invalid revision`);
      entries[key] = { revision: record.revision, manifest: checkedStoredManifest(record.manifest, key) };
    }
    return { version: DOCUMENT_VERSION, projectId, entries };
  }

  /** Capacity is enforced BEFORE staging: at most 256 entries and a 1 MiB
   * serialized UTF-8 document. A violation throws without ever calling
   * state.write, so the port keeps its previous durable value. */
  private assertCapacity(doc: ArtifactMetadataDocument): void {
    if (Object.keys(doc.entries).length > MAX_ENTRIES) {
      throw new CanvasStateError(413, 'CLOUD_ARTIFACT_METADATA_LIMIT', `artifact metadata exceeds the ${MAX_ENTRIES}-entry bound`);
    }
    if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new CanvasStateError(413, 'CLOUD_ARTIFACT_METADATA_LIMIT', 'artifact metadata exceeds the 1 MiB cloud state bound');
    }
  }

  private saveDocument(projectId: string, doc: ArtifactMetadataDocument): void {
    this.assertCapacity(doc);
    this.state.write(slotFor(projectId), doc);
  }

  /** Manifest for `path` when `revision` is the sha256 of the SAME canonical
   * head bytes the manifest was stored against. Any mismatch — absent entry,
   * different bytes — returns null, never a stale artifact title. The result
   * is a safe deep clone. */
  async list(projectId:string):Promise<Array<{path:string;revision:string;manifest:JsonRecord}>> {
    await this.state.ready;
    const doc=this.loadDocument(checkProjectId(projectId));
    return Object.entries(doc.entries).map(([path,entry])=>({path,revision:entry.revision,manifest:cloneJson(entry.manifest)}));
  }

  /** Computes the document a `from` -> `to` head rename would produce, or
   * null when nothing would change. Shared by rename() and preflightRename()
   * so the pre-move check runs the exact same pipeline — destination
   * conflict, kind/extension compatibility, every cross-entry reference
   * rewrite and every result-manifest revalidation — the mutation performs.
   * Throws the same failures rename would surface; writes nothing.
   *
   * Reference rewrite mirrors the local `.artifact.json` sidecar semantics
   * (artifacts/manifest-rename.ts): EVERY stored manifest is scanned and its
   * `entry`/`primary`/`supportingFiles` refs to the moved file are updated —
   * including refs owned by unrelated artifacts and the ordinary-file case
   * where the renamed file has no artifact entry of its own. The moved
   * artifact's own manifest resolves refs against the DESTINATION owner path,
   * matching the local pipeline where the ref pass runs after the sidecar
   * file has already moved. Other manifests keep their `entry` pinned to
   * their own slot key. Every manifest the rename produces is revalidated and
   * stored as a cloneJson'd validated value — the validator materializes
   * undefined optional fields the strict JsonStatePort codec would reject.
   * Revisions are never touched: a rename does not modify file bytes, so each
   * manifest stays bound to the head sha256 it was recorded against. */
  private stagedRenameDocument(
    doc: ArtifactMetadataDocument,
    source: string,
    destination: string,
    rev: string,
  ): ArtifactMetadataDocument | null {
    const entries = cloneEntries(doc.entries);
    const own = Object.hasOwn(entries, source) ? entries[source] : undefined;
    let changed = false;
    let moving: ArtifactMetadataEntry | null = null;

    if (own) {
      delete entries[source];
      changed = true;
      if (own.revision === rev) {
        if (Object.hasOwn(entries, destination)) {
          throw new CanvasStateError(409, 'CANVAS_CONFLICT', 'rename destination already has artifact metadata');
        }
        assertKindExtensionCompatible(own.manifest.kind, destination);
        const rewritten = rewriteArtifactManifestRenameRefs(own.manifest, {
          ownerName: destination,
          oldName: source,
          newName: destination,
        });
        const renamed = validateArtifactManifestInput({ ...rewritten.manifest, entry: destination }, destination);
        if (!renamed.ok || !renamed.value) {
          return badRequest(`renamed artifact manifest is invalid: ${renamed.ok ? 'empty' : renamed.error}`);
        }
        if (renamed.value.entry !== destination) {
          return badRequest('renamed artifact manifest entry does not match the destination path');
        }
        moving = { revision: own.revision, manifest: cloneJson(renamed.value) };
      }
      // Revision mismatch: the stored manifest describes superseded bytes and
      // can never match again after the move (rename does not change content),
      // so the stale own marker is dropped rather than propagated to the
      // destination. References in OTHER manifests are still rewritten.
    }

    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (!entry) continue;
      const rewritten = rewriteArtifactManifestRenameRefs(entry.manifest, {
        ownerName: key,
        oldName: source,
        newName: destination,
      });
      if (!rewritten.changed) continue;
      const validated = validateArtifactManifestInput(rewritten.manifest, key);
      if (!validated.ok || !validated.value) {
        return badRequest(`renamed artifact manifest for ${JSON.stringify(key)} is invalid: ${validated.ok ? 'empty' : validated.error}`);
      }
      if (validated.value.entry !== key) {
        return badRequest(`renamed artifact manifest entry does not match its slot key ${JSON.stringify(key)}`);
      }
      entries[key] = { revision: entry.revision, manifest: cloneJson(validated.value) };
      changed = true;
    }

    if (!changed) return null;
    if (moving) entries[destination] = moving;
    return { version: DOCUMENT_VERSION, projectId: doc.projectId, entries };
  }

  /** Check before moving a canonical file head; no state is staged. Runs the
   * identical computation and validation pipeline rename() would run —
   * including every cross-entry reference rewrite and the capacity bound the
   * resulting document must satisfy — so a passing preflight means the
   * metadata update itself cannot fail on this document. */
  async preflightRename(projectId: string, from: string, to: string, revision: string): Promise<void> {
    await this.state.ready;
    const pid = checkProjectId(projectId);
    const source = checkArtifactPath(from);
    const destination = checkArtifactPath(to);
    if (source === destination) invalid('rename target equals source');
    const rev = checkRevision(revision);
    const doc = this.loadDocument(pid);
    const next = this.stagedRenameDocument(doc, source, destination, rev);
    if (!next) return;
    this.assertCapacity(next);
  }

  async get(projectId: string, path: string, revision: string): Promise<JsonRecord | null> {
    await this.state.ready;
    const pid = checkProjectId(projectId);
    const relative = checkArtifactPath(path);
    const rev = checkRevision(revision);
    const doc = this.loadDocument(pid);
    const entry = Object.hasOwn(doc.entries, relative) ? doc.entries[relative] : undefined;
    if (!entry || entry.revision !== rev) return null;
    return cloneJson(entry.manifest);
  }

  /** Records `manifest` as the artifact description of `path` at `revision`
   * (the sha256 the caller committed as the canonical head). Awaits flush()
   * so a resolved call means the metadata is durable; a persistence failure
   * propagates and the port keeps its own failure state. */
  async set(projectId: string, path: string, revision: string, manifest: unknown): Promise<void> {
    await this.state.ready;
    const pid = checkProjectId(projectId);
    const relative = checkArtifactPath(path);
    const rev = checkRevision(revision);
    const validated = checkedCallerManifest(manifest, relative);
    await this.serialized(pid, async () => {
      const doc = this.loadDocument(pid);
      const next: ArtifactMetadataDocument = {
        version: DOCUMENT_VERSION,
        projectId: pid,
        entries: cloneEntries(doc.entries),
      };
      next.entries[relative] = { revision: rev, manifest: validated };
      this.saveDocument(pid, next);
      await this.state.flush();
    });
  }

  /** Moves existing metadata `from` -> `to` and rewrites manifest references
   * to the moved file across EVERY entry in the project slot — the cloud
   * equivalent of the local sidecar rename pass. The file-head rename itself
   * is owned by the caller (CloudProjectFiles); `currentRevision` must be the
   * head sha256 BEFORE the move so a stale own manifest is dropped instead of
   * dragged to the new path. A metadata entry already at `to` conflicts 409;
   * a manifest whose kind cannot live at the new extension fails 400 — both
   * before any mutation. `from` having no entry is not a no-op when other
   * manifests reference the file (ordinary supporting-file rename); only a
   * rename that changes nothing skips the write entirely. */
  async rename(projectId: string, from: string, to: string, currentRevision: string): Promise<void> {
    await this.state.ready;
    const pid = checkProjectId(projectId);
    const source = checkArtifactPath(from);
    const destination = checkArtifactPath(to);
    if (source === destination) invalid('rename target equals source');
    const rev = checkRevision(currentRevision);
    await this.serialized(pid, async () => {
      const doc = this.loadDocument(pid);
      const next = this.stagedRenameDocument(doc, source, destination, rev);
      if (!next) return;
      this.saveDocument(pid, next);
      await this.state.flush();
    });
  }

  /** Drops the metadata for `path`. Absent entries are a no-op (no write, no
   * flush); present ones are removed, staged and flushed before returning. */
  async remove(projectId: string, path: string): Promise<void> {
    await this.state.ready;
    const pid = checkProjectId(projectId);
    const relative = checkArtifactPath(path);
    await this.serialized(pid, async () => {
      const doc = this.loadDocument(pid);
      if (!Object.hasOwn(doc.entries, relative)) return;
      const next: ArtifactMetadataDocument = {
        version: DOCUMENT_VERSION,
        projectId: pid,
        entries: cloneEntries(doc.entries),
      };
      delete next.entries[relative];
      this.saveDocument(pid, next);
      await this.state.flush();
    });
  }
}
