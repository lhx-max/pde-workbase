// Pure artifact parser extracted unchanged from the upstream plain-stream module.
export interface PlainStreamArtifact {
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
  extension: SupportedArtifactExtension;
  fileName: string;
}
type SupportedArtifactExtension = '.html' | '.css' | '.svg' | '.md';
const OPEN_TAG = '<artifact';
const CLOSE_TAG = '</artifact>';
const MAX_ARTIFACTS_PER_RUN = 50;
const HEADING_RE = /^#{1,4}\s+/;
const UL_ITEM_RE = /^\s*[-*+]\s+/;
const OL_ITEM_RE = /^\s*\d+\.\s+/;
// Mirrors apps/web/src/artifacts/markdown-context.ts so headless plain-stream
// persistence sees the same fence boundaries as the browser artifact parser.
const FENCE_OPEN_RE = /^```(\w[\w+-]*)?\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;

const TYPE_TO_EXTENSION = new Map<string, SupportedArtifactExtension>([
  ['html', '.html'],
  ['text/html', '.html'],
  ['css', '.css'],
  ['text/css', '.css'],
  ['svg', '.svg'],
  ['image/svg+xml', '.svg'],
  ['markdown', '.md'],
  ['md', '.md'],
  ['text/markdown', '.md'],
  ['text/x-markdown', '.md'],
]);

export interface PlainStreamArtifactSpan {
  artifact: PlainStreamArtifact;
  start: number;
  /** Exclusive end of the complete artifact wrapper in the source response. */
  end: number;
}

export function extractPlainStreamArtifacts(stdout: string): PlainStreamArtifact[] {
  return extractPlainStreamArtifactSpans(stdout).map(span => span.artifact);
}

/** Same extraction rules, with source spans for callers that must inspect the remainder. */
export function extractPlainStreamArtifactSpans(stdout: string): PlainStreamArtifactSpan[] {
  if (!stdout.includes(OPEN_TAG)) return [];
  const skipRanges = computeMarkdownSkipRanges(stdout);
  const artifacts: PlainStreamArtifactSpan[] = [];
  let from = 0;

  while (from < stdout.length && artifacts.length < MAX_ARTIFACTS_PER_RUN) {
    const openStart = findNextArtifactOpen(stdout, from, skipRanges);
    if (openStart === -1) break;
    const nextOpenStart = findNextArtifactOpen(stdout, openStart + OPEN_TAG.length, skipRanges);
    const openEnd = findOpenTagEnd(stdout, openStart + OPEN_TAG.length);
    if (openEnd === -1) {
      from = openStart + OPEN_TAG.length;
      continue;
    }
    if (nextOpenStart !== -1 && nextOpenStart < openEnd) {
      from = nextOpenStart;
      continue;
    }
    const closeStart = stdout.indexOf(CLOSE_TAG, openEnd);
    if (closeStart === -1) {
      from = openStart + OPEN_TAG.length;
      continue;
    }
    if (nextOpenStart !== -1 && nextOpenStart < closeStart) {
      from = nextOpenStart;
      continue;
    }

    const attrText = stdout.slice(openStart + OPEN_TAG.length, openEnd - 1);
    const attrs = parseAttrs(attrText);
    const content = stdout.slice(openEnd, closeStart);
    const artifactType = normalizeArtifactType(attrs.type, content);
    const extension = artifactType ? TYPE_TO_EXTENSION.get(artifactType) : undefined;
    if (artifactType && extension) {
      const title = attrs.title ?? '';
      const identifier = attrs.identifier ?? '';
      artifacts.push({
        start: openStart,
        end: closeStart + CLOSE_TAG.length,
        artifact: {
          identifier,
          artifactType,
          title,
          content,
          extension,
          fileName: `${artifactBaseNameFor({ identifier, title })}${extension}`,
        },
      });
    }
    from = closeStart + CLOSE_TAG.length;
  }

  return artifacts;
}

function normalizeArtifactType(rawType: string | undefined, content: string): string | null {
  const normalized = rawType?.trim().toLowerCase();
  if (normalized && TYPE_TO_EXTENSION.has(normalized)) return normalized;
  if (!normalized && looksLikeHtmlDocument(content)) return 'text/html';
  return null;
}

function looksLikeHtmlDocument(content: string): boolean {
  return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(content);
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = re.exec(raw);
  while (match) {
    attrs[match[1] as string] = (match[2] ?? match[3] ?? '') as string;
    match = re.exec(raw);
  }
  return attrs;
}

function findNextArtifactOpen(
  text: string,
  from: number,
  skipRanges: ReadonlyArray<[number, number]>,
): number {
  let current = from;
  while (current < text.length) {
    const idx = text.indexOf(OPEN_TAG, current);
    if (idx === -1) return -1;
    if (!isRealArtifactOpenAt(text, idx) || rangeContains(skipRanges, idx)) {
      current = idx + OPEN_TAG.length;
      continue;
    }
    return idx;
  }
  return -1;
}

function isRealArtifactOpenAt(text: string, idx: number): boolean {
  const next = text.charAt(idx + OPEN_TAG.length);
  return /\s/.test(next);
}

function findOpenTagEnd(text: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i + 1;
  }
  return -1;
}

function computeMarkdownSkipRanges(text: string): Array<[number, number]> {
  const fenceRanges = computeMarkdownFenceRanges(text);
  return [...fenceRanges, ...computeMarkdownInlineCodeRanges(text, fenceRanges)];
}

function computeMarkdownFenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let pos = 0;
  let fenceStart = -1;
  while (pos < text.length) {
    const eol = text.indexOf('\n', pos);
    const lineEnd = eol === -1 ? text.length : eol;
    const line = text.slice(pos, lineEnd);
    const lineHasNewline = eol !== -1;

    if (fenceStart === -1) {
      if (lineHasNewline && FENCE_OPEN_RE.test(line)) {
        fenceStart = pos;
      }
    } else if (lineHasNewline && FENCE_CLOSE_RE.test(line)) {
      ranges.push([fenceStart, eol + 1]);
      fenceStart = -1;
    }

    if (!lineHasNewline) {
      break;
    }
    pos = eol + 1;
  }
  if (fenceStart !== -1) ranges.push([fenceStart, text.length]);
  return ranges;
}

function computeMarkdownInlineCodeRanges(
  text: string,
  fenceRanges: ReadonlyArray<[number, number]>,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const [start, end] of computeMarkdownInlineBlockRanges(text, fenceRanges)) {
    let i = start;
    while (i < end) {
      const idx = text.indexOf('`', i);
      if (idx === -1 || idx >= end) break;
      const tickCount = countBacktickRun(text, idx);
      const close = findMatchingBacktickRun(text, idx + tickCount, tickCount, fenceRanges, end);
      if (close === -1) {
        i = idx + tickCount;
        continue;
      }
      ranges.push([idx, close + tickCount]);
      i = close + tickCount;
    }
  }
  return ranges;
}

function computeMarkdownInlineBlockRanges(
  text: string,
  fenceRanges: ReadonlyArray<[number, number]>,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let pos = 0;
  let blockStart = -1;

  const closeBlockBefore = (idx: number) => {
    if (blockStart !== -1 && idx > blockStart) ranges.push([blockStart, idx]);
    blockStart = -1;
  };

  while (pos < text.length) {
    const fenceRange = rangeContaining(fenceRanges, pos);
    if (fenceRange) {
      closeBlockBefore(pos);
      pos = fenceRange[1];
      continue;
    }

    const eol = text.indexOf('\n', pos);
    const lineEnd = eol === -1 ? text.length : eol;
    const line = text.slice(pos, lineEnd);

    if (line.trim() === '') {
      closeBlockBefore(pos);
    } else if (HEADING_RE.test(line) || UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
      closeBlockBefore(pos);
      ranges.push([pos, lineEnd]);
    } else if (blockStart === -1) {
      blockStart = pos;
    }

    pos = eol === -1 ? text.length : eol + 1;
  }

  closeBlockBefore(text.length);
  return ranges;
}

function countBacktickRun(text: string, from: number): number {
  let count = 0;
  while (text.charAt(from + count) === '`') count += 1;
  return count;
}

function findMatchingBacktickRun(
  text: string,
  from: number,
  tickCount: number,
  fenceRanges: ReadonlyArray<[number, number]>,
  until: number,
): number {
  let i = from;
  while (i < until) {
    const idx = text.indexOf('`', i);
    if (idx === -1 || idx >= until) return -1;
    if (rangeContains(fenceRanges, idx)) {
      i = idx + 1;
      continue;
    }
    const candidateCount = countBacktickRun(text, idx);
    if (candidateCount === tickCount) return idx;
    i = idx + candidateCount;
  }
  return -1;
}

function rangeContaining(
  ranges: ReadonlyArray<[number, number]>,
  idx: number,
): [number, number] | null {
  return ranges.find(([start, end]) => idx >= start && idx < end) ?? null;
}

function rangeContains(ranges: ReadonlyArray<[number, number]>, idx: number): boolean {
  return ranges.some(([start, end]) => idx >= start && idx < end);
}

function artifactBaseNameFor(input: { identifier: string; title: string }): string {
  return (
    (input.identifier || input.title || 'artifact')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'artifact'
  );
}

