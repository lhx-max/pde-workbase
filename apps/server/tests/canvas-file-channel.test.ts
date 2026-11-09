import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createCanvasServer, type CanvasServer } from '../src/server.js';

const active: Array<{ api: CanvasServer; listener: ReturnType<CanvasServer['app']['listen']>; root: string }> = [];
afterEach(async () => {
  for (const { api, listener, root } of active.splice(0)) {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'canvas-file-channel-'));
  const api = createCanvasServer({ dataRoot: root });
  const listener = api.app.listen(0, '127.0.0.1');
  active.push({ api, listener, root });
  await once(listener, 'listening');
  await api.ready;
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const project = api.registry.create({ name: 'Sketch card' });
  return { api, url, project };
}

const sketchPath = 'sketches/card.sketch.json';
const sketchBody = '{"type":"excalidraw","elements":[{"id":"a","type":"rectangle"}]}';

it('reads and writes a sketch card file on the local canvas without cloud storage', async () => {
  const { api, url, project } = await fixture();
  const channel = `${url}/api/apps/canvas/instances/${project.id}/files?path=${encodeURIComponent(sketchPath)}`;
  const missing = await fetch(channel);
  expect(missing.status).toBe(404);

  const written = await fetch(channel, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: sketchBody }),
  });
  expect(written.status).toBe(200);
  expect(await written.json()).toMatchObject({ data: { path: sketchPath, status: 'written' } });

  const again = await fetch(channel);
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ data: { content: sketchBody } });

  const onDisk = await readFile(join(api.registry.resolveProjectRoot(project.id), sketchPath), 'utf8');
  expect(onDisk).toBe(sketchBody);
  const projectFile = await fetch(`${url}/api/projects/${project.id}/files/${encodeURIComponent(sketchPath)}`);
  expect(projectFile.status).toBe(200);
  expect(await projectFile.text()).toBe(sketchBody);
});

it('rejects a file path that leaves the project', async () => {
  const { url, project } = await fixture();
  const escaped = await fetch(`${url}/api/apps/canvas/instances/${project.id}/files?path=${encodeURIComponent('../outside.sketch.json')}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'no' }),
  });
  expect(escaped.status).toBe(400);
});
