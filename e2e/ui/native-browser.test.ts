import { writeFile } from 'node:fs/promises';
import { test, expect } from '@/playwright/suite';
import { api, createProject } from '@/api';
import { createBrowserFixture, pngBytes } from '@/tools-dev/browser-fixture';
import { expectIndependentWorkspace, openLauncher, screenshot, useEnglish } from '@/playwright/workspace';
import { T } from '@/timeouts';

type NativeView = HTMLElement & { getURL(): string; getWebContentsId(): number; executeJavaScript<T>(code: string): Promise<T>; loadURL(url: string): Promise<void> };
type Snapshot = { sessionId: string; projectId: string; tabId: string; navigationId: number; enabled: boolean; items: Array<{ id: string; name: string; kind: string; readable: boolean; url: string }> };

test('[P0] native browser navigation, project capture, resource grants and safe URL denial', async ({ nativePage: page, runtime }, testInfo) => {
  const fixture = await createBrowserFixture();
  const rendererErrors: Array<{ kind: string; text: string; location?: unknown }> = [];
  const redact = (text: string) => text.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-long-identifier]');
  const onConsole = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() === 'error') rendererErrors.push({ kind: 'console', text: redact(message.text()), location: message.location() });
  };
  const onPageError = (error: Error) => rendererErrors.push({ kind: 'pageerror', text: redact(error.stack ?? error.message) });
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    const id = await createProject(runtime, 'Native capture verification');
    const otherId = await createProject(runtime, 'Grant isolation target');
    await useEnglish(page);
    await page.goto(`${runtime.webUrl}/?projectId=${id}`);
    await expectIndependentWorkspace(page);
    await openLauncher(page);
    await page.getByRole('menuitem', { name: 'New Browser', exact: true }).click();
    await expect(page.getByTestId('design-browser-home')).toBeVisible();
    await screenshot(page, testInfo, '13-native-browser-home');
    await page.getByRole('textbox', { name: 'Browser address', exact: true }).fill(fixture.url);
    await page.getByRole('textbox', { name: 'Browser address', exact: true }).press('Enter');
    const view = page.locator('webview:visible');
    await expect(view).toBeVisible();
    await expect.poll(() => view.evaluate(node => (node as NativeView).getURL())).toBe(`${fixture.url}/`);
    await expect.poll(() => view.evaluate(node => (node as NativeView).executeJavaScript<string>('document.querySelector("#headline")?.textContent'))).toBe('Capture references into this project.');
    expect(await view.evaluate(node => (node as NativeView).executeJavaScript<string>('typeof globalThis.__bezier__'))).toBe('undefined');
    await screenshot(page, testInfo, '14-native-browser-page');
    // The original address bar settles blur into its label view asynchronously.
    // Observe that completion before refocusing, rather than racing its pending blur reset.
    await expect(page.getByRole('textbox', { name: 'Browser address', exact: true })).toHaveValue('');
    await page.getByRole('textbox', { name: 'Browser address', exact: true }).fill(`${fixture.url}/second`);
    await page.getByRole('textbox', { name: 'Browser address', exact: true }).press('Enter');
    await expect.poll(() => view.evaluate(node => (node as NativeView).executeJavaScript<string>('document.querySelector("#page-marker")?.textContent'))).toBe('Second page');
    await page.getByRole('button', { name: 'Go Back', exact: true }).click();
    await expect.poll(() => view.evaluate(node => (node as NativeView).getURL())).toBe(`${fixture.url}/`);
    await page.getByRole('button', { name: 'Go Forward', exact: true }).click();
    await expect.poll(() => view.evaluate(node => (node as NativeView).getURL())).toBe(`${fixture.url}/second`);
    await page.getByRole('button', { name: 'Go Back', exact: true }).click();
    await expect.poll(() => view.evaluate(node => (node as NativeView).executeJavaScript<string>('document.querySelector("#page-marker")?.textContent'))).toBe('First page');

    const start = page.waitForResponse(response => response.url().endsWith(`/api/projects/${id}/browser-resources/start`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Page resources', exact: true }).click();
    const started = await start;
    expect(started.ok()).toBe(true);
    const snapshot = await started.json() as Snapshot;
    const accessToken = started.request().headers()['x-browser-resource-token'];
    expect(accessToken).toBeTruthy();
    expect(snapshot.projectId).toBe(id);
    expect(snapshot.items.some(item => item.kind === 'svg' && !item.readable)).toBe(true);
    expect(snapshot.items.every(item => !item.url.includes('private='))).toBe(true);
    const raster = snapshot.items.find(item => item.name === 'image.png');
    expect(raster?.readable).toBe(true);
    await expect(page.getByRole('checkbox', { name: 'Select image.png', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select image.png', exact: true }).check();
    await screenshot(page, testInfo, '15-native-resources');
    const crossed = await fetch(`${runtime.serverUrl}/api/projects/${otherId}/browser-resources/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-browser-resource-token': accessToken! }, body: JSON.stringify({ sessionId: snapshot.sessionId }) });
    expect(crossed.status).toBe(403);

    await page.getByRole('button', { name: 'Save selected…', exact: true }).click();
    const saveImage = page.waitForResponse(response => response.url().endsWith(`/api/projects/${id}/files`) && response.request().method() === 'POST' && String(response.request().postDataJSON()?.name).endsWith('.png'));
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
    const imageSaved = await saveImage;
    expect(imageSaved.ok()).toBe(true);
    const imageFile = (await imageSaved.json() as { file: { name: string } }).file.name;
    const savedBytes = Buffer.from(await (await fetch(`${runtime.serverUrl}/api/projects/${id}/files/${encodeURIComponent(imageFile)}`)).arrayBuffer());
    expect(savedBytes.equals(pngBytes)).toBe(true);
    await expect(page.getByText('1 saved · 0 failed', { exact: true })).toBeVisible();
    await screenshot(page, testInfo, '16-native-project-resource-saved');

    await page.getByRole('button', { name: 'Close resource capture', exact: true }).click();
    let revokedStatus = 0;
    await expect.poll(async () => {
      const revoked = await fetch(`${runtime.serverUrl}/api/projects/${id}/browser-resources/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-browser-resource-token': accessToken! }, body: JSON.stringify({ sessionId: snapshot.sessionId }) });
      revokedStatus = revoked.status; return revokedStatus;
    }).toBe(403);
    await page.getByRole('button', { name: 'Browser menu', exact: true }).click();
    const saveScreenshot = page.waitForResponse(response => response.url().endsWith(`/api/projects/${id}/files`) && response.request().method() === 'POST' && String(response.request().postDataJSON()?.name).includes('browser-capture'), { timeout: T.long });
    await page.getByRole('menuitem', { name: 'Copy Screenshot', exact: true }).click();
    const screenshotSaved = await saveScreenshot;
    expect(screenshotSaved.ok()).toBe(true);
    const captureFile = (await screenshotSaved.json() as { file: { name: string } }).file.name;
    const captured = Buffer.from(await (await fetch(`${runtime.serverUrl}/api/projects/${id}/files/${encodeURIComponent(captureFile)}`)).arrayBuffer());
    expect(captured.length).toBeGreaterThan(1000);
    expect([...captured.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const capturedPath = testInfo.outputPath('17-native-captured-project-image.png');
    await writeFile(capturedPath, captured);
    await testInfo.attach('native-captured-project-image', { path: capturedPath, contentType: 'image/png' });

    await page.getByRole('button', { name: 'Browser menu', exact: true }).click();
    const saveArchive = page.waitForResponse(response => response.url().endsWith(`/api/projects/${id}/files`) && response.request().method() === 'POST' && String(response.request().postDataJSON()?.name).endsWith('/manifest.json'), { timeout: T.long });
    await page.getByRole('menuitem', { name: 'Download Page', exact: true }).click();
    expect((await saveArchive).ok()).toBe(true);
    const files = await api<{ files: Array<{ name: string }> }>(runtime, `/api/projects/${id}/files?scope=all`);
    expect(files.files.some(file => file.name.endsWith('/page.html'))).toBe(true);
    expect(files.files.some(file => file.name.endsWith('/styles.css'))).toBe(true);

    const aliasUrl = `http://localhost:${new URL(runtime.serverUrl).port}/api/health`;
    const aliasSubresourceDenied = await view.evaluate((node, url) => (node as NativeView).executeJavaScript<boolean>(`fetch(${JSON.stringify(url)}, {mode:'no-cors'}).then(()=>false,()=>true)`), aliasUrl);
    expect(aliasSubresourceDenied).toBe(true);
    const denialTarget = testInfo.outputPath('denied-local-document.html');
    await writeFile(denialTarget, '<h1>THIS LOCAL FILE MUST NOT LOAD IN A GUEST</h1>');
    const denied = await view.evaluate(async (node, url) => {
      try { await (node as NativeView).loadURL(url); return { rejected: false, error: '' }; }
      catch (error) { return { rejected: true, error: String(error) }; }
    }, new URL(`file://${denialTarget}`).href);
    expect(denied.rejected).toBe(true);
    // Electron reports either cancellation code depending on which native navigation guard wins.
    expect(denied.error).toMatch(/ERR_(?:BLOCKED_BY_CLIENT|FAILED|ABORTED)/);
    const visibleAfterDenial = await view.evaluate(async node => {
      try { return await (node as NativeView).executeJavaScript<string>('document.documentElement.textContent'); }
      catch { return ''; }
    });
    expect(visibleAfterDenial).not.toContain('THIS LOCAL FILE MUST NOT LOAD IN A GUEST');
    const privilegeDenied = await view.evaluate(async (node, url) => {
      try { await (node as NativeView).loadURL(url); return false; } catch { return true; }
    }, `${runtime.serverUrl}/api/health`);
    expect(privilegeDenied).toBe(true);
    const aliasNavigationDenied = await view.evaluate(async (node, url) => {
      try { await (node as NativeView).loadURL(url); return false; } catch { return true; }
    }, aliasUrl);
    expect(aliasNavigationDenied).toBe(true);
    await expectIndependentWorkspace(page);
    await testInfo.attach('native-evidence.json', { body: JSON.stringify({ projectId: id, capturedFile: captureFile, originalResourceFile: imageFile, resourceProjectIsolation: crossed.status, revokedGrantStatus: revokedStatus, fileNavigationDenied: denied.rejected, privilegedNavigationDenied: privilegeDenied, aliasSubresourceDenied, aliasNavigationDenied }), contentType: 'application/json' });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    const rendererErrorsPath = testInfo.outputPath('native-renderer-errors.json');
    await writeFile(rendererErrorsPath, JSON.stringify(rendererErrors, null, 2));
    await testInfo.attach('native-renderer-errors.json', { path: rendererErrorsPath, contentType: 'application/json' });
    await fixture.dispose();
  }
});
