import { test, expect } from '@/playwright/suite';
import { createProject } from '@/api';
import { expectIndependentWorkspace, openLauncher, screenshot, useChinese } from '@/playwright/workspace';
import { T } from '@/timeouts';

// Geometry comes from the retained 319e5eee CSS: routines.css project chrome,
// SketchEditor.module.css and @bezier/components CanvasViewToolbar. This tests
// the actual cascade and DOM ancestry, not whether those files merely exist.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`[P0] original workspace chrome and sketch layout under ${colorScheme} OS preference`, async ({ nativePage: page, runtime }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await useChinese(page);
    const id = await createProject(runtime, '样式还原对照');
    await page.goto(`${runtime.webUrl}/?projectId=${id}`);
    await expectIndependentWorkspace(page);
    await openLauncher(page);
    await page.getByRole('menuitem', { name: '新建草图', exact: true }).click();
    const editor = page.getByTestId('sketch-excalidraw-editor');
    const shapes = editor.locator('.excalidraw .shapes-section .App-toolbar');
    const view = page.getByRole('toolbar', { name: '草图视图控制', exact: true });
    await expect(shapes).toBeVisible({ timeout: T.long });
    await expect(view).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const metrics: unknown[] = [];
    for (const width of [1440, 840]) {
      await page.setViewportSize({ width, height: 900 });
      const snapshot = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector(selector)!;
          const css = getComputedStyle(element);
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
            padding: css.padding, gap: css.gap, borderBottomWidth: css.borderBottomWidth,
            radius: css.borderRadius, margin: css.margin, display: css.display, background: css.backgroundColor };
        };
        return { width: innerWidth, theme: document.documentElement.dataset.theme,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          shell: read('.ws-tabs-shell'), tabs: read('.ws-tabs-bar'), tab: read('.ws-tab.active'),
          workspace: read('.workspace'), header: read('[data-testid="sketch-header"]'),
          canvas: read('[data-testid="sketch-excalidraw-editor"]'),
          shapes: read('.sketch-editor .shapes-section .App-toolbar'),
          view: read('[aria-label="草图视图控制"]') };
      });
      metrics.push(snapshot);
      await page.bringToFront();
      await screenshot(page, testInfo, `style-${colorScheme}-${width}`);
      expect.soft(snapshot.theme).toBe('light');
      expect.soft(snapshot.accent).toBe('#353535');
      expect.soft(snapshot.shell.padding).toBe('6px 14px');
      expect.soft(snapshot.shell.borderBottomWidth).toBe('0px');
      expect.soft(snapshot.tabs.gap).toBe('6px');
      expect.soft(snapshot.tab.height).toBe(30);
      expect.soft(snapshot.tab.radius).toBe('12px');
      expect.soft(snapshot.workspace.x).toBe(8);
      expect.soft(snapshot.workspace.right).toBe(width - 8);
      expect.soft(snapshot.workspace.bottom).toBe(892);
      expect.soft(snapshot.header.height).toBeGreaterThanOrEqual(44);
      expect.soft(snapshot.shapes.height).toBe(40);
      expect.soft(snapshot.view.height).toBe(32);
      expect.soft(snapshot.view.radius).toBe('9px');
      expect.soft(snapshot.view.y - snapshot.canvas.y).toBe(8);
      expect.soft(snapshot.canvas.right - snapshot.view.right).toBe(8);
      expect.soft(snapshot.shapes.right <= snapshot.view.x || snapshot.shapes.y >= snapshot.view.bottom || snapshot.shapes.bottom <= snapshot.view.y).toBe(true);
    }
    await testInfo.attach('computed-style-metrics.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    await expect(page.getByTestId('sketch-export-image')).toBeDisabled();
    await expect(view.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    const saved = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(`/api/projects/${id}/files`)
      && String(response.request().postDataJSON()?.content).includes('rectangle'));
    await page.getByRole('button', { name: '页面线框', exact: true }).click();
    await expect(page.getByTestId('sketch-export-image')).toBeEnabled();
    await expect(view.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
    // Native tests share an owned window per worker. Do not navigate the next
    // case away from an unsaved drawing and trip the genuine beforeunload guard.
    expect((await saved).ok()).toBe(true);
    await expect(page.getByTestId('sketch-save-state')).toHaveAttribute('data-state', 'saved');
  });
}
