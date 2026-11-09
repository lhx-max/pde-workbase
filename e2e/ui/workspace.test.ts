import { test, expect } from '@/playwright/suite';
import { createProject, writeText, setTabs, projectText, api } from '@/api';
import { webDocument, writePresentation } from './workspace-fixtures';
import { expectIndependentWorkspace, openLauncher, previewSelector, screenshot, useChinese } from '@/playwright/workspace';
import { T } from '@/timeouts';

test('[P0] original workspace launcher, project assets, text, sketch and clip persist', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, '工作区功能验证');
  await writeText(runtime, id, '研究笔记.md', '# 研究笔记\n\n项目文件与画布保存在一起。');
  await writeText(runtime, id, '项目概览.html', webDocument());
  await writePresentation(runtime, id, '演示文稿.html');
  await setTabs(runtime, id, ['项目概览.html', '演示文稿.html']);
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await expect(page.getByTestId('canvas-workbench-surface')).toBeVisible();
  const viewControls = page.getByRole('toolbar', { name: '画板视图控制', exact: true });
  await expect(viewControls).toHaveCSS('display', 'flex');
  await expect(viewControls).toHaveCSS('height', '32px');
  await expect(viewControls).toHaveCSS('flex-direction', 'row');
  await expect(viewControls.locator('svg').first()).toHaveCSS('width', '15px');
  await expect(page.getByText(/describe an idea in chat/i)).toHaveCount(0);
  await screenshot(page, testInfo, '01-full-workspace');

  await page.locator('.dock-assets-button').click();
  await expect(page.getByTestId('canvas-assets-sidebar')).toBeVisible();
  await expect(page.getByTestId('canvas-sidebar-file-研究笔记.md')).toBeVisible();
  const sidebarFiles = page.getByTestId('canvas-assets-sidebar').locator('[data-testid^="canvas-sidebar-file-"]');
  await expect(sidebarFiles).toHaveCount(3);
  expect((await sidebarFiles.evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')!.replace('canvas-sidebar-file-', '')))).sort()).toEqual(['项目概览.html', '演示文稿.html', '研究笔记.md'].sort());
  await screenshot(page, testInfo, '02-project-assets');
  await page.getByTestId('canvas-assets-sidebar').getByRole('button', { name: '关闭', exact: true }).click();

  await openLauncher(page);
  for (const name of ['新建浏览器', '新建草图', '文本', '剪辑']) await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await screenshot(page, testInfo, '03-launcher-tabs');
  const createText = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && String(response.request().postDataJSON()?.name).endsWith('.md'));
  await page.getByRole('menuitem', { name: '文本', exact: true }).click();
  const textCreated = await createText;
  expect(textCreated.ok()).toBe(true);
  const textName = (await textCreated.json() as { file: { name: string } }).file.name;
  await page.getByRole('tab', { name: '代码', exact: true }).click();
  const markdown = '# 可持久保存的画布笔记\n\n在原始 Markdown 编辑界面中修改。';
  const saveText = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && response.request().postDataJSON()?.content === markdown);
  await page.getByRole('textbox', { name: 'Markdown 编辑器', exact: true }).fill(markdown);
  expect((await saveText).ok()).toBe(true);
  expect(await projectText(runtime, id, textName)).toBe(markdown);
  await page.getByRole('tab', { name: '分栏', exact: true }).click();
  await screenshot(page, testInfo, '04-text-editor');

  await openLauncher(page);
  const createSketch = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && /\.(excalidraw|sketch\.json)$/.test(String(response.request().postDataJSON()?.name)));
  await page.getByRole('menuitem', { name: '新建草图', exact: true }).click();
  const sketchCreated = await createSketch;
  expect(sketchCreated.ok()).toBe(true);
  const sketchName = (await sketchCreated.json() as { file: { name: string } }).file.name;
  await expect(page.locator('.excalidraw:visible')).toBeVisible({ timeout: T.long });
  await expect(page.locator('.excalidraw:visible canvas').first()).toBeVisible();
  const sketchSaved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && response.request().postDataJSON()?.name === sketchName && String(response.request().postDataJSON()?.content).includes('rectangle'));
  await page.getByRole('button', { name: '页面线框', exact: true }).click();
  expect((await sketchSaved).ok()).toBe(true);
  expect(await projectText(runtime, id, sketchName)).toContain('rectangle');
  await screenshot(page, testInfo, '05-sketch-editor');

  await openLauncher(page);
  await page.getByRole('menuitem', { name: '剪辑', exact: true }).click();
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
  const id = await createProject(runtime, '预览与版本验证');
  await writeText(runtime, id, '项目概览.html', webDocument('原始画布标题'));
  await writePresentation(runtime, id, '演示文稿.html');
  await setTabs(runtime, id, ['项目概览.html', '演示文稿.html'], '项目概览.html');
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  const frame = page.frameLocator(previewSelector).first();
  await expect(frame.getByRole('heading', { name: '原始画布标题' })).toBeVisible({ timeout: T.long });
  await expect(frame.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  // Original URL-load/srcDoc activation can reload once after the first paint.
  // Retry the idempotent fixture action until the active document responds.
  await expect(async () => {
    await frame.getByRole('button', { name: '验证交互' }).click({ timeout: T.short });
    await expect(frame.getByRole('button', { name: '交互验证成功' })).toBeVisible({ timeout: T.short });
  }).toPass({ timeout: T.long });
  await screenshot(page, testInfo, '07-html-preview');
  await page.getByRole('tab', { name: '代码', exact: true }).click();
  await expect(page.locator('.viewer-source:visible')).toContainText('原始画布标题');
  await screenshot(page, testInfo, '08-html-source');
  await page.getByRole('tab', { name: '预览', exact: true }).click();

  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(frame.locator('html[data-bezier-edit-mode]')).toHaveCount(1);
  await expect(frame.locator('html[data-bezier-edit-mode]')).toHaveCount(1);
  // Preserve the original harness's bridge-reemit completion signal.
  await expect(async () => {
    await frame.getByRole('heading', { name: '原始画布标题' }).click({ timeout: T.short });
    await expect(frame.locator('#headline[data-bezier-edit-selected="true"]')).toHaveCount(1, { timeout: T.short });
  }).toPass({ timeout: T.long });
  const selectedText = page.locator('.manual-edit-modal').getByRole('textbox', { name: '文本', exact: true });
  await expect(selectedText).toBeVisible();
  const original = await selectedText.inputValue();
  expect(original).toContain('原始画布标题');
  await selectedText.fill(original.replace('原始画布标题', '修订后的画布标题'));
  const save = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${id}/files`) && response.request().postDataJSON()?.name === '项目概览.html');
  await page.locator('.manual-edit-modal').getByRole('button', { name: '保存', exact: true }).click();
  expect((await save).ok()).toBe(true);
  await expect.poll(() => projectText(runtime, id, '项目概览.html')).toContain('修订后的画布标题');
  await screenshot(page, testInfo, '09-html-manual-edit');
  await page.getByTestId('manual-edit-mode-toggle').click();
  await page.locator('.viewer-toolbar-more:visible > button').click();
  await page.locator('[data-bezier-version-entry="true"]').click();
  await expect(page.getByRole('dialog', { name: '版本管理', exact: true })).toBeVisible();
  const history = await api<{ versions: Array<{ id: string }> }>(runtime, `/api/projects/${id}/files/项目概览.html/versions`);
  expect(history.versions.length).toBeGreaterThanOrEqual(2);
  await screenshot(page, testInfo, '10-html-versions');
  await page.reload();
  await expect(frame.getByRole('heading', { name: '修订后的画布标题' })).toBeVisible({ timeout: T.long });

  await page.getByRole('tab').filter({ hasText: '演示文稿.html' }).click();
  await expect(frame.getByRole('heading', { name: '从参考资料到最终交付。' })).toBeVisible({ timeout: T.long });
  await expect(page.locator('.deck-thumbnail-rail [data-slide-index]')).toHaveCount(2);
  await screenshot(page, testInfo, '11-presentation-preview');
  await page.locator('[data-testid="comment-preview-canvas"]:visible').hover({ position: { x: 3, y: 3 } });
  await expect(page.locator('.deck-floating-nav:visible')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '下一张', exact: true }).click({ timeout: T.short });
  await expect(frame.getByRole('heading', { name: '让素材与作品保持相伴。' })).toBeInViewport();
  await screenshot(page, testInfo, '11b-presentation-second-slide');
  await page.getByRole('tab', { name: '代码', exact: true }).click();
  await expect(page.locator('.viewer-source:visible')).toContainText('围绕项目组织素材');
  await screenshot(page, testInfo, '12-presentation-source');
  await expectIndependentWorkspace(page);
});
