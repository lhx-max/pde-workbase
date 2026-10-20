import { test, expect } from '@/playwright/suite';
import { createProject } from '@/api';
import { expectIndependentWorkspace, openLauncher, screenshot } from '@/playwright/workspace';

// Do not call useChinese here: this is a first-run product-default regression,
// not a test of a manually pinned locale or the host/browser language detector.
test('[P0] 英语浏览器全新配置默认简体中文，仍尊重手动英语偏好', async ({ browser, runtime }, testInfo) => {
  const id = await createProject(runtime, '首次启动默认语言验证');
  const context = await browser.newContext({
    locale: 'en-US',
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 960 },
  });
  try {
    expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
    const page = await context.newPage();
    await page.goto(`${runtime.webUrl}/?projectId=${id}`);
    await expectIndependentWorkspace(page);
    expect(await page.evaluate(() => navigator.language)).toBe('en-US');
    expect(await page.evaluate(() => navigator.languages)).toEqual(['en-US']);
    // A default must not be fabricated by the test writing locale storage.
    expect(await page.evaluate(() => ({
      locale: localStorage.getItem('bezier:locale'),
      source: localStorage.getItem('bezier:locale-source'),
    }))).toEqual({ locale: null, source: null });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('toolbar', { name: '画板视图控制', exact: true })).toBeVisible();
    await openLauncher(page);
    for (const name of ['新建浏览器', '新建草图', '文本', '剪辑']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('menuitem', { name: 'New Browser', exact: true })).toHaveCount(0);
    await screenshot(page, testInfo, '00-default-chinese-english-browser');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    // Simulate an existing deliberate user preference, only AFTER proving the
    // untouched first run. Reload must respect this public persistence contract.
    await page.evaluate(() => {
      localStorage.setItem('bezier:locale', 'en');
      localStorage.setItem('bezier:locale-source', 'manual');
    });
    await page.reload();
    await expectIndependentWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await openLauncher(page);
    await expect(page.getByRole('menuitem', { name: 'New Browser', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '新建浏览器', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => ({
      locale: localStorage.getItem('bezier:locale'),
      source: localStorage.getItem('bezier:locale-source'),
    }))).toEqual({ locale: 'en', source: 'manual' });
  } finally {
    await context.close();
  }
});
