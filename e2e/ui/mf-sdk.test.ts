import { test, expect } from '@/playwright/suite';
import { writeFile } from 'node:fs/promises';
import { api, createProject, projectText, writeText } from '@/api';
import { useChinese } from '@/playwright/workspace';
import { guardMfBrowserNetwork } from '@/playwright/mf-network';
import { recordMfRendererVersions } from '@/playwright/mf-renderers';
import { MF_FIXTURE_UI_HOST } from '@/tools-dev/mf-fixture';

// Real beta.18 SDK document + real parent/bridge/proxy. Only the remote MF protocol is a fixture.
// Caller prebuilds into CANVAS_E2E_WEB_BUILD_DIR; the suite never touches a preview build.
test.use({ mfFixture: true });
test.describe('MF real SDK with owned HTTPS protocol', () => {
  test('native welcome composer uploads and sends through real proxy without applying canvas output', async ({ page, runtime }, info) => {
    const fixture = runtime.mfFixture!;
    const network = await guardMfBrowserNetwork(page);
    const renderers = await recordMfRendererVersions(page);
    const offset = fixture.requests.length;
    const id = await createProject(runtime, 'MF actual SDK smoke');
    await writeText(runtime, id, 'preserved.md', 'Unchanged before and after chat.');
    await useChinese(page);
    try {
      await page.goto(`/?projectId=${id}`);
      await page.getByTestId('mf-conversation-toggle').click();
      const frame = page.frameLocator('[data-testid="mf-conversation-frame"]');
      // Native editor, not an iframe stub, synthetic bridge, or a React SDK mock.
      const editor = frame.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible();
      await expect(page.getByTestId('mf-new-session')).toBeEnabled();
      const frameUrl = await page.getByTestId('mf-conversation-frame').getAttribute('src');
      expect(new URL(frameUrl!).hostname).toBe(MF_FIXTURE_UI_HOST);
      expect(new URL(runtime.webUrl).hostname).toBe('127.0.0.1');
      const rendererVersions = await renderers.snapshot();
      expect(rendererVersions.parent.renderers.filter(r => r.rendererPackageName === 'react-dom')).toHaveLength(1);
      expect(rendererVersions.mf).toHaveLength(1);
      expect(rendererVersions.mf[0]!.renderers).toEqual([{ version: '19.2.3', rendererPackageName: 'react-dom' }]);
      // Record (rather than assume) the Next-managed parent renderer version.
      await frame.locator('input[type=file]').first().setInputFiles({ name: 'fixture-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Owned local upload fixture, no external data.') });
      await expect.poll(() => fixture.requests.slice(offset).some(r => r.path.endsWith('/workspace/file/upload'))).toBe(true);
      await expect(frame.getByText('fixture-note.txt', { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await editor.fill('SDK_NATIVE_SMOKE: hello from the actual composer');
      await editor.press('Enter');
      await expect.poll(() => fixture.requests.slice(offset).filter(r => r.path === '/api/kpandora/v1/chat/web').length).toBe(1);
      await expect(frame.getByText('Local protocol fixture response. No model was contacted.', { exact: false }).first()).toBeVisible();
      await expect.poll(() => fixture.websocketMessages.some((m: any) => m.type === 'subscribe')).toBe(true);
      const chat = fixture.requests.slice(offset).find(r => r.path === '/api/kpandora/v1/chat/web')!;
      expect(JSON.stringify(chat.body)).toContain('SDK_NATIVE_SMOKE');
      expect(JSON.stringify(chat.body)).toContain('fixture-note.txt');
      expect(chat.authenticated).toBe(true);
      const terminalOffset = fixture.requests.length;
      fixture.finishStreams();
      await expect(page.getByTestId('mf-new-session')).toBeEnabled();
      await expect.poll(() => fixture.requests.slice(terminalOffset).some(r => r.path === '/api/kpandora/v1/chat/queue/claim-next')).toBe(true);
      const tasks = await api<{ tasks: unknown[] }>(runtime, `/api/projects/${id}/mf/tasks`);
      expect(tasks.tasks).toEqual([]);
      expect(await projectText(runtime, id, 'preserved.md')).toBe('Unchanged before and after chat.');
      expect(network.ssoHealthRequests).toEqual([]);
      expect(network.httpFailures).toEqual([]);
      expect(network.sdkFailures).toEqual([]);
      expect(network.errors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
      // The provider forwards style to both outer and Ant App layers; the owned
      // footer must anchor to the document bottom, not stop after chat content.
      await expect.poll(() => frame.locator('.mf-footnote').evaluate(element =>
        Math.abs(element.getBoundingClientRect().bottom - window.innerHeight))).toBeLessThanOrEqual(2);
      await page.screenshot({ path: info.outputPath('mf-actual-sdk.png') });
    } finally {
      fixture.finishStreams();
      await network.attach(info);
      await renderers.attach(info);
      const path = info.outputPath('mf-fixture-requests.json');
      await writeFile(path, JSON.stringify({ requests: fixture.requests.slice(offset), unexpected: fixture.unexpected, ws: fixture.websocketMessages }, null, 2));
      await info.attach('mf-fixture-requests.json', { path, contentType: 'application/json' });
    }
  });
});
