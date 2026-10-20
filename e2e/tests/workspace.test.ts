import { get } from 'node:http';
import { describe, expect, it } from 'vitest';
import { T } from '@/timeouts';
import { api, createProject, projectText, webDocument, writeText } from '@/api';
import { useToolsDev } from '@/vitest/suite';

describe('real independent workspace HTTP boundary', () => {
  const runtime = useToolsDev();
  it('serves the built original web shell and real project-file version history', async () => {
    const active = runtime();
    const id = await createProject(active, 'HTTP revision witness');
    const initial = await writeText(active, id, 'Overview.html', webDocument('First revision'));
    expect(initial.version?.id).toBeTruthy();
    await writeText(active, id, 'Overview.html', webDocument('Second revision'));
    const versions = await api<{ versions: Array<{ id: string }> }>(active, `/api/projects/${id}/files/Overview.html/versions`);
    expect(versions.versions.length).toBeGreaterThanOrEqual(2);
    await api(active, `/api/projects/${id}/files/Overview.html/versions/${initial.version!.id}/restore`, {});
    expect(await projectText(active, id, 'Overview.html')).toContain('First revision');
    const web = await fetch(`${active.webUrl}/?projectId=${id}`);
    expect(web.status).toBe(200);
    expect(await web.text()).toContain('_next/');
    const proxied = await fetch(`${active.webUrl}/api/projects/${id}/files`);
    expect(proxied.status).toBe(200);
    expect((await proxied.json() as { files: Array<{ name: string }> }).files.some(file => file.name === 'Overview.html')).toBe(true);
  });
  it('rejects a rebound Host at the built Next proxy before returning project data', async () => {
    const active = runtime();
    // Node 24 fetch replaces a supplied Host with its URL authority. Use the
    // wire-level HTTP client so this actually sends the adversarial header.
    const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = get(`${active.webUrl}/api/projects`, { headers: { host: 'rebound.example' } }, incoming => {
        let body = '';
        incoming.setEncoding('utf8');
        incoming.on('data', chunk => { body += chunk; });
        incoming.on('end', () => resolve({ status: incoming.statusCode, body }));
        incoming.on('error', reject);
      });
      request.on('error', reject);
      request.setTimeout(T.medium, () => request.destroy(new Error('Host guard did not return a response')));
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'CANVAS_WEB_HOST_FORBIDDEN' } });
  });
  it('keeps files project-bound and reports unavailable native grants in web mode', async () => {
    const active = runtime();
    const first = await createProject(active, 'HTTP first project');
    const second = await createProject(active, 'HTTP second project');
    await writeText(active, first, 'Isolated.md', 'Only the first project owns this note.');
    expect((await fetch(`${active.serverUrl}/api/projects/${second}/files/Isolated.md`)).status).toBe(404);
    const native = await fetch(`${active.serverUrl}/api/projects/${first}/browser-resources/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-browser-resource-token': 'invalid-but-well-formed-grant' }, body: JSON.stringify({ sessionId: 'not-issued' }) });
    expect(native.status).toBe(503);
    const traversal = await fetch(`${active.serverUrl}/api/projects/${first}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '../outside.txt', content: 'must fail' }) });
    expect(traversal.ok).toBe(false);
    for (const route of ['/api/chat', '/api/personal-assets']) expect((await fetch(`${active.serverUrl}${route}`)).status).toBe(404);
  });
  describe('two concurrently live production workspaces', () => {
    const secondRuntime = useToolsDev();
    it('routes each production web process only to its own explicit backend and data root', async () => {
      const first = runtime(); const second = secondRuntime();
      expect(first.serverUrl).not.toBe(second.serverUrl);
      expect(first.webUrl).not.toBe(second.webUrl);
      expect(first.dataRoot).not.toBe(second.dataRoot);
      const a = await createProject(first, 'First simultaneous workspace');
      const b = await createProject(second, 'Second simultaneous workspace');
      await writeText(first, a, 'Namespace.md', 'FIRST ISOLATED WORKSPACE');
      await writeText(second, b, 'Namespace.md', 'SECOND ISOLATED WORKSPACE');
      const firstResponse = await fetch(`${first.webUrl}/api/projects/${a}/files/Namespace.md`);
      expect(firstResponse.status).toBe(200);
      expect(await firstResponse.text()).toBe('FIRST ISOLATED WORKSPACE');
      const secondResponse = await fetch(`${second.webUrl}/api/projects/${b}/files/Namespace.md`);
      expect(secondResponse.status).toBe(200);
      expect(await secondResponse.text()).toBe('SECOND ISOLATED WORKSPACE');
      expect((await fetch(`${first.webUrl}/api/projects/${b}/files/Namespace.md`)).status).toBe(404);
      expect((await fetch(`${second.webUrl}/api/projects/${a}/files/Namespace.md`)).status).toBe(404);
    });
  });
});
