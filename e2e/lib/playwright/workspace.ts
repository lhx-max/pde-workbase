import type { Page, TestInfo } from '@playwright/test';
import { expect } from './suite.js';
export const previewSelector = '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-url-load"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible';
export async function useEnglish(page: Page) {
  await page.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('bezier:locale', 'en'); localStorage.setItem('bezier:locale-source', 'manual'); });
}
/** Ordinary acceptance screenshots use Simplified Chinese, independent of host locale. */
export async function useChinese(page: Page) {
  await page.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('bezier:locale', 'zh-CN'); localStorage.setItem('bezier:locale-source', 'manual'); });
}
export async function openLauncher(page: Page) {
  await page.getByTestId('workspace-add-tab').click();
  await expect(page.getByTestId('tab-launcher-menu')).toBeVisible();
}
export async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}
export async function expectIndependentWorkspace(page: Page) {
  await expect(page.getByTestId('file-workspace')).toBeVisible();
  await expect(page.locator('.chat-pane:visible, .chat-composer:visible, [data-testid="chat-pane"]:visible')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^(Chat|Library|Personal assets|Team assets|对话|聊天|个人资产|团队资产)$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(New chat|Personal assets|Team assets|新建对话|新建聊天|个人资产|团队资产)$/i })).toHaveCount(0);
}
