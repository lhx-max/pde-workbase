import { test, expect } from '@/playwright/suite';
import { api, createProject, setTabs, writeText } from '@/api';
import { expectIndependentWorkspace, previewSelector, screenshot, useChinese } from '@/playwright/workspace';
import { webDocument } from './workspace-fixtures';

test('[P0] viewer shared tooltip and handoff layout retain the original host contract', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, '工具栏全量复验');
  await writeText(runtime, id, '工具栏.html', webDocument());
  await setTabs(runtime, id, ['工具栏.html'], '工具栏.html');
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await expect(page.frameLocator(previewSelector).first().getByRole('heading', { name: '画布研究' })).toBeVisible();
  const handoff = page.getByTestId('handoff-wrap');
  await expect(handoff).toBeVisible();
  await screenshot(page, testInfo, 'viewer-handoff-layout');
  await expect.soft(handoff).toHaveCSS('position', 'relative');
  // An inline-flex wrapper is blockified when it becomes a flex item.
  await expect.soft(handoff).toHaveCSS('display', 'flex');
  const button = handoff.locator('button');
  await button.hover();
  await expect(page.getByRole('tooltip')).toHaveText('选择交付目标');
  await screenshot(page, testInfo, 'viewer-shared-tooltip');
  await button.click();
  const error = page.getByTestId('handoff-fallback-error');
  await expect(error).toHaveText('当前宿主未配置交付目标。');
  await expect(error).toHaveCSS('font-size', '12px');
  await screenshot(page, testInfo, 'viewer-unconfigured-handoff');
});

test('[P0] original presentation portal fills the viewport in tab and fullscreen modes', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, '演示覆盖层全量复验');
  await writeText(runtime, id, '全屏演示.html', webDocument('全窗口演示内容'));
  await setTabs(runtime, id, ['全屏演示.html'], '全屏演示.html');
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await expect(page.frameLocator(previewSelector).first().getByRole('heading', { name: '全窗口演示内容' })).toBeVisible();
  for (const mode of [0, 1]) {
    await page.locator('.present-trigger:visible').click();
    await page.locator('.present-menu [role="menuitem"]').nth(mode).click();
    const overlay = page.locator('.present-overlay');
    await expect(overlay).toBeVisible();
    await screenshot(page, testInfo, `presentation-${mode === 0 ? 'in-tab' : 'fullscreen'}`);
    await expect(overlay).toHaveCSS('position', 'fixed');
    await expect(overlay).toHaveCSS('z-index', '1050');
    await expect.poll(() => overlay.evaluate(element => {
      const box = element.getBoundingClientRect();
      const frame = element.querySelector('iframe')!.getBoundingClientRect();
      return Math.max(Math.abs(box.left), Math.abs(box.top), Math.abs(box.width - innerWidth), Math.abs(box.height - innerHeight), Math.abs(frame.width - innerWidth), Math.abs(frame.height - innerHeight));
    })).toBeLessThanOrEqual(1);
    await expect(overlay.frameLocator('iframe').getByRole('heading', { name: '全窗口演示内容' })).toBeVisible();
    if (mode === 1) await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('present-overlay');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
  }
});

test('[P0] full asset library keeps the non-image grid and HTML preview geometry', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, '资产卡片全量复验');
  for (const suffix of ['甲', '乙']) {
    await api(runtime, '/api/asset-library', { name: `排版笔记${suffix}`, kind: 'text', content: `# 排版笔记${suffix}\n\n真实本地资产内容。` });
    await api(runtime, '/api/asset-library', { name: `网页封面${suffix}`, kind: 'webpage', content: webDocument(`网页封面${suffix}`) });
  }
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await page.locator('.dock-assets-button').click();
  const sidebar = page.getByTestId('canvas-assets-sidebar');
  await sidebar.getByRole('tab', { name: '资产', exact: true }).click();
  await sidebar.getByRole('button', { name: '打开完整资产库', exact: true }).click();
  const library = page.getByRole('dialog', { name: '资产库', exact: true });
  await expect(library).toBeVisible();
  await library.getByRole('button', { name: '文本', exact: true }).click();
  const grid = library.locator('.community-template-grid');
  await expect(library.getByRole('button', { name: '打开 排版笔记甲', exact: true })).toBeVisible();
  await screenshot(page, testInfo, 'asset-text-grid');
  await expect.soft(grid).toHaveCSS('display', 'grid');
  const preview = library.locator('.community-template-card__preview').first();
  await expect.soft(preview).toHaveCSS('display', 'grid');
  await library.getByRole('button', { name: '网页', exact: true }).click();
  const frame = library.locator('.community-template-thumb__html-frame').first();
  await expect(frame).toBeVisible();
  await screenshot(page, testInfo, 'asset-html-thumbnails');
  await expect(frame).toHaveCSS('position', 'absolute');
  await expect(frame).toHaveCSS('transform-origin', '0px 0px');
  await expect(frame).toHaveCSS('transform', 'matrix(0.4, 0, 0, 0.4, 0, 0)');
  for (const width of [1440, 840, 560]) {
    await page.setViewportSize({ width, height: 960 });
    await screenshot(page, testInfo, `asset-expanded-${width}`);
    const box = await library.boundingBox();
    expect.soft(box!.width).toBeCloseTo(width <= 640 ? width : width - 64, 0);
    expect.soft(await library.evaluate(element => getComputedStyle(element).padding)).toBe('0px');
    const header = library.getByRole('heading', { name: '资产库', exact: true }).locator('..');
    expect.soft(await header.evaluate(element => getComputedStyle(element).flexDirection)).toBe('row');
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await library.getByRole('button', { name: '打开 网页封面甲', exact: true }).hover();
  await library.getByRole('button', { name: '网页封面甲 更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await screenshot(page, testInfo, 'asset-delete-confirmation');
  expect.soft((await confirmation.boundingBox())!.width).toBeCloseTo(420, 0);
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await library.getByRole('button', { name: '新建', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建个人资产', exact: true });
  await expect(form).toBeVisible();
  await screenshot(page, testInfo, 'asset-create-form');
  expect.soft((await form.boundingBox())!.width).toBeCloseTo(640, 0);
  await form.getByRole('button', { name: '取消', exact: true }).click();
});
