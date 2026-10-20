// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocumentPreview, ProjectFile } from '@bezier/contracts';
import { I18nProvider } from '../src/i18n';
vi.mock('../src/components/HtmlViewer', () => ({ HtmlViewer: () => null }));
vi.mock('../src/providers/registry', async importOriginal => ({
  ...await importOriginal<typeof import('../src/providers/registry')>(), fetchProjectFilePreview: vi.fn(),
}));
import { fetchProjectFilePreview } from '../src/providers/registry';
import { FileViewer } from '../src/components/FileViewer';
afterEach(() => { cleanup(); vi.mocked(fetchProjectFilePreview).mockReset(); });

function openPreview(kind: ProjectFile['kind'], preview: ProjectDocumentPreview, locale: 'en' | 'zh-CN' = 'zh-CN') {
  vi.mocked(fetchProjectFilePreview).mockResolvedValue(preview);
  const file: ProjectFile = { name: 'User file', kind, mime: 'application/octet-stream', mtime: 1, size: 1 };
  return render(<I18nProvider initial={locale}><FileViewer projectId="test" file={file}/></I18nProvider>);
}

describe('structured document preview localization', () => {
  it('uses notice metadata rather than interpreting identical user text', async () => {
    openPreview('document', { title: 'User file', sections: [
      { title: 'Document', lines: ['No readable text found.'], notice: 'no-readable-text' },
      { title: 'User heading', lines: ['No readable text found.'] },
    ] });
    expect(await screen.findByText('未找到可读取的文字。')).toBeTruthy();
    expect(screen.getByText('No readable text found.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '文档', level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'User heading', level: 3 })).toBeTruthy();
  });
  it('localizes only generated worksheet titles and structured empty notices', async () => {
    openPreview('spreadsheet', { title: 'User file', sections: [
      { title: 'Sheet 1', generatedTitle: 'sheet', lines: ['No readable cell values found.'], notice: 'no-readable-cells' },
      { title: 'Sheet 2', lines: ['User content'] },
      { title: 'Spreadsheet', lines: ['No readable sheets found.'], notice: 'no-readable-sheets' },
    ] });
    expect(await screen.findByRole('heading', { name: '工作表 1', level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sheet 2', level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '电子表格', level: 3 })).toBeTruthy();
    expect(screen.getByText('未找到可读取的单元格内容。')).toBeTruthy();
    expect(screen.getByText('未找到可读取的工作表。')).toBeTruthy();
  });
  it('retains an explicit English rendering', async () => {
    openPreview('presentation', { title: 'User file', sections: [{ title: 'Slide 1', lines: ['No readable text found.'], notice: 'no-readable-text' }] }, 'en');
    expect(await screen.findByRole('heading', { name: 'Slide 1', level: 3 })).toBeTruthy();
    expect(screen.getByText('No readable text found.')).toBeTruthy();
  });
});
