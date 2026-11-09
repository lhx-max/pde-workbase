import { test, expect } from '@/playwright/suite';
import { writeFile } from 'node:fs/promises';
import { api, createProject, projectText, writeText } from '@/api';
import { useChinese } from '@/playwright/workspace';
import { guardMfBrowserNetwork } from '@/playwright/mf-network';
import { MF_FIXTURE_UI_HOST, type MfFixtureAuthFailure } from '@/tools-dev/mf-fixture';

test.use({ mfFixture: true });
test('real SDK auth failures fail closed without iframe login navigation or developer token requests', async ({ page, runtime }, info) => {
  const fixture = runtime.mfFixture!;
  const network = await guardMfBrowserNetwork(page);
  const requestOffset = fixture.requests.length;
  const childNavigations: string[] = [];
  const authResponses: Array<{ mode: MfFixtureAuthFailure; url: string; status: number; body: unknown }> = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() !== page.mainFrame()) childNavigations.push(request.url());
  });
  await useChinese(page);
  try {
    for (const mode of ['http-401', 'code-40101'] as MfFixtureAuthFailure[]) {
      await test.step(mode, async () => {
        const failureOffset = network.httpFailures.length;
        const navigationOffset = childNavigations.length;
        const modeOffset = fixture.requests.length;
        const id = await createProject(runtime, `MF real auth failure ${mode}`);
        await writeText(runtime, id, 'preserved.md', 'Authentication failure must not mutate the canvas.');
        fixture.setAuthFailure(mode);
        await page.goto(`/?projectId=${id}`);
        const authPath = mode === 'http-401' ? '/api/kpandora/v1/login/user' : '/api/kpandora/v1/model/chat/list';
        const [authResponse] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === authPath),
          page.getByTestId('mf-conversation-toggle').click(),
        ]);
        const authBody: unknown = await authResponse.json();
        authResponses.push({ mode, url: authResponse.url(), status: authResponse.status(), body: authBody });
        if (mode === 'code-40101') {
          expect(authResponse.status()).toBe(200);
          expect(authBody).toMatchObject({ code: 40101, data: { location: 'https://mf-login.invalid/login' } });
        } else expect(authResponse.status()).toBe(401);
        const iframe = page.getByTestId('mf-conversation-frame');
        await expect(iframe).toBeVisible();
        const frameUrl = (await iframe.getAttribute('src'))!;
        expect(new URL(frameUrl).hostname).toBe(MF_FIXTURE_UI_HOST);
        await expect(page.getByTestId('mf-conversation-sidebar')).toContainText('MF 需要身份验证。');
        await expect(page.getByTestId('mf-new-session')).toBeDisabled();
        // Owner selection is intent, not readiness; users must still be able to opt out.
        await page.getByTestId('mf-execution-owner').check();
        await expect(page.getByTestId('mf-new-session')).toBeDisabled();
        await page.getByTestId('mf-execution-owner').uncheck();
        await expect(page.getByTestId('mf-new-session')).toBeDisabled();
        await expect(page.getByTestId('mf-conversation-sidebar')).toContainText('MF 需要身份验证。');
        await expect(page.frameLocator('[data-testid="mf-conversation-frame"]').locator('.mf-footnote')).toBeVisible();
        // Next may canonicalize the initial owned /mf-ui/ URL to /mf-ui.
        // No different origin, query, path, or subsequent login document is allowed.
        const canonical = (value: string) => { const url = new URL(value); if (url.pathname === '/mf-ui/') url.pathname = '/mf-ui'; return url.href; };
        expect(page.frames().filter(frame => canonical(frame.url()) === canonical(frameUrl))).toHaveLength(1);
        const navigations = childNavigations.slice(navigationOffset);
        expect(navigations.length).toBeGreaterThan(0);
        expect(navigations.length).toBeLessThanOrEqual(2);
        expect([...new Set(navigations.map(canonical))]).toEqual([canonical(frameUrl)]);
        expect(network.blocked.filter(url => new URL(url).hostname === 'mf-login.invalid')).toEqual([]);
        expect(network.ssoHealthRequests).toEqual([]);
        const failures = network.httpFailures.slice(failureOffset);
        if (mode === 'http-401') {
          expect(failures.length).toBeGreaterThan(0);
          expect(failures.every(failure => failure.status === 401 && new URL(failure.url).pathname === '/api/kpandora/v1/login/user')).toBe(true);
        } else expect(failures).toEqual([]);
        expect(fixture.requests.slice(modeOffset).some(request => request.path === authPath && request.authenticated)).toBe(true);
        expect(fixture.requests.slice(modeOffset).filter(request => request.path === '/api/kpandora/v1/chat/web')).toEqual([]);
        expect(await projectText(runtime, id, 'preserved.md')).toBe('Authentication failure must not mutate the canvas.');
        await expect(page.locator('.react-flow__node')).toHaveCount(0);
        expect((await api<{ tasks: unknown[] }>(runtime, `/api/projects/${id}/mf/tasks`)).tasks).toEqual([]);
        expect(network.errors).toEqual([]);
        expect(fixture.unexpected).toEqual([]);
        await page.screenshot({ path: info.outputPath(`mf-auth-${mode}.png`) });
      });
    }
  } finally {
    fixture.setAuthFailure();
    await network.attach(info);
    const path = info.outputPath('mf-auth-protocol.json');
    await writeFile(path, JSON.stringify({ modes: ['http-401', 'code-40101'], authResponses, childNavigations, requests: fixture.requests.slice(requestOffset), unexpected: fixture.unexpected }, null, 2));
    await info.attach('mf-auth-protocol.json', { path, contentType: 'application/json' });
  }
});
