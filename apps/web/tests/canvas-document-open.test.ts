import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { readOrSeedCanvasDocument, preserveCanvasOpenDraft } from '../src/app-surfaces/canvas-document-open';

const request = { nodeId: 'n', path: 'text.md', title: 'Text', content: 'cached caller draft', preferContent: true };
const headers = { 'x-team-id': 'team-a' };
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const missing = () => new Response(JSON.stringify({ error: { code: 'CANVAS_FILE_NOT_FOUND', message: 'missing' } }), { status: 404 });
const state = (text = 'persisted node', patch: Record<string, unknown> = {}) => response({ revision: 42, state: { workbenchBasicNodes: [{ id: 'n', kind: 'text', text, projectFilePath: 'text.md', ...patch }] } });
afterEach(() => vi.unstubAllGlobals());

it('never writes an existing mirror even when preferContent differs from caller content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ content: 'new mirror', revision: 42 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await readOrSeedCanvasDocument('c', request, headers)).toEqual({ content: 'new mirror', seeded: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', headers });
  expect(preserveCanvasOpenDraft(request)).toEqual({ content: 'cached caller draft' });
});

it('seeds a missing mirror only from persisted node text with observed revision and node identity', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(state()).mockResolvedValueOnce(missing())
    .mockResolvedValueOnce(response({ content: 'persisted node', revision: 43 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await readOrSeedCanvasDocument('c', request, headers)).toEqual({ content: 'persisted node', seeded: true });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    '/api/apps/canvas/instances/c/files?path=text.md', '/api/apps/canvas/instances/c/state',
    '/api/apps/canvas/instances/c/files?path=text.md', '/api/apps/canvas/instances/c/files?path=text.md',
  ]);
  const write = fetcher.mock.calls[3]![1];
  expect(write.method).toBe('PUT');
  expect(JSON.parse(write.body)).toEqual({ content: 'persisted node', nodeId: 'n', expectedRevision: 42, baseContent: 'persisted node' });
  expect(write.headers.get('x-team-id')).toBe('team-a');
});

it('does not write when a mirror appears between the initial absence and version capture', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(state())
    .mockResolvedValueOnce(response({ content: 'concurrent mirror', revision: 43 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await readOrSeedCanvasDocument('c', request, headers)).toEqual({ content: 'concurrent mirror', seeded: false });
  expect(fetcher.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false);
});

it('keeps caller draft and does not retry a stale seed after node revision changes', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(state()).mockResolvedValueOnce(missing())
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Canvas changed before save' } }), { status: 409 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(readOrSeedCanvasDocument('c', request, headers)).rejects.toThrow('Canvas changed');
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
  expect(preserveCanvasOpenDraft(request).content).toBe('cached caller draft');
});

it('rejects a changed node path rather than materializing its stale path', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(state('persisted node', { projectFilePath: 'moved.md' })).mockResolvedValueOnce(missing());
  vi.stubGlobal('fetch', fetcher);
  await expect(readOrSeedCanvasDocument('c', request, headers)).rejects.toThrow('位置已变化');
  expect(fetcher.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false);
});

it('does not treat permission failures as missing files or empty content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(readOrSeedCanvasDocument('c', request, headers)).rejects.toThrow('forbidden');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not cause the caller to patch over text typed while opening was pending', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  let liveNode = request.content;
  const opened = readOrSeedCanvasDocument('c', request, headers);
  liveNode = 'typed while opening';
  finish(response({ content: 'remote latest', revision: 50 }));
  await opened;
  const result = preserveCanvasOpenDraft(request);
  // BasicCanvasNode compares the result to the captured item.text, not to liveNode.
  if (result.content !== request.content) liveNode = result.content;
  expect(liveNode).toBe('typed while opening');
});

it('keeps the FileWorkspace open callback read-only and reports errors before the caller swallows them', () => {
  const source = readFileSync(new URL('../src/components/FileWorkspace.tsx', import.meta.url), 'utf8');
  const callback = source.split('onOpenTextDocument={async (request) => {')[1]!.split('uiHost={{')[0]!;
  expect(callback).not.toContain('setTextDocumentChange(');
  expect(callback).not.toContain('writeProjectTextFile(');
  expect(callback).toContain('readOrSeedCanvasDocument(projectId, request, headers)');
  expect(callback).toContain('return preserveCanvasOpenDraft(request)');
  expect(callback).toContain('reportError(cause)');
});
