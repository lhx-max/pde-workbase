import { test, expect } from '@/playwright/suite';
import { api, createProject } from '@/api';
import { createBrowserFixture } from '@/tools-dev/browser-fixture';
import { expectIndependentWorkspace, openLauncher, screenshot, useEnglish } from '@/playwright/workspace';
import { T } from '@/timeouts';
import { randomUUID } from 'node:crypto';

type Asset = { id: string; name: string; revision: number; source?: { projectId?: string; url?: string } };

test.skip(process.env.CANVAS_E2E_CONFIRM_NATIVE_EXTENSION !== '1', 'Requires a human to confirm the native Enable dialog; never bypass OS consent.');

test('[manual] actual external extension selection, original save dialog and inspector reach the local library', async ({ nativePage: app, externalExtension, runtime }, testInfo) => {
  test.setTimeout(T.xlong * 3);
  const fixture = await createBrowserFixture();
  const { page, id } = externalExtension;
  try {
    expect(id).toBe('filiogdhdejjikcnhfgdclfcnflecgpd');
    const workspaceName = `External extension workspace ${randomUUID()}`;
    const projectId = await createProject(runtime, workspaceName);
    await useEnglish(app);
    await app.goto(`${runtime.webUrl}/?projectId=${projectId}`);
    await expectIndependentWorkspace(app);
    await openLauncher(app);
    await app.getByRole('menuitem', { name: 'New Browser', exact: true }).click();
    await app.getByRole('button', { name: 'Browser menu', exact: true }).click();
    await app.getByRole('menuitem', { name: 'Browser extension', exact: true }).click();
    await app.getByTestId('settings-browser-extension').getByRole('button', { name: 'Install extension', exact: true }).click();
    // A human confirms the real OS dialog. The subsequent ZIP Save As can be
    // canceled: this fixture already staged the built ZIP into its own profile.
    await page.goto(fixture.url);
    // Real trusted mouse input in a separate Chrome for Testing profile, not
    // chrome.runtime.sendMessage/evaluate injection or a synthetic bridge request.
    await page.locator('#headline').click({ clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection()?.toString().trim());
    expect(selected).toBeTruthy();
    const capture = page.locator('#da-capture-root');
    await expect(capture.locator('.barBtn')).toBeVisible();
    await capture.locator('.barBtn').click();
    const dialog = capture.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.save')).toBeEnabled({ timeout: T.xlong });
    // Discovery must name THIS owned project before any write, not another
    // independently running workspace listening on a discovery port.
    await expect(dialog).toContainText(workspaceName);
    await dialog.locator('#da-name').fill('External captured reference');
    await screenshot(page, testInfo, '31-external-extension-original-save-dialog');
    await dialog.locator('.save').click();
    const assets = async () => (await api<{ assets: Asset[] }>(runtime, '/api/asset-library?scope=local')).assets;
    await expect.poll(async () => (await assets()).some(asset => asset.name === 'External captured reference')).toBe(true);
    const asset = (await assets()).find(asset => asset.name === 'External captured reference')!;
    expect(asset.source?.projectId).toBe(projectId);
    expect(asset.source?.url).toBe(`${fixture.url}/`);
    const bytes = await fetch(`${runtime.serverUrl}/api/asset-library/${asset.id}/content`);
    expect(bytes.ok).toBe(true);
    expect(await bytes.text()).toBe(selected);
    await testInfo.attach('external-extension-write-evidence.json', { body: JSON.stringify({ projectId, extensionId: id, assetId: asset.id, exactTextRetained: true, projectAssociationRetained: true, inspectorRecheckComplete: false }), contentType: 'application/json' });
    await expect(dialog.locator('.save')).toHaveText(/^(Save changes|保存修改)$/);
    await dialog.locator('#da-name').fill('External reference verified');
    await dialog.locator('.save').click();
    await expect.poll(async () => (await assets()).find(row => row.id === asset.id)?.name).toBe('External reference verified');
    expect((await assets()).filter(row => row.id === asset.id)).toHaveLength(1);
    await dialog.locator('.yamlToggle').click();
    await expect(dialog.locator('#da-yaml')).toBeVisible();
    await expect(dialog.locator('#da-yaml')).toHaveValue(/External reference verified/);
    await screenshot(page, testInfo, '32-external-extension-live-saved-inspector');
    await expect(app.getByTestId('settings-browser-extension').getByRole('status')).toBeVisible({ timeout: T.xlong });
    await app.getByRole('dialog', { name: 'Browser extension', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    await app.getByRole('tab', { name: workspaceName, exact: true }).click();
    await app.locator('.dock-assets-button').click();
    const sidebar = app.getByTestId('canvas-assets-sidebar');
    await sidebar.getByRole('tab', { name: 'Assets', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: 'Open External reference verified', exact: true })).toBeVisible();
    await screenshot(app, testInfo, '33-external-capture-in-original-local-library');
    await testInfo.attach('external-extension-evidence.json', { body: JSON.stringify({ projectId, extensionId: id, assetId: asset.id, selected, exactTextRetained: true, inspectorUpdatesSameAsset: true, ordinaryBrowserProfileTouched: false }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});
