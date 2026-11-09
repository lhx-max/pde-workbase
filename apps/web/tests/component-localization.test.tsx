// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider, tForLanguageTag } from '../src/i18n';
import { normalizeManualEditStyles } from '../src/components/html-viewer/ManualEditPanel';
import { MarkdownWordDocument } from '../src/components/MarkdownWordDocument';
import { DeckThumbnailRail } from '../src/components/DeckThumbnailRail';
import { documentPreviewSectionTitle } from '../src/components/document-preview-labels';
import { AnnotationStyleSummary } from '../src/components/BoardComposerPopover';
import { AssetInspectorViews } from '../src/components/AssetInspectorViews';
import { BrowserCollectorPanel } from '../src/components/BrowserCollectorPanel';
import type { PreviewCommentSnapshot } from '../src/comments';

const target = {
  elementId: 'sample', label: 'Customer heading', position: { x: 0, y: 0, width: 100, height: 40 },
  style: { color: '#123456', backgroundColor: '#ffffff', fontFamily: 'Inter', fontSize: '16px', lineHeight: '24px' },
} as PreviewCommentSnapshot;
afterEach(cleanup);

describe('first-party Chinese component copy', () => {
  it('translates annotation metadata without changing user content or font names', () => {
    render(<I18nProvider initial="zh-CN"><AnnotationStyleSummary target={target}/></I18nProvider>);
    for (const label of ['尺寸', '颜色', '背景', '字体', '行高']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('16px Inter')).toBeTruthy();
    expect(screen.queryByText('Size')).toBeNull();
  });
  it('translates the asset prompt tab while retaining the YAML format name', () => {
    render(<I18nProvider initial="zh-CN"><AssetInspectorViews view="info" onViewChange={() => {}} info="User asset" prompt="User prompt" yaml="User YAML"/></I18nProvider>);
    expect(screen.getByRole('tab', { name: '提示词' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'YAML' })).toBeTruthy();
    expect(screen.getByText('User asset')).toBeTruthy();
  });
  it('keeps a usable explicit English option', () => {
    render(<I18nProvider initial="en"><AnnotationStyleSummary target={target}/></I18nProvider>);
    expect(screen.getByText('Size')).toBeTruthy();
    expect(screen.getByText('Color')).toBeTruthy();
  });
  it('localizes document formatting and deck navigation accessibility labels', () => {
    render(<I18nProvider initial="zh-CN">
      <MarkdownWordDocument markdown="User heading" editable onChange={() => {}}/>
      <DeckThumbnailRail count={0} activeIndex={0} buildThumbSrcDoc={() => ''} onSelect={() => {}}/>
    </I18nProvider>);
    expect(screen.getByRole('toolbar', { name: '文档格式' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '段落样式' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: '幻灯片' })).toBeTruthy();
  });
  it('localizes manual style validation without changing accepted CSS values', () => {
    const t = tForLanguageTag('zh-CN')!;
    expect(normalizeManualEditStyles({ opacity: 'oops' }, { layoutEnabled: true }, t)).toEqual({ ok: false, error: '不透明度必须是数字。' });
    expect(normalizeManualEditStyles({ fontSize: 'oops' }, { layoutEnabled: true }, t)).toEqual({ ok: false, error: '请输入数字、px、% 或受支持的 auto 值。' });
    expect(normalizeManualEditStyles({ textAlign: 'left', width: '50%' }, { layoutEnabled: true }, t)).toEqual({ ok: true, styles: { textAlign: 'left', width: '50%' } });
    expect(normalizeManualEditStyles({ opacity: 'oops' }, { layoutEnabled: true }, tForLanguageTag('en')!)).toEqual({ ok: false, error: 'Opacity must be a number.' });
  });
  it('localizes only known generated Office section headings, not sheet names or arbitrary headings', () => {
    const t = tForLanguageTag('zh-CN')!;
    expect(documentPreviewSectionTitle('document', 'Document', 0, t)).toBe('文档');
    expect(documentPreviewSectionTitle('presentation', 'Slide 2', 1, t)).toBe('幻灯片 2');
    expect(documentPreviewSectionTitle('spreadsheet', 'Document', 0, t)).toBe('Document');
    expect(documentPreviewSectionTitle('spreadsheet', 'Slide 2', 1, t)).toBe('Slide 2');
    expect(documentPreviewSectionTitle('document', 'Customer heading', 0, t)).toBe('Customer heading');
    expect(documentPreviewSectionTitle('presentation', 'Slide 99', 1, t)).toBe('Slide 99');
    expect(documentPreviewSectionTitle('presentation', 'Slide 2', 1, tForLanguageTag('en')!)).toBe('Slide 2');
  });
  it('shows the Chinese collection capability limitation without a native bridge', () => {
    render(<I18nProvider initial="zh-CN"><BrowserCollectorPanel projectId="test" files={[]} onRefreshFiles={() => {}}/></I18nProvider>);
    expect(screen.getByText('在桌面端边浏览边采集')).toBeTruthy();
  });
});
