import { useCallback, useEffect, useRef, useState } from 'react';
import { getBezierHost } from '@bezier/host';
import { BrowserResourceError, type BrowserResourceGrant, type BrowserResourceRead, type BrowserResourceSnapshot, type WorkspaceCollabContext } from '@bezier/contracts';
import { workspaceIdentityCacheKey } from './context';
import type { ResourceCaptureNode } from './BrowserResourcePlugin';
import { resourceCommand, resourceErrorCode } from './client';

const SCAN_INTERVAL_MS = 5000;
const LOADING_SNAPSHOT_INTERVAL_MS = 1500;
type Control = 'start' | 'scan' | 'stop';
type LiveSession = {
  control(action: Control): Promise<void>;
  read(resourceId: string, navigationId: number): Promise<BrowserResourceRead>;
};

export function useResourceSession(node: ResourceCaptureNode, projectId: string, tabId: string, context?: WorkspaceCollabContext | null) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<BrowserResourceSnapshot | null>(null);
  const [grant, setGrant] = useState<BrowserResourceGrant | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<ReturnType<typeof resourceErrorCode> | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const live = useRef<LiveSession | null>(null);
  const paused = useRef(false);
  const contextRef = useRef(context);
  contextRef.current = context;
  const identity = workspaceIdentityCacheKey(context);

  useEffect(() => {
    let alive = true;
    let ownedGrant: BrowserResourceGrant | null = null;
    let currentSnapshot: BrowserResourceSnapshot | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let minimumNavigation = 0;
    let sequence = 0;
    let documentRevision = 0;
    let controlRevision = 0;
    let pendingControl = false;
    let inFlight: Promise<void> | null = null;
    // Intent is independent of native enabled: a failed initial start rolls
    // native capture back to disabled, whereas a deliberate stop must stay stopped.
    let enabledIntent = !paused.current;
    let started = false;
    let automatic = true;
    let waitingForLoad = false;
    let loadPending = false;
    const abort = new AbortController();
    const host = getBezierHost()?.browser;
    setGrant(null); setSnapshot(null); setError(null); setBusy(true); setRecovering(false);

    const clearDocument = () => {
      documentRevision++;
      if (currentSnapshot) {
        currentSnapshot = { ...currentSnapshot, items: [], limitReached: false };
        setSnapshot(currentSnapshot);
      }
      setEpoch(value => value + 1);
    };
    const apply = (value: BrowserResourceSnapshot) => {
      if (!alive || value.sessionId !== ownedGrant?.sessionId || value.projectId !== projectId || value.tabId !== tabId
        || value.navigationId < minimumNavigation || value.navigationId < (currentSnapshot?.navigationId ?? 0)) return false;
      if (currentSnapshot && currentSnapshot.navigationId !== value.navigationId) clearDocument();
      // Native snapshots may contain network evidence from a pending document;
      // expose resources only after a successful post-load scan.
      currentSnapshot = waitingForLoad ? { ...value, items: [], limitReached: false } : value;
      setSnapshot(currentSnapshot);
      return true;
    };
    const schedule = () => {
      clearTimeout(timer);
      if (alive && enabledIntent && automatic) {
        timer = setTimeout(() => { void run(); }, waitingForLoad ? LOADING_SNAPSHOT_INTERVAL_MS : SCAN_INTERVAL_MS);
      }
    };
    const run = (explicit?: Control): Promise<void> => {
      if (!alive || !ownedGrant) return Promise.resolve();
      if (inFlight) return inFlight;
      clearTimeout(timer);
      const action = explicit ?? (!enabledIntent || waitingForLoad ? 'snapshot' : started ? 'scan' : 'start');
      const request = ++sequence;
      loadPending = false;
      const requestGrant = ownedGrant;
      inFlight = (async () => {
        try {
          const value = await resourceCommand(projectId, requestGrant, action, {}, contextRef.current, abort.signal);
          if (!alive) return;
          if (action === 'start') started = true;
          if (request !== sequence || !apply(value)) return;
          // A stop through another authorized surface is also deliberate. Never
          // turn it into an automatic start on the next navigation or timer.
          if (!value.enabled && started) {
            enabledIntent = false; paused.current = true; setRecovering(false);
          }
          if (action !== 'snapshot') setRecovering(false);
          setError(null);
        } catch (error) {
          if (!alive || request !== sequence) return;
          const code = resourceErrorCode(error);
          if (code === 'stale-document' && enabledIntent) {
            waitingForLoad = true;
            clearDocument();
            setRecovering(true); setError(null);
          } else {
            // No retry loop or grant re-open for authorization/transport failures.
            automatic = false;
            setRecovering(false); setError(code);
          }
        } finally {
          inFlight = null;
          if (alive) {
            if (loadPending && enabledIntent && automatic && !pendingControl) void run();
            else schedule();
          }
        }
      })();
      return inFlight;
    };
    const navigate = (event: Event) => {
      if ((event as Event & { isMainFrame?: boolean }).isMainFrame === false) return;
      // Before the grant/snapshot exists, native navigation numbering is unknown.
      // Sequence rejection still protects requests crossing that opening race.
      if (ownedGrant && currentSnapshot) minimumNavigation = Math.max(minimumNavigation, currentSnapshot.navigationId) + 1;
      sequence++;
      waitingForLoad = true; loadPending = false;
      clearDocument();
      if (enabledIntent && automatic) { setRecovering(true); setError(null); }
      if (!inFlight) schedule();
    };
    const loaded = (event: Event) => {
      if ((event as Event & { isMainFrame?: boolean }).isMainFrame === false) return;
      waitingForLoad = false;
      if (!enabledIntent || !automatic) return;
      sequence++;
      loadPending = true;
      if (!pendingControl) void run();
    };
    node.addEventListener('did-start-navigation', navigate);
    node.addEventListener('render-process-gone', navigate);
    node.addEventListener('did-finish-load', loaded);
    node.addEventListener('did-navigate-in-page', loaded);

    const session: LiveSession = {
      async control(action) {
        const revision = ++controlRevision;
        sequence++;
        if (action !== 'scan') { enabledIntent = action === 'start'; paused.current = !enabledIntent; }
        automatic = true; pendingControl = true; loadPending = false;
        clearTimeout(timer);
        if (action === 'stop') { clearDocument(); setRecovering(false); }
        setBusy(true); setError(null);
        // Serialize with automatic scans instead of dropping a user's pause.
        await inFlight;
        if (!alive || revision !== controlRevision) return;
        if (action === 'start') started = false;
        try { await run(action); }
        finally {
          if (alive && revision === controlRevision) {
            pendingControl = false; setBusy(false);
            if (loadPending && enabledIntent && automatic) void run();
          }
        }
      },
      async read(resourceId, navigationId) {
        if (!alive || !ownedGrant) throw new BrowserResourceError('unauthorized', 'Resource grant is unavailable');
        const revision = documentRevision;
        const current = () => alive && enabledIntent && !waitingForLoad && revision === documentRevision
          && currentSnapshot?.enabled && currentSnapshot.navigationId === navigationId && navigationId >= minimumNavigation;
        if (!current()) throw new BrowserResourceError('stale-document', 'Resource document changed');
        const result = await resourceCommand(projectId, ownedGrant, 'read', { resourceId, navigationId }, contextRef.current, abort.signal);
        if (!current() || result.resourceId !== resourceId || result.navigationId !== navigationId) {
          throw new BrowserResourceError('stale-document', 'Resource document changed');
        }
        return result;
      },
    };
    void (async () => {
      if (!host?.openResourceCapture || !host.closeResourceCapture) throw new BrowserResourceError('unavailable', 'Native resource capture unavailable');
      const next = await host.openResourceCapture(node.getWebContentsId(), projectId, tabId);
      if (!alive) { void host.closeResourceCapture(next.sessionId, next.accessToken).catch(() => undefined); return; }
      ownedGrant = next;
      live.current = session;
      setGrant(next);
      await run();
    })().catch(error => { if (alive) setError(resourceErrorCode(error)); }).finally(() => { if (alive && !pendingControl) setBusy(false); });
    return () => {
      alive = false; clearTimeout(timer); abort.abort();
      node.removeEventListener('did-start-navigation', navigate);
      node.removeEventListener('render-process-gone', navigate);
      node.removeEventListener('did-finish-load', loaded);
      node.removeEventListener('did-navigate-in-page', loaded);
      if (live.current === session) live.current = null;
      if (ownedGrant) void host?.closeResourceCapture?.(ownedGrant.sessionId, ownedGrant.accessToken).catch(() => undefined);
    };
  }, [node, projectId, tabId, identity, attempt]);

  const control = useCallback(async (action: Control) => { await live.current?.control(action); }, []);
  const read = useCallback(async (resourceId: string, navigationId: number) => {
    const session = live.current;
    if (!session) throw new BrowserResourceError('unauthorized', 'Resource grant is unavailable');
    return session.read(resourceId, navigationId);
  }, []);
  return { snapshot, grant, busy, error, recovering, epoch, control, read, retry: () => setAttempt(value => value + 1) };
}
