import { test, expect } from '@/playwright/suite';
import { api, createProject } from '@/api';
import { expectIndependentWorkspace, screenshot, useChinese } from '@/playwright/workspace';
import { createOfficeTextFixture, type OfficeFixtureKind } from '@/tools-dev/office-fixture';

// Acceptance of the original DocumentPreviewViewer: structured text, NOT Office
// page/slide/grid rendering, editing, formula evaluation or full format fidelity.
const cases: Array<{
  kind: OfficeFixtureKind;
  previewKind: string;
  image: string;
  // Protocol section titles stay unchanged; only product UI labels are localized.
  displayTitles: string[];
  sections: Array<{ title: string; lines: string[] }>;
}> = [
  {
    kind: 'docx', previewKind: 'document', image: '34-docx-text-preview', displayTitles: ['文档'],
    sections: [{ title: 'Document', lines: ['画布研究 & 评审', '第二段：仅预览文本。'] }],
  },
  {
    kind: 'pptx', previewKind: 'presentation', image: '35-pptx-text-preview', displayTitles: ['幻灯片 1', '幻灯片 2'],
    sections: [
      { title: 'Slide 1', lines: ['画布 & 参考资料', '第一张幻灯片：仅预览文本。'] },
      { title: 'Slide 2', lines: ['交付清单', '下载保留原始字节。'] },
    ],
  },
  {
    kind: 'xlsx', previewKind: 'spreadsheet', image: '36-xlsx-text-preview', displayTitles: ['研究 & 成本', '汇总'],
    sections: [
      { title: '研究 & 成本', lines: ['项目 & 来源 | 成本', '画布示例 | 42'] },
      { title: '汇总', lines: ['纯文本合计 | 42'] },
    ],
  },
];

for (const sample of cases) {
  test(`[P0] ${sample.kind.toUpperCase()} sidebar discovery, Quick Switcher structured text-only preview and exact download bytes`, async ({ page, runtime }, testInfo) => {
    const id = await createProject(runtime, `${sample.kind.toUpperCase()} 纯文本预览验收`);
    const fixture = await createOfficeTextFixture(runtime, sample.kind);
    const repeated = await createOfficeTextFixture(runtime, sample.kind);
    expect(repeated.bytes.equals(fixture.bytes), 'synthetic archive bytes are deterministic').toBe(true);
    const uploaded = await api<{ file: { name: string } }>(runtime, `/api/projects/${id}/files`, {
      name: fixture.name, content: fixture.bytes.toString('base64'), encoding: 'base64',
    });
    expect(uploaded.file.name).toBe(fixture.name);

    await useChinese(page);
    await page.goto(`/?projectId=${id}`);
    await expectIndependentWorkspace(page);
    await page.locator('.dock-assets-button').click();
    await expect(page.getByTestId('canvas-assets-sidebar')).toBeVisible();
    const file = page.getByTestId(`canvas-sidebar-file-${fixture.name}`);
    await expect(file).toBeVisible();
    await file.getByTitle(fixture.name, { exact: true }).click();
    // Sidebar rows currently select only; their onOpenFile prop is not wired.
    // Use the original user-facing file palette, not injected state or app internals.
    await page.keyboard.press('ControlOrMeta+p');
    const palette = page.locator('.qs-overlay[role="dialog"]');
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox').fill(fixture.name);
    const previewResponse = page.waitForResponse(response =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/projects/${id}/files/${encodeURIComponent(fixture.name)}/preview`);
    await palette.getByRole('option').filter({ hasText: fixture.name }).click();
    const response = await previewResponse;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ kind: sample.previewKind, title: fixture.name, sections: sample.sections });

    const viewer = page.locator('.document-viewer:visible');
    const preview = viewer.locator('.document-preview');
    await expect(preview.getByRole('heading', { level: 2 })).toHaveText(fixture.name);
    const sections = preview.locator('section');
    await expect(sections).toHaveCount(sample.sections.length);
    for (const [index, expected] of sample.sections.entries()) {
      await expect(sections.nth(index).getByRole('heading', { level: 3 })).toHaveText(sample.displayTitles[index]!);
      await expect(sections.nth(index).locator('p')).toHaveText(expected.lines);
    }
    await expect(viewer.getByRole('alert')).toHaveCount(0);
    const download = viewer.getByRole('link', { name: '下载', exact: true });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('download', fixture.name);
    // Verify the actual Download link's HTTP resource, not a mocked response or
    // a reconstructed archive. This does not claim OS/browser download UI coverage.
    const href = await download.getAttribute('href');
    expect(href).toBeTruthy();
    const downloaded = await page.request.get(new URL(href!, page.url()).href);
    expect(downloaded.status()).toBe(200);
    expect((await downloaded.body()).equals(fixture.bytes), 'Download resource preserves every uploaded byte').toBe(true);
    await screenshot(page, testInfo, sample.image);
  });
}
