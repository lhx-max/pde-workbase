import { validateRewriteLines } from './rewrite';

function stamp(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
    + ',' + String(ms % 1000).padStart(3, '0');
}

export function makeSubtitles(rows: unknown, durationMs: number): string {
  const lines = validateRewriteLines(rows, durationMs);
  return lines.map((line, index) => `${index + 1}\n${stamp(line.videoStartMs)} --> ${stamp(line.videoEndMs)}\n${line.text.replace(/[\r\n]+/gu, ' ')}\n`).join('\n');
}
