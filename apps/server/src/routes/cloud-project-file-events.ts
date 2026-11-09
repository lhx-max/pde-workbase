// Cloud-authoritative project file event stream. Root registers this BEFORE
// the legacy local file routes so GET /api/projects/:id/events resolves here
// on cloud-backed deployments. There is no filesystem watcher and no local
// fallback: the only signal source is the injected CloudProjectFiles.list
// snapshot diffed on a bounded, sequential poll.
//
// Semantics are best-effort invalidation, not a durable revision or event
// log: events may coalesce or be missed between polls, and a backpressured
// reader is disconnected rather than buffered. The canvas operation event
// stream is the separate authoritative operation history.
//
// Authorization is re-evaluated through the injected isAuthorized callback
// on every emission decision — initial snapshot, each change batch, every
// heartbeat — because the root adapter re-checks live MA membership /
// instance / project ownership per call. Request bodies and tenant headers
// are never consulted here.
import type { Express, Request, Response } from 'express';
import type { ProjectFile } from '@bezier/contracts';
import type { CloudProjectFiles } from '../storage/cloud-project-files.js';
import type { ProjectRegistry } from '../storage/project-registry.js';

export interface RegisterCloudProjectFileEventsDeps {
  files: Pick<CloudProjectFiles, 'list'>;
  registry: Pick<ProjectRegistry, 'get'>;
  /** Root-scoped live authorizer. Revalidates current MA membership,
   * instance and project ownership on every call; the route never trusts
   * request body fields and never caches a grant. Returns false when access
   * is denied/revoked. No Response is passed — the route owns all errors. */
  isAuthorized: (req: Request, projectId: string) => Promise<boolean>;
  /** Snapshot poll cadence. Default 3000ms; clamped to
   * [minPollIntervalMs, 60000]. Production callers leave the default. */
  pollIntervalMs?: number;
  /** Lower clamp bound for pollIntervalMs. Defaults to 100ms; tests may
   * lower it (>=1) for fast in-memory polling. */
  minPollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const DEFAULT_MIN_POLL_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_STREAMS = 64;

type CloudFileWatchKind = 'add' | 'change' | 'unlink';
interface CloudFileChangedEvent {
  type: 'file-changed';
  path: string;
  kind: CloudFileWatchKind;
}

function sendApiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function snapshotOf(files: readonly ProjectFile[]): Map<string, ProjectFile> {
  const snapshot = new Map<string, ProjectFile>();
  for (const file of files) {
    if(typeof file.name!=='string'||!file.name||snapshot.has(file.name))throw new Error('Invalid cloud file snapshot');
    snapshot.set(file.name, file);
  }
  return snapshot;
}

function sameFile(a: ProjectFile, b: ProjectFile): boolean {
  return (
    a.name === b.name
    && a.path === b.path
    && a.size === b.size
    && a.mtime === b.mtime
    && a.mime === b.mime
    && a.kind === b.kind
  );
}

function diffSnapshots(previous: Map<string, ProjectFile>, next: Map<string, ProjectFile>): CloudFileChangedEvent[] {
  const events: CloudFileChangedEvent[] = [];
  for (const [path, file] of next) {
    const before = previous.get(path);
    if (!before) events.push({ type: 'file-changed', path, kind: 'add' });
    else if (!sameFile(before, file)) events.push({ type: 'file-changed', path, kind: 'change' });
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) events.push({ type: 'file-changed', path, kind: 'unlink' });
  }
  events.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return events;
}

export function registerCloudProjectFileEvents(app: Express, deps: RegisterCloudProjectFileEventsDeps) {
  const minPoll = Math.max(1, Math.floor(deps.minPollIntervalMs ?? DEFAULT_MIN_POLL_INTERVAL_MS));
  const requested = Number.isFinite(deps.pollIntervalMs) ? Math.floor(deps.pollIntervalMs as number) : DEFAULT_POLL_INTERVAL_MS;
  const pollIntervalMs = Math.min(MAX_POLL_INTERVAL_MS, Math.max(minPoll, requested));
  let active = 0;

  app.get('/api/projects/:id/events', async (req, res) => {
    const projectId = String(req.params.id);
    if (active >= MAX_STREAMS) {
      sendApiError(res, 503, 'EVENT_STREAM_CAPACITY', 'too many open project file event streams');
      return;
    }
    if (!deps.registry.get(projectId)) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return;
    }
    active+=1;let counted=true;
    const releaseSlot=()=>{if(counted){counted=false;active--;}};
    res.once('close',releaseSlot);res.once('finish',releaseSlot);req.once('aborted',releaseSlot);
    let allowed: boolean;
    try {
      allowed = await deps.isAuthorized(req, projectId);
    } catch {
      sendApiError(res, 503, 'CLOUD_STORAGE_UNAVAILABLE', 'project file events unavailable');
      return;
    }
    if (!allowed) {
      sendApiError(res, 403, 'FORBIDDEN', 'project access denied');
      return;
    }
    if(res.destroyed||res.writableEnded||req.aborted){releaseSlot();return;}
    let snapshot: Map<string, ProjectFile>;
    try {
      snapshot = snapshotOf(await deps.files.list(projectId));
    } catch {
      sendApiError(res, 503, 'CLOUD_STORAGE_UNAVAILABLE', 'project file events unavailable');
      return;
    }

    if(res.destroyed||res.writableEnded||req.aborted){releaseSlot();return;}
    let closed = false;
    let pollTimer: NodeJS.Timeout | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let heartbeatPending = false;

    const release = () => {
      if (closed) return;
      closed = true;
      releaseSlot();
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeat) clearInterval(heartbeat);
    };

    const teardown = () => {
      if (closed) return;
      release();
      try {
        if (!res.writableEnded && !res.destroyed) res.end();
      } catch {
        // The socket is already gone; the slot and timers are released above.
      }
    };

    const writeFrame = (frame: string): boolean => {
      if (closed || res.writableEnded || res.destroyed) return false;
      try {
        // A backpressured reader fell behind an invalidation hint. Close
        // rather than accumulate an unbounded buffer — the client can
        // reconnect; this stream is not a durable log.
        if (!res.write(frame)) {
          teardown();
          return false;
        }
        return true;
      } catch {
        teardown();
        return false;
      }
    };

    const send = (event: string, payload: unknown): boolean =>
      writeFrame(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

    const fail = (code: string, message: string) => {
      send('stream-error', { code, message });
      teardown();
    };

    const recheck = async (): Promise<'ok' | 'revoked' | 'error'> => {
      try {
        return (await deps.isAuthorized(req, projectId)) ? 'ok' : 'revoked';
      } catch {
        return 'error';
      }
    };

    const failFor = (auth: 'revoked' | 'error') => {
      if (auth === 'revoked') fail('FORBIDDEN', 'project access revoked');
      else fail('CLOUD_STORAGE_UNAVAILABLE', 'project file events unavailable');
    };

    const schedule = () => {
      if (closed) return;
      pollTimer = setTimeout(() => {
        void tick();
      }, pollIntervalMs);
      pollTimer.unref();
    };

    const tick = async () => {
      if (closed) return;
      try {
        const access=await recheck();if(closed)return;if(access!=='ok'){failFor(access);return;}
        const next = snapshotOf(await deps.files.list(projectId));
        if (closed) return;
        const events = diffSnapshots(snapshot, next);
        snapshot = next;
        if (events.length === 0) {
          schedule();
          return;
        }
        const auth = await recheck();
        if (closed) return;
        if (auth !== 'ok') {
          failFor(auth);
          return;
        }
        for (const event of events) {
          if (!send('file-changed', event)) return;
        }
        schedule();
      } catch {
        fail('CLOUD_STORAGE_UNAVAILABLE', 'project file events unavailable');
      }
    };

    const beat = async () => {
      if (closed || heartbeatPending) return;
      heartbeatPending = true;
      try {
        const auth = await recheck();
        if (closed) return;
        if (auth !== 'ok') {
          failFor(auth);
          return;
        }
        writeFrame(': heartbeat\n\n');
      } finally {
        heartbeatPending = false;
      }
    };

    res.once('close', release);
    res.once('finish', release);
    req.once('aborted', release);

    const initialAccess=await recheck();if(initialAccess!=='ok'){release();sendApiError(res,initialAccess==='revoked'?403:503,'FORBIDDEN','Project stream access is unavailable');return;}
    if(closed||res.destroyed)return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    if (!send('ready', { projectId })) return;
    schedule();
    heartbeat = setInterval(() => {
      void beat();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
  });
}
