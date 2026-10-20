import type { CreationPreferenceType, CreationPreferenceSectionKey } from './creation-preferences.js';
import type { Routine } from './routines.js';

/** Read-only lookup; a space need not have an automation yet. */
export interface SpacePreferenceAutomationResponse { routine: Routine | null }

/** Per-space brief. Each section is one user-authored rule document. */
export interface SpaceBriefSection {
  kind: string;
  data: unknown;
}

export interface SpaceBrief {
  spaceId: string;
  scope: string;
  version: number;
  updatedAt: number;
  sections: Record<string, SpaceBriefSection>;
}

export interface SpaceBriefSectionPatch {
  kind?: string;
  data: unknown;
  /** Reject stale editors instead of overwriting a newer brief. */
  expectedVersion?: number;
}

export interface SpacePreferenceReviewRequest {
  version: number;
  action: 'apply' | 'reject' | 'reset';
  /** Omit to publish/reject the candidate; compact/migration file decisions are staged.
   * reset requires a path and removes only its staged decision. */
  path?: string;
  /** Explicit edited result for one file. null means deletion, not an empty file. */
  content?: string | null;
}

export interface SpacePreferenceReviewFile {
  path: string;
  before: string | null;
  after: string | null;
  /** Saved review intent for atomic publication, not a change to the live bundle. */
  resolution?: 'apply' | 'reject';
}

export interface SpacePreferenceReviewResolution {
  action: 'apply' | 'reject';
  content: string | null;
}

/** Human audit records are not files in the production Skill. */
export interface SpacePreferenceReviewDocument {
  path: 'evidence.md' | 'validation/cases.json' | 'validation/results.md' | 'changes.md';
  content: string;
}

export const SPACE_PREFERENCE_V3_LIMITS = { styles: 4, variantsPerStyle: 2, variants: 6, files: 8, referencesPerStyle: 3 } as const;

export interface SpacePreferenceProductionIndex {
  schemaVersion: 3;
  spaceId: string;
  defaultStyleId: string | null;
  styles: Array<{
    id: string; path: string; name: string; status: 'active' | 'stale';
    variants: Array<{ id: string; name: string }>;
    referenceIds: string[];
    naming: { evidenceId: string; field: 'analysis' | 'tag' | 'description'; value: string };
  }>;
  references: Array<{ evidenceId: string; versionId: string; uses: string[] }>;
}

export function spacePreferenceReviewDocuments(section: SpaceBriefSection | undefined): SpacePreferenceReviewDocument[] {
  const documents = (section?.data as { reviewDocuments?: SpacePreferenceReviewDocument[] } | undefined)?.reviewDocuments;
  if (Array.isArray(documents)) return documents;
  // Legacy audit files remain viewable to people during migration.
  return (spacePreferenceBundle(section)?.files ?? []).filter((file): file is SpacePreferenceReviewDocument =>
    ['evidence.md', 'validation/cases.json', 'validation/results.md'].includes(file.path));
}

/** Lifecycle metadata is not a proposed prose edit. Preserve all other bytes. */
export function normalizePreferenceContent(content: string): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (!frontmatter) return content;
  return frontmatter.replace(/^status: candidate(?=\r?$)/m, 'status: confirmed') + content.slice(frontmatter.length);
}

export function preferenceConfirmedKey(section: SpaceBriefSection): string | null {
  const type = (section.data as { type?: unknown } | null)?.type;
  return section.kind === 'preference-candidate' && typeof type === 'string' && /^[a-z][a-z0-9-]{0,35}$/.test(type)
    ? `confirmed-${type}` : null;
}

export function preferenceSectionFiles(section: SpaceBriefSection | undefined): Array<{ path: string; content: string }> {
  if (!section) return [];
  const bundle = spacePreferenceBundle(section);
  if (bundle) return bundle.files.map(file => ({ ...file, content: normalizePreferenceContent(file.content) }));
  const title = spaceBriefRuleTitle(section, '').replace(/ · 待确认$/, '');
  return [{ path: 'document.md', content: `# ${title}\n\n${spaceBriefMarkdownText(section)}` }];
}

/** One authoritative comparison for file badges, diff rendering and server review. */
export function spacePreferenceReviewFiles(brief: SpaceBrief, key: string): SpacePreferenceReviewFile[] {
  const section = brief.sections[key];
  if (!section) return [];
  const confirmedKey = preferenceConfirmedKey(section);
  const before = preferenceSectionFiles(confirmedKey ? brief.sections[confirmedKey] : section);
  const after = preferenceSectionFiles(section);
  const oldFiles = new Map(before.map(file => [file.path, file.content]));
  const newFiles = new Map(after.map(file => [file.path, file.content]));
  const resolutions = confirmedKey
    ? (section.data as { reviewResolutions?: Record<string, SpacePreferenceReviewResolution> }).reviewResolutions : undefined;
  return [...new Set([...newFiles.keys(), ...oldFiles.keys()])].map(path => {
    const resolution = resolutions?.[path];
    return {
      path, before: oldFiles.get(path) ?? null,
      after: resolution ? resolution.content : newFiles.get(path) ?? null,
      ...(resolution ? { resolution: resolution.action } : {}),
    };
  });
}

/** Compact bundles publish coherently (including their first publication).
 * Legacy same-schema file review retains its existing immediate behavior. */
export function spacePreferenceRequiresAtomicReview(brief: SpaceBrief, key: string): boolean {
  const section = brief.sections[key];
  if (!section) return false;
  const confirmedKey = preferenceConfirmedKey(section);
  if (!confirmedKey) return false;
  const candidate = spacePreferenceBundle(section);
  const confirmed = spacePreferenceBundle(brief.sections[confirmedKey]);
  return Boolean(candidate && (candidate.schemaVersion === 3 || (confirmed && candidate.schemaVersion !== confirmed.schemaVersion)));
}

export interface SpacePreferenceUpdateSummary {
  changeSummary?: Array<{ path: string; reason: string; evidenceIds: string[] }>;
  analysisSummary?: { inspected: number; reused: number; remaining: number };
}

export interface SpacePreferenceCandidate {
  type: string;
  title: string;
  markdown: string;
  evidenceIds: string[];
  bundle?: SpacePreferenceBundle;
  /** Human-facing provenance/testing records, never exported as Skill files. */
  reviewDocuments?: SpacePreferenceReviewDocument[];
  /** With a confirmed bundle, send only changed files against this brief version. */
  bundleChanges?: {
    /** Explicit forward-only format migration; omission retains the baseline. */
    schemaVersion?: 2 | 3;
    baseVersion: number;
    files: Array<{ path: string; content: string | null; reason: string; evidenceIds: string[] }>;
  };
}

/** Workspace-local, inert text files. Never executable or globally installed. */
export interface SpacePreferenceBundle {
  schemaVersion: 1 | 2 | 3;
  spaceId: string;
  files: Array<{ path: string; content: string }>;
}

/** Closed inert-text allowlist shared by submission, review and CLI reads. */
export function isSpacePreferenceBundlePath(path: unknown, schemaVersion: 1 | 2 | 3): path is string {
  if (typeof path !== 'string') return false;
  if (schemaVersion === 3) return /^(SKILL\.md|foundations\.md|recipes\.md|references\/index\.json|styles\/[a-z0-9][a-z0-9-]{0,47}\.md)$/.test(path);
  if (/^(SKILL\.md|visual-rules\.md|evidence\.md|references\/index\.json|styles\/[a-z0-9][a-z0-9-]{0,47}\.md)$/.test(path)) return true;
  return schemaVersion === 2 && /^(system-overview\.md|validation\/(cases\.json|results\.md)|styles\/[a-z0-9][a-z0-9-]{0,47}\/(identity|color|composition|typography|rhythm|rendering|recipes|checks)\.md|styles\/[a-z0-9][a-z0-9-]{0,47}\/decisions\.json)$/.test(path);
}

export interface SpacePreferenceFileRead {
  spaceId: string;
  version: number;
  path: string;
  content: string;
}

/** JSON output for human review, never a production-file read response. */
export interface SpacePreferenceReportRead {
  spaceId: string;
  scope: string;
  version: number;
  key: 'confirmed-image' | 'suggested-image' | CreationPreferenceSectionKey;
  documents: SpacePreferenceReviewDocument[];
}

/** Receipt for an exact personal-library image written to an explicit new file.
 * This proves byte identity, not that an Agent looked at or used the image. */
export interface SpacePreferenceReferenceRead {
  spaceId: string;
  scope: string;
  version: number;
  assetId: string;
  evidenceId: string;
  versionId: string;
  owner: 'local-personal';
  mime: string;
  size: number;
  hash: string;
  path: string;
}

export function spacePreferenceBundle(section: SpaceBriefSection | undefined): SpacePreferenceBundle | null {
  const data = section?.data as { bundle?: SpacePreferenceBundle } | undefined;
  return data?.bundle && [1, 2, 3].includes(data.bundle.schemaVersion) && Array.isArray(data.bundle.files) ? data.bundle : null;
}

export interface SpacePreferenceSubmission {
  snapshotId: string;
  routineRunId?: string;
  /** Explicit user-requested maintenance of an existing bundle, not a routine.
   * Allows unchanged evidence without invalidating or fabricating observations. */
  revisionReason?: string;
  candidates: SpacePreferenceCandidate[];
  /** One visual observation per actually inspected sample, never metadata-only. */
  imageObservations?: Array<{ evidenceId: string; versionId: string; observation: string }>;
  /** Valid observations can add evidence without changing a confirmed rule. */
  noChangeReason?: string;
}

export interface SpacePreferenceEvidence {
  snapshotId: string;
  spaceId: string;
  brief: SpaceBrief;
  sources: Array<{ id: string; kind: 'project' | 'asset'; data: unknown }>;
  limitations: string[];
  unchanged?: boolean;
  incremental?: {
    analysisVersion: string;
    baseVersion: number;
    baseBundle: SpacePreferenceBundle | null;
    pendingReview: boolean;
    /** These exact samples need new image observations; cached samples do not. */
    requiredObservationIds: string[];
    cachedObservations: Array<{ evidenceId: string; versionId: string; observation: string }>;
    changes: Array<{ evidenceId: string; kind: 'added' | 'image' | 'metadata' | 'reanalyze' | 'removed' }>;
    /** Complete eligible inventory IDs, not an expansion of this batch's readable sources. */
    availableEvidenceIds?: string[];
    /** Unprocessed eligible images beyond this bounded batch; never infer deletion. */
    remaining: number;
    protectedFiles: string[];
  };
}

export interface SpaceBriefRule {
  key: string;
  title: string;
  text: string;
  createdAt: number;
}

export function emptySpaceBrief(spaceId: string, scope = 'local'): SpaceBrief {
  return {
    spaceId,
    scope,
    version: 0,
    updatedAt: 0,
    sections: {},
  };
}

export function spaceBriefMarkdownText(section: SpaceBriefSection | undefined): string {
  if (!section) return '';
  if (typeof section.data === 'string') return section.data;
  if (
    section.data
    && typeof section.data === 'object'
    && 'text' in section.data
    && typeof (section.data as { text?: unknown }).text === 'string'
  ) {
    return (section.data as { text: string }).text;
  }
  return '';
}

export function spaceBriefRuleTitle(section: SpaceBriefSection | undefined, key: string): string {
  if (
    section?.data
    && typeof section.data === 'object'
    && 'title' in section.data
    && typeof (section.data as { title?: unknown }).title === 'string'
    && (section.data as { title: string }).title.trim()
  ) {
    return (section.data as { title: string }).title.trim();
  }
  return key;
}

export function spaceBriefCreatedAt(section: SpaceBriefSection | undefined): number {
  if (
    section?.data
    && typeof section.data === 'object'
    && 'createdAt' in section.data
    && typeof (section.data as { createdAt?: unknown }).createdAt === 'number'
  ) {
    return (section.data as { createdAt: number }).createdAt;
  }
  return 0;
}

export function listSpaceBriefRules(brief: SpaceBrief): SpaceBriefRule[] {
  return Object.entries(brief.sections)
    .map(([key, section]) => ({
      key,
      title: spaceBriefRuleTitle(section, key),
      text: spaceBriefMarkdownText(section),
      createdAt: spaceBriefCreatedAt(section),
    }))
    .sort((left, right) => left.createdAt - right.createdAt || left.title.localeCompare(right.title, 'zh'));
}

export function spaceBriefRuleSection(title: string, text: string, createdAt = Date.now()): SpaceBriefSection {
  return { kind: 'markdown', data: { title: title.trim(), text, createdAt } };
}

export function allocateSpaceBriefKey(existing: Iterable<string>, title: string): string {
  const taken = new Set(existing);
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const base = slug && /^[a-z]/.test(slug) ? slug : `rule-${Date.now().toString(36)}`;
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${base}-${index}`;
    if (!taken.has(next)) return next;
  }
  return `rule-${Date.now().toString(36)}`;
}
/** Bounded user-authored workflow evidence; image/Agent output is not preference evidence. */
export interface ImageBehaviorSource {
  id: string;
  projectId: string;
  conversationId: string;
  kind: 'user-message' | 'user-feedback';
  text: string;
  createdAt: number;
  truncated: boolean;
}
export interface ImageBehaviorRule {
  appliesTo: string;
  instruction: string;
  basis: 'explicit' | 'repeated';
  evidence: Array<{ sourceId: string; quote: string }>;
}
export interface ImageBehaviorEvidence {
  preferenceType?: CreationPreferenceType;
  snapshotId: string;
  spaceId: string;
  brief: SpaceBrief;
  sources: ImageBehaviorSource[];
  unchanged: boolean;
  pendingReview: boolean;
  limitations: string[];
}
export interface ImageBehaviorSubmission {
  snapshotId: string;
  routineRunId?: string;
  rules: ImageBehaviorRule[];
  noChangeReason?: string;
}
