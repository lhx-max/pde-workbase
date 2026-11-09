import { test, expect } from '@/playwright/suite';
import { api, createProject, projectText } from '@/api';
import { useChinese } from '@/playwright/workspace';
import { guardMfBrowserNetwork } from '@/playwright/mf-network';
import { MF_FIXTURE_AIE, MF_FIXTURE_FILE, MF_FIXTURE_FILE_CONTENT } from '@/tools-dev/mf-fixture';
import { writeFile } from 'node:fs/promises';

test.use({ mfFixture: true });
test('real SDK workspace tree preview imports identical bytes only after host confirmation', async ({ page, runtime }, info) => {
  const fixture = runtime.mfFixture!;
  const offset = fixture.requests.length;
  const network = await guardMfBrowserNetwork(page);
  const id = await createProject(runtime, 'MF workspace preview import');
  const rawPath = '/api/kpandora/v1/sandbox/instance/workspace/file/raw';
  const rawRequests = () => fixture.requests.slice(offset).filter(r => r.path === rawPath);
  const importUrl = `/api/projects/${id}/mf/artifacts/import`;
  const importCalls: unknown[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(importUrl)) importCalls.push(request.postDataJSON()); });
  await useChinese(page);
  try {
    await page.goto(`/?projectId=${id}`);
    await page.getByTestId('mf-conversation-toggle').click();
    await expect(page.getByTestId('mf-new-session')).toBeEnabled();
    const frame = page.frameLocator('[data-testid="mf-conversation-frame"]');
    const editor = frame.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible();
    await editor.fill('Establish the native SDK session for explicit artifact import.');
    await editor.press('Enter');
    await expect.poll(() => fixture.requests.slice(offset).filter(r => r.path === '/api/kpandora/v1/chat/web').length).toBe(1);
    fixture.finishStreams();
    await expect(page.getByTestId('mf-new-session')).toBeEnabled();
    // Native tree, native file row, native text renderer; no injected React/DOM or bridge calls.
    await frame.getByRole('button', { name: 'MF 文件', exact: true }).click();
    const tree = frame.locator('.mf-tree');
    await expect(tree).toBeVisible();
    const notice = tree.getByRole('note');
    await expect(notice).toContainText('CDN');
    await expect(notice).toContainText('在线文档');
    await expect(notice).toContainText('元数据');
    const workspaceFile = tree.getByText(MF_FIXTURE_FILE.name, { exact: true }).filter({ visible: true }).first();
    await expect(workspaceFile).toBeVisible();
    await page.screenshot({ path: info.outputPath('mf-workspace-tree-warning.png') });
    await workspaceFile.click();
    const preview = frame.locator('.mf-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('MF_WORKSPACE_PREVIEW_FIXTURE');
    await expect.poll(() => rawRequests().length).toBe(1);
    const expectedQuery = { path: MF_FIXTURE_FILE.path, aieUsername: MF_FIXTURE_AIE };
    expect(rawRequests()[0]!.query).toEqual(expectedQuery);
    const confirmation = page.waitForEvent('dialog');
    const click = preview.getByRole('button', { name: '导入本地素材库', exact: true }).click();
    const dialog = await confirmation;
    expect(dialog.type()).toBe('confirm');
    expect(dialog.page()).toBe(page);
    expect(dialog.message()).toContain(MF_FIXTURE_FILE.name);
    expect(rawRequests()).toHaveLength(1); // Neither server download nor publication before host consent.
    expect(importCalls).toEqual([]);
    const importResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(importUrl));
    await dialog.accept();
    await click;
    const response = await importResponse;
    expect(response.ok(), `Import HTTP ${response.status()}: ${await response.text()}`).toBe(true);
    const sent = response.request().postDataJSON();
    expect(sent.artifact).toMatchObject({ source: 'workspace', path: MF_FIXTURE_FILE.path });
    expect(sent.artifact.spaceId).toBeUndefined();
    const result = await response.json() as { path: string; nodeId: string };
    expect(await projectText(runtime, id, result.path)).toBe(MF_FIXTURE_FILE_CONTENT);
    await expect.poll(() => rawRequests().length).toBe(2);
    expect(rawRequests()[1]!.query).toEqual(expectedQuery);
    expect(fixture.requests.slice(offset).some(r => r.path === '/api/kpandora/kim/workspace/file/raw')).toBe(false);
    const saved = await api<{ state: { workbenchBasicNodes?: Array<{ id: string }> } }>(runtime, `/api/projects/${id}/canvas/state`);
    expect(saved.state.workbenchBasicNodes).toHaveLength(1);
    expect(saved.state.workbenchBasicNodes?.[0]?.id).toBe(result.nodeId);
    const visibleNode = page.locator(`.react-flow__node[data-id="${result.nodeId}"]`);
    await expect(visibleNode).toBeVisible();
    await expect(visibleNode).toContainText('MF_WORKSPACE_PREVIEW_FIXTURE');
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    expect(fixture.requests.slice(offset).filter(r => r.method !== 'GET' && /\/workspace\//.test(r.path))).toEqual([]);
    expect(network.ssoHealthRequests).toEqual([]);
    expect(network.httpFailures).toEqual([]);
    expect(network.sdkFailures).toEqual([]);
    expect(network.errors).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
    await expect(preview).toContainText('工作区宿主已完成导入请求。');
    await page.screenshot({ path: info.outputPath('mf-workspace-preview-import.png') });
    // beta.18 PreviewPanelToolbar: more actions, fullscreen, and close are
    // fixed-size SDK icon buttons. Host button padding must not collapse SVGs.
    const toolbarButtons = preview.getByRole('button', { name: 'more actions', exact: true }).locator('..').locator(':scope > button');
    await expect(toolbarButtons).toHaveCount(3);
    const geometry = await toolbarButtons.evaluateAll(buttons => buttons.map(button => {
      const style = getComputedStyle(button), rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label'), width: rect.width, height: rect.height,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
        svgs: Array.from(button.querySelectorAll('svg')).map(svg => {
          const box = svg.getBoundingClientRect();
          return { width: box.width, height: box.height, glyph: svg.innerHTML };
        }) };
    }));
    const geometryPath = info.outputPath('mf-preview-toolbar-geometry.json');
    await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
    await info.attach('mf-preview-toolbar-geometry.json', { path: geometryPath, contentType: 'application/json' });
    for (const button of geometry) {
      expect(button.svgs, `${button.label}: toolbar must contain its native SVG`).toHaveLength(1);
      expect(button.svgs[0]!.width, `${button.label}: SDK glyph width with host padding ${button.paddingLeft}/${button.paddingRight}`).toBeGreaterThanOrEqual(12);
      expect(button.svgs[0]!.height).toBeGreaterThanOrEqual(12);
    }
    expect(new Set(geometry.map(button => button.svgs[0]!.glyph)).size).toBe(3);
  } finally {
    fixture.finishStreams();
    await network.attach(info);
    const path = info.outputPath('mf-artifact-protocol.json');
    await writeFile(path, JSON.stringify({ requests: fixture.requests.slice(offset), unexpected: fixture.unexpected }, null, 2));
    await info.attach('mf-artifact-protocol.json', { path, contentType: 'application/json' });
  }
});
