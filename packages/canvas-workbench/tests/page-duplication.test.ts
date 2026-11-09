import { afterEach, expect, it, vi } from 'vitest';
import { duplicateCanvasPage } from '../src/workbench/canvas-page-duplication';
import { setCanvasHostContext } from '../src/platform/api-base';
import type { CanvasBasicNode } from '../src/workbench/BasicCanvasNode';

afterEach(() => { vi.unstubAllGlobals(); setCanvasHostContext(null); });
const source: CanvasBasicNode = {
  id: 'web', kind: 'page', title: 'Web', x: 0, y: 0, projectFilePath: 'outputs/pages/current.html',
  generation: { requestId: 'old-run', status: 'running', previewPath: 'outputs/pages/current.html' },
  resultHistory: [{ projectFilePath: 'outputs/pages/first.html' }, { projectFilePath: 'outputs/pages/current.html' }],
};

function files(failWrite = 0) {
  const stored = new Map([['outputs/pages/first.html', '<h1>First</h1>'], ['outputs/pages/current.html', '<h1>Current</h1>']]);
  let writes = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = decodeURIComponent(url.split('/raw/')[1] || '');
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      if (++writes === failWrite) return new Response('', { status: 500 });
      stored.set(body.name, body.content);
      return new Response(JSON.stringify({ file: { name: body.name } }));
    }
    if (init?.method === 'DELETE') { stored.delete(path); return new Response('{}'); }
    return new Response(stored.get(path) || '', { status: stored.has(path) ? 200 : 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { stored, fetcher };
}

it('isolates the current file and all history versions without copying an active task binding', async () => {
  const { stored, fetcher } = files();
  const before = structuredClone(source);
  setCanvasHostContext({ projectId: 'other-project' });
  const patch = await duplicateCanvasPage(source, { projectId: 'owning-project' }, () => true);
  expect(patch?.generation).toBeUndefined();
  expect(patch?.projectFilePath).not.toBe(source.projectFilePath);
  expect(patch?.projectFilePath).toMatch(/^outputs\/pages\/canvas-copy-/);
  expect(patch?.resultHistory?.[1]?.projectFilePath).toBe(patch?.projectFilePath);
  for (const snapshot of patch!.resultHistory!) expect(stored.has(snapshot.projectFilePath as string)).toBe(true);
  stored.set(patch!.projectFilePath!, '<h1>Only the copy</h1>');
  expect(stored.get(source.projectFilePath!)).toBe('<h1>Current</h1>');
  expect(source).toEqual(before);
  expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/projects/owning-project/'))).toBe(true);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});

it('does not create a partial copy when a historical file is missing', async () => {
  const { stored, fetcher } = files();
  stored.delete('outputs/pages/first.html');
  await expect(duplicateCanvasPage(source, { projectId: 'owning-project' }, () => true)).rejects.toThrow('404');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('removes only newly created files after a later write fails', async () => {
  const { stored } = files(2);
  await expect(duplicateCanvasPage(source, { projectId: 'owning-project' }, () => true)).rejects.toThrow('500');
  expect([...stored.keys()].sort()).toEqual(['outputs/pages/current.html', 'outputs/pages/first.html']);
});

it('abandons and cleans a copy if its source or project changes during the operation', async () => {
  const { stored } = files();
  const patch = await duplicateCanvasPage(source, { projectId: 'owning-project' }, () => stored.size === 2);
  expect(patch).toBeUndefined();
  expect(stored.size).toBe(2);
});

it('duplicates an empty brief without carrying a running task into the copy', async () => {
  const { fetcher } = files();
  const patch = await duplicateCanvasPage({ ...source, projectFilePath: undefined, resultHistory: undefined, generation: { requestId: 'run', status: 'running' } }, { projectId: 'p' }, () => true);
  expect(patch).toMatchObject({ generation: undefined, projectFilePath: undefined });
  expect(fetcher).not.toHaveBeenCalled();
});
