import { equal } from './merge.js';
import type { StoredCanvasOperation } from './operations.js';

type RecordItem = Record<string, unknown> & { id: string };

function isItem(value: unknown): value is RecordItem {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string';
}

/** Keep id plus fields that actually differ. Unchanged cards stay as `{id}` so undo can still find them. */
function slimList(before: unknown[], after: unknown[], side: 'before' | 'after'): unknown[] {
  const other = new Map((side === 'before' ? after : before).filter(isItem).map(item => [item.id, item]));
  return (side === 'before' ? before : after).map(item => {
    if (!isItem(item)) return item;
    const counterpart = other.get(item.id);
    if (!counterpart) return item;
    const slim: Record<string, unknown> = { id: item.id };
    for (const key of Object.keys(item)) {
      if (key !== 'id' && !equal(item[key], counterpart[key])) slim[key] = item[key];
    }
    return slim;
  });
}

function slimPair(before: unknown, after: unknown): { before: unknown; after: unknown } | null {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  if (![...before, ...after].every(item => item == null || isItem(item))) return null;
  return { before: slimList(before, after, 'before'), after: slimList(before, after, 'after') };
}

/** Drop fields an operation did not change. Replay only needs the fingerprint and receipt. */
export function compactOperationDelta(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const nextBefore: Record<string, unknown> = {};
  const nextAfter: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[key], after[key])) continue;
    const slim = slimPair(before[key], after[key]);
    if (slim) {
      nextBefore[key] = slim.before;
      nextAfter[key] = slim.after;
    } else {
      if (before[key] !== undefined) nextBefore[key] = before[key];
      if (after[key] !== undefined) nextAfter[key] = after[key];
    }
  }
  return { before: nextBefore, after: nextAfter };
}

export function compactOperationJournal(journal: Record<string, StoredCanvasOperation>): Record<string, StoredCanvasOperation> {
  return Object.fromEntries(Object.entries(journal).map(([id, entry]) => {
    const delta = compactOperationDelta(entry.before ?? {}, entry.after ?? {});
    return [id, { ...entry, before: delta.before, after: delta.after }];
  }));
}
