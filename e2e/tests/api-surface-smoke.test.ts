import { describe, expect, it } from 'vitest';
import { createProject } from '@/api';
import { useToolsDev } from '@/vitest/suite';

/** Check the default public API surfaces in a fresh isolated runtime, never an ambient service. */
describe('default Canvas API surface', () => {
  const runtime = useToolsDev();

  it('returns usable project, canvas, file, library, workflow and preference responses', async () => {
    const { serverUrl } = runtime();
    const projectId = await createProject(runtime(), 'API surface owner');
    const routes = [
      ['/api/health', 'ok'],
      ['/api/projects', 'projects'],
      [`/api/projects/${projectId}`, 'project'],
      [`/api/projects/${projectId}/canvas/state`, 'state'],
      [`/api/projects/${projectId}/canvas/revision`, 'revision'],
      [`/api/projects/${projectId}/canvas/capabilities`, 'operations'],
      [`/api/projects/${projectId}/files`, 'files'],
      [`/api/projects/${projectId}/agent/tasks`, 'tasks'],
      ['/api/asset-library/info', 'capabilities'],
      ['/api/browser-preferences', 'revision'],
      ['/api/media/models', 'providers'],
      ['/api/workflow-graphs', 'workflows'],
      ['/api/integrations/mf', 'available'],
    ] as const;
    for (const [route, field] of routes) {
      const response = await fetch(`${serverUrl}${route}`);
      expect(response.status, `${route}: ${await response.clone().text()}`).toBe(200);
      const data: unknown = await response.json();
      expect(data, route).toHaveProperty(field);
    }
  });

  it('reports unconfigured external capabilities explicitly rather than claiming success', async () => {
    const { serverUrl } = runtime();
    const resources = await fetch(`${serverUrl}/api/design-systems`);
    expect(resources.status).toBe(503);
    expect(await resources.json()).toMatchObject({ error: { code: 'RESOURCE_ADAPTER_UNAVAILABLE' } });
    const mediaConfig = await fetch(`${serverUrl}/api/media/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providers: {} }),
    });
    expect(mediaConfig.status).toBe(503);
    expect(await mediaConfig.json()).toMatchObject({ error: { code: 'MEDIA_CONFIGURATION_UNAVAILABLE' } });
  });
});
