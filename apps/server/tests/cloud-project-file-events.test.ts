import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectFile } from '@bezier/contracts';
import type { CloudProjectFiles } from '../src/storage/cloud-project-files.js';
import type { ProjectRegistry } from '../src/storage/project-registry.js';
import { registerCloudProjectFileEvents } from '../src/routes/cloud-project-file-events.js';

const PROJECT: Project = {
  id: 'p1',
  name: 'cloud project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const file = (name: string, size: number, mtime: number, mime = 'text/plain'): ProjectFile => ({
  name,
  path: name,
  type: 'file',
  size,
  mtime,
  kind: 'text',
  mime,
});

interface SseEvent { event: string; data: string }
interface SseReader {
  status: number;
  next(): Promise<SseEvent>;
  ended: Promise<void>;
  close(): void;
}

/** Minimal real SSE reader over a live socket: parses event/data frames,
 * ignores comment blocks, exposes end-of-stream as a promise. */
function connect(port: number, path: string): Promise<SseReader> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      const buffered: SseEvent[] = [];
      const waiters: Array<{ resolve: (e: SseEvent) => void; reject: (e: Error) => void }> = [];
      const endWaiters: Array<() => void> = [];
      let tail = '';
      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        for (const waiter of waiters.splice(0)) waiter.reject(new Error('stream ended'));
        for (const waiter of endWaiters.splice(0)) waiter();
      };
      res.on('data', (chunk: string) => {
        tail += chunk;
        let index = tail.indexOf('\n\n');
        while (index >= 0) {
          const block = tail.slice(0, index);
          tail = tail.slice(index + 2);
          index = tail.indexOf('\n\n');
          let event = 'message';
          let data = '';
          let hasData = false;
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
            else if (line.startsWith('data:')) {
              hasData = true;
              data += line.slice('data:'.length).trim();
            }
          }
          if (!hasData) continue;
          const parsed = { event, data };
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(parsed);
          else buffered.push(parsed);
        }
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
      resolve({
        status: res.statusCode ?? 0,
        next: () => new Promise<SseEvent>((resolveNext, rejectNext) => {
          const parsed = buffered.shift();
          if (parsed) {
            resolveNext(parsed);
            return;
          }
          if (ended) {
            rejectNext(new Error('stream ended'));
            return;
          }
          waiters.push({ resolve: resolveNext, reject: rejectNext });
        }),
        ended: new Promise<void>((resolveEnded) => {
          if (ended) {
            resolveEnded();
            return;
          }
          endWaiters.push(resolveEnded);
        }),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

const jsonRequest = (port: number, path: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timed out waiting for ${label}`);
    }),
  ]);

function makeServer(overrides: {
  files?: Pick<CloudProjectFiles, 'list'>;
  registry?: Pick<ProjectRegistry, 'get'>;
  isAuthorized?: (req: Request, projectId: string) => Promise<boolean>;
  pollIntervalMs?: number;
  minPollIntervalMs?: number;
} = {}) {
  const app = express();
  registerCloudProjectFileEvents(app, {
    files: overrides.files ?? { list: async () => [] },
    registry: overrides.registry ?? { get: (id: string) => (id === PROJECT.id ? PROJECT : null) },
    isAuthorized: overrides.isAuthorized ?? (async () => true),
    pollIntervalMs: overrides.pollIntervalMs ?? 10,
    minPollIntervalMs: overrides.minPollIntervalMs ?? 10,
  });
  const server = http.createServer(app);
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('cloud project file events', () => {
  it('does not use a filesystem watcher', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/routes/cloud-project-file-events.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/chokidar|project-watchers|node:fs|fs\.watch/u);
  });

  it('emits ready, then add/change/unlink diffs from the cloud snapshot only', async () => {
    const rows = new Map<string, ProjectFile>([['a.txt', file('a.txt', 10, 100)]]);
    const list = vi.fn(async () => [...rows.values()]);
    const isAuthorized = vi.fn(async () => true);
    const { port, close } = await makeServer({ files: { list }, isAuthorized });
    cleanups.push(close);

    const reader = await connect(port, '/api/projects/p1/events');
    cleanups.push(() => reader.close());
    expect(reader.status).toBe(200);

    const ready = await withTimeout(reader.next(), 2_000, 'ready');
    expect(ready.event).toBe('ready');
    expect(JSON.parse(ready.data)).toEqual({ projectId: 'p1' });

    // No initial-snapshot events: the next event must be the first real diff.
    rows.set('b.txt', file('b.txt', 1, 200));
    const added = await withTimeout(reader.next(), 2_000, 'add event');
    expect(added.event).toBe('file-changed');
    expect(JSON.parse(added.data)).toEqual({ type: 'file-changed', path: 'b.txt', kind: 'add' });

    rows.set('a.txt', file('a.txt', 42, 300));
    const changed = await withTimeout(reader.next(), 2_000, 'change event');
    expect(JSON.parse(changed.data)).toEqual({ type: 'file-changed', path: 'a.txt', kind: 'change' });

    rows.delete('b.txt');
    const removed = await withTimeout(reader.next(), 2_000, 'unlink event');
    expect(JSON.parse(removed.data)).toEqual({ type: 'file-changed', path: 'b.txt', kind: 'unlink' });

    // Every emission decision re-ran the injected authorizer.
    expect(isAuthorized.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(list).toHaveBeenCalledWith('p1');
  });

  it('returns 403 before reading the cloud listing when access is denied', async () => {
    const list = vi.fn(async () => [file('a.txt', 1, 1)]);
    const { port, close } = await makeServer({ files: { list }, isAuthorized: async () => false });
    cleanups.push(close);

    const { status, body } = await jsonRequest(port, '/api/projects/p1/events');
    expect(status).toBe(403);
    expect(JSON.parse(body).error.code).toBe('FORBIDDEN');
    expect(list).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown project without touching cloud storage', async () => {
    const list = vi.fn(async () => []);
    const isAuthorized = vi.fn(async () => true);
    const { port, close } = await makeServer({ files: { list }, isAuthorized });
    cleanups.push(close);

    const { status, body } = await jsonRequest(port, '/api/projects/missing/events');
    expect(status).toBe(404);
    expect(JSON.parse(body).error.code).toBe('PROJECT_NOT_FOUND');
    expect(list).not.toHaveBeenCalled();
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it('closes with a sanitized stream-error when authorization is revoked mid-stream', async () => {
    const rows = new Map<string, ProjectFile>([['a.txt', file('a.txt', 1, 1)]]);
    let granted = true;
    const { port, close } = await makeServer({
      files: { list: async () => [...rows.values()] },
      isAuthorized: async () => granted,
    });
    cleanups.push(close);

    const reader = await connect(port, '/api/projects/p1/events');
    cleanups.push(() => reader.close());
    await withTimeout(reader.next(), 2_000, 'ready');

    granted = false;
    rows.set('leak.txt', file('leak.txt', 9, 9));
    const terminal = await withTimeout(reader.next(), 2_000, 'stream-error');
    expect(terminal.event).toBe('stream-error');
    expect(JSON.parse(terminal.data).code).toBe('FORBIDDEN');
    await withTimeout(reader.ended, 2_000, 'stream close');
    await expect(reader.next()).rejects.toThrow('stream ended');
  });

  it('returns sanitized 503 when the initial cloud snapshot fails', async () => {
    const { port, close } = await makeServer({
      files: {
        list: async () => {
          throw new Error('appwrite secret transport detail');
        },
      },
    });
    cleanups.push(close);

    const { status, body } = await jsonRequest(port, '/api/projects/p1/events');
    expect(status).toBe(503);
    expect(JSON.parse(body).error.code).toBe('CLOUD_STORAGE_UNAVAILABLE');
    expect(body).not.toContain('appwrite secret transport detail');
  });

  it('emits a sanitized stream-error when a poll fails after headers', async () => {
    const rows = new Map<string, ProjectFile>([['a.txt', file('a.txt', 1, 1)]]);
    let fail = false;
    const { port, close } = await makeServer({
      files: {
        list: async () => {
          if (fail) throw new Error('cloud blew up: internal token xyz');
          return [...rows.values()];
        },
      },
    });
    cleanups.push(close);

    const reader = await connect(port, '/api/projects/p1/events');
    cleanups.push(() => reader.close());
    await withTimeout(reader.next(), 2_000, 'ready');

    fail = true;
    const terminal = await withTimeout(reader.next(), 2_000, 'stream-error');
    expect(terminal.event).toBe('stream-error');
    const payload = JSON.parse(terminal.data) as { code: string; message?: string };
    expect(payload.code).toBe('CLOUD_STORAGE_UNAVAILABLE');
    expect(terminal.data).not.toContain('cloud blew up');
    expect(terminal.data).not.toContain('internal token xyz');
    await withTimeout(reader.ended, 2_000, 'stream close');
  });

  it('stops polling and frees capacity when the reader disconnects', async () => {
    const list = vi.fn(async () => [file('a.txt', 1, 1)]);
    const { port, close } = await makeServer({ files: { list } });
    cleanups.push(close);

    const reader = await connect(port, '/api/projects/p1/events');
    await withTimeout(reader.next(), 2_000, 'ready');
    reader.close();
    await sleep(80);
    const callsAtDisconnect = list.mock.calls.length;
    await sleep(120);
    expect(list.mock.calls.length).toBe(callsAtDisconnect);

    // The freed slot is immediately reusable.
    const second = await connect(port, '/api/projects/p1/events');
    cleanups.push(() => second.close());
    const ready = await withTimeout(second.next(), 2_000, 'ready after reconnect');
    expect(JSON.parse(ready.data)).toEqual({ projectId: 'p1' });
  });

  it('rejects with 503 past the 64-stream capacity and releases slots on close', async () => {
    const { port, close } = await makeServer();
    cleanups.push(close);

    const readers: SseReader[] = [];
    for (let i = 0; i < 64; i += 1) {
      const reader = await connect(port, '/api/projects/p1/events');
      readers.push(reader);
      await withTimeout(reader.next(), 2_000, `ready #${i}`);
    }
    cleanups.push(() => {
      for (const reader of readers) reader.close();
    });

    const { status, body } = await jsonRequest(port, '/api/projects/p1/events');
    expect(status).toBe(503);
    expect(JSON.parse(body).error.code).toBe('EVENT_STREAM_CAPACITY');

    readers[0]!.close();
    await sleep(30);
    const reopened = await connect(port, '/api/projects/p1/events');
    cleanups.push(() => reopened.close());
    const ready = await withTimeout(reopened.next(), 2_000, 'ready after capacity release');
    expect(JSON.parse(ready.data)).toEqual({ projectId: 'p1' });
  });
});

it('counts concurrent authorization preflights against the stream capacity',async()=>{
 let unlock!:(value:boolean)=>void;const gate=new Promise<boolean>(resolve=>{unlock=resolve;});
 const isAuthorized=vi.fn(()=>gate);const {port,close}=await makeServer({isAuthorized});cleanups.push(close);
 const pending=Array.from({length:64},()=>connect(port,'/api/projects/p1/events'));
 try{
  for(let tries=0;isAuthorized.mock.calls.length<64&&tries<100;tries++)await sleep(10);
  expect(isAuthorized.mock.calls.length).toBe(64);
  const overflow=await withTimeout(jsonRequest(port,'/api/projects/p1/events'),2000,'pending capacity');expect(overflow.status).toBe(503);
 }finally{unlock(true);const readers=await Promise.all(pending);for(const reader of readers)reader.close();}
});
it('closes on revocation before another unchanged snapshot is read',async()=>{
 let allowed=true;const list=vi.fn(async()=>[file('private.txt',1,1)]);
 const {port,close}=await makeServer({files:{list},isAuthorized:async()=>allowed,pollIntervalMs:50});cleanups.push(close);
 const reader=await connect(port,'/api/projects/p1/events');cleanups.push(()=>reader.close());await withTimeout(reader.next(),2000,'ready');allowed=false;
 const error=await withTimeout(reader.next(),2000,'revoked without file mutation');expect(error.event).toBe('stream-error');expect(JSON.parse(error.data).code).toBe('FORBIDDEN');expect(list).toHaveBeenCalledTimes(1);
});
