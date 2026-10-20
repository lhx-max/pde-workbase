import { test, expect } from '@/playwright/suite';
import { createProject } from '@/api';
import { expectIndependentWorkspace, screenshot, useChinese } from '@/playwright/workspace';

// Production UI only: create a real node; never call the external generator.
test('[P0] image ratio and resolution popover shows every option without clipping', async ({ page, runtime }, testInfo) => {
  await useChinese(page);
  for (const width of [1440, 840]) {
    await page.setViewportSize({ width, height: 960 });
    const id = await createProject(runtime, `生成面板样式核验-${width}`);
    await page.goto(`/?projectId=${id}`);
    await expectIndependentWorkspace(page);
    await page.locator('.dock-primary').click();
    await page.getByRole('menuitem', { name: '图片', exact: true }).click();
    const trigger = page.locator('.minimax-image-chip.is-params:visible');
    await expect(trigger).toBeVisible();
    await expect(page.getByRole('button', { name: '选择图片模板', exact: true })).toHaveText('模板');
    const count = page.locator('.minimax-image-chip.is-count');
    await count.click();
    const countMenu = page.getByRole('menu', { name: '生成数量', exact: true });
    const lastCount = countMenu.getByRole('menuitemradio').last();
    const countLabel = (await lastCount.innerText()).trim();
    await screenshot(page, testInfo, `image-count-${width}`);
    await lastCount.click();
    await expect(count).toContainText(countLabel);
    await trigger.click();
    const popup = page.locator('.home-workbench-popover.is-params-menu:visible');
    await expect(popup).toBeVisible();
    await expect(popup).toHaveCSS('width', '380px');
    await expect(popup).toHaveCSS('padding', '0px');
    await expect(popup.locator('.home-workbench-popover__scope')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const ratios = popup.locator('.is-ratio button');
    await expect(ratios).toHaveCount(5);
    const clipping = await popup.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll('button')).map(button => {
        const box = button.getBoundingClientRect();
        return { text: button.textContent, visible: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom };
      });
    });
    expect(clipping.every(item => item.visible), JSON.stringify(clipping)).toBe(true);
    const last = ratios.last();
    const label = (await last.innerText()).trim();
    await last.click();
    await expect(last).toHaveAttribute('aria-pressed', 'true');
    await screenshot(page, testInfo, `image-params-${width}`);
    await expect(trigger).toContainText(label);
    // The canvas also deselects its node on Escape; validate the value first.
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  }
});
