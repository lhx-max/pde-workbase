type WorkflowResultCandidate = {
  title: string;
  summary?: string;
  content?: string;
  [key: string]: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function jsonPayload(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(fenced);
  } catch {
    return null;
  }
}

function candidate(value: unknown, index: number): WorkflowResultCandidate | null {
  if (typeof value === 'string' && value.trim()) {
    return { title: `结果 ${index + 1}`, content: value.trim() };
  }
  const source = record(value);
  if (!source) return null;
  const title = typeof source.title === 'string' && source.title.trim()
    ? source.title.trim()
    : `结果 ${index + 1}`;
  return { ...source, title } as WorkflowResultCandidate;
}

/**
 * Confirmation nodes need selectable result items, while ordinary Agent turns
 * keep the full terminal response as one result. Invalid model JSON degrades
 * to a single confirmable result instead of losing the Agent output.
 */
export function workflowAgentOutput(
  content: string,
  fallbackTitle: string,
  expectsCandidates: boolean,
  outputFormat?: 'json' | 'markdown',
): unknown {
  const fallback = { title: fallbackTitle, content };
  if (outputFormat === 'markdown') return fallback;

  const parsed = jsonPayload(content);
  if (outputFormat === 'json' && parsed === null) return content;
  if (!expectsCandidates) return outputFormat === 'json' ? parsed : fallback;
  const source = record(parsed);
  const values = Array.isArray(parsed)
    ? parsed
    : source
      ? ['items', 'results', 'options', 'candidates']
          .map(key => source[key])
          .find(Array.isArray)
      : null;
  if (!Array.isArray(values)) return fallback;
  const candidates = values
    .map((value, index) => candidate(value, index))
    .filter((value): value is WorkflowResultCandidate => Boolean(value));
  return candidates.length > 0 ? candidates : fallback;
}
