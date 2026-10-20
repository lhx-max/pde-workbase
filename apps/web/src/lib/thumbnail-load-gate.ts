// Concurrency budget for home-surface thumbnail iframes.
//
// Why this exists: the project grids (all-projects, drafts, home recents,
// RecentProjectsStrip) render one sandboxed preview iframe per HTML project card. Each
// iframe is a full document load against the local daemon. Profiling a real
// packaged client (evidence/electron-project-waterfall-20260727) showed 52
// thumbnail documents still in flight when the user clicked a project card,
// pushing initial concurrency to 65 and contending with the opened project's
// own metadata/files/preview reads for Chromium, web, daemon and socket
// capacity.
//
// The cover HEAD probes already run through a small queue in
// RecentProjectsStrip; this module budgets the *document loads* themselves:
//
// - `useThumbnailLoadSlot(wanted)` grants at most `THUMBNAIL_LOAD_BUDGET`
//   active load leases across mounted grids. A card asks for a slot near the
//   viewport and calls `settle()` when loaded. The deadline frees stalled leases;
//   legacy consumers keep their document, while disposable asset thumbnails
//   opt into revocation and unmount. This is not a cap on all live iframes.
// - `suspendThumbnailLoads()` revokes every granted-but-still-loading slot
//   (the owning component unmounts its iframe and re-queues) without touching
//   already-settled frames. The app suspends the gate the moment a project
//   route becomes active so background thumbnails never compete with the
//   foreground project open; `resumeThumbnailLoads()` re-drains the queue when
//   the user returns to a home surface.

import { useCallback, useEffect, useReducer, useRef } from 'react';

// Start-of-range budget from the handoff (§4.2 recommends probing 6-8): six
// keeps the classic per-host HTTP/1.1 connection pool from being fully
// occupied by background covers.
export const THUMBNAIL_LOAD_BUDGET = 6;

// A hung document must not keep a shared load slot forever.
export const THUMBNAIL_LOAD_TIMEOUT_MS = 15_000;

// How far outside the viewport a card may be and still start loading. Small
// on purpose: one row of overscan, not the whole grid.
export const THUMBNAIL_OVERSCAN_MARGIN = '160px';

type SlotPhase = 'idle' | 'queued' | 'granted' | 'settled' | 'timedOut';

interface ThumbnailLoadSlot {
  phase: SlotPhase;
  foreground: boolean;
  timeoutMode: 'settle' | 'revoke';
  notify: () => void;
  watchdog: ReturnType<typeof setTimeout> | null;
  grantVersion: number;
}

let loadingCount = 0;
let suspended = false;
const queue: ThumbnailLoadSlot[] = [];
const slots = new Set<ThumbnailLoadSlot>();

/** Invalidate the lease even if its timer callback has already been dispatched. */
function clearWatchdog(slot: ThumbnailLoadSlot): void {
  slot.grantVersion += 1;
  if (slot.watchdog !== null) clearTimeout(slot.watchdog);
  slot.watchdog = null;
}

/** Only granted leases own deadlines; revocation is opt-in for disposable previews. */
function startWatchdog(slot: ThumbnailLoadSlot): void {
  const version = ++slot.grantVersion;
  slot.watchdog = setTimeout(() => {
    if (slot.phase !== 'granted' || slot.grantVersion !== version) return;
    clearWatchdog(slot);
    slot.phase = slot.timeoutMode === 'revoke' ? 'timedOut' : 'settled';
    loadingCount -= 1;
    // Legacy detail views keep their content; disposable thumbnails revoke it.
    slot.notify();
    drain();
  }, THUMBNAIL_LOAD_TIMEOUT_MS);
}

function drain(): void {
  while (loadingCount < THUMBNAIL_LOAD_BUDGET && queue.length > 0) {
    const index = suspended ? queue.findIndex(slot => slot.foreground) : 0;
    if (index < 0) break;
    const [slot] = queue.splice(index, 1);
    if (!slot) break;
    if (slot.phase !== 'queued') continue;
    slot.phase = 'granted';
    loadingCount += 1;
    startWatchdog(slot);
    slot.notify();
  }
}

function removeFromQueue(slot: ThumbnailLoadSlot): void {
  const index = queue.indexOf(slot);
  if (index >= 0) queue.splice(index, 1);
}

function requestSlot(slot: ThumbnailLoadSlot): void {
  if (slot.phase !== 'idle') return;
  slot.phase = 'queued';
  queue.push(slot);
  drain();
}

function releaseSlot(slot: ThumbnailLoadSlot): void {
  if (slot.phase === 'granted') {
    clearWatchdog(slot);
    slot.phase = 'idle';
    loadingCount -= 1;
    drain();
    return;
  }
  if (slot.phase === 'queued') {
    removeFromQueue(slot);
    slot.phase = 'idle';
  }
}

function settleSlot(slot: ThumbnailLoadSlot): void {
  if (slot.phase !== 'granted') return;
  clearWatchdog(slot);
  slot.phase = 'settled';
  loadingCount -= 1;
  drain();
}

function disposeSlot(slot: ThumbnailLoadSlot): void {
  releaseSlot(slot);
  slots.delete(slot);
}

/**
 * Stop granting thumbnail load slots and revoke every granted slot that has
 * not settled yet. Owning components re-render with `canLoad === false`,
 * unmount their still-loading iframes, and wait in the queue. Already-loaded
 * (settled) frames are left alone.
 */
export function suspendThumbnailLoads(): void {
  if (suspended) return;
  suspended = true;
  for (const slot of slots) {
    if (slot.phase !== 'granted' || slot.foreground) continue;
    clearWatchdog(slot);
    slot.phase = 'queued';
    loadingCount -= 1;
    queue.unshift(slot);
    slot.notify();
  }
}

/** Resume granting slots after `suspendThumbnailLoads()`. */
export function resumeThumbnailLoads(): void {
  if (!suspended) return;
  suspended = false;
  drain();
}

export function thumbnailLoadsSuspended(): boolean {
  return suspended;
}

/**
 * Reserve one of the shared thumbnail load slots.
 *
 * `wanted` should become true when the card is near the viewport and its
 * cover is ready to render. While the gate is saturated (or suspended) the
 * hook returns `canLoad === false`; the component keeps its lightweight
 * placeholder mounted. Call `settle()` from the iframe's load/error handler —
 * a settled slot stays renderable for the component's lifetime and no longer
 * counts against the budget. Set `retainSettled` to false for previews that
 * unmount offscreen, so waking their iframe must reserve a fresh load slot.
 *
 * A grant that does not settle within `THUMBNAIL_LOAD_TIMEOUT_MS` releases its
 * budget. The default `timeoutMode: 'settle'` keeps `canLoad === true` so legacy
 * detail views never lose interactive content just because loading is slow.
 * Disposable thumbnails should opt into `'revoke'`: timeout then becomes
 * terminal (`timedOut === true`, `canLoad === false`) and the consumer must
 * unmount the iframe and show a fallback. Changing `wanted` does not retry a
 * revoked load; remount the keyed consumer to retry. Queued time does not count
 * toward the granted-phase deadline.
 */
export function useThumbnailLoadSlot(
  wanted: boolean,
  foreground = false,
  retainSettled = true,
  timeoutMode: 'settle' | 'revoke' = 'settle',
): {
  canLoad: boolean;
  timedOut: boolean;
  settle: () => void;
} {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const slotRef = useRef<ThumbnailLoadSlot | null>(null);
  if (slotRef.current === null) {
    slotRef.current = { phase: 'idle', foreground, timeoutMode, notify: () => force(), watchdog: null, grantVersion: 0 };
  }
  const slot = slotRef.current;

  useEffect(() => {
    slot.foreground = foreground;
    slot.timeoutMode = timeoutMode;
    slots.add(slot);
    if (wanted) {
      requestSlot(slot);
      // `requestSlot` may grant synchronously; the render that scheduled this
      // effect predates the grant, so reflect it.
      force();
    } else if (slot.phase !== 'settled' || !retainSettled) {
      releaseSlot(slot);
      if (slot.phase === 'settled') slot.phase = 'idle';
      force();
    }
  }, [wanted, slot, foreground, retainSettled, timeoutMode]);

  useEffect(() => () => disposeSlot(slot), [slot]);

  const settle = useCallback(() => {
    settleSlot(slot);
  }, [slot]);

  return {
    canLoad: slot.phase === 'granted' || slot.phase === 'settled',
    timedOut: slot.phase === 'timedOut',
    settle,
  };
}

/** Test-only: drop gate state after consumers have unmounted. */
export function resetThumbnailLoadGateForTests(): void {
  for (const slot of slots) clearWatchdog(slot);
  loadingCount = 0;
  suspended = false;
  queue.length = 0;
  slots.clear();
}
