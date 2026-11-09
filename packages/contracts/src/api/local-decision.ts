/** Optional local inference. Scores are advisory, never authorization decisions. */
export type LocalDecisionModelId = 'english' | 'multilingual' | 'typed-decisions';

export interface LocalDecisionModelSpec {
  id: LocalDecisionModelId;
  /** Human label, e.g. "Laya Multilingual". */
  label: string;
  huggingFaceUrl: string;
  parameters: string;
  languages: string;
}

export const LOCAL_DECISION_MODELS: readonly LocalDecisionModelSpec[] = [
  { id: 'english', label: 'Laya English', huggingFaceUrl: 'https://huggingface.co/convaiinnovations/laya', parameters: '421M', languages: 'English' },
  { id: 'multilingual', label: 'Laya Multilingual', huggingFaceUrl: 'https://huggingface.co/convaiinnovations/laya-multilingual', parameters: '322M', languages: '100+ languages' },
  { id: 'typed-decisions', label: 'Laya Typed Decisions', huggingFaceUrl: 'https://huggingface.co/convaiinnovations/laya-typed-decisions', parameters: '421M', languages: 'English' },
];

export interface LocalDecisionModelStatus {
  id: LocalDecisionModelId;
  installed: boolean;
  installing: boolean;
  /** Exactly one installed model is active; it is the checkpoint the sidecar loads. */
  active: boolean;
}

export interface LocalDecisionStatus {
  /** True when at least one model is installed. */
  installed: boolean;
  /** Master switch: the sidecar only runs while enabled and an active model is installed. */
  enabled: boolean;
  phase: 'not-installed' | 'installing' | 'stopped' | 'starting' | 'ready' | 'error';
  version: string | null;
  error: string | null;
  stage: string | null;
  /** Latest installer output line (ANSI-stripped, truncated) while installing. */
  progress: string | null;
  /** Seconds since the last installer output (or stage start). Null outside installation.
   * Optional for clients connecting to older daemons; not proof of download activity. */
  progressIdleSeconds?: number | null;
  activeModel: LocalDecisionModelId | null;
  models: LocalDecisionModelStatus[];
}
export type LocalDecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };
export interface LocalDecisionRequest {
  state: string | Record<string, unknown>;
  questions: Record<string, LocalDecisionQuestion>;
}
export interface LocalDecisionResponse {
  available: boolean;
  advisory: true;
  reason?: string;
  answers?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  latency_ms?: number;
}

/** Snapshot at prompt construction; the endpoint checks live state again on every call. */
export function localDecisionCapability(status: LocalDecisionStatus | undefined): string {
  if (!status) return '';
  if (!status.enabled || status.phase !== 'ready') return '## Optional decision assistant\nThe selected decision model is unavailable or disabled. Do not call it, install it, enable it, or switch models automatically. Continue the normal workflow.';
  return '## Optional decision assistant\nThe selected decision model is enabled and ready. You may optionally load the decision-assistant skill and call `bezier decision predict --prompt-file <request.json> --json` for small structured advisory judgments. Use it only when evidence and expected benefit justify a call; it does not replace your reasoning, browser measurements, tests, permissions, or security policy. Never treat scores as authorization or proof of completion. If unavailable, busy or uncertain, continue normally. Do not install, enable, disable, or switch models on the user’s behalf without a request.';
}

/** Bound work before it enters the local model process. No arbitrary model/code paths. */
export function parseLocalDecisionRequest(value: unknown): LocalDecisionRequest {
  const fail = (): never => { throw new Error('Expected state and 1–16 structured questions (noul/choice); maximum 64 KiB.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  if (JSON.stringify(value).length > 64 * 1024) return fail();
  const body = value as Record<string, unknown>;
  const state = body.state;
  if (!(typeof state === 'string' && state.trim()) && !(state && typeof state === 'object' && !Array.isArray(state))) return fail();
  if (!body.questions || typeof body.questions !== 'object' || Array.isArray(body.questions)) return fail();
  const entries = Object.entries(body.questions);
  if (entries.length < 1 || entries.length > 16) return fail();
  for (const [key, raw] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || !raw || typeof raw !== 'object') return fail();
    const q = raw as Record<string, unknown>;
    if (typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 2000) return fail();
    if (q.type === 'noul') continue;
    if (q.type !== 'choice' || !q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) return fail();
    const options = Object.entries(q.criteria);
    if (options.length < 2 || options.length > 20 || options.some(([k, v]) => !k || typeof v !== 'string' || !v.trim() || v.length > 2000)) return fail();
  }
  return { state: state as LocalDecisionRequest['state'], questions: body.questions as LocalDecisionRequest['questions'] };
}
