'use client';

import React from 'react';
import type { CanvasOperationReceipt } from '@bezier/contracts';
import { Button } from '@bezier/components';
import { CanvasHistory } from './canvas-history';
import { canvasOperationBatch, rebaseCanvasDraft } from './canvas-operation-batch';
import { registerCanvasPersistence } from './canvas-persistence';
import { CanvasIdleWorkContext, createCanvasIdleWork } from './canvas-idle-work';
import { cr } from '../locales/canvas-remainder';
import {
  apiErrorMessage,
  canvasFetchForContext,
  projectFetchWithContext,
  type CanvasHostContext,
} from './api-base';

type CanvasState = Record<string, unknown>;
type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

type CanvasContextValue = {
  requestContext: CanvasHostContext;
  history: { run: <T>(action: () => T) => T; undo: () => void; redo: () => void };
  getState: () => CanvasState;
  subscribe: (key: string, listener: () => void) => () => void;
  setValue: <T>(key: string, value: React.SetStateAction<T>, defaultValue: T) => void;
  setInteractionActive: (active: boolean) => void;
  isInteractionActive: () => boolean;
  flush: (keys?: readonly string[]) => Promise<void>;
};

type PendingCanvasChange = {
  value: unknown;
  baseValue: unknown;
  version: number;
};

const CANVAS_DRAFT_CHECKPOINT_MS = 250;
const CANVAS_REVISION_POLL_MS = 1_500;
const CANVAS_REVISION_MAX_RETRY_MS = 30_000;

const CanvasContext = React.createContext<CanvasContextValue | null>(null);

async function request<T>(context: CanvasHostContext, url: string, init?: RequestInit): Promise<T> {
  const response = url === '/api/canvas/operations'
    ? await projectFetchWithContext(context, '/canvas/operations', init)
    : await canvasFetchForContext(context, url, init);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(apiErrorMessage(payload.error, cr().requestFailedStatus(response.status))), { status: response.status });
  }
  return payload;
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function sameValue(previous: unknown, next: unknown): boolean {
  return Object.is(previous, next) || stableStringify(previous) === stableStringify(next);
}

function shareUnchangedFields(previous: CanvasState, next: CanvasState): CanvasState {
  let changed = Object.keys(previous).length !== Object.keys(next).length;
  for (const key of Object.keys(next)) {
    if (Object.prototype.hasOwnProperty.call(previous, key) && sameValue(previous[key], next[key])) next[key] = previous[key];
    else changed = true;
  }
  return changed ? next : previous;
}

export function CanvasCompatProvider({ children, hydrateBusinessState, onInteractionActiveChange, requestContext }: React.PropsWithChildren<{
  hydrateBusinessState?: (state: CanvasState) => Promise<CanvasState>;
  onInteractionActiveChange?: (active: boolean) => void;
  requestContext: CanvasHostContext;
}>) {
  const [state, setState] = React.useState<CanvasState>({});
  const idleWork = React.useMemo(createCanvasIdleWork, []);
  const listeners = React.useRef(new Map<string, Set<() => void>>());
  const published = React.useRef(state);
  React.useLayoutEffect(() => {
    const previous = published.current;
    published.current = state;
    for (const [key, subscribers] of listeners.current) {
      if (!Object.is(previous[key], state[key])) subscribers.forEach(notify => notify());
    }
  }, [state]);
  React.useEffect(() => () => idleWork.clear(), [idleWork]);
  const historyRef = React.useRef(new CanvasHistory());
  const transactionDepthRef = React.useRef(0);
  const historyScope = stableStringify(requestContext);
  React.useEffect(() => { historyRef.current.clear(); }, [historyScope]);
  const [hydrated, setHydrated] = React.useState(false);
  const [persistenceReady, setPersistenceReady] = React.useState(false);
  const stateRef = React.useRef(state);
  const hydrateBusinessStateRef = React.useRef(hydrateBusinessState);
  const revisionRef = React.useRef(0);
  const mutationVersionRef = React.useRef(0);
  const dirtyVersionsRef = React.useRef(new Map<string, number>());
  const savedVersionsRef = React.useRef(new Map<string, number>());
  const saveErrorRef = React.useRef<unknown>(undefined);
  const [saveConflict, setSaveConflict] = React.useState<string | null>(null);
  const blockedRef = React.useRef(false);
  const recoveredDraftRef = React.useRef<CanvasState | null>(null);
  const retryRequestRef = React.useRef<{ batch: Map<string, PendingCanvasChange>; body: string; route: string } | null>(null);
  const draftCheckpointTimerRef = React.useRef<number | undefined>(undefined);
  const draftKey = `canvas-unsaved:${requestContext.projectId}`;
  // A transport switch should not rehydrate or clear a different project's
  // pending queue; the provider owns one project for its entire lifetime.
  const ownerProjectRef = React.useRef(requestContext.projectId);
  if (ownerProjectRef.current !== requestContext.projectId) throw new Error('Canvas provider must remount when the project changes');
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { state?: CanvasState; request?: unknown };
        if (draft.state && typeof draft.state === 'object' && !Array.isArray(draft.state)) recoveredDraftRef.current = draft.state;
        const stored = draft.request;
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
          // Replay the persisted request once before locking — canvas ops are
          // idempotent on operationId, so a re-submit is safe; if it lands,
          // the draft is cleared and saves stay unblocked. Only a real failure
          // (conflict, unreachable) falls back to the manual export/discard UI.
          const isOps = Array.isArray((stored as { operations?: unknown }).operations);
          void request<{ state?: CanvasState; revision?: number }>(requestContext, isOps ? '/api/canvas/operations' : '/api/canvas/state', {
            method: isOps ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stored),
          }).then(payload => {
            if (payload?.state && typeof payload.revision === 'number') {
              revisionRef.current = Math.max(revisionRef.current, payload.revision);
              stateRef.current = payload.state;
              setState(payload.state);
            }
            try { localStorage.removeItem(draftKey); } catch { /* Storage unavailable. */ }
          }).catch(() => {
            blockedRef.current = true;
            setSaveConflict('Recovered an unsaved canvas draft. Export it before discarding or reloading.');
          });
          return;
        }
        blockedRef.current = true;
        setSaveConflict('Recovered an unsaved canvas draft. Export it before discarding or reloading.');
      }
    } catch { /* Storage unavailable: retain in-memory edits. */ }
  }, [draftKey]);
  const pendingChangesRef = React.useRef(new Map<string, PendingCanvasChange>());
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const saveInFlightRef = React.useRef(false);
  const flushScheduledRef = React.useRef(false);
  const retryTimerRef = React.useRef<number | undefined>(undefined);
  const initialLoadSettledRef = React.useRef(false);
  const interactionActiveRef = React.useRef(false);
  const refreshRevisionNowRef = React.useRef<(() => void) | null>(null);
  const cancelRefreshRef = React.useRef<(() => void) | undefined>(undefined);
  stateRef.current = state;
  hydrateBusinessStateRef.current = hydrateBusinessState;

  const checkpointDraft = React.useCallback(() => {
    if (draftCheckpointTimerRef.current !== undefined) window.clearTimeout(draftCheckpointTimerRef.current);
    draftCheckpointTimerRef.current = undefined;
    if (!dirtyVersionsRef.current.size && !retryRequestRef.current && !blockedRef.current) return;
    try {
      const request = retryRequestRef.current ? JSON.parse(retryRequestRef.current.body) as unknown : undefined;
      localStorage.setItem(draftKey, JSON.stringify({ state: stateRef.current, ...(request === undefined ? {} : { request }) }));
    } catch { /* Keep in memory. */ }
  }, [draftKey]);
  const scheduleDraftCheckpoint = React.useCallback(() => {
    if (draftCheckpointTimerRef.current !== undefined) return;
    draftCheckpointTimerRef.current = window.setTimeout(checkpointDraft, CANVAS_DRAFT_CHECKPOINT_MS);
  }, [checkpointDraft]);

  const setInteractionActive = React.useCallback((active: boolean) => {
    const wasActive = interactionActiveRef.current;
    interactionActiveRef.current = active;
    idleWork.setActive(active);
    if (wasActive !== active) onInteractionActiveChange?.(active);
    if (wasActive && !active && document.visibilityState === 'visible') {
      cancelRefreshRef.current?.();
      cancelRefreshRef.current = idleWork.schedule(() => refreshRevisionNowRef.current?.(), 600);
    }
  }, [onInteractionActiveChange, idleWork]);
  const isInteractionActive = React.useCallback(() => interactionActiveRef.current, []);

  React.useEffect(() => {
    let alive = true;
    let loading = false;
    let revisionPollTimer: number | undefined;
    let revisionPollFailures = 0;
    const loadState = async () => {
      if (loading) return;
      loading = true;
      try {
        const payload = await request<{ ok: true; state: CanvasState; revision: number }>(requestContext, '/api/canvas/state');
        if (alive) {
          if (payload.revision < revisionRef.current) return;
          const remoteState = payload.state || {};
          const nextState = { ...remoteState };
          if (recoveredDraftRef.current) Object.assign(nextState, recoveredDraftRef.current);
          const overlayDirtyState = () => {
            for (const key of dirtyVersionsRef.current.keys()) {
              if (Object.prototype.hasOwnProperty.call(stateRef.current, key)) {
                nextState[key] = stateRef.current[key];
              }
            }
          };
          overlayDirtyState();

          if (hydrateBusinessStateRef.current) {
            const projected = await hydrateBusinessStateRef.current(nextState);
            if (!alive) return;
            Object.assign(nextState, projected);
            if (recoveredDraftRef.current) Object.assign(nextState, recoveredDraftRef.current);
            // Hydration is asynchronous. Text may have changed while it was
            // running, so local dirty values must win a second time here.
            overlayDirtyState();
          }

          setPersistenceReady(true);
          revisionRef.current = Math.max(revisionRef.current, payload.revision);
          const sharedState = shareUnchangedFields(stateRef.current, nextState);
          if (sharedState !== stateRef.current) {
            stateRef.current = sharedState;
            setState(sharedState);
          }
        }
      } catch (error) {
        if (alive) console.error(cr().compatLoadFail, error);
      } finally {
        loading = false;
        if (alive && !initialLoadSettledRef.current) {
          initialLoadSettledRef.current = true;
          setHydrated(true);
        }
      }
    };
    const pollRevision = async (): Promise<boolean> => {
      if (document.visibilityState !== 'visible' || interactionActiveRef.current) return true;
      if (loading) return true;
      try {
        const payload = await request<{ ok: true; revision: number }>(requestContext, '/api/canvas/revision');
        if (alive && payload.revision !== revisionRef.current) {
          await loadState();
        }
        return true;
      } catch (error) {
        if (alive) {
          if (revisionPollFailures === 0) {
            console.error(cr().compatCheckFail, error);
          }
        }
        return false;
      }
    };
    const scheduleRevisionPoll = (delay: number) => {
      revisionPollTimer = window.setTimeout(async () => {
        const succeeded = await pollRevision();
        if (!alive) return;
        revisionPollFailures = succeeded ? 0 : revisionPollFailures + 1;
        const nextDelay = succeeded
          ? CANVAS_REVISION_POLL_MS
          : Math.min(
              CANVAS_REVISION_POLL_MS * (2 ** revisionPollFailures),
              CANVAS_REVISION_MAX_RETRY_MS,
            );
        scheduleRevisionPoll(nextDelay);
      }, delay);
    };
    const refreshRevisionNow = () => {
      void pollRevision();
    };
    refreshRevisionNowRef.current = refreshRevisionNow;
    const onDeliveryChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === requestContext.projectId) refreshRevisionNow();
    };
    window.addEventListener('bezier:canvas-text-delivery-changed', onDeliveryChanged);
    void loadState();
    scheduleRevisionPoll(CANVAS_REVISION_POLL_MS);
    return () => {
      alive = false;
      window.removeEventListener('bezier:canvas-text-delivery-changed', onDeliveryChanged);
      if (refreshRevisionNowRef.current === refreshRevisionNow) {
        refreshRevisionNowRef.current = null;
      }
      if (revisionPollTimer !== undefined) window.clearTimeout(revisionPollTimer);
    };
  }, [requestContext]);

  const flushChanges = React.useCallback(() => {
    flushScheduledRef.current = false;
    if (retryTimerRef.current !== undefined) return saveQueueRef.current;
    if (saveInFlightRef.current) return saveQueueRef.current;
    if (blockedRef.current) return saveQueueRef.current;
    if (!pendingChangesRef.current.size && !retryRequestRef.current) return saveQueueRef.current;
    saveInFlightRef.current = true;
    const batch = retryRequestRef.current?.batch ?? new Map(pendingChangesRef.current);
    if (!retryRequestRef.current) pendingChangesRef.current.clear();
    const changes = Object.fromEntries(Array.from(batch, ([key, entry]) => [key, entry.value]));
    const base = Object.fromEntries(Array.from(batch, ([key, entry]) => [key, entry.baseValue]));
    const expectedRevision = revisionRef.current;
    const operations = canvasOperationBatch(base, changes, stateRef.current);
    const route = retryRequestRef.current?.route ?? (operations ? '/api/canvas/operations' : '/api/canvas/state');
    const requestBody = retryRequestRef.current?.body ?? JSON.stringify(operations
      ? { operationId: crypto.randomUUID(), baseRevision: expectedRevision, operations, expectedState: base }
      : { changes, base, expectedRevision });
    retryRequestRef.current = { batch, body: requestBody, route };
    saveQueueRef.current = Promise.resolve()
      .then(async () => {
        try {
          const payload = await request<{ ok: true; state?: CanvasState; revision: number; receipt?: CanvasOperationReceipt; replayed?: boolean }>(requestContext, route, {
            method: route.endsWith('/operations') ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
            // Small pending mutations should survive a direct refresh. Large
            // canvas snapshots exceed the browser keepalive quota and stay on
            // the normal retry path instead of failing synchronously.
            ...(requestBody.length <= 60_000 ? { keepalive: true } : {}),
          });
          if (route.endsWith('/operations') &&
            (payload.receipt?.operationId !== (JSON.parse(requestBody) as { operationId: string }).operationId ||
              payload.receipt.revision !== payload.revision)) {
            throw new Error('Canvas operation receipt does not match the pending request');
          }
          // Validate all rebases before acknowledging any key: a conflict must
          // never leave a partially advanced queue or a regenerated operation id.
          const rebased = new Map<string, { pending: PendingCanvasChange; value: unknown }>();
          for (const [key, entry] of batch) {
            const pending = pendingChangesRef.current.get(key);
            if (pending && payload.state) rebased.set(key, {
              pending, value: rebaseCanvasDraft(entry.value, pending.value, payload.state[key]),
            });
          }
          retryRequestRef.current = null;
          saveErrorRef.current = undefined;
          setSaveConflict(null);
          revisionRef.current = Math.max(revisionRef.current, payload.revision);
          for (const [key, entry] of batch) {
            savedVersionsRef.current.set(key, entry.version);
            const nextPending = rebased.get(key);
            if (nextPending && payload.state) {
              pendingChangesRef.current.set(key, { ...nextPending.pending, value: nextPending.value, baseValue: payload.state[key] });
              stateRef.current = { ...stateRef.current, [key]: nextPending.value };
            }
            if (dirtyVersionsRef.current.get(key) === entry.version) {
              dirtyVersionsRef.current.delete(key);
            }
          }
          if (payload.state) {
            const nextState = { ...payload.state };
            for (const key of dirtyVersionsRef.current.keys()) {
              if (Object.prototype.hasOwnProperty.call(stateRef.current, key)) {
                nextState[key] = stateRef.current[key];
              }
            }
            const sharedState = shareUnchangedFields(stateRef.current, nextState);
            if (sharedState !== stateRef.current) {
              stateRef.current = sharedState;
              setState(sharedState);
            }
          }
          if (!dirtyVersionsRef.current.size) {
            if (draftCheckpointTimerRef.current !== undefined) window.clearTimeout(draftCheckpointTimerRef.current);
            draftCheckpointTimerRef.current = undefined;
            try { localStorage.removeItem(draftKey); } catch { /* Storage unavailable. */ }
          } else scheduleDraftCheckpoint();
        } catch (error) {
          saveErrorRef.current = error;
          try { localStorage.setItem(draftKey, JSON.stringify({ state: stateRef.current, request: JSON.parse(requestBody) })); } catch { /* Keep in memory. */ }
          setSaveConflict(error instanceof Error ? error.message : cr().compatSaveFail);
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500 && status !== 429) blockedRef.current = true;
          console.error(cr().compatSaveFail, error);
          if (!blockedRef.current && retryTimerRef.current === undefined) {
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = undefined;
              void flushChanges();
            }, 1500);
          }
        }
      })
      .finally(() => {
        saveInFlightRef.current = false;
        if (!blockedRef.current && pendingChangesRef.current.size && retryTimerRef.current === undefined) queueMicrotask(() => void flushChanges());
      });
    return saveQueueRef.current;
  }, [requestContext, draftKey, scheduleDraftCheckpoint]);

  const scheduleFlush = React.useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => void flushChanges());
  }, [flushChanges]);

  React.useEffect(() => {
    const flushNow = () => {
      checkpointDraft();
      if (retryTimerRef.current !== undefined) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
      void flushChanges();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        flushNow();
      } else {
        refreshRevisionNowRef.current?.();
      }
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      flushNow();
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushChanges, checkpointDraft]);

  const setValue = React.useCallback(<T,>(
    key: string,
    nextValue: React.SetStateAction<T>,
    defaultValue: T,
  ) => {
    const previous = (Object.prototype.hasOwnProperty.call(stateRef.current, key)
      ? stateRef.current[key]
      : defaultValue) as T;
    const resolved = typeof nextValue === 'function'
      ? (nextValue as (value: T) => T)(previous)
      : nextValue;
    if (sameValue(previous, resolved)) return;
    const nextState = { ...stateRef.current, [key]: resolved };
    const mutationVersion = ++mutationVersionRef.current;
    const pending = pendingChangesRef.current.get(key);
    dirtyVersionsRef.current.set(key, mutationVersion);
    pendingChangesRef.current.set(key, {
      value: resolved,
      baseValue: pending ? pending.baseValue : previous,
      version: mutationVersion,
    });
    stateRef.current = nextState;
    setState(nextState);
    if (blockedRef.current) checkpointDraft();
    else scheduleDraftCheckpoint();
    scheduleFlush();
  }, [scheduleFlush, checkpointDraft, scheduleDraftCheckpoint]);

  const run = React.useCallback(<T,>(action: () => T): T => {
    const before = stateRef.current;
    const outer = transactionDepthRef.current++ === 0;
    try { return action(); }
    finally {
      transactionDepthRef.current -= 1;
      if (outer) historyRef.current.record(before, stateRef.current);
    }
  }, []);
  const stepHistory = React.useCallback((redo: boolean) => {
    const current = stateRef.current;
    const next = historyRef.current.step(current, redo);
    for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
      if (!sameValue(current[key], next[key])) setValue(key, next[key], current[key]);
    }
  }, [setValue]);
  const history = React.useMemo(() => ({ run, undo: () => stepHistory(false), redo: () => stepHistory(true) }), [run, stepHistory]);
  const flush = React.useCallback(async (keys?: readonly string[]) => {
    // A submission waits for its captured mutation, not for the whole canvas
    // to become idle. Layout/drag updates may continue while this save runs.
    const target = [...dirtyVersionsRef.current].filter(([key]) => !keys || keys.includes(key));
    // Explicit submit/navigation is allowed to retry immediately.
    if (retryTimerRef.current !== undefined) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = undefined;
    if (blockedRef.current) throw saveErrorRef.current ?? new Error('Recovered canvas draft must be exported or discarded before saving');
    saveErrorRef.current = undefined;
    while (target.some(([key, version]) => (savedVersionsRef.current.get(key) ?? 0) < version)) {
      await flushChanges();
      if (saveErrorRef.current) throw saveErrorRef.current;
    }
  }, [flushChanges]);

  const getState = React.useCallback(() => stateRef.current, []);
  React.useLayoutEffect(() => {
    if (!persistenceReady) return;
    return registerCanvasPersistence(requestContext.projectId, {
      read: getState, mutationVersion: () => mutationVersionRef.current, flush,
    });
  }, [requestContext, persistenceReady, getState, flush]);
  const subscribe = React.useCallback((key: string, listener: () => void) => {
    let subscribers = listeners.current.get(key);
    if (!subscribers) { subscribers = new Set(); listeners.current.set(key, subscribers); }
    subscribers.add(listener);
    return () => { subscribers.delete(listener); if (!subscribers.size) listeners.current.delete(key); };
  }, []);
  const contextValue = React.useMemo(() => ({ requestContext, getState, subscribe, setValue, setInteractionActive, isInteractionActive, history, flush }),
    [requestContext, getState, subscribe, setValue, setInteractionActive, isInteractionActive, history, flush]);

  return (
    <CanvasIdleWorkContext.Provider value={idleWork}><CanvasContext.Provider value={contextValue}>
      {/*
        Mounting state consumers against the temporary empty object lets their
        default-seeding effects become dirty local writes before the first GET
        resolves. Those writes can then overwrite persisted card positions.
      */}
      {saveConflict ? <div role="alert" style={{ padding: 12, background: '#471d1d', color: '#fff' }}>
        <span>{cr().compatSaveFail}: {saveConflict}</span>{' '}
        <Button onClick={() => {
          const content = localStorage.getItem(draftKey) || JSON.stringify({ state: stateRef.current }, null, 2);
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = 'canvas-unsaved-draft.json'; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export draft</Button>{' '}
        <Button onClick={() => { localStorage.removeItem(draftKey); window.location.reload(); }}>Discard draft</Button>
      </div> : null}
      {hydrated ? children : null}
    </CanvasContext.Provider></CanvasIdleWorkContext.Provider>
  );
}

export function useCanvasState<T>(key: string, defaultValue: T): [T, SetState<T>] {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error(cr().mustUseProvider('useCanvasState'));
  const defaultValueRef = React.useRef(defaultValue);
  if (!sameValue(defaultValueRef.current, defaultValue)) defaultValueRef.current = defaultValue;
  const subscribe = React.useCallback((notify: () => void) => context.subscribe(key, notify), [context.subscribe, key]);
  const getSnapshot = React.useCallback(() => {
    const state = context.getState();
    return Object.prototype.hasOwnProperty.call(state, key) ? state[key] as T : defaultValueRef.current;
  }, [context.getState, key]);
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setter = React.useCallback<SetState<T>>(
    next => {
      if (typeof next === 'function') {
        const updater = next as (value: T) => T;
        context.setValue<T>(
          key,
          (prev: T) => updater(prev === undefined ? defaultValueRef.current : prev),
          defaultValueRef.current,
        );
      } else {
        context.setValue<T>(key, next, defaultValueRef.current);
      }
    },
    [context.setValue, key],
  );
  return [value, setter];
}

export function useCanvasHistory() {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error('useCanvasHistory requires CanvasCompatProvider');
  return context.history;
}

export function useCanvasFlush() {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error('useCanvasFlush requires CanvasCompatProvider');
  return context.flush;
}

/** Synchronous snapshot for an action that has just persisted a new node. */
export function useCanvasSnapshot() {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error('useCanvasSnapshot requires CanvasCompatProvider');
  return context.getState;
}

export function useCanvasRequestContext() {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error('useCanvasRequestContext requires CanvasCompatProvider');
  return context.requestContext;
}

export function useCanvasInteractionActivity(): (active: boolean) => void {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error(cr().mustUseProvider('useCanvasInteractionActivity'));
  return context.setInteractionActive;
}

export function useCanvasInteractionStatus(): () => boolean {
  const context = React.useContext(CanvasContext);
  if (!context) throw new Error(cr().mustUseProvider('useCanvasInteractionStatus'));
  return context.isInteractionActive;
}
