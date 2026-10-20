import type { Locator, Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, expect } from '@/playwright/suite';
import { api, createProject, writeText } from '@/api';
import type { ToolsDevRuntime } from '@/tools-dev/runtime';
import { expectIndependentWorkspace, screenshot, useChinese } from '@/playwright/workspace';

// Reachability audit of the production workspace, not a mock generation harness.
// The caller owns the production build. In particular this must not rebuild or
// stop an existing preview. No provider, extension or execution adapter is used.
// Each screenshot has a DOM inventory so registered-but-unrendered node types
// cannot accidentally be counted as coverage. Missing template capabilities and
// the old resource-picker/tooltip baseline are recorded, not called regressions.
async function capture(page: Page, info: TestInfo, name: string) {
  await screenshot(page, info, name);
  const inventory = JSON.stringify(await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      zoom: document.querySelector('[data-canvas-menu-trigger="zoom"]')?.textContent,
      nodes: Array.from(document.querySelectorAll('.react-flow__node')).map(node => ({
        id: node.getAttribute('data-id'), classes: node.className,
        selected: node.classList.contains('selected'), rect: node.getBoundingClientRect().toJSON(),
      })),
      overlays: Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]')).filter(node => node.getBoundingClientRect().width > 0).map(node => ({
        label: node.getAttribute('aria-label'), classes: node.className,
        rect: node.getBoundingClientRect().toJSON(), padding: getComputedStyle(node).padding,
      })),
    })), null, 2);
  const path = info.outputPath(`${name}-inventory.json`);
  await writeFile(path, inventory);
  await info.attach(`${name}-inventory`, { path, contentType: 'application/json' });
}

async function openProject(page: Page, runtime: ToolsDevRuntime, name: string) {
  const id = await createProject(runtime, name);
  await useChinese(page);
  await page.goto(`/?projectId=${id}`);
  await expectIndependentWorkspace(page);
  await expect(page.getByTestId('canvas-workbench-surface')).toBeVisible();
  return id;
}
async function addNode(page: Page, name: string) {
  const before = await page.locator('.react-flow__node').count();
  await page.locator('.dock-primary').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
  const node = page.locator('.react-flow__node.selected');
  await expect(node).toHaveCount(1);
  const id = await node.getAttribute('data-id');
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}
async function zoomTo(page: Page, percent: 50 | 100) {
  await page.locator('[data-canvas-menu-trigger="zoom"]').click();
  await page.getByRole('menuitem', { name: `${percent}%`, exact: true }).click();
  await expect(page.locator('[data-canvas-menu-trigger="zoom"]')).toHaveText(`${percent}%`);
}
async function inViewport(page: Page, panel: Locator) {
  await expect(panel).toBeVisible();
  const rect = await panel.boundingBox();
  const view = page.viewportSize()!;
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(-1);
  expect(rect!.y).toBeGreaterThanOrEqual(-1);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(view.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(view.height + 1);
}
// A real decodable, local PNG; the detached canvas only constructs test bytes.
// No product DOM, React store, fetch, or internal canvas API is replaced.
async function pngFixture(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 1200, 800);
    gradient.addColorStop(0, '#164b63'); gradient.addColorStop(1, '#eab77d');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#f7f3e8'; ctx.fillRect(110, 140, 980, 520);
    ctx.fillStyle = '#164b63'; ctx.font = 'bold 70px sans-serif'; ctx.fillText('LOCAL IMAGE AUDIT', 165, 325);
    ctx.font = '32px sans-serif'; ctx.fillText('Crop / grade / annotate without a generator', 165, 420);
    ctx.fillStyle = '#b76b42'; ctx.beginPath(); ctx.arc(1000, 620, 70, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return { name: 'visual-audit.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

function wavFixture() {
  const rate = 8000, samples = rate * 4;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(2000 * Math.sin(index * Math.PI * 880 / rate)), 44 + index * 2);
  return { name: 'visual-audit.wav', mimeType: 'audio/wav', buffer };
}

for (const width of [1440, 840]) {
  test(`[P0] video unconfigured-catalog boundary at ${width}px`, async ({ page, runtime }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await openProject(page, runtime, `视频输入视觉-${width}`);
    const node = await addNode(page, '视频');
    if (width === 840) await zoomTo(page, 50);
    await expect(node.getByRole('status')).toContainText('暂无已配置的视频模型');
    // VideoCanvasNode deliberately does not mount EnabledVideoCanvasNode when
    // the real server catalog is empty. Do not fabricate a provider to see it.
    await expect(node.locator('select')).toHaveCount(0);
    await expect(node.locator('.video-node-camera-trigger')).toHaveCount(0);
    await expect(node.getByRole('button', { name: '复制视频', exact: true })).toBeAttached();
    await capture(page, info, `video-unconfigured-${width}`);
    info.annotations.push({ type: 'coverage-boundary', description: 'Real video selects require an actual media catalog; unconfigured runtime deliberately hides the composer. Camera control is exercised through the reachable storyboard field instead.' });
  });
}

test('[P0] uploaded image has real crop, grading and annotation surfaces', async ({ page, runtime }, info) => {
  const id = await openProject(page, runtime, '图片编辑视觉');
  const file = await pngFixture(page);
  const transfer = await page.evaluateHandle(({ base64, name, mimeType }) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type: mimeType })); return dt;
  }, { base64: file.buffer.toString('base64'), name: file.name, mimeType: file.mimeType });
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/projects/${id}/upload`);
  // Native file-drop event enters the same production upload path as the user.
  await page.locator('.react-flow__pane').dispatchEvent('drop', { dataTransfer: transfer, clientX: 440, clientY: 270 });
  expect((await uploaded).ok()).toBe(true);
  await transfer.dispose();
  const node = page.locator('.react-flow__node-imageAsset');
  await expect(node).toHaveCount(1);
  await node.locator('.image-asset-frame').click();
  await expect(node).toHaveClass(/selected/);
  await expect(node.locator('.image-asset-prompt-composer select')).toHaveCount(4);
  await expect.poll(async () => JSON.stringify((await api<{ state: unknown }>(runtime, `/api/projects/${id}/canvas/state`)).state).includes(file.name)).toBe(true);
  await capture(page, info, 'image-uploaded-selected');
  await node.getByRole('button', { name: '裁剪', exact: true }).click();
  const crop = page.getByRole('dialog', { name: '裁剪图片', exact: true });
  await inViewport(page, crop);
  await expect(crop.getByRole('button', { name: '1:1', exact: true })).toBeEnabled();
  await crop.getByRole('button', { name: '1:1', exact: true }).click();
  await capture(page, info, 'image-crop-square');
  await crop.getByRole('button', { name: '取消', exact: true }).last().click();
  await expect(crop).toHaveCount(0);
  await node.getByRole('button', { name: '调色', exact: true }).click();
  const grade = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '调色', exact: true }) });
  await expect(grade).toBeVisible();
  const slider = grade.getByRole('slider', { name: '曝光', exact: true });
  await expect(slider).toBeEnabled();
  await slider.focus(); await page.keyboard.press('ArrowRight');
  await capture(page, info, 'image-color-grade');
  await grade.getByRole('button', { name: '取消', exact: true }).click();
  await node.getByRole('button', { name: '标注', exact: true }).click();
  const annotation = page.locator('.minimax-annotation-v2');
  await expect(annotation).toBeVisible();
  await annotation.locator('[data-tool="text"]').click();
  await annotation.locator('.minimax-annotation-menu-wrap button').first().click();
  await expect(page.locator('.minimax-annotation-font-menu:visible')).toBeVisible();
  await capture(page, info, 'image-annotation-font-menu');
  await page.locator('.minimax-annotation-font-menu[data-state="open"]').getByRole('menuitemradio').first().click();
  await annotation.locator('[data-tool="brush"]').click();
  await capture(page, info, 'image-annotation-pen');
});

test('[P0] freely edited storyboard fields, frame upload and preview are reachable', async ({ page, runtime }, info) => {
  const id = await openProject(page, runtime, '分镜字段视觉');
  const node = await addNode(page, '分镜');
  await node.getByRole('button', { name: '自由编辑', exact: true }).click();
  await expect(page.locator('.react-flow__node-storyboardAssetGroup')).toHaveCount(2);
  await zoomTo(page, 50);
  const shots = node.locator('.storyboard-shot-item');
  if (await shots.count() === 0) await node.getByRole('button', { name: '添加镜头', exact: true }).click();
  const shot = shots.first();
  await shot.getByRole('button', { name: /编辑.*画面描述/ }).click();
  const field = page.locator('.storyboard-field-popover[data-state="open"]');
  await expect(field).toBeVisible();
  await field.locator('textarea').fill('黄昏的街角，一位行人缓慢穿过暖色窗光；保留长描述以核验字段排版。');
  await capture(page, info, 'storyboard-description-50pct');
  await field.getByRole('button', { name: '保存', exact: true }).click();
  await shot.getByRole('button', { name: /编辑.*景别/ }).click();
  await expect(field).toBeVisible();
  const option = field.locator('.storyboard-field-options button').first();
  await option.click();
  await capture(page, info, 'storyboard-shot-options');
  await field.getByRole('button', { name: '保存', exact: true }).click();
  await page.setViewportSize({ width: 840, height: 960 });
  await shot.getByRole('button', { name: /编辑.*画面描述/ }).click();
  await inViewport(page, field);
  await capture(page, info, 'storyboard-description-narrow-50pct');
  await field.getByRole('button', { name: '保存', exact: true }).click();
  for (const width of [840, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await shot.getByRole('button', { name: /编辑.*运镜/ }).click();
    const camera = page.locator('.video-node-camera-popover[data-state="open"]');
    await inViewport(page, camera);
    await expect(camera).toHaveCSS('padding', '0px');
    const moves = camera.locator('.video-node-camera-move-button');
    await expect(moves).toHaveCount(13);
    await moves.nth(1).click();
    await expect(moves.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await capture(page, info, `storyboard-camera-${width}-50pct`);
    await camera.locator('.video-node-camera-footer button').click();
    await expect(camera).toHaveCount(0);
  }
  await shot.locator('.storyboard-shot-image').first().click();
  const frame = page.locator('.storyboard-shot-settings:visible');
  await expect(frame).toBeVisible();
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/projects/${id}/upload`);
  await frame.locator('input[type="file"]').setInputFiles(await pngFixture(page));
  expect((await uploaded).ok()).toBe(true);
  await expect(shot.locator('.storyboard-shot-image img')).toBeVisible();
  await expect(page.locator('.react-flow__node-storyboardGallery')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-storyboardImageStack')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await capture(page, info, 'storyboard-frame-upload-preview');
});

test('[P0] clip detail accepts local media and opens export and inspector menus', async ({ page, runtime }, info) => {
  const id = await openProject(page, runtime, '剪辑详细视觉');
  const node = await addNode(page, '剪辑');
  await node.locator('.clip-empty').click();
  const picker = page.getByRole('dialog');
  await expect(picker).toBeVisible();
  await picker.getByRole('tab', { name: /上传/ }).click();
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/projects/${id}/files`);
  await picker.locator('input[type="file"]').setInputFiles(await pngFixture(page));
  expect((await uploaded).ok()).toBe(true);
  await expect(picker).toHaveCount(0);
  await capture(page, info, 'clip-local-image-timeline');
  await node.getByRole('button', { name: /进入详细/ }).click();
  await expect(page.getByRole('button', { name: '导出视频', exact: true })).toBeEnabled();
  await capture(page, info, 'clip-detailed-editor');
  await page.locator('.clip-timeline').getByRole('button', { name: /visual-audit.png，开始/ }).click();
  const animation = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '动画与转场' }) });
  await animation.locator('summary').click();
  await animation.locator('select').selectOption('fade');
  await expect(animation.locator('select')).toHaveValue('fade');
  await capture(page, info, 'clip-inspector-animation-options');
  await page.getByRole('button', { name: '添加素材', exact: true }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole('tab', { name: /上传/ }).click();
  const audioUploaded = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/projects/${id}/files`);
  await picker.locator('input[type="file"]').setInputFiles(wavFixture());
  expect((await audioUploaded).ok()).toBe(true);
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.clip-timeline').getByRole('button', { name: /visual-audit.wav，开始/ })).toBeVisible();
  await page.getByRole('button', { name: '播放监视器', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluateAll(elements => elements.some(element => {
    const audio = element as HTMLAudioElement;
    return !audio.paused && audio.readyState >= 2 && audio.currentTime > 0.1;
  }))).toBe(true);
  await page.getByRole('button', { name: '暂停监视器', exact: true }).click();
  await capture(page, info, 'clip-real-audio-track-and-inspector');
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '导出剪辑', exact: true });
  await inViewport(page, panel);
  await panel.locator('select').first().selectOption('png');
  await expect(panel.locator('select').nth(2)).toBeDisabled();
  await capture(page, info, 'clip-export-png-options');
  await panel.locator('select').first().selectOption('mp4');
  await expect(panel.locator('select').nth(2)).toBeEnabled();
  await capture(page, info, 'clip-export-mp4-options');
  // Do not invoke ffmpeg or claim a successful generated export.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

for (const kind of ['文本', '网页', 'PPT']) {
  test(`[P0] ${kind} node selection and real template entry are reachable`, async ({ page, runtime }, info) => {
    const id = await openProject(page, runtime, `${kind}入口视觉`);
    await writeText(runtime, id, '本地参考.md', '# 本地参考\n\n本测试不调用外部执行器。');
    const node = await addNode(page, kind);
    await capture(page, info, `${kind}-selected-composer`);
    const template = node.getByRole('button', { name: /^(模板|Template)$/ });
    await expect(template).toBeVisible();
    await template.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await capture(page, info, `${kind}-template-entry`);
    await info.attach('template-capability-boundary.txt', { contentType: 'text/plain', body: await dialog.innerText() });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    if (kind === '网页') {
      await node.getByRole('button', { name: '设计系统', exact: true }).click();
      await expect(dialog).toBeVisible();
      await capture(page, info, 'web-design-system-entry');
    } else {
      await node.locator('[aria-haspopup="menu"]').first().click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menu')).toHaveCSS('opacity', '1');
      await capture(page, info, `${kind}-length-menu`);
    }
  });
}
