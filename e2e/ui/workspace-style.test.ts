import { test, expect } from '@/playwright/suite';
import { createProject, writeText, setTabs } from '@/api';
import { webDocument } from './workspace-fixtures';
import { expectIndependentWorkspace, previewSelector, screenshot, useChinese } from '@/playwright/workspace';
import { T } from '@/timeouts';

test('[P0] original image export dialog keeps its full-screen scrim and centered frame', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, '导出弹窗样式验证');
  await writeText(runtime, id, '页面.html', webDocument());
  await setTabs(runtime, id, ['页面.html'], '页面.html');
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await expect(page.frameLocator(previewSelector).first().locator('html')).toHaveAttribute('data-fixture-ready', 'true', { timeout: T.long });
  await page.getByRole('button', { name: /^更多: 导出/ }).click();
  await page.getByRole('menuitem', { name: '导出', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出为图片', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出为图片', exact: true });
  await expect(dialog).toBeVisible();
  const backdrop = page.locator('.image-export-backdrop:visible');
  await screenshot(page, testInfo, 'style-image-export-dialog');
  await expect.soft(backdrop).toHaveCSS('position', 'fixed', { timeout: 500 });
  await expect.soft(backdrop).toHaveCSS('display', 'flex', { timeout: 500 });
  await expect.soft(backdrop).toHaveCSS('background-color', 'rgba(28, 27, 26, 0.42)', { timeout: 500 });
  const box = await dialog.boundingBox();
  const scrim = await backdrop.boundingBox();
  expect.soft(scrim).toEqual({ x: 0, y: 0, width: 1440, height: 960 });
  expect.soft(box).not.toBeNull();
  if (box) {
    expect.soft(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(1);
    expect.soft(Math.abs(box.y + box.height / 2 - 480)).toBeLessThan(1);
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(previewSelector).first()).toBeVisible();
});
