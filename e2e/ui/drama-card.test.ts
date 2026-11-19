import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { api, createProject } from '@/api';
import { expect, test } from '@/playwright/suite';
import { useChinese } from '@/playwright/workspace';
import type { ToolsDevRuntime } from '@/tools-dev/runtime';

const fixture = fileURLToPath(new URL('../../packages/canvas-pack-drama-audio/demo/materials/念念有回响_7582803412262063398.mp4', import.meta.url));
const nodeId = 'drama-pack-test';
const instanceRoute = (project: string) => `/api/apps/canvas/instances/${project}`;

type Snapshot = { data: { revision: number; state: { workbenchBasicNodes?: { id: string; data: Record<string, unknown> }[] } } };

async function seedCard(runtime: ToolsDevRuntime, project: string, data: Record<string, unknown>) {
  const path = instanceRoute(project);
  const initial = await api<Snapshot>(runtime, `${path}/state`);
  await api(runtime, `${path}/operations`, {
    operationId: randomUUID(), baseRevision: initial.data.revision,
    operations: [{ type: 'node.create', node: { id: nodeId, kind: 'card.drama.audio', title: '短剧配音', x: 0, y: 0, width: 380, height: 215, data } }],
  });
  return async () => (await api<Snapshot>(runtime, `${path}/state`)).data.state.workbenchBasicNodes?.find(node => node.id === nodeId)?.data;
}

test('canvas dubbing card imports media, persists edits and restores media after reload', async ({ page, runtime }) => {
  const project = await createProject(runtime, '短剧配音卡包');
  const read = await seedCard(runtime, project, { stage: 'edit' });
  await useChinese(page);
  await page.goto(`/?projectId=${project}`);
  const open = page.getByRole('button', { name: '打开短剧配音编辑器', exact: true });
  await open.click();
  const editor = page.getByRole('dialog', { name: '短剧配音编辑器' });
  const button = (name: string) => editor.getByRole('button', { name, exact: true });
  await expect(editor.getByRole('heading', { name: '音频时间轴' })).toBeVisible();

  const media = page.waitForEvent('filechooser');
  await button('导入主视频').click();
  await (await media).setFiles(fixture);
  await expect.poll(async () => Number((await read())?.videoDurationMs ?? 0)).toBeGreaterThan(1000);
  const script = page.waitForEvent('filechooser');
  await button('导入台词').click();
  await (await script).setFiles({ name: '台词.txt', mimeType: 'text/plain', buffer: Buffer.from('先核对配音。\n再确认画面。') });
  await expect.poll(async () => (await read())?.rewriteLines).toMatchObject([{ text: '先核对配音。' }, { text: '再确认画面。' }]);

  await editor.locator('[data-script-line-id]').first().click();
  await button('确认本句区间').click();
  await expect.poll(async () => (await read())?.confirmedLineIds).toHaveLength(1);
  await button('撤销').click();
  await expect.poll(async () => (await read())?.confirmedLineIds ?? []).toHaveLength(0);
  await button('重做').click();
  await expect.poll(async () => (await read())?.confirmedLineIds).toHaveLength(1);

  await button('导出').first().click();
  const downloaded = page.waitForEvent('download');
  await button('导出台词 SRT').click();
  await button('继续导出').click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('短剧台词.srt');
  expect(await readFile(await file.path(), 'utf8')).toContain('先核对配音。');

  await page.reload();
  await open.click();
  await expect(editor.locator('[data-script-line-id]')).toHaveCount(2);
  await expect(editor.locator('video')).toHaveCount(0);
  const restore = page.waitForEvent('filechooser');
  await button('恢复会话素材').click();
  await (await restore).setFiles(fixture);
  await expect.poll(() => editor.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThan(0);
});

test('existing local demo card and standalone dubbing workbench keep their entry points', async ({ page, runtime }) => {
  const project = await createProject(runtime, '旧版配音工作台');
  await seedCard(runtime, project, {
    stage: 'edit', demoProfile: 'local-test', demoProjectId: project, videoDurationMs: 3000,
    rewriteLines: [{ id: 'legacy-line', text: '旧版台词仍可编辑。', videoStartMs: 0, videoEndMs: 3000 }],
  });
  await useChinese(page);
  await page.goto(`/?projectId=${project}`);
  await expect(page.getByText('逐句配音编辑', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开短剧配音编辑器' })).toHaveCount(0);
  await page.goto(`/session-apps?projectId=${project}`);
  await expect(page.getByRole('heading', { name: '音频时间轴' })).toBeVisible();
  await expect(page.locator('[data-script-line-id]').first()).toContainText('旧版台词仍可编辑。');
});
