import { describe, expect, it } from 'vitest';
import path from 'node:path';
import JSZip from 'jszip';
import { buildDocumentPreview } from '../src/artifacts/document-preview.js';
const dataRoot = path.resolve('.tmp/document-preview-localization');
async function preview(name: string, entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [entry, content] of Object.entries(entries)) zip.file(entry, content);
  return buildDocumentPreview({ name, buffer: await zip.generateAsync({ type: 'nodebuffer' }) }, dataRoot);
}
describe('generated preview text localization metadata', () => {
  it('marks empty document text without changing compatibility lines', async () => {
    const result = await preview('empty.docx', { 'word/document.xml': '<w:document/>' });
    expect(result.sections).toEqual([{ title: 'Document', lines: ['No readable text found.'], notice: 'no-readable-text' }]);
  });
  it('does not mark matching user prose as an empty-state message', async () => {
    const result = await preview('user.docx', { 'word/document.xml': '<w:document><w:p><w:t>No readable text found.</w:t></w:p></w:document>' });
    expect(result.sections).toEqual([{ title: 'Document', lines: ['No readable text found.'] }]);
  });
  it('marks the generated empty presentation and workbook states', async () => {
    const deck = await preview('empty.pptx', { 'unused.xml': '<empty/>' });
    expect(deck.sections[0]).toMatchObject({ notice: 'no-readable-slides' });
    const workbook = await preview('empty.xlsx', { 'unused.xml': '<empty/>' });
    expect(workbook.sections[0]).toMatchObject({ notice: 'no-readable-sheets' });
  });
  it('distinguishes generated worksheet names from explicitly named user worksheets', async () => {
    const xml = '<worksheet><row><c t="inlineStr"><is><t>No readable cell values found.</t></is></c></row></worksheet>';
    const unnamed = await preview('fallback.xlsx', { 'xl/worksheets/sheet1.xml': xml });
    expect(unnamed.sections[0]).toMatchObject({ title: 'Sheet 1', generatedTitle: 'sheet', lines: ['No readable cell values found.'] });
    const named = await preview('named.xlsx', { 'xl/worksheets/sheet1.xml': xml, 'xl/workbook.xml': '<workbook><sheet name="Sheet 1" r:id="r1"/></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>' });
    expect(named.sections[0]).toEqual({ title: 'Sheet 1', lines: ['No readable cell values found.'] });
  });
});
