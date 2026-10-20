export type BrowserCaptureRecord = {
  id: string;
  at: number;
  kind: 'selection' | 'image';
  title: string;
  sourceUrl?: string;
  ok: boolean;
  message: string;
};

const RECORD_LIMIT = 20;

export function upsertCaptureRecord(
  records: BrowserCaptureRecord[],
  next: BrowserCaptureRecord,
  limit = RECORD_LIMIT,
): BrowserCaptureRecord[] {
  return [next, ...records.filter((record) => record.id !== next.id)].slice(0, limit);
}
