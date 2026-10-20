import { test, expect } from '@/playwright/suite';
import { createProject, writeText, writePresentation, setTabs, webDocument, projectText, api } from '@/api';
import { expectIndependentWorkspace, openLauncher, previewSelector, screenshot, useEnglish } from '@/playwright/workspace';
import { T } from '@/timeouts';

test('[P0] original workspace launcher, project assets, text, sketch and clip persist', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, 'Workspace surface verification');
  await writeText(runtime, id, 'Research.md', '# Research notes\n\nProject-bound files stay next to the canvas.');
  await writeText(runtime, id, 'Overview.html', webDocument());
  await writePresentation(runtime, id, 'Presentation.html');
  await setTabs(runtime, id, ['Overview.html', 'Presentation.html']);
  await useEnglish(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await expect(page.getByTestId('canvas-workbench-surface')).toBeVisible();
  const viewControls = page.getByRole('toolbar', { name: 'Board view controls', exact: true });
  await expect(viewControls).toHaveCSS('display', 'flex');
  await expect(viewControls).toHaveCSS('height', '32px');
  await expect(viewControls).toHaveCSS('flex-direction', 'row');
  await expect(viewControls.locator('svg').first()).toHaveCSS('width', '15px');
  await expect(page.getByText(/describe an idea in chat/i)).toHaveCount(0);
  await screenshot(page, testInfo, '01-full-workspace');

  await page.locator('.dock-assets-button').click();
  await expect(page.getByTestId('canvas-assets-sidebar')).toBeVisible();
  await expect(page.getByTestId('canvas-sidebar-file-Research.md')).toBeVisible();
  const sidebarFiles = page.getByTestId('canvas-assets-sidebar').locator('[data-testid^="canvas-sidebar-file-"]');
  await expect(sidebarFiles).toHaveCount(3);
  expect((await sidebarFiles.evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')!.replace('canvas-sidebar-file-', '')))).sort()).toEqual(['Overview.html', 'Presentation.html', 'Research.md']);
  await screenshot(page, testInfo, '02-project-assets');
  await page.getByTestId('canvas-assets-sidebar').getByRole('button', { name: /close/i }).click();

  await openLauncher(page);
  for (const name of ['New Browser', 'New sketch', 'Text', 'Clip']) await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await screenshot(page, testInfo, '03-launcher-tabs');
  const createText = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && String(response.request().postDataJSON()?.name).endsWith('.md'));
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  const textCreated = await createText;
  expect(textCreated.ok()).toBe(true);
  const textName = (await textCreated.json() as { file: { name: string } }).file.name;
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  const markdown = '# A persistent canvas note\n\nEdited in the original Markdown surface.';
  const saveText = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && response.request().postDataJSON()?.content === markdown);
  await page.getByRole('textbox', { name: 'Markdown editor', exact: true }).fill(markdown);
  expect((await saveText).ok()).toBe(true);
  expect(await projectText(runtime, id, textName)).toBe(markdown);
  await page.getByRole('tab', { name: 'Split', exact: true }).click();
  await screenshot(page, testInfo, '04-text-editor');

  await openLauncher(page);
  const createSketch = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && /\.(excalidraw|sketch\.json)$/.test(String(response.request().postDataJSON()?.name)));
  await page.getByRole('menuitem', { name: 'New sketch', exact: true }).click();
  const sketchCreated = await createSketch;
  expect(sketchCreated.ok()).toBe(true);
  const sketchName = (await sketchCreated.json() as { file: { name: string } }).file.name;
  await expect(page.locator('.excalidraw:visible')).toBeVisible({ timeout: T.long });
  await expect(page.locator('.excalidraw:visible canvas').first()).toBeVisible();
  const sketchSaved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && response.request().postDataJSON()?.name === sketchName && String(response.request().postDataJSON()?.content).includes('rectangle'));
  await page.getByRole('button', { name: 'Page wireframe', exact: true }).click();
  expect((await sketchSaved).ok()).toBe(true);
  expect(await projectText(runtime, id, sketchName)).toContain('rectangle');
  await screenshot(page, testInfo, '05-sketch-editor');

  await openLauncher(page);
  await page.getByRole('menuitem', { name: 'Clip', exact: true }).click();
  await expect(page.locator('.clip-timeline:visible').first()).toBeVisible({ timeout: T.long });
  await expect.poll(async () => {
    const saved = await api<{ state: { workbenchBasicNodes?: Array<{ kind: string }> } }>(runtime, `/api/projects/${id}/canvas/state`);
    return saved.state.workbenchBasicNodes?.filter(node => node.kind === 'clip').length ?? 0;
  }).toBe(1);
  await screenshot(page, testInfo, '06-clip-workspace');
  await expectIndependentWorkspace(page);
  await page.reload();
  await expectIndependentWorkspace(page);
  await expect(page.locator('.clip-timeline:visible').first()).toBeVisible({ timeout: T.long });
  expect(await projectText(runtime, id, textName)).toBe(markdown);
});

test('[P0] HTML and presentation previews, source, manual edit and version history roundtrip', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, 'Preview revision verification');
  await writeText(runtime, id, 'Overview.html', webDocument('Original canvas heading'));
  await writePresentation(runtime, id, 'Presentation.html');
  await setTabs(runtime, id, ['Overview.html', 'Presentation.html'], 'Overview.html');
  await useEnglish(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  const frame = page.frameLocator(previewSelector).first();
  await expect(frame.getByRole('heading', { name: 'Original canvas heading' })).toBeVisible({ timeout: T.long });
  await expect(frame.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  // Original URL-load/srcDoc activation can reload once after the first paint.
  // Retry the idempotent fixture action until the active document responds.
  await expect(async () => {
    await frame.getByRole('button', { name: 'Try interaction' }).click({ timeout: T.short });
    await expect(frame.getByRole('button', { name: 'Interaction verified' })).toBeVisible({ timeout: T.short });
  }).toPass({ timeout: T.long });
  await screenshot(page, testInfo, '07-html-preview');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.locator('.viewer-source:visible')).toContainText('Original canvas heading');
  await screenshot(page, testInfo, '08-html-source');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();

  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(frame.locator('html[data-bezier-edit-mode]')).toHaveCount(1);
  await expect(frame.locator('html[data-bezier-edit-mode]')).toHaveCount(1);
  // Preserve the original harness's bridge-reemit completion signal.
  await expect(async () => {
    await frame.getByRole('heading', { name: 'Original canvas heading' }).click({ timeout: T.short });
    await expect(frame.locator('#headline[data-bezier-edit-selected="true"]')).toHaveCount(1, { timeout: T.short });
  }).toPass({ timeout: T.long });
  const selectedText = page.locator('.manual-edit-modal').getByRole('textbox', { name: 'Text', exact: true });
  await expect(selectedText).toBeVisible();
  const original = await selectedText.inputValue();
  expect(original).toContain('Original canvas heading');
  await selectedText.fill(original.replace('Original canvas heading', 'Revised canvas heading'));
  const save = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && response.request().postDataJSON()?.name === 'Overview.html');
  await page.locator('.manual-edit-modal').getByRole('button', { name: 'Save', exact: true }).click();
  expect((await save).ok()).toBe(true);
  await expect.poll(() => projectText(runtime, id, 'Overview.html')).toContain('Revised canvas heading');
  await screenshot(page, testInfo, '09-html-manual-edit');
  await page.getByTestId('manual-edit-mode-toggle').click();
  await page.locator('.viewer-toolbar-more:visible > button').click();
  await page.locator('[data-bezier-version-entry="true"]').click();
  await expect(page.getByRole('dialog', { name: 'Versions', exact: true })).toBeVisible();
  const history = await api<{ versions: Array<{ id: string }> }>(runtime, `/api/projects/${id}/files/Overview.html/versions`);
  expect(history.versions.length).toBeGreaterThanOrEqual(2);
  await screenshot(page, testInfo, '10-html-versions');
  await page.reload();
  await expect(frame.getByRole('heading', { name: 'Revised canvas heading' })).toBeVisible({ timeout: T.long });

  await page.getByRole('tab').filter({ hasText: 'Presentation.html' }).click();
  await expect(frame.getByRole('heading', { name: 'From references to delivery.' })).toBeVisible({ timeout: T.long });
  await expect(page.locator('.deck-thumbnail-rail [data-slide-index]')).toHaveCount(2);
  await screenshot(page, testInfo, '11-presentation-preview');
  await page.locator('[data-testid="comment-preview-canvas"]:visible').hover({ position: { x: 3, y: 3 } });
  await expect(page.locator('.deck-floating-nav:visible')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Next slide', exact: true }).click({ timeout: T.short });
  await expect(frame.getByRole('heading', { name: 'Keep assets beside the work.' })).toBeInViewport();
  await screenshot(page, testInfo, '11b-presentation-second-slide');
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.locator('.viewer-source:visible')).toContainText('PROJECT-BOUND BY DESIGN');
  await screenshot(page, testInfo, '12-presentation-source');
  await expectIndependentWorkspace(page);
});
