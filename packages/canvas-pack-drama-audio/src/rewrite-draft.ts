import { DEFAULT_REWRITE_PROMPT, rewriteDocOf, validateRewriteInput, validateRewriteLines, type RewriteLine, type VideoRewriteInput } from './rewrite';

type Data = Record<string, unknown>;

export function currentRewriteInput(data: Data): VideoRewriteInput {
  return validateRewriteInput({
    script: data.script ?? null,
    prompt: data.rewritePrompt ?? DEFAULT_REWRITE_PROMPT,
    videoRef: data.videoRef,
    videoDurationMs: data.videoDurationMs,
  });
}

export function sameRewriteInput(input: VideoRewriteInput, current: VideoRewriteInput) {
  return input.script === current.script && input.prompt === current.prompt
    && input.videoRef === current.videoRef && input.videoDurationMs === current.videoDurationMs;
}

export function availableRewriteDraft(data: Data): RewriteLine[] | null {
  const draft = data.rewriteDraft as { input?: Data; lines?: unknown } | null | undefined;
  if (!draft?.input) return null;
  try {
    const current = currentRewriteInput(data);
    if (!sameRewriteInput(validateRewriteInput(draft.input), current)) return null;
    return validateRewriteLines(draft.lines, current.videoDurationMs);
  } catch { return null; }
}

export function adoptRewriteDraft(data: Data): Data {
  const rows = availableRewriteDraft(data);
  if (!rows) throw new Error('改写建议已失效或不存在，请重新生成。');
  return {
    script: rewriteDocOf(rows), rewriteLines: rows, rewriteDraft: null,
    segments: [], audioRef: null, durationMs: 0, confirmedLineIds: [],
    generatedLineTexts: {}, generatedLineVoices: {}, lineVoiceInstructions: {}, lineGains: {},
  };
}
