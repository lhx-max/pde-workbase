import { test, expect } from '@/playwright/suite';
import { createProject } from '@/api';
import { expectIndependentWorkspace, screenshot, useChinese } from '@/playwright/workspace';

test('[P0] original canvas mode popover stays compact and switches pointer/hand', async ({ page, runtime }, testInfo) => {
  const id = await createProject(runtime, '工具菜单样式验证');
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  const trigger = page.locator('.dock-mode-button');
  await trigger.hover();
  const menu = page.locator('.dock-mode-popover.home-workbench-popover');
  await expect(menu).toBeVisible();
  // Move into the popup, matching its hover retention contract, not a timeout.
  await menu.hover();
  await expect(menu.locator('.dock-mode-option')).toHaveCount(2);
  await screenshot(page, testInfo, 'canvas-mode-menu');
  await menu.screenshot({ path: testInfo.outputPath('canvas-mode-menu-detail.png'), animations: 'disabled' });
  // Original host overrides reset the generic Popover's w-72/p-4 and the
  // nested .canvas-workbench page background. Content retains its 144px minimum.
  await expect.soft(menu).toHaveCSS('padding', '0px', { timeout: 500 });
  await expect.soft(menu).toHaveCSS('width', '144px', { timeout: 500 });
  await expect.soft(menu).toHaveCSS('border-top-width', '0px', { timeout: 500 });
  await expect.soft(menu.locator('.home-workbench-popover__scope')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)', { timeout: 500 });
  await expect(menu.locator('.dock-mode-options')).toHaveCSS('padding', '4px');
  // Original icon primitive has a 36px minimum width; the dock sets height 34px.
  await expect(trigger).toHaveCSS('width', '36px');
  await expect(trigger).toHaveCSS('height', '34px');
  await menu.getByRole('button', { name: '选择 V', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await trigger.hover();
  await expect(menu).toBeVisible();
  await menu.hover();
  await expect(menu.getByRole('button', { name: '选择 V', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: '抓手 H', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await trigger.hover();
  await expect(menu).toBeVisible();
  await menu.hover();
  await expect(menu.getByRole('button', { name: '抓手 H', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
