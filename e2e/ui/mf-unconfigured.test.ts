import { test, expect } from '@/playwright/suite';
import { createProject, projectText, writeText } from '@/api';
import { useChinese } from '@/playwright/workspace';
import { guardMfBrowserNetwork } from '@/playwright/mf-network';

test('unconfigured sidebar stays honest and never loads SDK APIs', async ({ page, runtime }, info) => {
  const network = await guardMfBrowserNetwork(page);
  const id = await createProject(runtime, 'MF unavailable isolation');
  await writeText(runtime, id, 'preserved.md', 'Local canvas remains authoritative.');
  await useChinese(page);
  try {
    await page.goto(`/?projectId=${id}`);
    await expect(page.getByTestId('canvas-workbench-surface')).toBeVisible();
    await page.getByTestId('mf-conversation-toggle').click();
    await expect(page.getByTestId('mf-conversation-sidebar')).toBeVisible();
    await expect(page.getByTestId('mf-conversation-sidebar')).toContainText(/未配置|尚未配置|不可用/);
    await expect(page.getByTestId('mf-execution-owner')).toBeDisabled();
    await expect(page.getByTestId('mf-conversation-frame')).toHaveCount(0);
    expect(network.sdkRequests).toEqual([]);
    expect(network.ssoHealthRequests).toEqual([]);
    expect(network.httpFailures).toEqual([]);
    expect(network.sdkFailures).toEqual([]);
    expect(network.errors).toEqual([]);
    expect(await projectText(runtime, id, 'preserved.md')).toBe('Local canvas remains authoritative.');
    await expect(page.getByTestId('canvas-workbench-surface')).toBeVisible();
  } finally { await network.attach(info); }
});
